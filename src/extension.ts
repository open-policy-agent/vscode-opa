"use strict";

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { installBinary, OPA_CONFIG, REGAL_CONFIG, resolveBinary } from "./binaries";
import { activateDebugger } from "./da/activate";
import { activateRegal, isRegalRunning, restartRegal } from "./ls/clients/regal";
import * as opa from "./opa";
import { getPrettyTime } from "./util";

export const opaOutputChannel = vscode.window.createOutputChannel("OPA & Regal");

export class JSONProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  private content = "";

  public provideTextDocumentContent(_uri: vscode.Uri): string {
    return this.content;
  }

  get onDidChange(): vscode.Event<vscode.Uri> {
    return this._onDidChange.event;
  }

  public set(uri: vscode.Uri, note: string, output: any) {
    this.content = note;
    if (output !== undefined) {
      this.content += "\n" + JSON.stringify(output, undefined, 2);
    }
    this._onDidChange.fire(uri);
  }
}

export function activate(context: vscode.ExtensionContext) {
  vscode.window.onDidChangeActiveTextEditor(showCoverageOnEditorChange, null, context.subscriptions);
  vscode.workspace.onDidChangeTextDocument(removeDecorationsOnDocumentChange, null, context.subscriptions);

  activateCheckFile(context);
  activateCoverWorkspace(context);
  activateEvalPackage(context);
  activateEvalSelection(context);
  activateEvalCoverage(context);
  activateTestWorkspace(context);
  activateTraceSelection(context);
  activateProfileSelection(context);
  activatePartialSelection(context);
  activateRestartRegalCommand(context);

  // check for missing binaries and prompt to install them
  checkMissingBinaries();
  // start Regal language server
  activateRegal();
  // activate the debugger
  activateDebugger(context);

  // this will trigger the prompt to install OPA if missing, rather than waiting til on save
  // the manual running of a command
  opa.runWithStatus("opa", ["version"], "", (_code: number, _stderr: string, _stdout: string) => {});

  vscode.workspace.onDidChangeConfiguration((_event) => {
    // activateRegal is run here to catch newly installed language servers,
    // after their paths are updated.
    activateRegal();
    activateDebugger(context);
  });
}

// this is the decoration type for the eval result covering the whole line
export const evalResultDecorationType = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  after: {
    textDecoration: "none",
    fontWeight: "normal",
    fontStyle: "normal",
  },
});

// decoration type for the eval result covering only the rule name when the result is defined
export const evalResultTargetSuccessDecorationType = vscode.window.createTextEditorDecorationType({
  isWholeLine: false,
  backgroundColor: new vscode.ThemeColor("diffEditor.insertedTextBackground"),
});

// decoration type for the eval result covering only the rule name when the result is undefined
export const evalResultTargetUndefinedDecorationType = vscode.window.createTextEditorDecorationType({
  isWholeLine: false,
  backgroundColor: new vscode.ThemeColor("inputValidation.warningBackground"),
});

// remove all decorations from the active editor using the known types of decorations
export function removeDecorations() {
  Object.keys(fileCoverage).forEach((fileName) => {
    vscode.window.visibleTextEditors.forEach((value) => {
      if (value.document.fileName.endsWith(fileName)) {
        value.setDecorations(coveredHighlight, []);
        value.setDecorations(notCoveredHighlight, []);
      }
    });
  });

  fileCoverage = {};

  vscode.window.visibleTextEditors.forEach((value) => {
    value.setDecorations(evalResultDecorationType, []);
    value.setDecorations(evalResultTargetSuccessDecorationType, []);
    value.setDecorations(evalResultTargetUndefinedDecorationType, []);
  });
}

const outputUri = vscode.Uri.parse(`json:output.jsonc`);

const coveredHighlight = vscode.window.createTextEditorDecorationType({
  backgroundColor: "rgba(64,128,64,0.5)",
  isWholeLine: true,
});

const notCoveredHighlight = vscode.window.createTextEditorDecorationType({
  backgroundColor: "rgba(128,64,64,0.5)",
  isWholeLine: true,
});

