import { window, workspace, ExtensionContext } from 'vscode';
import {
    ErrorHandlerResult,
    CloseHandlerResult,
    ErrorAction,
    Message,
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    CloseAction,
} from 'vscode-languageclient/node';
import * as vscode from 'vscode';
import * as semver from 'semver';
import { existsSync } from 'fs';
import { sync as commandExistsSync } from 'command-exists';
import { promptForInstall } from '../../github-installer';
import { replaceWorkspaceFolderPathVariable } from '../../util';
import {
    evalResultDecorationType,
    evalResultTargetSuccessDecorationType,
    evalResultTargetUndefinedDecorationType,
    removeDecorations,
    opaOutputChannel
} from '../../extension';
import { execSync } from 'child_process';

let client: LanguageClient;
let clientLock = false;
let outChan: vscode.OutputChannel;

const minimumSupportedRegalVersion = '0.18.0';

export function promptForInstallRegal(message: string) {
    const dlOpts = downloadOptionsRegal();
    promptForInstall(
        'regal',
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

function promptForUpdateRegal() {
    const version = regalVersion();

    if (version === 'missing') {
        promptForInstallRegal('Regal is needed but not installed. Would you like to install it?');
        return
    }

    // assumption here that it's a dev version or something, and ignore
    if (!semver.valid(version)) {
        return
    }

    if (semver.gte(version, minimumSupportedRegalVersion)) {
        return
    }

    const path = regalPath();
    let message = 'The version of Regal that the OPA extension is using is out of date. Click "Install" to update it to a new one.'
    // if the path is not the path where VS Code manages Regal,
    // then we show another message
    if (path === 'regal') {
        message = 'Installed Regal version ' + version + ' is out of date and is not supported. Please update Regal to ' +
            minimumSupportedRegalVersion +
            ' using your preferred method. Or click "Install" to use a version managed by the OPA extension.';
    }

    promptForInstallRegal(message);

    return
}

function regalVersion(): string {
    let version = 'missing';

    if (isInstalledRegal()) {
        const versionJSON = execSync(regalPath() + ' version --format=json').toString().trim();
        const versionObj = JSON.parse(versionJSON);
        version = versionObj.version || 'unknown';
    }

    return version
}

export function regalPath(): string {
    let path = vscode.workspace.getConfiguration('opa.dependency_paths').get<string>('regal');
    if (path !== undefined && path !== null) {
        path = replaceWorkspaceFolderPathVariable(path);
    }

    if (path !== undefined && path !== null && path.length > 0) {
        if (path.startsWith('file://')) {
            path = path.substring(7);
        }

        if (existsSync(path)) {
            return path;
        }
    }

    // default case, attempt to find in path
    return 'regal';
}

class debuggableMessageStrategy {
    handleMessage(message: Message, next: (message: Message) => any): any {
        // If the VSCODE_DEBUG_MODE environment variable is set to true, then
        // we can log the messages to the console for debugging purposes.
        if (process.env.VSCODE_DEBUG_MODE === 'true') {
            const messageData = JSON.parse(JSON.stringify(message));
            const method = messageData.method || 'response';
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
    if (version === 'missing') {
        opaOutputChannel.appendLine('Regal LS could not be started because the "regal" executable is not available.');
        return;
    }

    // assumption here that it's a dev version or something, and ignore.
    // if the version is invalid, then continue as assuming a dev build or similar
    if (semver.valid(version)) {
        if (semver.lt(version, minimumSupportedRegalVersion)) {
            opaOutputChannel.appendLine('Regal LS could not be started because the version of "regal" is less than the minimum supported version.');
            return
        }
    }

    const serverOptions: ServerOptions = {
        command: regalPath(),
        args: ["language-server"],
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'rego' }],
        outputChannel: outChan,
        traceOutputChannel: outChan,
        revealOutputChannelOn: 0,
        connectionOptions: {
            messageStrategy: new debuggableMessageStrategy,
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
                workspace.createFileSystemWatcher('**/*.rego'),
                workspace.createFileSystemWatcher('**/.regal/config.yaml'),
            ],
        },
        diagnosticPullOptions: {
            onChange: true,
            onSave: true,
        },
        initializationOptions: {
            formatter: vscode.workspace.getConfiguration('opa').get<string>('formatter', 'opa-fmt'),
        }
    };

    client = new LanguageClient(
        'regal',
        'Regal LSP client',
        serverOptions,
        clientOptions
    );

    client.onRequest('regal/showEvalResult', handleRegalShowEvalResult);

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
        repo: 'StyraInc/regal',
        determineBinaryURLFromRelease: (release: any) => {
            // release.assets.name contains {'darwin', 'linux', 'windows'}
            const assets = release.assets || [];
            const os = process.platform;
            let targetAsset: { browser_download_url: string };
            switch (os) {
                case 'darwin':
                    targetAsset = assets.filter((asset: { name: string }) => asset.name.indexOf('Darwin') !== -1)[0];
                    break;
                case 'linux':
                    targetAsset = assets.filter((asset: { name: string }) => asset.name.indexOf('Linux') !== -1)[0];
                    break;
                case 'win32':
                    targetAsset = assets.filter((asset: { name: string }) => asset.name.indexOf('Windows') !== -1)[0];
                    break;
                default:
                    targetAsset = { browser_download_url: '' };
            }
            return targetAsset.browser_download_url;
        },
        determineExecutableName: () => {
            const os = process.platform;
            switch (os) {
                case 'darwin':
                case 'linux':
                    return 'regal';
                case 'win32':
                    return 'regal.exe';
                default:
                    return 'regal';
            }
        }
    };
}

