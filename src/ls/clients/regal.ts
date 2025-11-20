import { relative } from "path";
import * as semver from "semver";
import { workspace } from "vscode";
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
  State,
} from "vscode-languageclient/node";
import { REGAL_CONFIG, resolveBinary } from "../../binaries";
import {
  evalResultDecorationType,
  evalResultTargetSuccessDecorationType,
  evalResultTargetUndefinedDecorationType,
  opaOutputChannel,
  removeDecorations,
} from "../../extension";

let client: LanguageClient;
let clientLock = false;
const activeDebugSessions: Map<string, void> = new Map();

export function resolveRegalPath() {
  return resolveBinary(REGAL_CONFIG, "regal");
}

export function regalPath(): string {
  const binaryInfo = resolveRegalPath();
  return binaryInfo.path || "regal";
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

export function activateRegal() {
  if (clientLock) {
    return;
  }
  clientLock = true;

  const binaryInfo = resolveBinary(REGAL_CONFIG, "regal");

  // Validate binary availability
  if (!binaryInfo.path) {
    clientLock = false;
    return;
  }

  if (binaryInfo.version === "missing") {
    return;
  }

  // Validate minimum version if specified
  if (REGAL_CONFIG.minimumVersion && semver.valid(binaryInfo.version)) {
    if (semver.lt(binaryInfo.version, REGAL_CONFIG.minimumVersion)) {
      opaOutputChannel.appendLine(
        `${REGAL_CONFIG.name}: service could not be started - version ${binaryInfo.version} is below minimum ${REGAL_CONFIG.minimumVersion}`,
      );
      return;
    }
  }

  // Log startup information
  if (binaryInfo.source === "configured" && binaryInfo.originalPath) {
    opaOutputChannel.appendLine(
      `${REGAL_CONFIG.name}: starting service with ${binaryInfo.originalPath} (${binaryInfo.path}) version ${binaryInfo.version}`,
    );
  } else {
    opaOutputChannel.appendLine(
      `${REGAL_CONFIG.name}: starting service with system ${REGAL_CONFIG.configKey} version ${binaryInfo.version}`,
    );
  }

  const serverOptions: ServerOptions = {
    command: binaryInfo.path!,
    args: ["language-server"],
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "rego" }],
    outputChannel: opaOutputChannel,
    traceOutputChannel: opaOutputChannel,
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
      // These options are passed to the Regal language server to signal the
      // capabilities of the client. Since VSCode and vscode-opa supports both
      // inline evaluation results and live debugging, both are enabled and are
      // not configurable.
      evalCodelensDisplayInline: true,
      enableDebugCodelens: true,
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

export function isRegalRunning(): boolean {
  return client && client.state === State.Running;
}

export function restartRegal() {
  // Check if Regal binary is available before attempting restart
  const binaryInfo = resolveBinary(REGAL_CONFIG, "regal");
  if (!binaryInfo.path || binaryInfo.version === "missing") {
    opaOutputChannel.appendLine("Error: Cannot restart Regal language server - Regal binary is not available");
    return;
  }

  // Only restart if Regal is currently running or if we have a client instance
  if (!client) {
    opaOutputChannel.appendLine("Starting Regal language server...");
    activateRegal();
    return;
  }

  opaOutputChannel.appendLine("Restarting Regal language server...");

  const stopPromise = deactivateRegal();

  if (stopPromise) {
    stopPromise.then(() => {
      setTimeout(() => {
        activateRegal();
      }, 100);
    });
  } else {
    setTimeout(() => {
      activateRegal();
    }, 100);
  }
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
  printOutput: {
    [file: string]: {
      [line: number]: [text: string[]];
    };
  };
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

  const wf = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);

  for (const [uri, items] of Object.entries(params.result.printOutput)) {
    let path;
    if (wf) {
      path = relative(wf.uri.fsPath, vscode.Uri.parse(uri).fsPath);
    } else {
      path = vscode.Uri.parse(uri).fsPath;
    }

    Object.keys(items).map(Number).forEach((line) => {
      const lineItems = items[line];
      if (lineItems) {
        opaOutputChannel.appendLine(`🖨️ ${path}:${line} => ${lineItems.join(" => ")}`);
      }
    });
  }

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
  // TODO: display print output in any file from the params map!
  // Currently only print output in the current editor is shown
  const printOutput = params.result.printOutput[activeEditor.document.uri.toString()];
  if (!printOutput) {
    return;
  }

  Object.keys(printOutput).map(Number).forEach((line) => {
    const lineOutput = printOutput[line];
    if (!lineOutput) return;

    const lineLength = activeEditor.document.lineAt(line).text.length;
    const joinedLines = lineOutput.join("\n");

    // Pre-block formatting fails if there are over 100k chars
    const hoverText = joinedLines.length < 100000 ? makeCode("text", joinedLines) : joinedLines;
    const hoverMessage = "### Print Output\n\n" + hoverText;

    let attachmentMessage = ` 🖨️ => ${lineOutput.join(" => ")}`;
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
