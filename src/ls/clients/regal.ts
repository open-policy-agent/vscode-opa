import { execSync } from "child_process";
import { sync as commandExistsSync } from "command-exists";
import { existsSync } from "fs";
import * as semver from "semver";
import { ExtensionContext, window, workspace } from "vscode";
import * as vscode from "vscode";
import {
  CloseAction,
  CloseHandlerResult,
  ErrorAction,
  ErrorHandlerResult,
  LanguageClient,
  LanguageClientOptions,
  Message,
  ServerOptions,
} from "vscode-languageclient/node";
import {
  evalResultDecorationType,
  evalResultTargetSuccessDecorationType,
  evalResultTargetUndefinedDecorationType,
  opaOutputChannel,
  removeDecorations,
} from "../../extension";
import { promptForInstall } from "../../github-installer";
import { replaceWorkspaceFolderPathVariable } from "../../util";

let client: LanguageClient;
let clientLock = false;
let outChan: vscode.OutputChannel;
let activeDebugSessions: Map<string, void> = new Map();

const minimumSupportedRegalVersion = "0.18.0";

export function promptForInstallRegal(message: string) {
  const dlOpts = downloadOptionsRegal();
  promptForInstall(
    "regal",
    dlOpts.repo,
    message,
    dlOpts.determineBinaryURLFromRelease,
    dlOpts.determineExecutableName,
  );
}

export function isInstalledRegal(): boolean {
  if (commandExistsSync(regalPath())) {
    return true;
  }

  return false;
}

export function promptForUpdateRegal(minVer: string = minimumSupportedRegalVersion) {
  const version = regalVersion();

  if (version === "missing") {
    promptForInstallRegal("Regal is needed but not installed. Would you like to install it?");
    return;
  }

  // assumption here that it's a dev version or something, and ignore
  if (!semver.valid(version)) {
    return;
  }

  if (semver.gte(version, minVer)) {
    return;
  }

  const path = regalPath();
  let message =
    "The version of Regal that the OPA extension is using is out of date. Click \"Install\" to update it to a new one.";
  // if the path is not the path where VS Code manages Regal,
  // then we show another message
  if (path === "regal") {
    message = "Installed Regal version " + version + " is out of date and is not supported. Please update Regal to "
      + minVer
      + " using your preferred method. Or click \"Install\" to use a version managed by the OPA extension.";
  }

  promptForInstallRegal(message);

  return;
}

function regalVersion(): string {
  let version = "missing";

  if (isInstalledRegal()) {
    const versionJSON = execSync(regalPath() + " version --format=json").toString().trim();
    const versionObj = JSON.parse(versionJSON);
    version = versionObj.version || "unknown";
  }

  return version;
}

export function regalPath(): string {
  let path = vscode.workspace.getConfiguration("opa.dependency_paths").get<string>("regal");
  if (path !== undefined && path !== null) {
    path = replaceWorkspaceFolderPathVariable(path);
  }

  if (path !== undefined && path !== null && path.length > 0) {
    if (path.startsWith("file://")) {
      path = path.substring(7);
    }

    if (existsSync(path)) {
      return path;
    }
  }

  // default case, attempt to find in path
  return "regal";
}

class debuggableMessageStrategy {
  handleMessage(message: Message, next: (message: Message) => any): any {
    // If the VSCODE_DEBUG_MODE environment variable is set to true, then
    // we can log the messages to the console for debugging purposes.
    if (process.env.VSCODE_DEBUG_MODE === "true") {
      const messageData = JSON.parse(JSON.stringify(message));
      const method = messageData.method || "response";
      console.log(method, JSON.stringify(messageData));
    }

    return next(message);
  }
}

