"use strict";

import * as vscode from "vscode";

/**
 * String helpers for OPA types.
 */
export function getPackage(parsed: any): string {
  return getPathString(parsed["package"].path.slice(1));
}

export function getImports(parsed: any): string[] {
  if (parsed.imports !== undefined) {
    return parsed.imports.map((x: any) => {
      const str = getPathString(x.path.value);
      if (!x.alias) {
        return str;
      }
      return str + " as " + x.alias;
    });
  }
  return [];
}

export function getPathString(path: any): string {
  let i = -1;
  return path.map((x: any) => {
    i++;
    if (i === 0) {
      return x.value;
    } else {
      if (x.value.match("^[a-zA-Z_][a-zA-Z_0-9]*$")) {
        return "." + x.value;
      }
      return "[\"" + x.value + "\"]";
    }
  }).join("");
}

export function getPrettyTime(ns: number): string {
  const seconds = ns / 1e9;
  if (seconds >= 1) {
    return seconds.toString() + "s";
  }
  const milliseconds = ns / 1e6;
  if (milliseconds >= 1) {
    return milliseconds.toString() + "ms";
  }
  return (ns / 1e3).toString() + "µs";
}

export function replaceWorkspaceFolderPathVariable(path: string): string {
  if (vscode.workspace.workspaceFolders !== undefined) {
    // here, uri.fsPath is used as this returns a usable path on both Windows and Unix
    const workspaceFolderPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
    path = path.replace("${workspaceFolder}", workspaceFolderPath);
    path = path.replace("${workspacePath}", workspaceFolderPath);
  } else if (path.indexOf("${workspaceFolder}") >= 0) {
    vscode.window.showWarningMessage(
      "${workspaceFolder} variable configured in settings, but no workspace is active"
    );
  }

  return path;
}
