"use strict";

import * as vscode from "vscode";
import type { RunTestsParams, TestLocation } from "../ls/clients/regal";
import { runTests } from "../ls/clients/regal";

let controller: vscode.TestController;

// Store test metadata for each test item
const testMetadata = new Map<string, { package: string; name: string }>();

export function activateTestController(
  context: vscode.ExtensionContext,
): vscode.TestController {
  controller = vscode.tests.createTestController("opaTests", "OPA Tests");
  context.subscriptions.push(controller);

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
  const fileName = fileUri.split("/").pop() || fileUri;

  controller.items.delete(fileUri);

  if (locations.length === 0) {
    return;
  }

  const fileItem = controller.createTestItem(fileUri, fileName, uri);
  controller.items.add(fileItem);

  for (const test of locations) {
    // Include line number in ID to handle incremental rules with same name
    const testId = `${fileUri}:${test.name}:${test.location.row}`;
    const testItem = controller.createTestItem(testId, test.name, uri);
    testItem.range = new vscode.Range(
      test.location.row - 1,
      test.location.col - 1,
      test.location.end.row - 1,
      test.location.end.col - 1,
    );
    fileItem.children.add(testItem);

    testMetadata.set(testId, {
      package: test.package,
      name: test.name,
    });
  }
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

  const metadata = testMetadata.get(test.id);
  if (!metadata) {
    run.errored(test, new vscode.TestMessage("Test metadata not found"));
    return;
  }

  if (!test.uri) {
    run.errored(test, new vscode.TestMessage("Test URI not found"));
    return;
  }

  const params: RunTestsParams = {
    uri: test.uri.toString(),
    package: metadata.package,
    name: metadata.name,
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

  // Note: The 'fail' property is only set when a test fails
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
      // needed windows line endings to get this looking right
      const normalizedOutput = decodedOutput.replace(/\n/g, "\r\n");
      run.appendOutput(normalizedOutput);
    } catch (error) {
      run.appendOutput(result.output);
    }
  }
}