function handleRegalShowEvalResult(params: any) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return
    }

    const line = params.line - 1;
    const documentLine = activeEditor.document.lineAt(line);
    const lineLength = documentLine.text.length;

    // attachmentMessage is the message that is displayed after the rule name within the editor
    let attachmentMessage = params.result.value

    // hoverMessage is the message that is displayed when hovering over base decoration
    let hoverMessage = params.result.value

    const hoverTitle = "### Evaluation Result\n\n";

    if (params.result.isUndefined) {
        attachmentMessage = 'undefined'
        hoverMessage = hoverTitle + makeCode("text", attachmentMessage)
    } else {
        // this matches both arrays and objects
        if (typeof params.result.value == 'object') {
            attachmentMessage = JSON.stringify(params.result.value, null, 2).
                replace(/\n\s*/g, ' '). // must be a new line first to avoid matching inside strings
                replace(/(\{|\[)\s/g, '$1').
                replace(/\s(\}|\])/g, '$1');
            let code = makeCode("json", JSON.stringify(params.result.value, null, 2));


            // pre block formatting fails if there are over 100k chars
            if (code.length > 100000) {
                code = JSON.stringify(params.result.value, null, 2);
            }

            hoverMessage = hoverTitle + code;
        }

        if (typeof params.result.value == 'string') {
            attachmentMessage = String(params.result.value).replace(/ /g, '\u00a0')
            // for strings, which may be long, there is a preference for wrapping
            // over horizontal scroll present in a pre block.
            hoverMessage = hoverTitle + "`" + attachmentMessage + "`";
        }
    }

    // to avoid horizontal scroll for large outputs, we ask users to hover
    // for the full result
    const truncateThreshold = 100;
    if (lineLength + attachmentMessage.length > truncateThreshold) {
        const suffix = "... (hover for result)";
        attachmentMessage = attachmentMessage.substring(0, truncateThreshold - lineLength - suffix.length) + suffix;
    }

    const decorationOption: vscode.DecorationOptions = {
        // this is not needed as these options are passed to a whole line decoration type
        // however, the field is required.
        range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, lineLength),),
        hoverMessage: hoverMessage,
        renderOptions: {
            after: {
                contentText: " => " + attachmentMessage,
                // Using the same color as the line numbers means this matches
                // the 'muted' appearance of the gutter for various themes
                color: new vscode.ThemeColor('editorLineNumber.foreground'),
            },
        },
    }

    let ruleEnd = lineLength;
    // find the first whitespace, or [ char, if found, update endRange to that
    for (let i = 0; i < lineLength; i++) {
        if (documentLine.text[i] === ' ' || documentLine.text[i] === '[') {
            ruleEnd = i;
            break;
        }
    }

    // ruleNameDecorationOptions highlights only the rule name with a color.
    // the colored highlight is displayed in addition to the whole line decoration
    const ruleNameDecorationOptions: vscode.DecorationOptions = {
        range: new vscode.Range(
            new vscode.Position(line, 0),
            new vscode.Position(line, ruleEnd),
        ),
    };

    // before setting a new decoration, remove all previous decorations
    removeDecorations();

    // always set the base decoration, containing the result message and after text
    activeEditor.setDecorations(evalResultDecorationType, [decorationOption]);

    // evalResultDecorationTypeUndefined is a different color to indicate
    // the difference between undefined and other results
    if (params.result.isUndefined) {
        activeEditor.setDecorations(evalResultTargetUndefinedDecorationType, [ruleNameDecorationOptions]);
        return
    }

    // otherwise, show a success decoration for the rule
    activeEditor.setDecorations(evalResultTargetSuccessDecorationType, [ruleNameDecorationOptions]);
}

// makeCode returns a markdown code block with the given language and code
function makeCode(lang: string, code: string) {
    return "```" + lang + "\n" + code + "\n```";
}
