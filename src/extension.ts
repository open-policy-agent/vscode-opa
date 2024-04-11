'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import * as opa from './opa';
import { getPrettyTime } from './util';
import { configureLanguageServers } from './ls/configure';
import { activateLanguageServers } from './ls/activate';
import { advertiseLanguageServers } from './ls/advertise';

export const opaOutputChannel = vscode.window.createOutputChannel('OPA');

export class JSONProvider implements vscode.TextDocumentContentProvider {

    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private content = "";

    public provideTextDocumentContent(_uri: vscode.Uri): string {
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
    activateDefinitionProvider(context);
    activateClearPromptsCommand(context);

    // promote available language servers to users with none installed
    advertiseLanguageServers(context);
    // prompt users with language servers installed to enable them
    configureLanguageServers(context);
    // start configured language servers
    activateLanguageServers(context);

    // this will trigger the prompt to install OPA if missing, rather than waiting til on save
    // the manual running of a command
    opa.runWithStatus(context, 'opa', ['version'], '', (_code: number, _stderr: string, _stdout: string) => { });

    context.subscriptions.push(vscode.commands.registerCommand('opa.show.commands', () => {
        const extension = vscode.extensions.getExtension("tsandall.opa");
        if (extension !== undefined) {
            const commands = extension.packageJSON.contributes.commands;
            commands.push({ command: 'editor.action.goToDeclaration', title: 'Go to Definition' });
        }
    }));

    // 'local' formatter for OPA, this uses opa format directly and does not
    // use any language servers
    const opaFormatter: vscode.DocumentFormattingEditProvider = {
        provideDocumentFormattingEdits(_document: vscode.TextDocument): vscode.TextEdit[] | Thenable<vscode.TextEdit[]> {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return [];
            }

            // opa fmt doesn't support block formatting
            // so we must always select the entire document
            const selectionRange = getFullDocumentSelection(editor);

            const content = editor.document.getText(selectionRange);

            return new Promise((resolve, reject) => {
                runOPAFormatter(context, content, editor, reject, resolve, selectionRange);
            });
        }
    };

    // opaFormatterRegistration is used to track the registration of the OPA formatter.
    // The registration is disposed when the language server 'regal' is enabled so that
    // the language server can handle formatting instead of shelling out to 'opa fmt'.
    let opaFormatterRegistration: vscode.Disposable | undefined;
    function registerOPAFormatterIfRequired() {
        const configuredLanguageServers = vscode.workspace.getConfiguration('opa').
            get<Array<string>>('languageServers') || [];
        if (configuredLanguageServers.includes('regal')) {
            // if the opaFormatter is registered, dispose it to disable the OPA formatter
            if (opaFormatterRegistration !== undefined) {
                opaFormatterRegistration.dispose();
                opaFormatterRegistration = undefined;
            }
            // here we can return as the language server will automatically pick up formatting
            // requests for rego files
            return;
        }

        opaFormatterRegistration = vscode.languages.registerDocumentFormattingEditProvider(
            { scheme: 'file', language: 'rego' },
            opaFormatter,
        );
    }
    // register the OPA formatter if required at start up
    registerOPAFormatterIfRequired();

    vscode.workspace.onDidSaveTextDocument((_document: vscode.TextDocument) => {
        const onFormat: boolean = vscode.workspace.getConfiguration('formatOnSave')['on'];
        if (onFormat !== true) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        vscode.commands.executeCommand('editor.action.formatDocument');
        editor.document.save();
        return;
    });

    vscode.workspace.onDidChangeConfiguration((_event) => {
        // configureLanguageServers is run here to catch newly installed language servers,
        // after their paths are updated.
        configureLanguageServers(context);
        activateLanguageServers(context);

        // if there is no language server configured, register the OPA formatter for rego
        registerOPAFormatterIfRequired();
    });
}

const outputUri = vscode.Uri.parse(`json:output.jsonc`);

const coveredHighlight = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(64,128,64,0.5)',
    isWholeLine: true
});

const notCoveredHighlight = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(128,64,64,0.5)',
    isWholeLine: true
});

interface UntypedObject {
    [key: string]: any;
}

let fileCoverage: UntypedObject = {};

function runOPAFormatter(context: vscode.ExtensionContext, content: string, editor: vscode.TextEditor | undefined,
    reject: (reason?: any) => void,
    resolve: (value: vscode.TextEdit[] | PromiseLike<vscode.TextEdit[]>) => void,
    selectionRange: vscode.Selection) {

    opa.runWithStatus(context, 'opa', ['fmt'], content, (code: number, stderr: string, stdout: string) => {
        if (!editor) {
            return [];
        }

        if (code !== 0) {
            const err = new Error("error running opa fmt :: " + stderr);
            opaOutputShowError(err.message);
            reject(err);
        } else {
            opaOutputHide();
        }

        resolve([vscode.TextEdit.replace(selectionRange, stdout)]);
    });
}

