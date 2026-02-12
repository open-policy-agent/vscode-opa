import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

export interface ExplorerParams {
  target: string;
  strict: boolean;
  annotations: boolean;
  print: boolean;
  format: boolean;
}

export interface ExplorerStage {
  name: string;
  output: string;
  error: boolean;
}

export interface ExplorerResult {
  stages: ExplorerStage[];
  plan?: string;
}

export class OPATreeItem extends vscode.TreeItem {
  public stageIndex: number | undefined;
  public itemType: "stages" | "stage" | "plan" | "config" | "config-group" | undefined;
  public configKey: "strict" | "annotations" | "print" | "format" | undefined;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      itemType?: "stages" | "stage" | "plan" | "config" | "config-group";
      description?: string;
      iconPath?: vscode.ThemeIcon;
      stageIndex?: number;
      command?: vscode.Command;
      configKey?: "strict" | "annotations" | "print" | "format";
      checkboxState?: vscode.TreeItemCheckboxState;
    },
  ) {
    super(label, collapsibleState);
    this.itemType = undefined;
    this.stageIndex = undefined;
    this.configKey = undefined;
    if (options) {
      this.itemType = options.itemType;
      this.stageIndex = options.stageIndex;
      this.configKey = options.configKey;
      if (options.description) {
        this.description = options.description;
      }
      if (options.iconPath) {
        this.iconPath = options.iconPath;
      }
      if (options.command) {
        this.command = options.command;
      }
      if (options.checkboxState !== undefined) {
        this.checkboxState = options.checkboxState;
      }
    }
  }
}