interface UntypedObject {
  [key: string]: any;
}

let fileCoverage: UntypedObject = {};

function showCoverageOnEditorChange(editor: vscode.TextEditor | undefined) {
  if (!editor) {
    return;
  }
  showCoverageForEditor(editor);
}

function removeDecorationsOnDocumentChange(e: vscode.TextDocumentChangeEvent) {
  // output:extension-output is the output channel for the extensions
  // and should not be used for clearing decorations
  if (e.document.uri.toString().startsWith("output:extension-output")) {
    return;
  }

  // output URI is the URI of the JSON file used for the eval result output
  if (`${e.document.uri}` === `${outputUri}`) {
    return;
  }

  removeDecorations();
}

function showCoverageForEditor(_editor: vscode.TextEditor) {
  Object.keys(fileCoverage).forEach((fileName) => {
    vscode.window.visibleTextEditors.forEach((value) => {
      if (value.document.fileName.endsWith(fileName)) {
        value.setDecorations(coveredHighlight, fileCoverage[fileName].covered);
        value.setDecorations(notCoveredHighlight, fileCoverage[fileName].notCovered);
      }
    });
  });
}

function showCoverageForWindow() {
  vscode.window.visibleTextEditors.forEach((value) => {
    showCoverageForEditor(value);
  });
}

function setFileCoverage(result: any) {
  Object.keys(result.files).forEach((fileName) => {
    const report = result.files[fileName];
    if (!report) {
      return;
    }
    let covered = [];
    if (report.covered !== undefined) {
      covered = report.covered.map((range: any) => {
        return new vscode.Range(range.start.row - 1, 0, range.end.row - 1, 1000);
      });
    }
    let notCovered = [];
    if (report.not_covered !== undefined) {
      notCovered = report.not_covered.map((range: any) => {
        return new vscode.Range(range.start.row - 1, 0, range.end.row - 1, 1000);
      });
    }
    fileCoverage[fileName] = {
      covered: covered,
      notCovered: notCovered,
    };
  });
}

function formatQuery(query: string): string {
  const lines = query.split("\n");
  if (lines.length === 1) {
    return query;
  }
  const moreLines = lines.length - 1;
  return `${lines[0]} ... (+${moreLines} more line${moreLines === 1 ? "" : "s"})`;
}

function setEvalOutput(
  provider: JSONProvider,
  uri: vscode.Uri,
  stderr: string,
  result: any,
  inputPath: string,
  query: string,
) {
  if (stderr !== "") {
    opaOutputShow(stderr);
  }

  let inputMessage: string;
  if (inputPath === "") {
    inputMessage = "no input file";
  } else {
    inputMessage = inputPath.replace("file://", "");
    inputMessage = vscode.workspace.asRelativePath(inputMessage);
  }

  const displayQuery = formatQuery(query);

  if (result.result === undefined) {
    provider.set(
      outputUri,
      `// Query: ${displayQuery}\n// No results found. Took ${
        getPrettyTime(result.metrics.timer_rego_query_eval_ns)
      }. Used ${inputMessage} as input.`,
      undefined,
    );
  } else {
    let output: any;
    if (result.result[0].bindings === undefined) {
      output = result.result.map((x: any) => x.expressions.map((x: any) => x.value));
    } else {
      output = result.result.map((x: any) => x.bindings);
    }
    provider.set(
      uri,
      `// Query: ${displayQuery}\n// Found ${result.result.length} result${result.result.length === 1 ? "" : "s"} in ${
        getPrettyTime(result.metrics.timer_rego_query_eval_ns)
      } using ${inputMessage} as input.`,
      output,
    );
  }
}

