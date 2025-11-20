"use strict";

import { sync as commandExistsSync } from "command-exists";
import { existsSync } from "fs";
import * as vscode from "vscode";
import { replaceWorkspaceFolderPathVariable } from "../util";
import { BinaryConfig, BinaryInfo } from "./types";

export function resolveBinary(config: BinaryConfig, fallbackPath?: string): BinaryInfo {
  let path = vscode.workspace.getConfiguration("opa.dependency_paths").get<string>(config.configKey);

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
  }

  const systemPath = fallbackPath || config.configKey;
  if (commandExistsSync(systemPath)) {
    const versionInfo = config.versionParser(systemPath);
    return {
      path: systemPath,
      source: "system",
      version: versionInfo.version,
      ...(versionInfo.error && { error: versionInfo.error }),
    };
  }

  return {
    source: "missing",
    version: "missing",
  };
}
