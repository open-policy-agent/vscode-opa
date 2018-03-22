'use strict';

import * as vscode from 'vscode';
import cp = require('child_process');
var commandExistsSync = require('command-exists').sync;
var fs = require('fs');
var path = require('path');

let testOutputChannel = vscode.window.createOutputChannel('OPA Tests');

export class TraceProvider implements vscode.TextDocumentContentProvider {

    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private content = "";

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.content;
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public set(uri: vscode.Uri, trace: any) {
        this.content = trace.join("\n");
        this._onDidChange.fire(uri);
    }
}

export class JSONProvider implements vscode.TextDocumentContentProvider {

    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private content = "";

    public provideTextDocumentContent(uri: vscode.Uri): string {
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
    vscode.workspace.onDidChangeTextDocument(removeCoverageOnDocumentChange, null, context.subscriptions);

    activateCoverWorkspace(context);
    activateEvalPackage(context);
    activateEvalSelection(context);
    activateTestWorkspace(context);
    activateTraceSelection(context);
}


let coveredHighlight = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(64,128,64,0.5)',
    isWholeLine: true
});

let notCoveredHighlight = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(128,64,64,0.5)',
    isWholeLine: true
});

interface UntypedObject {
    [key: string]: any
}

let fileCoverage: UntypedObject = {};

function showCoverageOnEditorChange(editor: vscode.TextEditor | undefined) {
    if (!editor) {
        return;
    }
    showCoverageForEditor(editor)
}

function removeCoverageOnDocumentChange(e: vscode.TextDocumentChangeEvent) {
    removeCoverage();
}

function showCoverageForEditor(editor: vscode.TextEditor) {
    Object.keys(fileCoverage).forEach(fileName => {
        vscode.window.visibleTextEditors.forEach((value, index, obj) => {
            if (value.document.fileName.endsWith(fileName)) {
                value.setDecorations(coveredHighlight, fileCoverage[fileName].covered);
                value.setDecorations(notCoveredHighlight, fileCoverage[fileName].notCovered);
            }
        })
    });
}

function removeCoverage() {
    Object.keys(fileCoverage).forEach(fileName => {
        vscode.window.visibleTextEditors.forEach((value, index, obj) => {
            if (value.document.fileName.endsWith(fileName)) {
                value.setDecorations(coveredHighlight, []);
                value.setDecorations(notCoveredHighlight, []);
            }
        })
    });
    fileCoverage = {};
}


function activateCoverWorkspace(context: vscode.ExtensionContext) {

    var coverWorkspaceCommand = vscode.commands.registerCommand('opa.test.coverage.workspace', () => {

        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        for (let fileName in fileCoverage) {
            if (editor.document.fileName.endsWith(fileName)) {
                removeCoverage();
                return;
            }
        }

        let rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
        fileCoverage = {};

        runOPA('opa', ['test', '--coverage', '--format', 'json', rootPath], '', (error: string, result: any) => {
            if (error !== '') {
                testOutputChannel.clear();
                testOutputChannel.append(error);
                testOutputChannel.show(true);
            } else {
                Object.keys(result.files).forEach(fileName => {
                    let report = result.files[fileName];
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
                        notCovered: notCovered
                    };
                });
                vscode.window.visibleTextEditors.forEach((value, index, obj) => {
                    showCoverageForEditor(value);
                })

            }
        });

    });

    context.subscriptions.push(coverWorkspaceCommand);
}