function activateCheckFile(context: vscode.ExtensionContext) {
  const checkRegoFile = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const doc = editor.document;

    // Only check rego files
    if (doc.languageId === "rego") {
      const args: string[] = ["check"];

      ifInWorkspace(() => {
        if (opa.canUseBundleFlags()) {
          args.push("--bundle");
        }
        args.push(...opa.getRoots());
        args.push(...opa.getSchemaParams());
      }, () => {
        args.push(doc.uri.fsPath);
      });

      if (opa.canUseStrictFlag()) {
        args.push("--strict");
      }

      opa.runWithStatus("opa", args, "", (_code: number, stderr: string, _stdout: string) => {
        const output = stderr;
        if (output.trim() !== "") {
          opaOutputShowError(output);
        }
      });
    }
  };

  const checkRegoFileOnSave = () => {
    if (checkOnSaveEnabled()) {
      checkRegoFile();
    }
  };

  const checkFileCommand = vscode.commands.registerCommand("opa.check.file", checkRegoFile);
  // Need to use onWillSave instead of onDidSave because there's a weird race condition
  // that causes the callback to get called twice when we prompt for installing OPA
  vscode.workspace.onWillSaveTextDocument(checkRegoFileOnSave, null, context.subscriptions);

  context.subscriptions.push(checkFileCommand);
}

function activateCoverWorkspace(context: vscode.ExtensionContext) {
  const coverWorkspaceCommand = vscode.commands.registerCommand("opa.test.coverage.workspace", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    for (const fileName in fileCoverage) {
      if (editor.document.fileName.endsWith(fileName)) {
        removeDecorations();
        return;
      }
    }

    fileCoverage = {};

    const args: string[] = ["test", "--coverage", "--format", "json"];

    ifInWorkspace(() => {
      if (opa.canUseBundleFlags()) {
        args.push("--bundle");
      }

      args.push(...opa.getRoots());
    }, () => {
      args.push(editor.document.uri.fsPath);
    });

    opa.run("opa", args, "", (_, result) => {
      setFileCoverage(result);
      showCoverageForWindow();
    }, opaOutputShowError);
  });

  context.subscriptions.push(coverWorkspaceCommand);
}

function activateEvalPackage(context: vscode.ExtensionContext) {
  const provider = new JSONProvider();
  const registration = vscode.workspace.registerTextDocumentContentProvider(outputUri.scheme, provider);

  const evalPackageCommand = vscode.commands.registerCommand(
    "opa.eval.package",
    onActiveWorkspaceEditor(outputUri, (editor: vscode.TextEditor, _inWorkspace: boolean) => {
      opa.parse("opa", opa.getDataDir(editor.document.uri), (pkg: string, _: string[]) => {
        const { inputPath, args } = createOpaEvalArgs(editor, pkg);
        args.push("--metrics");

        provider.set(outputUri, "// Evaluating...", undefined);

        opa.run("opa", args, "data." + pkg, (stderr, result) => {
          setEvalOutput(provider, outputUri, stderr, result, inputPath, "data." + pkg);
        }, opaOutputShowError);
      }, (error: string) => {
        opaOutputShowError(error);
      });
    }),
  );

  context.subscriptions.push(evalPackageCommand, registration);
}

function activateEvalSelection(context: vscode.ExtensionContext) {
  const provider = new JSONProvider();
  const registration = vscode.workspace.registerTextDocumentContentProvider(outputUri.scheme, provider);

  const evalSelectionCommand = vscode.commands.registerCommand(
    "opa.eval.selection",
    onActiveWorkspaceEditor(outputUri, (editor: vscode.TextEditor) => {
      opa.parse("opa", opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {
        const { inputPath, args } = createOpaEvalArgs(editor, pkg, imports);
        args.push("--metrics");

        const text = editor.document.getText(editor.selection);

        provider.set(outputUri, "// Evaluating...", undefined);

        opa.run("opa", args, text, (stderr, result) => {
          setEvalOutput(provider, outputUri, stderr, result, inputPath, text);
        }, opaOutputShowError);
      }, (error: string) => {
        opaOutputShowError(error);
      });
    }),
  );

  context.subscriptions.push(evalSelectionCommand, registration);
}

