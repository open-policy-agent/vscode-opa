"use strict";

import * as vscode from "vscode";

let lastRegoEditor: vscode.TextEditor | undefined;

function isRegoEditor(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
  return editor?.document.languageId === "rego";
}

// Remember the most recently focused Rego editor, so that commands still target it
// after focus moves elsewhere, e.g. to the Output panel or the eval output document.
export function trackRegoEditor(editor: vscode.TextEditor | undefined) {
  if (isRegoEditor(editor)) {
    lastRegoEditor = editor;
  }
}

// Returns the active Rego editor, or else the last focused Rego editor whose document is still open.
export function getRegoEditor(): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (isRegoEditor(active)) {
    return active;
  }

  if (!lastRegoEditor || lastRegoEditor.document.isClosed) {
    return undefined;
  }

  // Prefer a visible editor for the same document, since the tracked instance
  // may have been disposed if its tab was hidden.
  const doc = lastRegoEditor.document;
  return vscode.window.visibleTextEditors.find(ed => ed.document === doc) ?? lastRegoEditor;
}

// Like getRegoEditor, but tells the user to open a Rego file when there is none.
export function requireRegoEditor(): vscode.TextEditor | undefined {
  const editor = getRegoEditor();
  if (!editor) {
    vscode.window.showErrorMessage("Open a .rego file to run this command.");
  }
  return editor;
}
