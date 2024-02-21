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
import { existsSync } from 'fs';
const commandExistsSync = require('command-exists').sync;
const semver = require('semver');

import { promptForInstall } from '../../github-installer';
import { replaceWorkspaceFolderPathVariable } from '../../util';
import { opaOutputChannel } from '../../extension';

let client: LanguageClient;

const minimumSupportedRegalVersion = '0.16.0';

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
        const execSync = require('child_process').execSync;
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

export function activatedRegal(): boolean {
    if (client === undefined) {
        return false;
    }

    if (!client.isRunning()) {
        return false;
    }

    return true;
}

export function activateRegal(context: ExtensionContext) {
    // This should not happen, but this is a safety check to avoid spawning
    // multiple language server instances which leads to duplicate messages in clients.
    if (activatedRegal()) {
        opaOutputChannel.appendLine('Regal LS is already running.');
        return;
    }

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

    const outChan = window.createOutputChannel("regal-ls");

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'rego' }],
        outputChannel: outChan,
        traceOutputChannel: outChan,
        revealOutputChannelOn: 0,
        errorHandler: {
            error: (error: Error, message: Message, count: number): ErrorHandlerResult => {
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
    };

    client = new LanguageClient(
        'regal',
        'Regal LSP client',
        serverOptions,
        clientOptions
    );

    client.start();
}

export function deactivateRegal(): Thenable<void> | undefined {
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
