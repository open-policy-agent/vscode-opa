'use strict';

import cp = require('child_process');
const commandExistsSync = require('command-exists').sync;
import * as vscode from 'vscode';

import { promptForInstall } from './install-opa';
import { getImports, getPackage } from './util';

/**
 * Helpers for executing OPA as a subprocess.
 */

export function parse(opaPath: string, path: string, cb: (pkg: string, imports: string[]) => void) {
    run(opaPath, ['parse', path, '--format', 'json'], '', (error: string, result: any) => {
        if (error !== '') {
            vscode.window.showErrorMessage(error);
        } else {
            let pkg = getPackage(result);
            let imports = getImports(result);
            cb(pkg, imports);
        }
    });
}

// run executes the OPA binary at path with args and stdin.  The callback is
// invoked with an error message on failure or JSON object on success.
export function run(path: string, args: string[], stdin: string, cb: (error: string, result: any) => void) {
    runWithStatus(path, args, stdin, (code: number, stderr: string, stdout: string) => {
        if (code !== 0) {
            cb(stderr, '');
        } else {
            cb('', JSON.parse(stdout));
        }
    });
}

// runWithStatus executes the OPA binary at path with args and stdin. The
// callback is invoked with the exit status, stderr, and stdout buffers.
export function runWithStatus(path: string, args: string[], stdin: string, cb: (code: number, stderr: string, stdout: string) => void) {
    const opaPath = vscode.workspace.getConfiguration('opa').get<string>('path');
    const existsOnPath = commandExistsSync(path);
    const existsInUserSettings = opaPath !== null && commandExistsSync(opaPath);

    if (!(existsOnPath || existsInUserSettings)) {
        promptForInstall();
        return;
    }

    if (existsInUserSettings && opaPath !== undefined) {
        // Prefer OPA in User Settings to the one installed on $PATH
        path = opaPath;
    }

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
