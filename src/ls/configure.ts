'use strict';

import * as vscode from 'vscode';

import { supportedLanguageServers } from './ls';
import { isInstalledRegal, regalPath } from './clients/regal';
import { opaOutputChannel } from '../extension';

// configureLanguageServers checks if any of the supported language servers
// are installed and prompts the user to enable them.
// If a user opts in, the language server is added to the list of enabled
// language servers in the OPA extension configuration.
export function configureLanguageServers(context: vscode.ExtensionContext) {
    const configuration = vscode.workspace.getConfiguration('opa');
    const configuredLanguageServers = configuration.get<Array<string>>('languageServers') || [];

    // if the user has language servers set to an empty array this is
    // taken as an indication that they don't want to be prompted to enable
    // any new ones
    if (configuration.get('languageServers') !== null && configuredLanguageServers.length === 0) {
        opaOutputChannel.appendLine('User has no language servers configured');
        return
    }

    // offer to enable any installed language servers that are not enabled
    for (const [languageServerID, languageServerName] of Object.entries(supportedLanguageServers)) {
        // continue if the language server is already configured
        const isConfigured = configuredLanguageServers.includes(languageServerID);
        if (isConfigured) {
            continue;
        }

        switch (languageServerID) {
            case 'regal': {
                const isInstalled = isInstalledRegal();
                const path = regalPath();
                // if regal has been installed by the extension, it should be
                // enabled by default
                if (!isConfigured && isInstalled && path !== 'regal') {
                    configuration.update(
                        'languageServers',
                        configuredLanguageServers.concat([languageServerID]),
                        // This makes it a global configuration change for all
                        // OPA/Rego projects
                        true,
                    );
                    break
                }

                // don't offer to enable regal if it's not installed
                if (!isInstalled) {
                    break
                }

                const globalStateKey = 'opa.prompts.configure.language_server.' + languageServerID;

                if (context.globalState.get(globalStateKey)) {
                    continue;
                }

                context.globalState.update(globalStateKey, true);

                const btnText = 'Enable ' + languageServerName;
                vscode.window.showInformationMessage(
                    'You have ' + languageServerName + ' installed. Would you like to use it from the OPA plugin?',
                    btnText,
                ).then((selection) => {
                    if (selection === btnText) {
                        configuration.update(
                            'languageServers',
                            configuredLanguageServers.concat([languageServerID]),
                            // This makes it a global configuration change for all
                            // OPA/Rego projects
                            true,
                        );
                    }
                });
            }
        }
    }
}