function activateEvalCoverage(context: vscode.ExtensionContext) {
  const provider = new JSONProvider();
  const registration = vscode.workspace.registerTextDocumentContentProvider(outputUri.scheme, provider);

  const evalCoverageCommand = vscode.commands.registerCommand(
    "opa.eval.coverage",
    onActiveWorkspaceEditor(outputUri, (editor: vscode.TextEditor) => {
      for (const fileName in fileCoverage) {
        if (editor.document.fileName.endsWith(fileName)) {
          removeDecorations();
          return;
        }
      }

      fileCoverage = {};

      opa.parse("opa", opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {
        const { inputPath, args } = createOpaEvalArgs(editor, pkg, imports);
        args.push("--metrics");
        args.push("--coverage");

        const text = editor.document.getText(editor.selection);

        provider.set(outputUri, "// Evaluating...", undefined);

        opa.run("opa", args, text, (stderr, result) => {
          setEvalOutput(provider, outputUri, stderr, result, inputPath, text);
          setFileCoverage(result.coverage);
          showCoverageForWindow();
        }, opaOutputShowError);
      }, (error: string) => {
        opaOutputShowError(error);
      });
    }),
  );

  context.subscriptions.push(evalCoverageCommand, registration);
}

function activateTestWorkspace(context: vscode.ExtensionContext) {
  const testWorkspaceCommand = vscode.commands.registerCommand("opa.test.workspace", () => {
    opaOutputChannel.show(true);
    opaOutputChannel.clear();

    const args: string[] = ["test"];

    args.push("--verbose");

    ifInWorkspace(() => {
      if (opa.canUseBundleFlags()) {
        args.push("--bundle");
      }
      args.push(...opa.getRoots());
    }, () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      args.push(editor.document.uri.fsPath);
    });

    opa.runWithStatus("opa", args, "", (code: number, stderr: string, stdout: string) => {
      if (code === 0 || code === 2) {
        opaOutputChannel.append(stdout);
      } else {
        opaOutputShowError(stderr);
      }
    });
  });

  context.subscriptions.push(testWorkspaceCommand);
}

function activateTraceSelection(context: vscode.ExtensionContext) {
  const traceSelectionCommand = vscode.commands.registerCommand("opa.trace.selection", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const text = editor.document.getText(editor.selection);

    opa.parse("opa", opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {
      const { args } = createOpaEvalArgs(editor, pkg, imports);
      args.push("--format", "pretty");
      args.push("--explain", "full");

      opa.runWithStatus("opa", args, text, (code: number, stderr: string, stdout: string) => {
        opaOutputChannel.show(true);
        opaOutputChannel.clear();

        if (code === 0 || code === 2) {
          opaOutputChannel.append(stdout);
        } else {
          opaOutputShowError(stderr);
        }
      });
    }, (error: string) => {
      opaOutputShowError(error);
    });
  });

  context.subscriptions.push(traceSelectionCommand);
}

function activateProfileSelection(context: vscode.ExtensionContext) {
  const profileSelectionCommand = vscode.commands.registerCommand("opa.profile.selection", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const text = editor.document.getText(editor.selection);

    opa.parse("opa", opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {
      opaOutputChannel.show(true);
      opaOutputChannel.clear();

      const { args } = createOpaEvalArgs(editor, pkg, imports);
      args.push("--profile");
      args.push("--format", "pretty");

      opa.runWithStatus("opa", args, text, (code: number, stderr: string, stdout: string) => {
        if (code === 0 || code === 2) {
          opaOutputChannel.append(stdout);
        } else {
          opaOutputShowError(stderr);
        }
      });
    }, (error: string) => {
      opaOutputShowError(error);
    });
  });

  context.subscriptions.push(profileSelectionCommand);
}

