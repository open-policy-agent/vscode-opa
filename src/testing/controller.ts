"use strict";

import * as vscode from "vscode";
import type { RunTestsParams, TestLocation, TestResult, TestTarget } from "../ls/clients/regal";
import { runTests } from "../ls/clients/regal";
import { TestHierarchyManager } from "./hierarchy-manager";
import { itemKind, itemPackage, parseTestId } from "./id";
import { decodeOutput } from "./output";

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

  try {
    await executeRun(request, run, cancellation);
  } finally {
    run.end();
  }
}

async function executeRun(
  request: vscode.TestRunRequest,
  run: vscode.TestRun,
  cancellation: vscode.CancellationToken,
): Promise<void> {
  const expected = collectExpected(request, run);
  if (expected.size === 0) {
    return;
  }

  const params: RunTestsParams = {};
  params.targets = request.include ? targetsFor(request.include) : [{}];
  if (request.exclude) {
    params.exclude = request.exclude.flatMap(item => targetFor(item) ?? []);
  }

  let results: TestResult[];
  try {
    results = await runTests(params, cancellation);
  } catch (error) {
    for (const item of expected.values()) {
      if (cancellation.isCancellationRequested) {
        run.skipped(item);
      } else {
        run.errored(item, new vscode.TestMessage(`LSP request failed: ${error}`));
      }
    }
    return;
  }

  for (const result of results) {
    const item = expected.get(`${result.package}:${result.name}`);
    if (item) {
      expected.delete(`${result.package}:${result.name}`);
      reportResult(item, result, run);
    }
  }
  for (const item of expected.values()) {
    run.errored(item, new vscode.TestMessage("No test results returned"));
  }
}

function collectExpected(
  request: vscode.TestRunRequest,
  run: vscode.TestRun,
): Map<string, vscode.TestItem> {
  const excluded = new Set(request.exclude ?? []);

  const roots: vscode.TestItem[] = [];
  (request.include ?? []).forEach(item => roots.push(item));
  if (!request.include) {
    controller.items.forEach(item => roots.push(item));
  }

  const expected = new Map<string, vscode.TestItem>();
  const collect = (item: vscode.TestItem) => {
    if (excluded.has(item)) {
      return;
    }
    if (item.children.size > 0) {
      item.children.forEach(collect);
      return;
    }
    const parsed = parseTestId(item.id);
    if (!parsed) {
      run.errored(item, new vscode.TestMessage("Invalid test"));
      return;
    }
    expected.set(`${parsed.package}:${parsed.name}`, item);
    run.started(item);
  };
  roots.forEach(collect);

  return expected;
}

function targetFor(item: vscode.TestItem): TestTarget | undefined {
  switch (itemKind(item.id)) {
    case "root":
      return {};
    case "package":
      return { package: itemPackage(item.id) };
    case "test": {
      const parsed = parseTestId(item.id);
      return parsed ? { package: parsed.package, name: parsed.name } : undefined;
    }
    default:
      return undefined;
  }
}

function targetsFor(items: readonly vscode.TestItem[]): TestTarget[] {
  const targets: TestTarget[] = [];
  const byFile = new Map<string, vscode.TestItem[]>();

  for (const item of items) {
    if (itemKind(item.id) === "test" && item.uri) {
      const tests = byFile.get(item.uri.toString()) ?? [];
      tests.push(item);
      byFile.set(item.uri.toString(), tests);
    } else {
      const target = targetFor(item);
      if (target) {
        targets.push(target);
      }
    }
  }

  for (const [fileUri, tests] of byFile) {
    const all = hierarchyManager.testIdsForFile(fileUri);
    if (all && tests.length === all.size && tests.every(t => all.has(t.id))) {
      targets.push({ uri: fileUri });
    } else {
      targets.push(...tests.flatMap(t => targetFor(t) ?? []));
    }
  }

  return targets;
}

function reportResult(
  test: vscode.TestItem,
  result: TestResult,
  run: vscode.TestRun,
): void {
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
    run.appendOutput(decodeOutput(result.output));
  }
}
