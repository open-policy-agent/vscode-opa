"use strict";

import { sync as commandExistsSync } from "command-exists";
import { existsSync } from "fs";
import * as vscode from "vscode";
import { replaceWorkspaceFolderPathVariable } from "../util";
import { BinaryConfig, BinaryInfo } from "./types";

export function resolveBinary(config: BinaryConfig, fallbackPath?: string): BinaryInfo {
  let path = vscode.workspace.getConfiguration("opa.dependency_paths").get<string>(config.configKey);

  let configuredOriginalPath: string | undefined;

  if (path?.trim()) {
    const originalPath = path;
    path = replaceWorkspaceFolderPathVariable(path);

    if (path.startsWith("file://")) {
      path = path.substring(7);
    }

    if (existsSync(path)) {
      const versionInfo = config.versionParser(path);
      return {
        path,
        source: "configured",
        originalPath,
        version: versionInfo.version,
        ...(versionInfo.error && { error: versionInfo.error }),
      };
    }

    configuredOriginalPath = originalPath;
  }

  const systemPath = fallbackPath || config.configKey;
  if (commandExistsSync(systemPath)) {
    const versionInfo = config.versionParser(systemPath);
    return {
      path: systemPath,
      source: "system",
      version: versionInfo.version,
      ...(configuredOriginalPath && {
        originalPath: configuredOriginalPath,
        configuredPathMissing: true,
      }),
      ...(versionInfo.error && { error: versionInfo.error }),
    };
  }

  return {
    source: "missing",
    version: "missing",
    ...(configuredOriginalPath && {
      originalPath: configuredOriginalPath,
      configuredPathMissing: true,
    }),
  };
}

// warnConfiguredPathMissing logs to the output channel and shows a popup
// indicating the configured binary path didn't exist on disk. Callers should
// gate this on binaryInfo.configuredPathMissing being set.
export function warnConfiguredPathMissing(
  config: BinaryConfig,
  binaryInfo: BinaryInfo,
  outputChannel: vscode.OutputChannel,
): void {
  const inspected = vscode.workspace
    .getConfiguration("opa.dependency_paths")
    .inspect<string>(config.configKey);
  const sourceDetail = inspected?.workspaceValue
    ? "workspace settings (.vscode/settings.json)"
    : "user settings";

  outputChannel.appendLine(
    `${config.name}: configured path '${binaryInfo.originalPath}' from ${sourceDetail} not found; falling back to ${
      binaryInfo.source === "system" ? "system PATH" : "no binary available"
    }.`,
  );

  vscode.window.showWarningMessage(
    `${config.name} binary not found at configured path '${binaryInfo.originalPath}' (from ${sourceDetail}).`,
  );
}