function activateEvalPackage(context: vscode.ExtensionContext) {
    const uri = vscode.Uri.parse(`json:output.json`);
    const provider = new JSONProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider(uri.scheme, provider);

    var evalPackageCommand = vscode.commands.registerCommand('opa.eval.package', onActiveWorkspaceEditor(uri, (editor: vscode.TextEditor) => {

        parseOPA('opa', editor.document.uri.path, (pkg: string, _: Array<string>) => {

            let rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
            let args: string[] = ['eval'];

            args.push('--stdin');
            args.push('--data', rootPath);
            args.push('--package', pkg);
            args.push('--metrics');

            let inputPath = path.join(rootPath, 'input.json');
            if (fs.existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            runOPA('opa', args, 'data.' + pkg, (error: string, result: any) => {
                if (error !== '') {
                    vscode.window.showErrorMessage(error);
                } else {
                    if (result.result === undefined) {
                        provider.set(uri, "// No results found.", undefined);
                    } else {
                        provider.set(uri, `// Evaluated package in ${getPrettyTime(result.metrics.timer_rego_query_eval_ns)}.`, result.result[0].expressions[0].value);
                    }
                }
            });
        });
    }));

    context.subscriptions.push(evalPackageCommand, registration);
}

function activateEvalSelection(context: vscode.ExtensionContext) {
    const uri = vscode.Uri.parse(`json:output.json`);
    const provider = new JSONProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider(uri.scheme, provider);

    var evalSelectionCommand = vscode.commands.registerCommand('opa.eval.selection', onActiveWorkspaceEditor(uri, (editor: vscode.TextEditor) => {

        parseOPA('opa', editor.document.uri.path, (pkg: string, imports: Array<string>) => {

            let rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
            let args: string[] = ['eval'];

            args.push('--stdin');
            args.push('--data', rootPath);
            args.push('--package', pkg);
            args.push('--metrics');

            let inputPath = path.join(rootPath, 'input.json');
            if (fs.existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            imports.forEach((x: string) => {
                args.push('--import', x);
            });

            let text = editor.document.getText(editor.selection);

            runOPA('opa', args, text, (error: string, result: any) => {
                if (error !== '') {
                    vscode.window.showErrorMessage(error);
                } else {
                    if (result.result === undefined) {
                        provider.set(uri, "// No results found.", undefined);
                    } else {
                        var output: any;
                        if (result.result[0].bindings === undefined) {
                            output = result.result.map((x: any) => x.expressions.map((x: any) => x.value));
                        } else {
                            output = result.result.map((x: any) => x.bindings);
                        }
                        provider.set(uri, `// Found ${result.result.length} result${result.result.length === 1 ? "" : "s"} in ${getPrettyTime(result.metrics.timer_rego_query_eval_ns)}.`, output);
                    }
                }
            });
        });
    }));

    context.subscriptions.push(evalSelectionCommand, registration);
}

function activateTestWorkspace(context: vscode.ExtensionContext) {

    var testWorkspaceCommand = vscode.commands.registerCommand('opa.test.workspace', () => {
        testOutputChannel.show(true);
        testOutputChannel.clear();

        let rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
        let args: string[] = ['test'];

        args.push('--verbose');
        args.push(rootPath);

        runOPAStatus('opa', args, '', (code: number, stderr: string, stdout: string) => {
            if (code === 0 || code === 2) {
                testOutputChannel.append(stdout);
            } else {
                vscode.window.showErrorMessage(stderr);
            }
        });
    });

    context.subscriptions.push(testWorkspaceCommand);
}

function activateTraceSelection(context: vscode.ExtensionContext) {
    const uri = vscode.Uri.parse(`opa+trace://trace/output.trace`);
    const provider = new TraceProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider(uri.scheme, provider);

    var traceSelectionCommand = vscode.commands.registerCommand('opa.trace.selection', onActiveWorkspaceEditor(uri, (editor: vscode.TextEditor) => {

        let text = editor.document.getText(editor.selection);

        parseOPA('opa', editor.document.uri.path, (pkg: string, imports: Array<string>) => {

            let rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
            let args: string[] = ['eval'];

            args.push('--stdin');
            args.push('--data', rootPath);
            args.push('--package', pkg);

            let inputPath = path.join(rootPath, 'input.json');
            if (fs.existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            imports.forEach((x: string) => {
                args.push('--import', x);
            });

            args.push('--explain', 'full');

            runOPA('opa', args, text, (error: string, result: any) => {
                if (error !== '') {
                    vscode.window.showErrorMessage(error);
                } else {
                    provider.set(uri, result.explanation);
                }
            });
        });
    }));

    context.subscriptions.push(traceSelectionCommand, registration);
}

function onActiveWorkspaceEditor(forURI: vscode.Uri, cb: (editor: vscode.TextEditor) => void): () => void {
    return () => {

        // Open the read-only document on the right most column. If no
        // read-only document exists yet, create a new one. If one exists,
        // re-use it.
        vscode.workspace.openTextDocument(forURI)
            .then(function (doc: any) {

                let found = vscode.window.visibleTextEditors.find((ed: vscode.TextEditor) => {
                    return ed.document.uri === doc.uri;
                });

                if (found === undefined) {
                    return vscode.window.showTextDocument(doc, vscode.ViewColumn.Three, true);
                }

                return found;
            });

        // TODO(tsandall): test non-workspace mode. I don't know if this plugin
        // will work if a single file is loaded. Certain features may not work
        // but many can.
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        let folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            return;
        }

        cb(editor);
    };
}

/**
 * Helpers for executing OPA as a subprocess.
 */

function parseOPA(opaPath: string, path: string, cb: (pkg: string, imports: Array<string>) => void) {
    runOPA(opaPath, ['parse', path, '--format', 'json'], '', (error: string, result: any) => {
        if (error !== '') {
            vscode.window.showErrorMessage(error);
        } else {
            let pkg = getPackage(result);
            let imports = getImports(result);
            cb(pkg, imports);
        }
    });
}

// runOPA executes the OPA binary at path with args and stdin.  The callback is
// invoked with an error message on failure or JSON object on success.
function runOPA(path: string, args: Array<string>, stdin: string, cb: (error: string, result: any) => void) {
    runOPAStatus(path, args, stdin, (code: number, stderr: string, stdout: string) => {
        if (code !== 0) {
            cb(stderr, '');
        } else {
            cb('', JSON.parse(stdout));
        }
    });
}

// runOPAStatus executes the OPA binary at path with args and stdin. The
// callback is invoked with the exit status, stderr, and stdout buffers.
function runOPAStatus(path: string, args: Array<string>, stdin: string, cb: (code: number, stderr: string, stdout: string) => void) {

    if (!commandExistsSync(path)) {
        cb(199, path + ' does not exist in $PATH. Check that OPA executable is installed into $PATH and VS Code was started with correct $PATH.', '');
        return;
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

/**
 * String helpers for OPA types.
 */

function getPackage(parsed: any): string {
    return getPathString(parsed["package"].path.slice(1));
}

function getImports(parsed: any): Array<string> {
    if (parsed.imports !== undefined) {
        return parsed.imports.map((x: any) => {
            let str = getPathString(x.path.value);
            if (!x.alias) {
                return str;
            }
            return str + " as " + x.alias;
        });
    }
    return [];
}

function getPathString(path: any): string {
    let i = -1;
    return path.map((x: any) => {
        i++;
        if (i === 0) {
            return x.value;
        } else {
            if (x.value.match('^[a-zA-Z_][a-zA-Z_0-9]*$')) {
                return "." + x.value;
            }
            return '["' + x.value + '"]';
        }
    }).join('');
}

function getPrettyTime(ns: number): string {
    let seconds = ns / 1e9;
    if (seconds >= 1) {
        return seconds.toString() + 's';
    }
    let milliseconds = ns / 1e6;
    if (milliseconds >= 1) {
        return milliseconds.toString() + 'ms';
    }
    return (ns / 1e3).toString() + 'µs';
}

export function deactivate() {
}
