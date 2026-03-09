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
import type { ExplorerResult } from "../../tree/opaTreeProvider";
import type { OPATreeDataProvider } from "../../tree/opaTreeProvider";

export interface RegalServerCustomCapabilities {
  explorerProvider: boolean;
  inlineEvalProvider: boolean;
  debugProvider: boolean;
  opaTestProvider: boolean;
}

// RegalClientActivationOptions is intended to be represent how the client
// should be set up to interact with the server.
export interface RegalClientActivationOptions {
  // featureFlags can be used to control the client-side implementation of
  // custom Regal LSP features. This is separate from the server side
  // capabilities.
  featureFlags: {
    enableExplorer: boolean;
    enableInlineEval: boolean;
    enableDebug: boolean;
    enableServerTesting: boolean;
  };
}

function extractServerCustomCapabilities(
  client: LanguageClient,
): RegalServerCustomCapabilities {
  // 'experimental' is LSP terminology, we are using these more as 'custom', or
  // just additional features we are building that are not in the core spec.
  const experimental = client.initializeResult?.capabilities?.experimental;

  return {
    explorerProvider: experimental?.explorerProvider ?? false,
    inlineEvalProvider: experimental?.inlineEvalProvider ?? false,
    debugProvider: experimental?.debugProvider ?? false,
    opaTestProvider: experimental?.opaTestProvider ?? false,
  };
}

let client: LanguageClient;
let clientLock = false;
let regalShowDiagnostics = true;
const activeDebugSessions: Map<string, void> = new Map();
let treeDataProvider: OPATreeDataProvider | undefined;
let testController:
  | { handleTestLocations: (uri: string, locations: TestLocation[]) => void }
  | undefined;

// Test location from Regal's regal/testLocations notification
export interface TestLocation {
  package: string;
  package_path: string[];
  name: string;
  root: string;
  location: {
    col: number;
    row: number;
    end: { col: number; row: number };
    file: string;
    text: string;
  };
}

// Request parameters for regal/runTests
export interface RunTestsParams {
  uri: string;
  package: string;
  name: string;
}

// Response from regal/runTests
export interface TestResult {
  location: { file: string; row: number; col: number };
  package: string;
  name: string;
  fail?: boolean;
  error?: any;
  duration: number;
  output?: string;
}

export function toggleRegalDiagnostics(): boolean {
  regalShowDiagnostics = !regalShowDiagnostics;

  // Trigger a diagnostic refresh for all rego files.
  // The middleware will handle returning empty diagnostics when disabled.
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId === "rego") {
      client?.sendNotification("textDocument/didChange", {
        textDocument: { uri: doc.uri.toString(), version: doc.version + 1 },
        contentChanges: [{ text: doc.getText() }],
      });
    }
  }

  return regalShowDiagnostics;
}

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

export async function activateRegal(
  options: RegalClientActivationOptions,
): Promise<
  | { client: LanguageClient; capabilities: RegalServerCustomCapabilities }
  | undefined
