'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import * as opa from './opa';
import { getPrettyTime } from './util';

export let opaOutputChannel = vscode.window.createOutputChannel('OPA');

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

    activateCheckFile(context);
    activateCoverWorkspace(context);
    activateEvalPackage(context);
    activateEvalSelection(context);
    activateTestWorkspace(context);
    activateTraceSelection(context);
    activateProfilePackage(context);
    activateProfileSelection(context);
    activatePartialSelection(context);
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
    [key: string]: any;
}

let fileCoverage: UntypedObject = {};

function showCoverageOnEditorChange(editor: vscode.TextEditor | undefined) {
    if (!editor) {
        return;
    }
    showCoverageForEditor(editor);
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
        });
    });
}

function removeCoverage() {
    Object.keys(fileCoverage).forEach(fileName => {
        vscode.window.visibleTextEditors.forEach((value, index, obj) => {
            if (value.document.fileName.endsWith(fileName)) {
                value.setDecorations(coveredHighlight, []);
                value.setDecorations(notCoveredHighlight, []);
            }
        });
    });
    fileCoverage = {};
}

function activateCheckFile(context: vscode.ExtensionContext) {
    const checkRegoFile = () => {
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const doc = editor.document;

        // Only check rego files
        if (doc.languageId === 'rego') {

            const filePath = doc.uri.fsPath;

            opa.runWithStatus('opa', ['check', filePath], '', (code: number, stderr: string, stdout: string) => {
                let output = stdout;
                if (output.trim() !== '') {
                    opaOutputChannel.show(true);
                    opaOutputChannel.clear();
                    opaOutputChannel.append(stdout);
                } else {
                    opaOutputChannel.clear();
                    opaOutputChannel.hide();
                }
            });
        }
    };
    const checkFileCommand = vscode.commands.registerCommand('opa.check.file', checkRegoFile);
    // Need to use onWillSave instead of onDidSave because there's a weird race condition
    // that causes the callback to get called twice when we prompt for installing OPA
    vscode.workspace.onWillSaveTextDocument(checkRegoFile, null, context.subscriptions);

    context.subscriptions.push(checkFileCommand);
}

function activateCoverWorkspace(context: vscode.ExtensionContext) {

    const coverWorkspaceCommand = vscode.commands.registerCommand('opa.test.coverage.workspace', () => {

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

        opa.run('opa', ['test', '--coverage', '--format', 'json', rootPath], '', (error: string, result: any) => {
            if (error !== '') {
                opaOutputChannel.clear();
                opaOutputChannel.append(error);
                opaOutputChannel.show(true);
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
                });

            }
        });

    });

    context.subscriptions.push(coverWorkspaceCommand);
}