export class OPATreeDataProvider implements vscode.TreeDataProvider<OPATreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<OPATreeItem | undefined | null | void> = new vscode.EventEmitter<
    OPATreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<OPATreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  private client?: LanguageClient;
  private explorerResult?: ExplorerResult;
  private lastDocumentUri?: string;
  private treeView?: vscode.TreeView<OPATreeItem>;
  private explorerConfig = {
    strict: false,
    annotations: true,
    print: true,
    format: true,
  };

  constructor() {}

  setLanguageClient(client: LanguageClient): void {
    this.client = client;
  }

  setTreeView(treeView: vscode.TreeView<OPATreeItem>): void {
    this.treeView = treeView;
  }

  setExplorerResult(result: ExplorerResult): void {
    this.explorerResult = result;
    this.refresh();

    // Auto-reveal the tree view when results arrive
    if (this.treeView) {
      vscode.commands.executeCommand("opaView.focus");
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OPATreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: OPATreeItem): Promise<OPATreeItem[]> {
    if (!element) {
      return this.getRootElements();
    }

    // If this is the "Configuration" parent, return config options
    if (element.itemType === "config-group") {
      return [
        new OPATreeItem("Strict Mode", vscode.TreeItemCollapsibleState.None, {
          itemType: "config",
          configKey: "strict",
          checkboxState: this.explorerConfig.strict
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked,
        }),
        new OPATreeItem("Include Annotations", vscode.TreeItemCollapsibleState.None, {
          itemType: "config",
          configKey: "annotations",
          checkboxState: this.explorerConfig.annotations
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked,
        }),
        new OPATreeItem("Include Print Statements", vscode.TreeItemCollapsibleState.None, {
          itemType: "config",
          configKey: "print",
          checkboxState: this.explorerConfig.print
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked,
        }),
        new OPATreeItem("Format Output", vscode.TreeItemCollapsibleState.None, {
          itemType: "config",
          configKey: "format",
          checkboxState: this.explorerConfig.format
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked,
        }),
      ];
    }

    // If this is the "Compilation Stages" parent, return stage children
    if (element.itemType === "stages" && this.explorerResult?.stages) {
      const stages = this.explorerResult.stages;
      return stages.map((stage, index) => {
        // Check if this stage is an error stage
        if (stage.error) {
          const item = new OPATreeItem(
            stage.name,
            vscode.TreeItemCollapsibleState.None,
            {
              itemType: "stage",
              stageIndex: index,
              iconPath: new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground")),
              command: {
                command: "opa.showStageError",
                title: "Show Error",
                arguments: [stage.name, stage.output],
              },
            },
          );
          item.tooltip = `${stage.name} - Compilation error (click to view)`;
          return item;
        }

        // First stage is the baseline, subsequent stages are compared to previous
        if (index === 0) {
          const item = new OPATreeItem(
            stage.name,
            vscode.TreeItemCollapsibleState.None,
            {
              itemType: "stage",
              stageIndex: index,
              iconPath: new vscode.ThemeIcon("symbol-file"),
              command: {
                command: "opa.showStageDiff",
                title: "Show Stage Diff",
                arguments: [index, this.explorerResult],
              },
            },
          );
          item.tooltip = `${stage.name} - Initial AST`;
          return item;
        }

        // Compare with previous stage to see if there's a diff
        const previousStage = stages[index - 1];
        if (!previousStage) {
          return new OPATreeItem(stage.name, vscode.TreeItemCollapsibleState.None);
        }
        const hasChanges = stage.output !== previousStage.output;

        // Use different icons and descriptions based on whether stage made changes
        const icon = hasChanges
          ? new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("charts.yellow"))
          : new vscode.ThemeIcon("circle-outline");

        const tooltip = hasChanges
          ? `${stage.name} - Modified AST`
          : `${stage.name} - No changes`;

        const item = new OPATreeItem(
          stage.name,
          vscode.TreeItemCollapsibleState.None,
          {
            itemType: "stage",
            stageIndex: index,
            iconPath: icon,
            description: hasChanges ? "modified" : "unchanged",
            command: {
              command: "opa.showStageDiff",
              title: "Show Stage Diff",
              arguments: [index, this.explorerResult],
            },
          },
        );
        item.tooltip = tooltip;
        return item;
      });
    }

    return [];
  }

  private async getRootElements(): Promise<OPATreeItem[]> {
    const items: OPATreeItem[] = [];

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      const workspaceFolder = vscode.workspace.workspaceFolders[0];
      if (!workspaceFolder) {
        return items;
      }

      // Add configuration options
      items.push(
        new OPATreeItem(
          "Configuration",
          vscode.TreeItemCollapsibleState.Collapsed,
          {
            itemType: "config-group",
            iconPath: new vscode.ThemeIcon("settings-gear"),
          },
        ),
      );

      // Add explorer results if available
      if (this.explorerResult && this.explorerResult.stages && this.explorerResult.stages.length > 0) {
        items.push(
          new OPATreeItem(
            "Compilation Stages",
            vscode.TreeItemCollapsibleState.Expanded,
            {
              itemType: "stages",
              description: `${this.explorerResult.stages.length} stage${this.explorerResult.stages.length === 1 ? "" : "s"}`,
              iconPath: new vscode.ThemeIcon("layers"),
            },
          ),
        );

        if (this.explorerResult.plan) {
          items.push(
            new OPATreeItem(
              "IR Plan",
              vscode.TreeItemCollapsibleState.None,
              {
                itemType: "plan",
                description: "Intermediate Representation",
                iconPath: new vscode.ThemeIcon("symbol-namespace"),
                command: {
                  command: "opa.showPlan",
                  title: "Show IR Plan",
                  arguments: [this.explorerResult.plan],
                },
              },
            ),
          );
        }
      }
    }

    return items;
  }

  async triggerExplorer(documentUri: string): Promise<void> {
    if (!this.client) {
      vscode.window.showErrorMessage("Regal language server is not available");
      return;
    }

    // Store the document URI for re-triggering when config changes
    this.lastDocumentUri = documentUri;

    try {
      const params: ExplorerParams = {
        target: documentUri,
        strict: this.explorerConfig.strict,
        annotations: this.explorerConfig.annotations,
        print: this.explorerConfig.print,
        format: this.explorerConfig.format,
      };

      await vscode.commands.executeCommand("regal.explorer", params);
    } catch (error) {
      vscode.window.showErrorMessage(`Explorer command failed: ${error}`);
    }
  }

  async handleCheckboxChange(item: OPATreeItem, newState: vscode.TreeItemCheckboxState): Promise<void> {
    if (item.itemType === "config" && item.configKey) {
      this.explorerConfig[item.configKey] = newState === vscode.TreeItemCheckboxState.Checked;

      // Re-trigger explorer with the new config if we have a document URI
      // The refresh will happen automatically when setExplorerResult is called
      if (this.lastDocumentUri) {
        await this.triggerExplorer(this.lastDocumentUri);
      }
    }
  }
}
