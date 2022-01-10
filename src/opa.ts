'use strict';

import cp = require('child_process');
const commandExistsSync = require('command-exists').sync;
import * as vscode from 'vscode';

import { promptForInstall } from './install-opa';
import { getImports, getPackage } from './util';
import { existsSync } from 'fs';
import { dirname } from 'path';

var regoVarPattern = new RegExp('^[a-zA-Z_][a-zA-Z0-9_]*$');

export function getDataDir(uri: vscode.Uri): string {
    // NOTE(tsandall): we don't have a precise version for 3be55ed6 so
    // do our best and rely on the -dev tag.
    if (!installedOPASameOrNewerThan("0.14.0-dev")) {
        return uri.fsPath;
    }
    if (uri.scheme === "file") {
        return uri.toString()
    }
    return decodeURIComponent(uri.toString())
}

export function canUseBundleFlags(): boolean {
    let bundleMode = vscode.workspace.getConfiguration('opa').get<boolean>('bundleMode', true);
    return installedOPASameOrNewerThan("0.14.0-dev") && bundleMode;
}

function dataFlag(): string {
    if (canUseBundleFlags()) {
        return "--bundle";
    }
    return "--data";
}

// returns true if installed OPA is same or newer than OPA version x.
function installedOPASameOrNewerThan(x: string): boolean {
    const s = getOPAVersionString();
    return opaVersionSameOrNewerThan(s, x);
}

// Returns a list of root data path URIs based on the plugin configuration.
export function getRoots(): string[] {
    const roots = vscode.workspace.getConfiguration('opa').get<string[]>('roots', []);
    let formattedRoots = new Array();
    roots.forEach(root => {
        root = root.replace('${workspaceFolder}', vscode.workspace.workspaceFolders![0].uri.toString());
        root = root.replace('${fileDirname}', dirname(vscode.window.activeTextEditor!.document.fileName));
        formattedRoots.push(getDataDir(vscode.Uri.parse(root)));
    });

    return formattedRoots;
}

// Returns a list of root data parameters in an array
// like ["--bundle=file:///a/b/x/", "--bundle=file:///a/b/y"] in bundle mode
// or ["--data=file:///a/b/x", "--data=file://a/b/y"] otherwise.
export function getRootParams(): string[] {
    const flag = dataFlag();
    const roots = getRoots();
    let params = new Array();
    roots.forEach(root => {
        params.push(`${flag}=${root}`);
    });
    return params;
}


// returns true if OPA version a is same or newer than OPA version b. If either
// version is not in the expected format (i.e.,
// <major>.<minor>.<point>[-<patch>]) this function returns true. Major, minor,
// and point versions are compared numerically. Patch versions are compared
// lexigraphically however an empty patch version is considered newer than a
// non-empty patch version.
function opaVersionSameOrNewerThan(a: string, b: string): boolean {

    const aVersion = parseOPAVersion(a);
    const bVersion = parseOPAVersion(b);

    if (aVersion.length !== 4 || bVersion.length !== 4) {
        return true;
    }

    for (let i = 0; i < 3; i++) {
        if (aVersion[i] > bVersion[i]) {
            return true;
        } else if (bVersion[i] > aVersion[i]) {
            return false;
        }
    }

    if (aVersion[3] === '' && bVersion[3] !== '') {
        return true;
    } else if (aVersion[3] !== '' && bVersion[3] === '') {
        return false;
    }

    return aVersion[3] >= bVersion[3];
}

// returns array of numbers and strings representing an OPA semantic version.
function parseOPAVersion(s: string): any[] {


    const parts = s.split('.', 3);
    if (parts.length < 3) {
        return [];
    }

    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    const pointParts = parts[2].split('-', 2);
    const point = Number(pointParts[0]);
    let patch = '';

    if (pointParts.length >= 2) {
        patch = pointParts[1];
    }

    return [major, minor, point, patch];
}

// returns the installed OPA version as a string.
function getOPAVersionString(): string {

    const result = cp.spawnSync('opa', ['version']);
    if (result.status !== 0) {
        return '';
    }

    const lines = result.stdout.toString().split('\n');

    for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].trim().split(': ', 2);
        if (parts.length < 2) {
            continue;
        }
        if (parts[0] === 'Version') {
            return parts[1];
        }
    }
    return '';
}

// refToString formats a ref as a string. Strings are special-cased for
// dot-style lookup. Note: this function is currently only used for populating
// picklists based on dependencies. As such it doesn't handle all term types
// properly.
export function refToString(ref: any[]): string {
    let result = ref[0].value;
    for (let i = 1; i < ref.length; i++) {
        if (ref[i].type === "string") {
            if (regoVarPattern.test(ref[i].value)) {
                result += '.' + ref[i].value;
                continue;
            }
        }
        result += '[' + JSON.stringify(ref[i].value) + ']';
    }
    return result;
}

/**
 * Helpers for executing OPA as a subprocess.
 */

export function parse(opaPath: string, path: string, cb: (pkg: string, imports: string[]) => void, onerror: (output: string) => void) {
    run(opaPath, ['parse', path, '--format', 'json'], '', (_, result) => {
        let pkg = getPackage(result);
        let imports = getImports(result);
        cb(pkg, imports);
    }, onerror);
}

export function run(path: string, args: string[], stdin: string, onSuccess: (stderr: string, result: any) => void, onFailure: (msg: string) => void) {
    runWithStatus(path, args, stdin, (code: number, stderr: string, stdout: string) => {
        if (code === 0) {
            onSuccess(stderr, JSON.parse(stdout));
        } else if (stdout !== '') {
            onFailure(stdout);
        } else {
            onFailure(stderr);
        }
    });
}

// runWithStatus executes the OPA binary at path with args and stdin. The
// callback is invoked with the exit status, stderr, and stdout buffers.
export function runWithStatus(path: string, args: string[], stdin: string, cb: (code: number, stderr: string, stdout: string) => void) {
    let opaPath = vscode.workspace.getConfiguration('opa').get<string>('path');
    if (opaPath !== undefined && opaPath !== null) {
        opaPath = opaPath.replace('${workspaceFolder}', vscode.workspace.workspaceFolders![0].uri.fsPath.toString());
    }

    const existsOnPath = commandExistsSync(path);
    const existsInUserSettings = opaPath !== undefined && opaPath !== null && existsSync(opaPath);

    if (!(existsOnPath || existsInUserSettings)) {
        promptForInstall();
        return;
    }

    if (existsInUserSettings && opaPath !== undefined) {
        // Prefer OPA in User Settings to the one installed on $PATH
        path = opaPath;
    }

    console.log("spawn:", path, "args:", args.toString());

    let proc = cp.spawn(path, args);

    proc.stdin.write(stdin);
    proc.stdin.end();
    let stdout = "";
    let stderr = "";

    proc.stdout.on('data', (data) => {
        stdout += data;
    });

    proc.stderr.on('data', (data) => {
        stderr += data;
    });

    proc.on('exit', (code, signal) => {
        console.log("code:", code);
        console.log("stdout:", stdout);
        console.log("stderr:", stderr);
        cb(code, stderr, stdout);
    });

}