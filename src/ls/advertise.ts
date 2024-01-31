'use strict';

import { supportedLanguageServers } from './ls';
import { promptForInstallRegal, isInstalledRegal } from './clients/regal';

// advertiseLanguageServers checks if any of the supported language servers
// are installed and prompts the user to install them if not.
export function advertiseLanguageServers() {
    for (const languageServerID in supportedLanguageServers) {
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
