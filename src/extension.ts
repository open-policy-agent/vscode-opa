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
    activateEvalCoverage(context);
    activateTestWorkspace(context);
    activateTraceSelection(context);
    activateProfileSelection(context);
    activatePartialSelection(context);
}

const outputUri = vscode.Uri.parse(`json:output.json`);

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
    // Do not remove coverage if the output document changed.
    if (`${e.document.uri}` !== `${outputUri}`) {
        removeCoverage();
    }
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

function showCoverageForWindow() {
    vscode.window.visibleTextEditors.forEach((value, index, obj) => {
        showCoverageForEditor(value);
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

function setFileCoverage(result: any) {
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
}

function setEvalOutput(provider: JSONProvider, uri: vscode.Uri, error: string, result: any) {
    if (error !== '') {
        opaOutputShowError(error);
    } else {
        opaOutputHide();
        if (result.result === undefined) {
            provider.set(outputUri, `// No results found. Took ${getPrettyTime(result.metrics.timer_rego_query_eval_ns)}.`, undefined);
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
}

function activateCheckFile(context: vscode.ExtensionContext) {
    const checkRegoFile = () => {
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const doc = editor.document;

        // Only check rego files
        if (doc.languageId === 'rego' && checkOnSaveEnabled()) {
            let args: string[] = ['check'];
            if (opa.canUseBundleFlags()) {
                args.push('--bundle');
            }
            args.push(...opa.getRoots());
            opa.runWithStatus('opa', args, '', (code: number, stderr: string, stdout: string) => {
                let output = stdout;
                if (output.trim() !== '') {
                    opaOutputShowError(output);
                } else {
                    opaOutputHide();
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

        fileCoverage = {};

        let args: string[] = ['test', '--coverage', '--format', 'json'];
        if (opa.canUseBundleFlags()) {
            args.push('--bundle');
        }
        args.push(...opa.getRoots());

        opa.run('opa', args, '', (error: string, result: any) => {
            if (error !== '') {
                opaOutputShowError(error);
            } else {
                opaOutputHide();
                setFileCoverage(result);
                showCoverageForWindow();
            }
        });

    });

    context.subscriptions.push(coverWorkspaceCommand);
}

function activateEvalPackage(context: vscode.ExtensionContext) {

    const provider = new JSONProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider(outputUri.scheme, provider);

    const evalPackageCommand = vscode.commands.registerCommand('opa.eval.package', onActiveWorkspaceEditor(outputUri, (editor: vscode.TextEditor) => {

        opa.parse('opa', opa.getDataDir(editor.document.uri), (pkg: string, _: string[]) => {

            let args: string[] = ['eval'];

            args.push('--stdin');
            args.push(...opa.getRootParams());
            args.push('--package', pkg);
            args.push('--metrics');

            let inputPath = getInputPath();
            if (existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            opa.run('opa', args, 'data.' + pkg, (error: string, result: any) => {
                if (error !== '') {
                    opaOutputShowError(error);
                } else {
                    opaOutputHide();
                    if (result.result === undefined) {
                        provider.set(outputUri, `// No results found. Took ${getPrettyTime(result.metrics.timer_rego_query_eval_ns)}.`, undefined);
                    } else {
                        provider.set(outputUri, `// Evaluated package in ${getPrettyTime(result.metrics.timer_rego_query_eval_ns)}.`, result.result[0].expressions[0].value);
                    }
                }
            });
        }, (error: string) => {
            opaOutputShowError(error);
        });
    }));

    context.subscriptions.push(evalPackageCommand, registration);
}

function activateEvalSelection(context: vscode.ExtensionContext) {

    const provider = new JSONProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider(outputUri.scheme, provider);

    const evalSelectionCommand = vscode.commands.registerCommand('opa.eval.selection', onActiveWorkspaceEditor(outputUri, (editor: vscode.TextEditor) => {
        opa.parse('opa', opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {

            let args: string[] = ['eval'];

            args.push('--stdin');
            args.push(...opa.getRootParams());
            args.push('--package', pkg);
            args.push('--metrics');

            let inputPath = getInputPath();
            if (existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            imports.forEach((x: string) => {
                args.push('--import', x);
            });

            let text = editor.document.getText(editor.selection);

            opa.run('opa', args, text, (error: string, result: any) => {
                setEvalOutput(provider, outputUri, error, result);
            });
        }, (error: string) => {
            opaOutputShowError(error);
        });
    }));

    context.subscriptions.push(evalSelectionCommand, registration);
}


function activateEvalCoverage(context: vscode.ExtensionContext) {

    const provider = new JSONProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider(outputUri.scheme, provider);

    const evalCoverageCommand = vscode.commands.registerCommand('opa.eval.coverage', onActiveWorkspaceEditor(outputUri, (editor: vscode.TextEditor) => {

        for (let fileName in fileCoverage) {
            if (editor.document.fileName.endsWith(fileName)) {
                removeCoverage();
                return;
            }
        }

        fileCoverage = {};

        opa.parse('opa', opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {

            let args: string[] = ['eval'];

            args.push('--coverage');
            args.push('--stdin');
            args.push(...opa.getRootParams());
            args.push('--package', pkg);
            args.push('--metrics');

            let inputPath = getInputPath();
            if (existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            imports.forEach((x: string) => {
                args.push('--import', x);
            });

            let text = editor.document.getText(editor.selection);

            opa.run('opa', args, text, (error: string, result: any) => {
                setEvalOutput(provider, outputUri, error, result);
                setFileCoverage(result.coverage);
                showCoverageForWindow();
            });
        }, (error: string) => {
            opaOutputShowError(error);
        });
    }));

    context.subscriptions.push(evalCoverageCommand, registration);
}

function activateTestWorkspace(context: vscode.ExtensionContext) {

    const testWorkspaceCommand = vscode.commands.registerCommand('opa.test.workspace', () => {
        opaOutputChannel.show(true);
        opaOutputChannel.clear();

        let args: string[] = ['test'];

        args.push('--verbose');
        if (opa.canUseBundleFlags) {
            args.push("--bundle");
        }
        args.push(...opa.getRoots());

        opa.runWithStatus('opa', args, '', (code: number, stderr: string, stdout: string) => {
            if (code === 0 || code === 2) {
                opaOutputChannel.append(stdout);
            } else {
                opaOutputShowError(stderr);
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

        opa.parse('opa', opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {

            let args: string[] = ['eval'];

            args.push('--stdin');
            args.push(...opa.getRootParams());
            args.push('--package', pkg);
            args.push('--format', 'pretty');

            let inputPath = getInputPath();
            if (existsSync(inputPath)) {
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
                    opaOutputShowError(stderr);
                }
            });
        }, (error: string) => {
            opaOutputShowError(error);
        });
    });

    context.subscriptions.push(traceSelectionCommand);
}

function activateProfileSelection(context: vscode.ExtensionContext) {
    const profileSelectionCommand = vscode.commands.registerCommand('opa.profile.selection', () => {

        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        let text = editor.document.getText(editor.selection);

        opa.parse('opa', opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {
            opaOutputChannel.show(true);
            opaOutputChannel.clear();

            let args: string[] = ['eval'];

            args.push('--stdin');
            args.push(...opa.getRootParams());
            args.push('--package', pkg);
            args.push('--profile');
            args.push('--format', 'pretty');

            let inputPath = getInputPath();
            if (existsSync(inputPath)) {
                args.push('--input', inputPath);
            }

            imports.forEach((x: string) => {
                args.push('--import', x);
            });

            opa.runWithStatus('opa', args, text, (code: number, stderr: string, stdout: string) => {
                if (code === 0 || code === 2) {
                    opaOutputChannel.append(stdout);
                } else {
                    opaOutputShowError(stderr);
                }
            });
        }, (error: string) => {
            opaOutputShowError(error);
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

        opa.parse('opa', opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {

            let depsArgs = ['deps', '--format', 'json',];
            depsArgs.push(...opa.getRootParams());
            depsArgs.push('data.' + pkg);

            opa.run('opa', depsArgs, '', (err: string, result: any) => {
                let refs = result.base.map((ref: any) => opa.refToString(ref));
                refs.push('input');
                vscode.window.showQuickPick(refs).then((selection: string | undefined) => {
                    if (selection !== undefined) {
                        opaOutputChannel.show(true);
                        opaOutputChannel.clear();

                        let args: string[] = ['eval'];

                        args.push('--partial');
                        args.push('--stdin');
                        args.push(...opa.getRootParams());
                        args.push('--package', pkg);
                        args.push('--format', 'pretty');
                        args.push('--unknowns', selection);

                        let inputPath = getInputPath();
                        if (existsSync(inputPath)) {
                            args.push('--input', inputPath);
                        }

                        imports.forEach((x: string) => {
                            args.push('--import', x);
                        });

                        opa.runWithStatus('opa', args, text, (code: number, stderr: string, stdout: string) => {
                            if (code === 0 || code === 2) {
                                opaOutputChannel.append(stdout);
                            } else {
                                opaOutputShowError(stderr);
                            }
                        });

                    }
                });
            });
        }, (error: string) => {
            opaOutputShowError(error);
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

function opaOutputShowError(error: string) {
    opaOutputChannel.clear();
    opaOutputChannel.append(formatErrors(error));
    opaOutputChannel.show(true);
}

function opaOutputHide() {
    opaOutputChannel.clear();
    opaOutputChannel.hide();
}


function formatErrors(error: string): string {
    try {
        const output = JSON.parse(error);
        let errors;
        if (output.error !== undefined) {
            if (!Array.isArray(output.error)) {
                errors = [output.error];
            } else {
                errors = output.error;
            }
        } else if (output.errors !== undefined) {
            errors = output.errors;
        }
        let msg = [];
        for (let i = 0; i < errors.length; i++) {
            let location_prefix;
            if (errors[i].location.file !== '') {
                location_prefix = `${errors[i].location.file}:${errors[i].location.row}`;
            } else {
                location_prefix = `<query>`;
            }
            msg.push(`${location_prefix}: ${errors[i].code}: ${errors[i].message}`);
        }
        return msg.join('\n');
    } catch (e) {
        return error;
    }
}

function checkOnSaveEnabled() {
    return vscode.workspace.getConfiguration('opa').get<boolean>('checkOnSave');
}

function existsSync(path: string): boolean {

    const parsed = vscode.Uri.parse(path);

    if (parsed.scheme === 'file') {
        return fs.existsSync(parsed.fsPath);
    }

    return fs.existsSync(path);
}

function getInputPath(): string {

    // If the rootDir is a file:// URL then just append /input.json onto the
    // end. Otherwise use the path.join function to get a platform-specific file
    // path returned.
    const parsed = vscode.workspace.workspaceFolders![0].uri;
    let rootDir = opa.getDataDir(parsed);

    if (parsed.scheme === 'file') {
        return parsed.toString() + '/input.json';
    }

    return path.join(rootDir, 'input.json');
}
