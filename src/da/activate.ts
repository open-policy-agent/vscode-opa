import * as vscode from "vscode";

import { existsSync, getInputPath } from "../extension";
import { regalPath } from "./../ls/clients/regal";
import { promptForUpdateRegal } from "./../ls/clients/regal";
import * as opa from "./../opa";

const minimumSupportedRegalVersion = "0.26.0";

export function activateDebugger(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("opa.debug.debugWorkspace", (resource: vscode.Uri) => {
      let targetResource = resource;
      if (!targetResource && vscode.window.activeTextEditor) {
        targetResource = vscode.window.activeTextEditor.document.uri;
      }

      // Only add the inputPath if the file exists
      let inputPath: string | undefined = getInputPath();
      if (!existsSync(inputPath)) {
        inputPath = undefined;
      }

      if (targetResource) {
        vscode.debug.startDebugging(undefined, {
          type: "opa-debug",
          name: "Debug Workspace",
          request: "launch",
          command: "eval",
          query: "data",
          inputPath: inputPath,
          stopOnEntry: true,
          enablePrint: true,
        });
      }
    }),
  );

  const provider = new OpaDebugConfigurationProvider();
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("opa-debug", provider));

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory("opa-debug", new OpaDebugAdapterExecutableFactory()),
  );

  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("opa-debug", {
    provideDebugConfigurations(
      _folder: vscode.WorkspaceFolder | undefined,
    ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
      return [
        {
          name: "Launch Rego Workspace",
          request: "launch",
          type: "opa-debug",
          command: "eval",
          query: "data",
          enablePrint: true,
        },
      ];
    },
  }, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("opa-debug", {
    provideDebugConfigurations(
      _folder: vscode.WorkspaceFolder | undefined,
    ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
      return [
        {
          name: "Launch Rego Workspace",
          request: "launch",
          type: "opa-debug",
          command: "eval",
          query: "data",
          inputPath: "${workspaceFolder}/input.json",
          enablePrint: true,
        },
      ];
    },
  }, vscode.DebugConfigurationProviderTriggerKind.Initial));
}

class OpaDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  /**
   * Massage a debug configuration just before a debug session is being launched,
   * e.g. add all missing attributes to the debug configuration.
   */
  resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // if launch.json is missing or empty
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "rego") {
        config.type = "opa-debug";
        config.name = "Launch";
        config.request = "launch";
        config.command = "eval";
        config.query = "data";
        config.stopOnEntry = true;
        config.enablePrint = true;
      }
    }

    if (!config.bundlePaths) {
      // if bundlePaths isn't set, default to opa.roots
      config.bundlePaths = opa.getRoots();
    }

    if (config.request === "attach" && !config.program) {
      return vscode.window.showInformationMessage("Cannot find a program to debug").then((_) => {
        return undefined; // abort launch
      });
    }

    if (config.request === "launch" && !config.dataPaths && !config.bundlePaths) {
      return vscode.window.showInformationMessage("Cannot find Rego to debug").then((_) => {
        return undefined; // abort launch
      });
    }

    return config;
  }
}

class OpaDebugAdapterExecutableFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
    executable: vscode.DebugAdapterExecutable | undefined,
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    if (!executable) {
      promptForUpdateRegal(minimumSupportedRegalVersion);
      executable = new vscode.DebugAdapterExecutable(regalPath(), ["debug"]);
    }
    return executable;
  }
}