function activatePartialSelection(context: vscode.ExtensionContext) {
  const partialSelectionCommand = vscode.commands.registerCommand("opa.partial.selection", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const text = editor.document.getText(editor.selection);

    opa.parse("opa", opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {
      const depsArgs = ["deps", "--format", "json"];

      ifInWorkspace(() => {
        depsArgs.push(...opa.getRootParams());
      }, () => {
        depsArgs.push("--data", editor.document.uri.fsPath);
      });

      depsArgs.push("data." + pkg);

      opa.run("opa", depsArgs, "", (_, result: any) => {
        const refs = result.base.map((ref: any) => opa.refToString(ref));
        refs.push("input");
        vscode.window.showQuickPick(refs).then((selection: string | undefined) => {
          if (selection !== undefined) {
            opaOutputChannel.show(true);
            opaOutputChannel.clear();

            const { args } = createOpaEvalArgs(editor, pkg, imports);
            args.push("--partial");
            args.push("--format", "pretty");
            args.push("--unknowns", selection);

            opa.runWithStatus("opa", args, text, (code: number, stderr: string, stdout: string) => {
              if (code === 0 || code === 2) {
                opaOutputChannel.append(stdout);
              } else {
                opaOutputShowError(stderr);
              }
            });
          }
        });
      }, (msg) => {
        opaOutputShowError(msg);
      });
    }, (error: string) => {
      opaOutputShowError(error);
    });
  });

  context.subscriptions.push(partialSelectionCommand);
}

function activateRestartRegalCommand(context: vscode.ExtensionContext) {
  const restartRegalCommand = vscode.commands.registerCommand("opa.regal.restart", () => {
    restartRegal();
  });

  context.subscriptions.push(restartRegalCommand);
}

function onActiveWorkspaceEditor(
  forURI: vscode.Uri,
  cb: (editor: vscode.TextEditor, inWorkspace: boolean) => void,
): () => void {
  return async () => {
    // TODO(tsandall): test non-workspace mode. I don't know if this plugin
    // will work if a single file is loaded. Certain features may not work
    // but many can.
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No active editor");
      return;
    }

    const inWorkspace = !!vscode.workspace.workspaceFolders;

    // Execute the callback first to populate content
    cb(editor, !!inWorkspace);

    // Then open the read-only document beside the current editor.
    // If no read-only document exists yet, create a new one. If one exists,
    // re-use it.
    try {
      const doc = await vscode.workspace.openTextDocument(forURI);
      const found = vscode.window.visibleTextEditors.find((ed: vscode.TextEditor) => {
        return ed.document.uri === doc.uri;
      });

      if (found === undefined) {
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true);
      }
    } catch (error) {
      console.error("Failed to open output document:", error);
    }
  };
}

let informAboutWorkspace = true;
const informAboutWorkspaceOption = "Don't show this tip again";

function ifInWorkspace(yes: () => void, no: () => void = () => {}) {
  if (vscode.workspace.workspaceFolders) {
    yes();
  } else {
    if (informAboutWorkspace) {
      vscode.window.showInformationMessage(
        "You're editing a single file. Open it inside a workspace to include "
          + "any relative modules and schemas in the OPA commands you run.",
        informAboutWorkspaceOption,
      ).then((selection: string | undefined) => {
        if (selection === informAboutWorkspaceOption) {
          informAboutWorkspace = false;
        }
      });
    }
    no();
  }
}

export function deactivate() {
}

function opaOutputShow(msg: string) {
  opaOutputChannel.clear();
  opaOutputChannel.append(msg);
  opaOutputChannel.show(true);
}

function opaOutputShowError(error: string) {
  opaOutputChannel.clear();
  opaOutputChannel.append(formatErrors(error));
  opaOutputChannel.show(true);
}

function formatErrors(error: string): string {
  try {
    const output = JSON.parse(error);
    let errors;
    if (output.error !== undefined) {
      if (!Array.isArray(output.error)) {
        errors = [output.error];
      } else {
        errors = output.error;
      }
    } else if (output.errors !== undefined) {
      errors = output.errors;
    }
    const msg = [];
    for (let i = 0; i < errors.length; i++) {
      let location_prefix;
      if (errors[i].location.file !== "") {
        location_prefix = `${errors[i].location.file}:${errors[i].location.row}`;
      } else {
        location_prefix = `<query>`;
      }
      msg.push(`${location_prefix}: ${errors[i].code}: ${errors[i].message}`);
    }
    return msg.join("\n");
  } catch (_) {
    return error;
  }
}

