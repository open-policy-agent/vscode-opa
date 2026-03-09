"use strict";

import * as vscode from "vscode";

export function rootId(workspaceUri: vscode.Uri): string {
  return workspaceUri.with({ query: "root" }).toString();
}

export function packageId(workspaceUri: vscode.Uri, fullPackage: string): string {
  return workspaceUri.with({ query: "package", fragment: fullPackage }).toString();
}

export function testId(fileUri: vscode.Uri, pkg: string, name: string): string {
  return fileUri.with({ query: "test", fragment: `${pkg}:${name}` }).toString();
}

export function parseTestId(testIdStr: string): { package: string; name: string } | undefined {
  const uri = vscode.Uri.parse(testIdStr);
  if (uri.query !== "test") {
    return undefined;
  }

  const [pkg, name] = uri.fragment.split(":");
  if (!pkg || !name) {
    return undefined;
  }

  return { package: pkg, name };
}