export function activateRegal(_context: ExtensionContext) {
  if (!outChan) {
    outChan = window.createOutputChannel("Regal");
  }

  // activateRegal is run when the config changes, but this happens a few times
  // at startup. We use clientLock to prevent the activation of multiple instances.
  if (clientLock) {
    return;
  }
  clientLock = true;

  promptForUpdateRegal();

  const version = regalVersion();
  if (version === "missing") {
    opaOutputChannel.appendLine("Regal LS could not be started because the \"regal\" executable is not available.");
    return;
  }

  // assumption here that it's a dev version or something, and ignore.
  // if the version is invalid, then continue as assuming a dev build or similar
  if (semver.valid(version)) {
    if (semver.lt(version, minimumSupportedRegalVersion)) {
      opaOutputChannel.appendLine(
        "Regal LS could not be started because the version of \"regal\" is less than the minimum supported version.",
      );
      return;
    }
  }

  const serverOptions: ServerOptions = {
    command: regalPath(),
    args: ["language-server"],
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "rego" }],
    outputChannel: outChan,
    traceOutputChannel: outChan,
    revealOutputChannelOn: 0,
    connectionOptions: {
      messageStrategy: new debuggableMessageStrategy(),
    },
    errorHandler: {
      error: (error: Error, message: Message, _count: number): ErrorHandlerResult => {
        console.error(error);
        console.error(message);
        return {
          action: ErrorAction.Continue,
        };
      },
      closed: (): CloseHandlerResult => {
        console.error("client closed");
        return {
          action: CloseAction.DoNotRestart,
        };
      },
    },
    synchronize: {
      fileEvents: [
        workspace.createFileSystemWatcher("**/*.rego"),
        workspace.createFileSystemWatcher("**/.regal/config.yaml"),
      ],
    },
    diagnosticPullOptions: {
      onChange: true,
      onSave: true,
    },
    initializationOptions: {
      formatter: vscode.workspace.getConfiguration("opa").get<string>("formatter", "opa-fmt"),
    },
  };

  client = new LanguageClient(
    "regal",
    "Regal LSP client",
    serverOptions,
    clientOptions,
  );

  client.onRequest<void, ShowEvalResultParams>("regal/showEvalResult", handleRegalShowEvalResult);
  client.onRequest<void, vscode.DebugConfiguration>("regal/startDebugging", handleDebug);

  vscode.debug.onDidTerminateDebugSession((session) => {
    activeDebugSessions.delete(session.name);
  });

  client.start();
}

export function deactivateRegal(): Thenable<void> | undefined {
  clientLock = false;
  if (!client) {
    return undefined;
  }

  return client.stop();
}

function downloadOptionsRegal() {
  return {
    repo: "StyraInc/regal",
    determineBinaryURLFromRelease: (release: any) => {
      // release.assets.name contains {'darwin', 'linux', 'windows'}
      const assets = release.assets || [];
      const os = process.platform;
      let targetAsset: { browser_download_url: string };
      switch (os) {
        case "darwin":
          targetAsset = assets.filter((asset: { name: string }) => asset.name.indexOf("Darwin") !== -1)[0];
          break;
        case "linux":
          targetAsset = assets.filter((asset: { name: string }) => asset.name.indexOf("Linux") !== -1)[0];
          break;
        case "win32":
          targetAsset = assets.filter((asset: { name: string }) => asset.name.indexOf("Windows") !== -1)[0];
          break;
        default:
          targetAsset = { browser_download_url: "" };
      }
      return targetAsset.browser_download_url;
    },
    determineExecutableName: () => {
      const os = process.platform;
      switch (os) {
        case "darwin":
        case "linux":
          return "regal";
        case "win32":
          return "regal.exe";
        default:
          return "regal";
      }
    },
  };
}

interface ShowEvalResultParams {
  line: number;
  result: EvalResult;
  // package or a rule name
  target: string;
  // only used when target is a package
  package: string;
  // only used when target is a rule name, contains a list of rule head locations
  rule_head_locations: ShowEvalResultParamsLocation[];
}

interface ShowEvalResultParamsLocation {
  row: number;
  col: number;
}

interface EvalResult {
  value: any;
  isUndefined: boolean;
  printOutput: { [line: number]: [text: string[]] };
}

