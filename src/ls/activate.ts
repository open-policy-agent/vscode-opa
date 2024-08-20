"use strict";

import * as vscode from "vscode";

import { activateRegal, deactivateRegal } from "./clients/regal";
import { supportedLanguageServers } from "./ls";

export function activateLanguageServers(context: vscode.ExtensionContext) {
  const configuration = vscode.workspace.getConfiguration("opa");
  const configuredLanguageServers = configuration.get<Array<string>>("languageServers") || [];

  // Find any language servers that are enabled but not configured and
  // disable them.
  for (const languageServerID in supportedLanguageServers) {
    if (configuredLanguageServers.includes(languageServerID)) {
      continue;
    }

    switch (languageServerID) {
      case "regal":
        deactivateRegal();
        break;
    }
  }

  // Enable any newly configured language servers.
  for (const languageServer of configuredLanguageServers) {
    switch (languageServer) {
      case "regal":
        activateRegal(context);
        break;
    }
  }
}
