"use strict";

import * as fs from "fs";
import * as os from "os";
import { URL } from "url";
import * as vscode from "vscode";
import { BinaryConfig, Logger } from "./types";

const FETCH_TIMEOUT_MS = 30000;

export async function installBinary(
  config: BinaryConfig,
  logger: Logger = { appendLine: () => {}, show: () => {} },
): Promise<string> {
  if (logger.show) {
    logger.show(true);
  }

  logger.appendLine(`Downloading ${config.repo} executable...`);

  const releaseUrl = `https://api.github.com/repos/${config.repo}/releases/latest`;
  const response = await fetch(releaseUrl, {
    headers: {
      "User-Agent": getUserAgent(),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch release info from ${releaseUrl}: ${response.status} ${response.statusText}`);
  }

  const release = await response.json() as any;
  const assets = release.assets || [];
  const platform = process.platform;
  const arch = process.arch;
  const targetAsset = config.assetFilter(assets, platform, arch);

  if (!targetAsset || !targetAsset.browser_download_url) {
    logger.appendLine(`${config.name}: no release found for platform ${platform}/${arch}`);
    logger.appendLine(`Fetched: ${releaseUrl}`);
    const assetNames = assets.map((a: { name: string }) => a.name).join(", ");
    logger.appendLine(`Assets available: ${assets.length > 0 ? assetNames : "none"}`);
    throw new Error(`No release found for platform ${platform}/${arch}`);
  }

  const downloadUrl = new URL(targetAsset.browser_download_url);
  const dest = os.homedir();
  const path = `${dest}/${config.configKey}`;

  const downloadResponse = await fetch(downloadUrl.href, {
    headers: {
      "User-Agent": getUserAgent(),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