function handleDebug(params: vscode.DebugConfiguration) {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return;
  }

  if (activeDebugSessions.has(params.name)) {
    vscode.window.showErrorMessage("Debug session for '" + params.name + "' already active");
    return;
  }

  vscode.debug.startDebugging(undefined, params).then((success) => {
    if (success) {
      activeDebugSessions.set(params.name, undefined);
    }
  });
}

function handleRegalShowEvalResult(params: ShowEvalResultParams) {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) return;

  // Before setting a new decoration, remove all previous decorations
  removeDecorations();

  const { attachmentMessage, hoverMessage } = createMessages(params);

  const decorationOptions: vscode.DecorationOptions[] = [];
  const targetDecorationOptions: vscode.DecorationOptions[] = [];

  const truncateThreshold = 100;

  if (params.target === "package") {
    handlePackageDecoration(
      params,
      activeEditor,
      decorationOptions,
      targetDecorationOptions,
      attachmentMessage,
      hoverMessage,
      truncateThreshold,
    );
  } else if (params.rule_head_locations.length > 0) {
    handleRuleHeadsDecoration(
      params,
      activeEditor,
      decorationOptions,
      targetDecorationOptions,
      attachmentMessage,
      hoverMessage,
      truncateThreshold,
    );
  }

  handlePrintOutputDecoration(params, activeEditor, decorationOptions, truncateThreshold);

  // Always set the base decoration, containing the result message and after text
  activeEditor.setDecorations(evalResultDecorationType, decorationOptions);

  // Set decoration type based on whether the result is undefined
  const targetDecorationType = params.result.isUndefined
    ? evalResultTargetUndefinedDecorationType
    : evalResultTargetSuccessDecorationType;
  activeEditor.setDecorations(targetDecorationType, targetDecorationOptions);
}

function createMessages(params: ShowEvalResultParams) {
  let attachmentMessage = params.result.value;
  let hoverMessage = params.result.value;
  const hoverTitle = "### Evaluation Result\n\n";

  if (params.result.isUndefined) {
    // Handle rule result
    attachmentMessage = "undefined";
    hoverMessage = hoverTitle + makeCode("text", attachmentMessage);
  } else if (typeof params.result.value === "object") {
    // Handle objects (including arrays)
    const formattedValue = JSON.stringify(params.result.value, null, 2);
    attachmentMessage = formattedValue.replace(/\n\s*/g, " ")
      .replace(/(\{|\[)\s/g, "$1")
      .replace(/\s(\}|\])/g, "$1");
    const code = makeCode("json", formattedValue);
    hoverMessage = hoverTitle + (code.length > 100000 ? formattedValue : code);
  } else {
    // Handle strings and other types simple types
    if (typeof params.result.value === "string") {
      attachmentMessage = `"${params.result.value.replace(/ /g, "\u00a0")}"`;
    }
    hoverMessage = hoverTitle + makeCode("json", attachmentMessage);
  }

  return { attachmentMessage, hoverMessage };
}

function handlePackageDecoration(
  params: ShowEvalResultParams,
  activeEditor: vscode.TextEditor,
  decorationOptions: vscode.DecorationOptions[],
  targetDecorationOptions: vscode.DecorationOptions[],
  attachmentMessage: string,
  hoverMessage: string,
  truncateThreshold: number,
) {
  const line = params.line - 1;
  const documentLine = activeEditor.document.lineAt(line);
  const lineLength = documentLine.text.length;

  // To avoid horizontal scroll for large outputs, we ask users to hover for the full result
  if (lineLength + attachmentMessage.length > truncateThreshold) {
    const suffix = "... (hover for result)";
    attachmentMessage = attachmentMessage.substring(0, truncateThreshold - lineLength - suffix.length) + suffix;
  }

  decorationOptions.push(createDecoration(line, lineLength, hoverMessage, attachmentMessage));

  const packageIndex = documentLine.text.indexOf(params.package);
  const startChar = packageIndex > 0 ? packageIndex : 0;
  const endChar = packageIndex > 0 ? packageIndex + params.package.length : lineLength;

  // Highlight only the target name with a color, displayed in addition to the whole line decoration
  targetDecorationOptions.push({
    range: new vscode.Range(new vscode.Position(line, startChar), new vscode.Position(line, endChar)),
  });
}

