'use strict';

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import { URL } from 'url';
import * as vscode from 'vscode';

import { opaOutputChannel } from './extension';
const releaseDownloader = require('@fohlen/github-release-downloader');

let installDeclined: { [repo: string]: boolean } = {};

export function promptForInstall(
    binaryConfigKey: string,
    repo: string,
    message: string,
    determineBinaryURLFromRelease: (release: any) => string,
    determineExecutableName: () => string,
) {
    if (installDeclined[binaryConfigKey]) {
        return;
    }

    vscode.window.showInformationMessage(message, 'Install')
        .then((selection) => {
            if (selection === 'Install') {
                install(
                    binaryConfigKey,
                    repo,
                    determineBinaryURLFromRelease,
                    determineExecutableName,
                );
            } else {
                installDeclined[binaryConfigKey] = true;
            }
        });
}

async function install(binaryConfigKey: string, repo: string, determineBinaryURLFromRelease: (release: any) => string, determineExecutableName: () => string) {
    opaOutputChannel.clear();
    opaOutputChannel.show(true);

    opaOutputChannel.appendLine('Getting latest release for your platform...');
    let url;
    try {
        url = await getDownloadUrl(repo, determineBinaryURLFromRelease);
        opaOutputChannel.appendLine(`Found latest release: ${url}`);
        if (url === null || url === undefined || url.toString().trim() === '') {
            opaOutputChannel.appendLine('Could not find the latest OPA release for your platform');
            return;
        }
    } catch (e) {
        opaOutputChannel.appendLine('Something went wrong while getting the latest release:');
        opaOutputChannel.appendLine(e as string);
        return;
    }

    opaOutputChannel.appendLine(`Downloading ${repo} executable...`);
    let path;
    try {
        path = await downloadFile(url, determineExecutableName);
        opaOutputChannel.appendLine(`Executable downloaded to ${path}`);
    } catch (e) {
        opaOutputChannel.appendLine('Something went wrong while downloading the executable:');
        opaOutputChannel.appendLine(e as string);
        return;
    }

    opaOutputChannel.appendLine('Changing file mode to 0755 to allow execution...');
    try {
        fs.chmodSync(path, 0o755);
    } catch (e) {
        opaOutputChannel.appendLine(e as string);
        return;
    }

    opaOutputChannel.appendLine(`Setting 'opa.dependency_paths.${binaryConfigKey}' to '${path}'...`);
    try {
        await vscode.workspace.getConfiguration('opa.dependency_paths').update(binaryConfigKey, path, true);
    } catch (e) {
        opaOutputChannel.appendLine('Something went wrong while saving the config setting:');
        opaOutputChannel.appendLine(e as string);
        return;
    }
    opaOutputChannel.appendLine(`Successfully installed ${repo}!`);
    opaOutputChannel.hide();
}

// Downloads a file given a URL
// Returns a Promise that resolves to the absolute file path when the download is complete
async function downloadFile(url: URL, determineExecutableName: () => string): Promise<string> {
    // Use the user's home directory as the default base directory
    const dest = os.homedir();
    return releaseDownloader.downloadAsset(url.href, determineExecutableName(), dest, () => {
        // Basic progress bar
        if (Math.floor(Date.now()).toString().endsWith('0')) {
            opaOutputChannel.append('.');
        }
    });
}

async function getDownloadUrl(repo: string, determineBinaryURLFromRelease: (release: any) => string): Promise<URL> {
    return new Promise<URL>((resolve, reject) => {
        // TODO: Honor HTTP proxy settings from `vscode.workspace.getConfiguration('http').get('proxy')`
        https.get({
            hostname: 'api.github.com',
            path: `/repos/${repo}/releases/latest`,
            headers: {
                'User-Agent': 'node.js',
                'Authorization': `token ${getToken()}`
            }
        }, (res: http.IncomingMessage) => {
            let rawData = '';
            res.on('data', (d: any) => {
                rawData += d;
            });
            res.on('end', () => {
                try {
                    const release = JSON.parse(rawData);
                    const url = determineBinaryURLFromRelease(release);
                    resolve(new URL(url));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', (e: any) => reject(e));
    });
}

function getToken(): string {
    // Need an OAuth token to access Github because
    // this gets around the ridiculously low
    // anonymous access rate limits (60 requests/sec/IP)
    // This token only gives access to "public_repo" and "repo:status" scopes
    return ["0", "0", "b", "6", "2", "d", "1",
        "0", "4", "d", "8", "5", "4", "9",
        "4", "b", "d", "6", "e", "e", "9",
        "5", "f", "1", "7", "1", "b", "d",
        "0", "2", "3", "c", "e", "4", "a",
        "3", "9", "a", "0", "6"].join('');
}
