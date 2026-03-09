"use strict";

import * as vscode from "vscode";
import type { RunTestsParams, TestLocation } from "../ls/clients/regal";
import { runTests } from "../ls/clients/regal";
import { TestHierarchyManager } from "./hierarchy-manager";
import { parseTestId } from "./id";

let controller: vscode.TestController;
let hierarchyManager: TestHierarchyManager;

export function activateTestController(
  context: vscode.ExtensionContext,
): vscode.TestController {
  controller = vscode.tests.createTestController("opaTests", "Rego");
  context.subscriptions.push(controller);

  hierarchyManager = new TestHierarchyManager(controller);

  controller.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    runHandler,
    true,
  );

  return controller;
}

export function handleTestLocations(
  fileUri: string,
  locations: TestLocation[],
): void {
  if (!controller) {
    return;
  }

  const uri = vscode.Uri.parse(fileUri);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    console.warn(`No workspace folder found for file: ${fileUri}`);
    return;
  }

  hierarchyManager.clearTestsForFile(fileUri);

  if (locations.length === 0) {
    return;
  }

  hierarchyManager.addTestsForFile(workspaceFolder.uri, fileUri, locations);
}

async function runHandler(
  request: vscode.TestRunRequest,
  cancellation: vscode.CancellationToken,
): Promise<void> {
  const run = controller.createTestRun(request);
  const queue: vscode.TestItem[] = [];

  if (request.include) {
    request.include.forEach(test => queue.push(test));
  } else {
    controller.items.forEach(test => queue.push(test));
  }

  for (const test of queue) {
    if (cancellation.isCancellationRequested) {
      break;
    }

    if (test.children.size > 0) {
      test.children.forEach(child => {
        if (!request.exclude?.includes(child)) {
          queue.push(child);
        }
      });
      continue;
    }

    try {
      await runSingleTest(test, run);
    } catch (error) {
      run.errored(
        test,
        new vscode.TestMessage(`Test execution error: ${error}`),
      );
    }
  }

  run.end();
}

async function runSingleTest(
  test: vscode.TestItem,
  run: vscode.TestRun,
): Promise<void> {
  run.started(test);

  const parsed = parseTestId(test.id);
  if (!parsed || !test.uri) {
    run.errored(test, new vscode.TestMessage("Invalid test"));
    return;
  }

  const params: RunTestsParams = {
    uri: test.uri.toString(),
    package: parsed.package,
    name: parsed.name,
  };

  let results;
  try {
    results = await runTests(params);
  } catch (error) {
    run.errored(test, new vscode.TestMessage(`LSP request failed: ${error}`));
    return;
  }

  const result = results[0];
  if (!result) {
    run.errored(test, new vscode.TestMessage("No test results returned"));
    return;
  }

  const durationMs = result.duration / 1_000_000;

  if (result.fail !== undefined) {
    const message = new vscode.TestMessage(
      result.error ? JSON.stringify(result.error, null, 2) : "Test failed",
    );
    if (result.location && test.uri) {
      message.location = new vscode.Location(
        test.uri,
        new vscode.Position(result.location.row - 1, result.location.col - 1),
      );
    }

    run.failed(test, message, durationMs);
  } else {
    run.passed(test, durationMs);
  }

  if (result.output) {
    try {
      const decodedOutput = Buffer.from(result.output, "base64").toString(
        "utf-8",
      );
      const normalizedOutput = decodedOutput.replace(/\n/g, "\r\n");
      run.appendOutput(normalizedOutput);
    } catch (error) {
      run.appendOutput(result.output);
    }
  }
}