function handleRuleHeadsDecoration(
  params: ShowEvalResultParams,
  activeEditor: vscode.TextEditor,
  decorationOptions: vscode.DecorationOptions[],
  targetDecorationOptions: vscode.DecorationOptions[],
  attachmentMessage: string,
  hoverMessage: string,
  truncateThreshold: number,
) {
  params.rule_head_locations.forEach((location) => {
    const line = location.row - 1;
    const documentLine = activeEditor.document.lineAt(line);
    const lineLength = documentLine.text.length;

    // To avoid horizontal scroll for large outputs, we ask users to hover for the full result
    if (lineLength + attachmentMessage.length > truncateThreshold) {
      const suffix = "... (hover for result)";
      attachmentMessage = attachmentMessage.substring(0, truncateThreshold - lineLength - suffix.length) + suffix;
    }

    decorationOptions.push(createDecoration(line, lineLength, hoverMessage, attachmentMessage));

    const startChar = location.col - 1;
    const endChar = documentLine.text.includes(params.target)
      ? startChar + params.target.length
      : findEndChar(documentLine.text, lineLength);

    // Highlight only the target name with a color, displayed in addition to the whole line decoration
    targetDecorationOptions.push({
      range: new vscode.Range(new vscode.Position(line, startChar), new vscode.Position(line, endChar)),
    });
  });
}

function handlePrintOutputDecoration(
  params: ShowEvalResultParams,
  activeEditor: vscode.TextEditor,
  decorationOptions: vscode.DecorationOptions[],
  truncateThreshold: number,
) {
  Object.keys(params.result.printOutput).map(Number).forEach((line) => {
    const lineLength = activeEditor.document.lineAt(line).text.length;
    const joinedLines = params.result.printOutput[line].join("\n");

    // Pre-block formatting fails if there are over 100k chars
    const hoverText = joinedLines.length < 100000 ? makeCode("text", joinedLines) : joinedLines;
    const hoverMessage = "### Print Output\n\n" + hoverText;

    let attachmentMessage = ` 🖨️ => ${params.result.printOutput[line].join(" => ")}`;
    if (lineLength + attachmentMessage.length > truncateThreshold) {
      const suffix = "... (hover for result)";
      attachmentMessage = attachmentMessage.substring(0, truncateThreshold - lineLength - suffix.length) + suffix;
    }

    decorationOptions.push({
      range: new vscode.Range(new vscode.Position(line - 1, 0), new vscode.Position(line - 1, lineLength)),
      hoverMessage: hoverMessage,
      renderOptions: {
        after: {
          contentText: attachmentMessage,
          color: new vscode.ThemeColor("editorLineNumber.foreground"),
        },
      },
    });
  });
}

function createDecoration(
  line: number,
  lineLength: number,
  hoverMessage: string,
  attachmentMessage: string,
): vscode.DecorationOptions {
  // Create base decoration options for a line
  return {
    range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, lineLength)),
    hoverMessage: hoverMessage,
    renderOptions: {
      after: {
        contentText: ` => ${attachmentMessage}`,
        color: new vscode.ThemeColor("editorLineNumber.foreground"),
      },
    },
  };
}

function findEndChar(text: string, lineLength: number): number {
  // Find the end character position, stopping at the first [ or . character as a fallback
  for (let i = 0; i < lineLength; i++) {
    if (text[i] === "[" || text[i] === ".") {
      return i;
    }
  }
  return lineLength;
}

// makeCode returns a markdown code block with the given language and code
function makeCode(lang: string, code: string) {
  return "```" + lang + "\n" + code + "\n```";
}
