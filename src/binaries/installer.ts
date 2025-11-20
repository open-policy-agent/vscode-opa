"use strict";

import * as fs from "fs";
import * as os from "os";
import { URL } from "url";
import * as vscode from "vscode";
import { BinaryConfig, Logger } from "./types";

export async function installBinary(
  config: BinaryConfig,
  logger: Logger = { appendLine: () => {}, show: () => {} },
): Promise<string> {
  if (logger.show) {
    logger.show(true);
  }

  logger.appendLine(`Downloading ${config.repo} executable...`);

  const response = await fetch(`https://api.github.com/repos/${config.repo}/releases/latest`, {
    headers: {
      "User-Agent": getUserAgent(),
      "Authorization": `token ${getToken()}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch release info: ${response.status} ${response.statusText}`);
  }

  const release = await response.json() as any;
  const assets = release.assets || [];
  const platform = process.platform;
  const arch = process.arch;
  const targetAsset = config.assetFilter(assets, platform, arch);

  if (!targetAsset || !targetAsset.browser_download_url) {
    logger.appendLine(`${config.name}: no release found for platform ${platform}`);
    throw new Error(`No release found for platform ${platform}`);
  }

  const downloadUrl = new URL(targetAsset.browser_download_url);
  const dest = os.homedir();
  const path = `${dest}/${config.configKey}`;

  const downloadResponse = await fetch(downloadUrl.href, {
    headers: {
      "User-Agent": getUserAgent(),
    },
  });

  if (!downloadResponse.ok) {
    throw new Error(
      `Failed to download ${downloadUrl.href}: ${downloadResponse.status} ${downloadResponse.statusText}`,
    );
  }

  const buffer = await downloadResponse.arrayBuffer();
  fs.writeFileSync(path, Buffer.from(buffer));

  logger.appendLine(`Executable downloaded to ${path}`);

  try {
    fs.chmodSync(path, 0o755);
  } catch (e) {
    logger.appendLine(e as string);
    throw e;
  }

  const currentConfig = vscode.workspace.getConfiguration("opa.dependency_paths").get<string>(config.configKey);
  if (!currentConfig || currentConfig !== path) {
    logger.appendLine(`Setting 'opa.dependency_paths.${config.configKey}' to '${path}'`);
  }

  try {
    await vscode.workspace.getConfiguration("opa.dependency_paths").update(config.configKey, path, true);
  } catch (e) {
    logger.appendLine("Something went wrong while saving the config setting:");
    logger.appendLine(e as string);
    throw e;
  }

  logger.appendLine(`Successfully installed ${config.repo}!`);
  return path;
}

function getUserAgent(): string {
  const platform = process.platform;
  const arch = process.arch;
  const nodeVersion = process.version;
  const vscodeVersion = vscode.version;

  return `vscode-opa (${platform} ${arch}; Node.js ${nodeVersion}) vscode/${vscodeVersion}`;
}

function getToken(): string {
  // Need an OAuth token to access Github because
  // this gets around the ridiculously low
  // anonymous access rate limits (60 requests/sec/IP)
  // This token only gives access to "public_repo" and "repo:status" scopes
  return [
    "0",
    "0",
    "b",
    "6",
    "2",
    "d",
    "1",
    "0",
    "4",
    "d",
    "8",
    "5",
    "4",
    "9",
    "4",
    "b",
    "d",
    "6",
    "e",
    "e",
    "9",
    "5",
    "f",
    "1",
    "7",
    "1",
    "b",
    "d",
    "0",
    "2",
    "3",
    "c",
    "e",
    "4",
    "a",
    "3",
    "9",
    "a",
    "0",
    "6",
  ].join("");
}