function getFullDocumentSelection(editor: vscode.TextEditor) {
    const firstLine = editor.document.lineAt(0);
    const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
    return new vscode.Selection(firstLine.range.start, lastLine.range.end);
}

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

function showCoverageForEditor(_editor: vscode.TextEditor) {
    Object.keys(fileCoverage).forEach((fileName) => {
        vscode.window.visibleTextEditors.forEach((value) => {
            if (value.document.fileName.endsWith(fileName)) {
                value.setDecorations(coveredHighlight, fileCoverage[fileName].covered);
                value.setDecorations(notCoveredHighlight, fileCoverage[fileName].notCovered);
            }
        });
    });
}

function showCoverageForWindow() {
    vscode.window.visibleTextEditors.forEach((value) => {
        showCoverageForEditor(value);
    });
}

function removeCoverage() {
    Object.keys(fileCoverage).forEach((fileName) => {
        vscode.window.visibleTextEditors.forEach((value) => {
            if (value.document.fileName.endsWith(fileName)) {
                value.setDecorations(coveredHighlight, []);
                value.setDecorations(notCoveredHighlight, []);
            }
        });
    });
    fileCoverage = {};
}

function setFileCoverage(result: any) {
    Object.keys(result.files).forEach((fileName) => {
        const report = result.files[fileName];
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

function setEvalOutput(provider: JSONProvider, uri: vscode.Uri, stderr: string, result: any, inputPath: string) {

    if (stderr !== '') {
        opaOutputShow(stderr);
    } else {
        opaOutputHide();
    }

    let inputMessage: string;
    if (inputPath === '') {
        inputMessage = 'no input file';
    } else {
        inputMessage = inputPath.replace('file://', '');
        inputMessage = vscode.workspace.asRelativePath(inputMessage);
    }
    if (result.result === undefined) {
        provider.set(outputUri, `// No results found. Took ${getPrettyTime(result.metrics.timer_rego_query_eval_ns)}. Used ${inputMessage} as input.`, undefined);
    } else {
        let output: any;
        if (result.result[0].bindings === undefined) {
            output = result.result.map((x: any) => x.expressions.map((x: any) => x.value));
        } else {
            output = result.result.map((x: any) => x.bindings);
        }
        provider.set(uri, `// Found ${result.result.length} result${result.result.length === 1 ? "" : "s"} in ${getPrettyTime(result.metrics.timer_rego_query_eval_ns)} using ${inputMessage} as input.`, output);
    }
}

function activateCheckFile(context: vscode.ExtensionContext) {
    const checkRegoFile = () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const doc = editor.document;

        // Only check rego files
        if (doc.languageId === 'rego') {
            const args: string[] = ['check'];

            ifInWorkspace(() => {
                if (opa.canUseBundleFlags()) {
                    args.push('--bundle');
                }
                args.push(...opa.getRoots());
                args.push(...opa.getSchemaParams());
            }, () => {
                args.push(doc.uri.fsPath);
            });

            if (opa.canUseStrictFlag()) {
                args.push('--strict');
            }

            opa.runWithStatus(context, 'opa', args, '', (_code: number, stderr: string, _stdout: string) => {
                const output = stderr;
                if (output.trim() !== '') {
                    opaOutputShowError(output);
                } else {
                    opaOutputHide();
                }
            });
        }
    };

    const checkRegoFileOnSave = () => {
        if (checkOnSaveEnabled()) {
            checkRegoFile();
        }
    };

    const checkFileCommand = vscode.commands.registerCommand('opa.check.file', checkRegoFile);
    // Need to use onWillSave instead of onDidSave because there's a weird race condition
    // that causes the callback to get called twice when we prompt for installing OPA
    vscode.workspace.onWillSaveTextDocument(checkRegoFileOnSave, null, context.subscriptions);

    context.subscriptions.push(checkFileCommand);
}

function activateCoverWorkspace(context: vscode.ExtensionContext) {

    const coverWorkspaceCommand = vscode.commands.registerCommand('opa.test.coverage.workspace', () => {

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        for (const fileName in fileCoverage) {
            if (editor.document.fileName.endsWith(fileName)) {
                removeCoverage();
                return;
            }
        }

        fileCoverage = {};

        const args: string[] = ['test', '--coverage', '--format', 'json'];

        ifInWorkspace(() => {
            if (opa.canUseBundleFlags()) {
                args.push('--bundle');
            }

            args.push(...opa.getRoots());
        }, () => {
            args.push(editor.document.uri.fsPath);
        });

        opa.run(context, 'opa', args, '', (_, result) => {
            opaOutputHide();
            setFileCoverage(result);
            showCoverageForWindow();
        }, opaOutputShowError);

    });

    context.subscriptions.push(coverWorkspaceCommand);
}

function activateEvalPackage(context: vscode.ExtensionContext) {

    const provider = new JSONProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider(outputUri.scheme, provider);

    const evalPackageCommand = vscode.commands.registerCommand('opa.eval.package', onActiveWorkspaceEditor(outputUri, (editor: vscode.TextEditor, _inWorkspace: boolean) => {

        opa.parse(context, 'opa', opa.getDataDir(editor.document.uri), (pkg: string, _: string[]) => {

            const { inputPath, args } = createOpaEvalArgs(editor, pkg);
            args.push('--metrics');

            opa.run(context, 'opa', args, 'data.' + pkg, (stderr, result) => {
                setEvalOutput(provider, outputUri, stderr, result, inputPath);
            }, opaOutputShowError);

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
        opa.parse(context, 'opa', opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {

            const { inputPath, args } = createOpaEvalArgs(editor, pkg, imports);
            args.push('--metrics');

            const text = editor.document.getText(editor.selection);

            opa.run(context, 'opa', args, text, (stderr, result) => {
                setEvalOutput(provider, outputUri, stderr, result, inputPath);
            }, opaOutputShowError);
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

        for (const fileName in fileCoverage) {
            if (editor.document.fileName.endsWith(fileName)) {
                removeCoverage();
                return;
            }
        }

        fileCoverage = {};

        opa.parse(context, 'opa', opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {

            const { inputPath, args } = createOpaEvalArgs(editor, pkg, imports);
            args.push('--metrics');
            args.push('--coverage');

            const text = editor.document.getText(editor.selection);

            opa.run(context, 'opa', args, text, (stderr, result) => {
                setEvalOutput(provider, outputUri, stderr, result, inputPath);
                setFileCoverage(result.coverage);
                showCoverageForWindow();
            }, opaOutputShowError);
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

        const args: string[] = ['test'];

        args.push('--verbose');

        ifInWorkspace(() => {
            if (opa.canUseBundleFlags()) {
                args.push("--bundle");
            }
            args.push(...opa.getRoots());
        }, () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            args.push(editor.document.uri.fsPath);
        });

        opa.runWithStatus(context, 'opa', args, '', (code: number, stderr: string, stdout: string) => {
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

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const text = editor.document.getText(editor.selection);

        opa.parse(context, 'opa', opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {

            const { args } = createOpaEvalArgs(editor, pkg, imports);
            args.push('--format', 'pretty');
            args.push('--explain', 'full');

            opa.runWithStatus(context, 'opa', args, text, (code: number, stderr: string, stdout: string) => {
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

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const text = editor.document.getText(editor.selection);

        opa.parse(context, 'opa', opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {
            opaOutputChannel.show(true);
            opaOutputChannel.clear();

            const { args } = createOpaEvalArgs(editor, pkg, imports);
            args.push('--profile');
            args.push('--format', 'pretty');

            opa.runWithStatus(context, 'opa', args, text, (code: number, stderr: string, stdout: string) => {
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

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const text = editor.document.getText(editor.selection);

        opa.parse(context, 'opa', opa.getDataDir(editor.document.uri), (pkg: string, imports: string[]) => {

            const depsArgs = ['deps', '--format', 'json',];

            ifInWorkspace(() => {
                depsArgs.push(...opa.getRootParams());
            }, () => {
                depsArgs.push('--data', editor.document.uri.fsPath);
            });

            depsArgs.push('data.' + pkg);

            opa.run(context, 'opa', depsArgs, '', (_, result: any) => {
                const refs = result.base.map((ref: any) => opa.refToString(ref));
                refs.push('input');
                vscode.window.showQuickPick(refs).then((selection: string | undefined) => {
                    if (selection !== undefined) {
                        opaOutputChannel.show(true);
                        opaOutputChannel.clear();

                        const { args } = createOpaEvalArgs(editor, pkg, imports);
                        args.push('--partial');
                        args.push('--format', 'pretty');
                        args.push('--unknowns', selection);

                        opa.runWithStatus(context, 'opa', args, text, (code: number, stderr: string, stdout: string) => {
                            if (code === 0 || code === 2) {
                                opaOutputChannel.append(stdout);
                            } else {
                                opaOutputShowError(stderr);
                            }
                        });

                    }
                });
            }, (msg) => {
                opaOutputShowError(msg);
            });
        }, (error: string) => {
            opaOutputShowError(error);
        });
    });

    context.subscriptions.push(partialSelectionCommand);
}

function activateClearPromptsCommand(context: vscode.ExtensionContext) {
    // this command is to allow users that have dismissed installation prompts from the plugin
    // to re-enable them. While mostly intended for development, it could be useful for users
    // who have dismissed a prompt and want to action it again. Clearing the global state is
    // otherwise a more involved process.
    const promptsClearCommand = vscode.commands.registerCommand('opa.prompts.clear', () => {
        opaOutputChannel.appendLine('Clearing prompts');
        context.globalState.keys().forEach((key) => {
            if (key.startsWith('opa.prompts')) {
                opaOutputChannel.appendLine(key);
                context.globalState.update(key, undefined);
            }
        });
    });

    context.subscriptions.push(promptsClearCommand);
}

function activateDefinitionProvider(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'rego', scheme: 'file' }, new RegoDefinitionProvider()));
}

function onActiveWorkspaceEditor(forURI: vscode.Uri, cb: (editor: vscode.TextEditor, inWorkspace: boolean) => void): () => void {
    return () => {

        // Open the read-only document on the right most column. If no
        // read-only document exists yet, create a new one. If one exists,
        // re-use it.
        vscode.workspace.openTextDocument(forURI)
            .then(function (doc: any) {

                const found = vscode.window.visibleTextEditors.find((ed: vscode.TextEditor) => {
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
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const inWorkspace = !!vscode.workspace.workspaceFolders;

        cb(editor, !!inWorkspace);
    };
}

let informAboutWorkspace = true;
const informAboutWorkspaceOption = "Don't show this tip again";

function ifInWorkspace(yes: () => void, no: () => void = () => { }) {
    if (vscode.workspace.workspaceFolders) {
        yes();
    } else {
        if (informAboutWorkspace) {
            vscode.window.showInformationMessage("You're editing a single file. Open it inside a workspace to include " +
                "any relative modules and schemas in the OPA commands you run.", informAboutWorkspaceOption).then((selection: string | undefined) => {
                    if (selection === informAboutWorkspaceOption) {
                        informAboutWorkspace = false;
                    }
                });
        }
        no();
    }
}

export function deactivate() {
}

function opaOutputShow(msg: string) {
    opaOutputChannel.clear();
    opaOutputChannel.append(msg);
    opaOutputChannel.show(true);
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
        const msg = [];
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
    } catch (_) {
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
    // look for input.json at the active editor's directory, or the workspace directory

    const activeDir = path.dirname(vscode.window.activeTextEditor!.document.uri.fsPath);
    let parsed = vscode.Uri.file(activeDir);

    // If we're in a workspace, and there is no sibling input.json to the actively edited file, look for the file in the workspace root
    if (!!vscode.workspace.workspaceFolders && !fs.existsSync(path.join(activeDir, 'input.json'))) {
        parsed = vscode.workspace.workspaceFolders![0].uri;
    }

    // If the rootDir is a file:// URL then just append /input.json onto the
    // end. Otherwise use the path.join function to get a platform-specific file
    // path returned.
    const rootDir = opa.getDataDir(parsed);

    if (parsed.scheme === 'file') {
        return parsed.toString() + '/input.json';
    }

    return path.join(rootDir, 'input.json');
}

class RegoDefinitionProvider implements vscode.DefinitionProvider {
    public provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken): Thenable<vscode.Location> {

        const args: string[] = ['oracle', 'find-definition', '--stdin-buffer'];
        ifInWorkspace(() => {
            args.push(...opa.getRootParams());
        });

        args.push(document.fileName + ':' + document.offsetAt(position).toString());

        return new Promise<vscode.Location>((resolve, reject) => {
            // here a null context is used as it's not available at this time
            opa.runWithStatus(undefined, 'opa', args, document.getText(), (code: number, stderr: string, stdout: string) => {
                if (code === 0) {
                    const result = JSON.parse(stdout);
                    if (result.result !== undefined) {
                        resolve(new vscode.Location(vscode.Uri.file(result.result.file), new vscode.Position(result.result.row - 1, result.result.col - 1)));
                    } else if (result.error !== undefined) {
                        reject(result.error);
                    } else {
                        reject("internal error");
                    }
                } else {
                    reject(stderr);
                }
            });
        });
    }
}

function createOpaEvalArgs(editor: vscode.TextEditor, pkg: string, imports: string[] = []): { inputPath: string, args: string[] } {
    const args: string[] = ['eval'];

    args.push('--stdin');
    args.push('--package', pkg);

    let inputPath = getInputPath();
    if (existsSync(inputPath)) {
        args.push('--input', inputPath);
    } else {
        inputPath = '';
    }

    imports.forEach((x: string) => {
        args.push('--import', x);
    });

    ifInWorkspace(() => {
        args.push(...opa.getRootParams());
        args.push(...opa.getSchemaParams());
    }, () => {
        args.push('--data', editor.document.uri.fsPath);
    });

    return { inputPath, args };
}
