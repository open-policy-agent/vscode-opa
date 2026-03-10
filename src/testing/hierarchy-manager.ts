"use strict";

import * as vscode from "vscode";
import type { TestLocation } from "../ls/clients/regal";
import { packageId, rootId, testId } from "./id";

// TestHierarchyManager tracks the state of tests that are defined and updates
// the controller state as test locations change.
export class TestHierarchyManager {
  private controller: vscode.TestController;
  private fileToTestIds = new Map<string, Set<string>>();

  constructor(controller: vscode.TestController) {
    this.controller = controller;
  }

  addTestsForFile(workspaceUri: vscode.Uri, fileUri: string, tests: TestLocation[]): void {
    for (const test of tests) {
      const rootItem = this.ensureRoot(workspaceUri);

      let parent = rootItem;
      const currentPath: string[] = [];
      for (const part of test.package_path) {
        currentPath.push(part);
        const fullPackage = `data.${currentPath.join(".")}`;
        const pkgId = packageId(workspaceUri, fullPackage);
        parent = this.ensurePackage(parent, pkgId, part);
      }

      this.addTest(parent, test, fileUri);
    }
  }

  clearTestsForFile(fileUri: string): void {
    const testIds = this.fileToTestIds.get(fileUri);
    if (!testIds) {
      return;
    }

    for (const id of testIds) {
      const parent = this.findParentOf(id);
      if (parent) {
        parent.children.delete(id);
      }
    }

    this.fileToTestIds.delete(fileUri);
    this.cleanupEmptyNodes();
  }

  private ensureRoot(workspaceUri: vscode.Uri): vscode.TestItem {
    const id = rootId(workspaceUri);
    let rootItem = this.controller.items.get(id);
    if (!rootItem) {
      const label = vscode.workspace.asRelativePath(workspaceUri, false);
      rootItem = this.controller.createTestItem(id, label);
      this.controller.items.add(rootItem);
    }
    return rootItem;
  }

  private ensurePackage(parent: vscode.TestItem, pkgId: string, label: string): vscode.TestItem {
    let packageItem = parent.children.get(pkgId);
    if (!packageItem) {
      packageItem = this.controller.createTestItem(pkgId, label);
      parent.children.add(packageItem);
    }
    return packageItem;
  }

  private addTest(parent: vscode.TestItem, test: TestLocation, fileUri: string): vscode.TestItem {
    const uri = vscode.Uri.parse(fileUri);
    const id = testId(uri, test.package, test.name);

    let testIds = this.fileToTestIds.get(fileUri);
    if (!testIds) {
      testIds = new Set();
      this.fileToTestIds.set(fileUri, testIds);
    }
    testIds.add(id);

    const testItem = this.controller.createTestItem(id, test.name, uri);
    testItem.range = new vscode.Range(
      test.location.row - 1,
      test.location.col - 1,
      test.location.end.row - 1,
      test.location.end.col - 1,
    );
    parent.children.add(testItem);

    return testItem;
  }

  private cleanupEmptyNodes(): void {
    for (const [, rootItem] of this.controller.items) {
      this.cleanupEmptyChildren(rootItem);
    }

    const emptyRoots: string[] = [];
    for (const [id, rootItem] of this.controller.items) {
      if (rootItem.children.size === 0) {
        emptyRoots.push(id);
      }
    }
    for (const id of emptyRoots) {
      this.controller.items.delete(id);
    }
  }

  private cleanupEmptyChildren(node: vscode.TestItem): void {
    for (const [, child] of node.children) {
      this.cleanupEmptyChildren(child);
    }

    const emptyChildren: string[] = [];
    for (const [childId, child] of node.children) {
      if (!child.uri && child.children.size === 0) {
        emptyChildren.push(childId);
      }
    }
    for (const childId of emptyChildren) {
      node.children.delete(childId);
    }
  }

  private findParentOf(targetId: string): vscode.TestItem | undefined {
    for (const [, rootItem] of this.controller.items) {
      const parent = this.findParentOfChild(rootItem, targetId);
      if (parent) {
        return parent;
      }
    }
    return undefined;
  }

  private findParentOfChild(node: vscode.TestItem, targetId: string): vscode.TestItem | undefined {
    if (node.children.get(targetId)) {
      return node;
    }
    for (const [, child] of node.children) {
      const found = this.findParentOfChild(child, targetId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
}
