"use strict";

import * as vscode from "vscode";
import type { TestLocation } from "../ls/clients/regal";

let controller: vscode.TestController;

export function activateTestController(context: vscode.ExtensionContext): vscode.TestController {
  controller = vscode.tests.createTestController("opaTests", "OPA Tests");
  context.subscriptions.push(controller);

  // TODO: add run profile when test running is implemented
  // controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, runHandler, true);

  return controller;
}

export function handleTestLocations(fileUri: string, locations: TestLocation[]): void {
  if (!controller) {
    return;
  }

  const uri = vscode.Uri.parse(fileUri);
  const fileName = fileUri.split("/").pop() || fileUri;

  controller.items.delete(fileUri);

  // Filter for single_test kind only
  const singleTests = locations.filter(loc => loc.kind === "single_test");

  if (singleTests.length === 0) {
    return;
  }

  const fileItem = controller.createTestItem(fileUri, fileName, uri);
  controller.items.add(fileItem);

  for (const test of singleTests) {
    // Include line number in ID to handle incremental rules with same name
    const testId = `${fileUri}:${test.test}:${test.location.row}`;
    const testItem = controller.createTestItem(
      testId,
      test.test,
      uri,
    );
    testItem.range = new vscode.Range(
      test.location.row - 1,
      test.location.col - 1,
      test.location.end.row - 1,
      test.location.end.col - 1,
    );
    fileItem.children.add(testItem);
  }
}