> {
  if (clientLock) {
    return undefined;
  }
  clientLock = true;

  const binaryInfo = resolveBinary(REGAL_CONFIG, "regal");

  // Validate binary availability
  if (!binaryInfo.path) {
    clientLock = false;
    return undefined;
  }

  if (binaryInfo.version === "missing") {
    clientLock = false;
    return undefined;
  }

  // Validate minimum version if specified
  if (REGAL_CONFIG.minimumVersion && semver.valid(binaryInfo.version)) {
    if (semver.lt(binaryInfo.version, REGAL_CONFIG.minimumVersion)) {
      opaOutputChannel.appendLine(
        `${REGAL_CONFIG.name}: service could not be started - version ${binaryInfo.version} is below minimum ${REGAL_CONFIG.minimumVersion}`,
      );
      clientLock = false;
      return undefined;
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
      error: (
        error: Error,
        message: Message,
        _count: number,
      ): ErrorHandlerResult => {
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
      formatter: vscode.workspace
        .getConfiguration("opa")
        .get<string>("formatter", "opa-fmt"),
      // These options are passed to the Regal language server to signal the
      // capabilities of the client. Feature flags control which custom
      // features are enabled.
      evalCodelensDisplayInline: options.featureFlags.enableInlineEval,
      enableDebugCodelens: options.featureFlags.enableDebug,
      enableExplorer: options.featureFlags.enableExplorer,
      enableServerTesting: options.featureFlags.enableServerTesting,
    },
    middleware: {
      // Users can toggle linting on/off using the "OPA: Toggle Regal Linting" command.
      // When disabled, diagnostics are suppressed by returning an empty array.
      handleDiagnostics: (
        uri: vscode.Uri,
        diagnostics: vscode.Diagnostic[],
        next: (uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) => void,
      ) => {
        if (regalShowDiagnostics) {
          next(uri, diagnostics);
        } else {
          next(uri, []);
        }
      },
    },
  };

  client = new LanguageClient(
    "regal",
    "Regal LSP client",
    serverOptions,
    clientOptions,
  );

  await client.start();

  const capabilities = extractServerCustomCapabilities(client);

  opaOutputChannel.appendLine(
    `Regal capabilities: explorer=${capabilities.explorerProvider}, inlineEval=${capabilities.inlineEvalProvider}, debug=${capabilities.debugProvider}, opaTest=${capabilities.opaTestProvider}`,
  );

  if (
    capabilities.inlineEvalProvider
    && options.featureFlags.enableInlineEval
  ) {
    client.onRequest<void, ShowEvalResultParams>(
      "regal/showEvalResult",
      handleRegalShowEvalResult,
    );
  }

  if (capabilities.debugProvider && options.featureFlags.enableDebug) {
    client.onRequest<void, vscode.DebugConfiguration>(
      "regal/startDebugging",
      handleDebug,
    );
  }

  if (capabilities.explorerProvider && options.featureFlags.enableExplorer) {
    client.onNotification(
      "regal/showExplorerResult",
      handleRegalShowExplorerResult,
    );
  }

  if (
    capabilities.opaTestProvider
    && options.featureFlags.enableServerTesting
  ) {
    client.onNotification("regal/testLocations", handleRegalTestLocations);
  }

  vscode.debug.onDidTerminateDebugSession(session => {
    activeDebugSessions.delete(session.name);
  });

  // Compute effective capabilities: feature is enabled if BOTH option is true AND server supports it
  const effectiveCapabilities = {
    explorerProvider: capabilities.explorerProvider && options.featureFlags.enableExplorer,
    inlineEvalProvider: capabilities.inlineEvalProvider && options.featureFlags.enableInlineEval,
    debugProvider: capabilities.debugProvider && options.featureFlags.enableDebug,
    opaTestProvider: capabilities.opaTestProvider && options.featureFlags.enableServerTesting,
  };

  return { client, capabilities: effectiveCapabilities };
}

export function setTreeDataProvider(provider: OPATreeDataProvider): void {
  treeDataProvider = provider;
}

export function setTestController(controller: {
  handleTestLocations: (uri: string, locations: TestLocation[]) => void;
}): void {
  testController = controller;
}

function handleRegalShowExplorerResult(result: ExplorerResult) {
  if (treeDataProvider) {
    treeDataProvider.setExplorerResult(result);
  }
}

interface TestLocationsNotification {
  locations: TestLocation[];
  uri: string;
}

function handleRegalTestLocations(params: TestLocationsNotification) {
  if (testController) {
    testController.handleTestLocations(params.uri, params.locations);
  }
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

export async function runTests(params: RunTestsParams): Promise<TestResult[]> {
  if (!client || client.state !== State.Running) {
    throw new Error("Regal language server is not running");
  }

  try {
    const results = await client.sendRequest<TestResult[]>(
      "regal/runTests",
      params,
    );
    return results;
  } catch (error) {
    opaOutputChannel.appendLine(`Error running tests: ${error}`);
    throw error;
  }
}

export async function restartRegal(
  options: RegalClientActivationOptions,
): Promise<
  | { client: LanguageClient; capabilities: RegalServerCustomCapabilities }
  | undefined
> {
  // Check if Regal binary is available before attempting restart
  const binaryInfo = resolveBinary(REGAL_CONFIG, "regal");
  if (!binaryInfo.path || binaryInfo.version === "missing") {
    opaOutputChannel.appendLine(
      "Error: Cannot restart Regal language server - Regal binary is not available",
    );
    return undefined;
  }

  // Only restart if Regal is currently running or if we have a client instance
  if (!client) {
    opaOutputChannel.appendLine("Starting Regal language server...");
    return await activateRegal(options);
  }

  opaOutputChannel.appendLine("Restarting Regal language server...");

  const stopPromise = deactivateRegal();
  if (stopPromise) {
    await stopPromise;
  }

  return await activateRegal(options);
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
    vscode.window.showErrorMessage(
      "Debug session for '" + params.name + "' already active",
    );
    return;
  }

  vscode.debug.startDebugging(undefined, params).then(success => {
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

  handlePrintOutputDecoration(
    params,
    activeEditor,
    decorationOptions,
    truncateThreshold,
  );

  const wf = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);

  for (const [uri, items] of Object.entries(params.result.printOutput)) {
    let path;
    if (wf) {
      path = relative(wf.uri.fsPath, vscode.Uri.parse(uri).fsPath);
    } else {
      path = vscode.Uri.parse(uri).fsPath;
    }

    Object.keys(items)
      .map(Number)
      .forEach(line => {
        const lineItems = items[line];
        if (lineItems) {
          opaOutputChannel.appendLine(
            `🖨️ ${path}:${line} => ${lineItems.join(" => ")}`,
          );
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
    attachmentMessage = formattedValue
      .replace(/\n\s*/g, " ")
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
    attachmentMessage = attachmentMessage.substring(
      0,
      truncateThreshold - lineLength - suffix.length,
    ) + suffix;
  }

  decorationOptions.push(
    createDecoration(line, lineLength, hoverMessage, attachmentMessage),
  );

  const packageIndex = documentLine.text.indexOf(params.package);
  const startChar = packageIndex > 0 ? packageIndex : 0;
  const endChar = packageIndex > 0 ? packageIndex + params.package.length : lineLength;

  // Highlight only the target name with a color, displayed in addition to the whole line decoration
  targetDecorationOptions.push({
    range: new vscode.Range(
      new vscode.Position(line, startChar),
      new vscode.Position(line, endChar),
    ),
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
  params.rule_head_locations.forEach(location => {
    const line = location.row - 1;
    const documentLine = activeEditor.document.lineAt(line);
    const lineLength = documentLine.text.length;

    // To avoid horizontal scroll for large outputs, we ask users to hover for the full result
    if (lineLength + attachmentMessage.length > truncateThreshold) {
      const suffix = "... (hover for result)";
      attachmentMessage = attachmentMessage.substring(
        0,
        truncateThreshold - lineLength - suffix.length,
      ) + suffix;
    }

    decorationOptions.push(
      createDecoration(line, lineLength, hoverMessage, attachmentMessage),
    );

    const startChar = location.col - 1;
    const endChar = documentLine.text.includes(params.target)
      ? startChar + params.target.length
      : findEndChar(documentLine.text, lineLength);

    // Highlight only the target name with a color, displayed in addition to the whole line decoration
    targetDecorationOptions.push({
      range: new vscode.Range(
        new vscode.Position(line, startChar),
        new vscode.Position(line, endChar),
      ),
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

  Object.keys(printOutput)
    .map(Number)
    .forEach(line => {
      const lineOutput = printOutput[line];
      if (!lineOutput) return;

      const lineLength = activeEditor.document.lineAt(line).text.length;
      const joinedLines = lineOutput.join("\n");

      // Pre-block formatting fails if there are over 100k chars
      const hoverText = joinedLines.length < 100000
        ? makeCode("text", joinedLines)
        : joinedLines;
      const hoverMessage = "### Print Output\n\n" + hoverText;

      let attachmentMessage = ` 🖨️ => ${lineOutput.join(" => ")}`;
      if (lineLength + attachmentMessage.length > truncateThreshold) {
        const suffix = "... (hover for result)";
        attachmentMessage = attachmentMessage.substring(
          0,
          truncateThreshold - lineLength - suffix.length,
        ) + suffix;
      }

      decorationOptions.push({
        range: new vscode.Range(
          new vscode.Position(line - 1, 0),
          new vscode.Position(line - 1, lineLength),
        ),
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
    range: new vscode.Range(
      new vscode.Position(line, 0),
      new vscode.Position(line, lineLength),
    ),
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