function activateEvalPackage(context: vscode.ExtensionContext) {
    const uri = vscode.Uri.parse(`json:output.json`);
    const provider = new JSONProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider(uri.scheme, provider);

    const evalPackageCommand = vscode.commands.registerCommand('opa.eval.package', onActiveWorkspaceEditor(uri, (editor: vscode.TextEditor) => {


        opa.parse('opa', editor.document.uri.fsPath, (pkg: string, _: string[]) => {

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

            opa.run('opa', args, 'data.' + pkg, (error: string, result: any) => {
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

    const evalSelectionCommand = vscode.commands.registerCommand('opa.eval.selection', onActiveWorkspaceEditor(uri, (editor: vscode.TextEditor) => {


        opa.parse('opa', editor.document.uri.fsPath, (pkg: string, imports: string[]) => {

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

            opa.run('opa', args, text, (error: string, result: any) => {
                if (error !== '') {
                    vscode.window.showErrorMessage(error);
                } else {
                    if (result.result === undefined) {
                        provider.set(uri, "// No results found.", undefined);
                    } else {
                        let output: any;
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

    const testWorkspaceCommand = vscode.commands.registerCommand('opa.test.workspace', () => {
        opaOutputChannel.show(true);
        opaOutputChannel.clear();

        let rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
        let args: string[] = ['test'];

        args.push('--verbose');
        args.push(rootPath);

        opa.runWithStatus('opa', args, '', (code: number, stderr: string, stdout: string) => {
            if (code === 0 || code === 2) {
                opaOutputChannel.append(stdout);
            } else {
                vscode.window.showErrorMessage(stderr);
            }
        });
    });

    context.subscriptions.push(testWorkspaceCommand);
}

function activateTraceSelection(context: vscode.ExtensionContext) {
    const traceSelectionCommand = vscode.commands.registerCommand('opa.trace.selection', () => {

        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        let text = editor.document.getText(editor.selection);

        opa.parse('opa', editor.document.uri.fsPath, (pkg: string, imports: string[]) => {

            let rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
            let args: string[] = ['eval'];

            args.push('--stdin');
            args.push('--data', rootPath);
            args.push('--package', pkg);
            args.push('--format', 'pretty');

            let inputPath = path.join(rootPath, 'input.json');
            if (fs.existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            imports.forEach((x: string) => {
                args.push('--import', x);
            });

            args.push('--explain', 'full');

            opa.runWithStatus('opa', args, text, (code: number, stderr: string, stdout: string) => {
                opaOutputChannel.show(true);
                opaOutputChannel.clear();

                if (code === 0 || code === 2) {
                    opaOutputChannel.append(stdout);
                } else {
                    vscode.window.showErrorMessage(stderr);
                }
            });
        });
    });

    context.subscriptions.push(traceSelectionCommand);
}

function activateProfilePackage(context: vscode.ExtensionContext) {
    const profilePackageCommand = vscode.commands.registerCommand('opa.profile.package', () => {

        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        opa.parse('opa', editor.document.uri.fsPath, (pkg: string, _: string[]) => {
            opaOutputChannel.show(true);
            opaOutputChannel.clear();

            let rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
            let args: string[] = ['eval'];

            args.push('--stdin');
            args.push('--data', rootPath);
            args.push('--package', pkg);
            args.push('--profile');
            args.push('--format', 'pretty');

            let inputPath = path.join(rootPath, 'input.json');
            if (fs.existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            opa.runWithStatus('opa', args, 'data.' + pkg, (code: number, stderr: string, stdout: string) => {
                if (code === 0 || code === 2) {
                    opaOutputChannel.append(stdout);
                } else {
                    vscode.window.showErrorMessage(stderr);
                }
            });
        });
    });

    context.subscriptions.push(profilePackageCommand);
}

function activateProfileSelection(context: vscode.ExtensionContext) {
    const profileSelectionCommand = vscode.commands.registerCommand('opa.profile.selection', () => {

        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        let text = editor.document.getText(editor.selection);

        opa.parse('opa', editor.document.uri.fsPath, (pkg: string, imports: string[]) => {
            opaOutputChannel.show(true);
            opaOutputChannel.clear();

            let rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
            let args: string[] = ['eval'];

            args.push('--stdin');
            args.push('--data', rootPath);
            args.push('--package', pkg);
            args.push('--profile');
            args.push('--format', 'pretty');

            let inputPath = path.join(rootPath, 'input.json');
            if (fs.existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            imports.forEach((x: string) => {
                args.push('--import', x);
            });

            opa.runWithStatus('opa', args, text, (code: number, stderr: string, stdout: string) => {
                if (code === 0 || code === 2) {
                    opaOutputChannel.append(stdout);
                } else {
                    vscode.window.showErrorMessage(stderr);
                }
            });
        });
    });

    context.subscriptions.push(profileSelectionCommand);
}

function activatePartialSelection(context: vscode.ExtensionContext) {
    const partialSelectionCommand = vscode.commands.registerCommand('opa.partial.selection', () => {

        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        let text = editor.document.getText(editor.selection);

        opa.parse('opa', editor.document.uri.fsPath, (pkg: string, imports: string[]) => {
            opaOutputChannel.show(true);
            opaOutputChannel.clear();

            let rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
            let args: string[] = ['eval'];

            args.push('--partial');
            args.push('--stdin');
            args.push('--data', rootPath);
            args.push('--package', pkg);
            args.push('--format', 'pretty');

            let inputPath = path.join(rootPath, 'input.json');
            if (fs.existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            imports.forEach((x: string) => {
                args.push('--import', x);
            });

            opa.runWithStatus('opa', args, text, (code: number, stderr: string, stdout: string) => {
                if (code === 0 || code === 2) {
                    opaOutputChannel.append(stdout);
                } else {
                    vscode.window.showErrorMessage(stderr);
                }
            });
        });
    });

    context.subscriptions.push(partialSelectionCommand);
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

export function deactivate() {
}