function checkOnSaveEnabled() {
  return vscode.workspace.getConfiguration("opa").get<boolean>("checkOnSave");
}

export function existsSync(path: string): boolean {
  const parsed = vscode.Uri.parse(path);

  if (parsed.scheme === "file") {
    return fs.existsSync(parsed.fsPath);
  }

  return fs.existsSync(path);
}

export function getInputPath(): string {
  // look for input.json at the active editor's directory, or the workspace directory

  const activeDir = path.dirname(vscode.window.activeTextEditor!.document.uri.fsPath);
  let parsed = vscode.Uri.file(activeDir);

  // If we're in a workspace, and there is no sibling input.json to the actively edited file, look for the file in the workspace root
  if (
    !!vscode.workspace.workspaceFolders
    && vscode.workspace.workspaceFolders.length > 0
    && !fs.existsSync(path.join(activeDir, "input.json"))
  ) {
    const firstWorkspaceFolder = vscode.workspace.workspaceFolders[0];
    if (firstWorkspaceFolder) {
      parsed = firstWorkspaceFolder.uri;
    }
  }

  // If the rootDir is a file:// URL then just append /input.json onto the
  // end. Otherwise use the path.join function to get a platform-specific file
  // path returned.
  const rootDir = opa.getDataDir(parsed);

  if (parsed.scheme === "file") {
    return parsed.toString() + "/input.json";
  }

  return path.join(rootDir, "input.json");
}

function createOpaEvalArgs(
  editor: vscode.TextEditor,
  pkg: string,
  imports: string[] = [],
): { inputPath: string; args: string[] } {
  const args: string[] = ["eval"];

  args.push("--stdin");
  args.push("--package", pkg);

  let inputPath = getInputPath();
  if (existsSync(inputPath)) {
    args.push("--input", inputPath);
  } else {
    inputPath = "";
  }

  imports.forEach((x: string) => {
    args.push("--import", x);
  });

  ifInWorkspace(() => {
    args.push(...opa.getRootParams());
    args.push(...opa.getSchemaParams());
  }, () => {
    args.push("--data", editor.document.uri.fsPath);
  });

  return { inputPath, args };
}

// Check for missing binaries and prompt to install them
function checkMissingBinaries() {
  const missingBinaries: Array<{ config: typeof REGAL_CONFIG | typeof OPA_CONFIG; name: string }> = [];

  if (!resolveBinary(OPA_CONFIG, "opa").path) {
    missingBinaries.push({ config: OPA_CONFIG, name: "OPA" });
  }

  if (!resolveBinary(REGAL_CONFIG, "regal").path) {
    missingBinaries.push({ config: REGAL_CONFIG, name: "Regal" });
  }

  if (missingBinaries.length > 0) {
    const names = missingBinaries.map(b => b.name).join(" and ");
    const message = `${names} ${
      missingBinaries.length === 1 ? "is" : "are"
    } needed but not installed. Would you like to install ${missingBinaries.length === 1 ? "it" : "them"}?`;

    vscode.window.showInformationMessage(message, "Install")
      .then(async (selection) => {
        if (selection === "Install") {
          for (const binary of missingBinaries) {
            try {
              await installBinary(binary.config, opaOutputChannel);
            } catch (error) {
              console.error(`Failed to install ${binary.name}:`, error);
            }
          }

          // if any Regal binary was installed and if we need to start/restart it server
          const hasRegalBinary = missingBinaries.some(b => b.config === REGAL_CONFIG);
          if (hasRegalBinary) {
            if (isRegalRunning()) {
              opaOutputChannel.appendLine("Regal is running, restarting with new binary...");
              restartRegal();
            } else {
              opaOutputChannel.appendLine("Starting Regal with newly installed binary...");
              activateRegal();
            }
          }
        }
      });
  }
}
