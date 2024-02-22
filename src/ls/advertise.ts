'use strict';

import * as vscode from 'vscode';

import { supportedLanguageServers } from './ls';
import { promptForInstallRegal, isInstalledRegal } from './clients/regal';
import { opaIsInstalled } from '../opa';

// advertiseLanguageServers checks if any of the supported language servers
// are installed and prompts the user to install them if not.
export function advertiseLanguageServers(context: vscode.ExtensionContext) {
    // if the user has not yet been offered to install OPA,
    // don't offer to install language servers and wait for that process to complete.
    // advertiseLanguageServers is run again after OPA is installed.
    const promptedForOPAInstall = context.globalState.get('opa.prompts.install.opa');
    if (!opaIsInstalled(context) && !promptedForOPAInstall) {
        return;
    }

    for (const languageServerID in supportedLanguageServers) {
        const globalStateKey = 'opa.prompts.install.language_server.' + languageServerID;

        if (context.globalState.get(globalStateKey)) {
            continue;
        }

        context.globalState.update(globalStateKey, true);

        switch (languageServerID) {
            case 'regal':
                if (isInstalledRegal()) {
                    break;
                }
                promptForInstallRegal('Would you like to install Regal for live linting of Rego code?');
                break;
        }
    }
}
