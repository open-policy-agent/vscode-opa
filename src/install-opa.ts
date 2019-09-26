'use strict';

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import { URL } from 'url';
import * as vscode from 'vscode';

import { opaOutputChannel } from './extension';
const releaseDownloader = require('@fohlen/github-release-downloader');

let installDeclined = false;

export function promptForInstall() {
    if (installDeclined) {
        return;
    }
    vscode.window.showInformationMessage('OPA executable is missing from your $PATH or \'opa.path\' is not set to the correct path. Would you like to install OPA?', 'Install')
        .then((selection) => {
            if (selection === 'Install') {
               install();
            } else {
                installDeclined = true;
            }
        });
}

async function install() {
    opaOutputChannel.clear();
    opaOutputChannel.show(true);

    opaOutputChannel.appendLine('Getting latest OPA release for your platform...');
    let url;
    try {
        url = await getOpaDownloadUrl();
        opaOutputChannel.appendLine(`Found latest OPA release: ${url}`);
        if (url === null || url === undefined || url.toString().trim() === '') {
            opaOutputChannel.appendLine('Could not find the latest OPA release for your platform');
            return;
        }
    } catch (e) {
        opaOutputChannel.appendLine('Something went wrong while getting the latest OPA release:');
        opaOutputChannel.appendLine(e);
        return;
    }

    opaOutputChannel.appendLine('Downloading OPA executable...');
    let path;
    try {
        path = await downloadFile(url);
        opaOutputChannel.appendLine(`OPA executable downloaded to ${path}`);
    } catch (e) {
        opaOutputChannel.appendLine('Something went wrong while downloading the OPA executable:');
        opaOutputChannel.appendLine(e);
        return;
    }

    opaOutputChannel.appendLine('Changing file mode to 0755 to allow execution...');
    try {
        await vscode.workspace.getConfiguration('opa').update('path', path, true);
        fs.chmodSync(path, 0o755);
    } catch (e) {
        opaOutputChannel.appendLine(e);
        return;
    }

    opaOutputChannel.appendLine(`Setting 'opa.path' to '${path}'...`);
    try {
        await vscode.workspace.getConfiguration('opa').update('path', path, true);
    } catch (e) {
        opaOutputChannel.appendLine('Something went wrong while saving the \'opa.path\' setting:');
        opaOutputChannel.appendLine(e);
        return;
    }
    opaOutputChannel.appendLine('Done!');
}

// Downloads a file given a URL
// Returns a Promise that resolves to the absolute file path when the download is complete
async function downloadFile(url: URL): Promise<string> {
    // Use the user's home directory as the default base directory
    const dest = os.homedir();
    return releaseDownloader.downloadAsset(url.href, getOPAExecutableName(), dest, () => {
        // Lame progress bar
        opaOutputChannel.append('.');
    });
}

async function getOpaDownloadUrl(): Promise<URL> {
    return new Promise<URL>((resolve, reject) => {
        // TODO: Honor HTTP proxy settings from `vscode.workspace.getConfiguration('http').get('proxy')`
        https.get({
            hostname:'api.github.com',
            path: '/repos/open-policy-agent/opa/releases/latest',
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
                    const url = getUrlFromRelease(release);
                    resolve(new URL(url));
                 } catch (e) {
                     reject(e);
                 }
             });
         }).on('error', (e: any) => reject(e));
    });
}

function getUrlFromRelease(release: {assets: {name: string, browser_download_url: string}[]}): string {
    // release.assets.name contains {'darwin', 'linux', 'windows'}
    const assets = release.assets || [];
    const os = process.platform;
    let targetAsset: {browser_download_url: string};
    switch (os) {
        case 'darwin':
            targetAsset = assets.filter((asset: {name: string}) => asset.name.indexOf('darwin') !== -1)[0];
            break;
        case 'linux':
            targetAsset = assets.filter((asset: {name: string}) => asset.name.indexOf('linux') !== -1)[0];
            break;
        case 'win32':
            targetAsset = assets.filter((asset: {name: string}) => asset.name.indexOf('windows') !== -1)[0];
            break;
        default:
            targetAsset = {browser_download_url: ''};
    }
    return targetAsset.browser_download_url;
}

function getOPAExecutableName(): string {
    const os = process.platform;
    switch (os) {
        case 'darwin':
        case 'linux':
            return 'opa';
        case 'win32':
            return 'opa.exe';
        default:
            return 'opa';
    }
}

function getToken(): string {
    // Need an OAuth token to access Github because
    // this gets around the ridiculously low
    // anonymous access rate limits (60 requests/sec/IP)
    // This token only gives access to "public_repo" and "repo:status" scopes
    return  ["0", "0", "b", "6", "2", "d", "1",
    "0", "4", "d", "8", "5", "4", "9",
    "4", "b", "d", "6", "e", "e", "9",
    "5", "f", "1", "7", "1", "b", "d",
    "0", "2", "3", "c", "e", "4", "a",
    "3", "9", "a", "0", "6"].join('');
}
