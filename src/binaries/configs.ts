"use strict";

import { BinaryConfig } from "./types";

const platformMap: { [key: string]: string } = {
  "darwin": "Darwin",
  "linux": "Linux",
  "win32": "Windows",
};

export const REGAL_CONFIG: BinaryConfig = {
  name: "Regal",
  configKey: "regal",
  repo: "open-policy-agent/regal",
  minimumVersion: "0.18.0",
  assetFilter: (assets, os) => {
    const platformName = platformMap[os];
    if (!platformName) {
      return undefined;
    }
    return assets.filter((asset: { name: string }) => asset.name.indexOf(platformName) !== -1)[0];
  },
  versionParser: (executablePath: string) => {
    try {
      const { execSync } = require("child_process");
      const versionJSON = execSync(executablePath + " version --format=json").toString().trim();
      const versionObj = JSON.parse(versionJSON);
      return { version: versionObj.version || "unknown" };
    } catch (error) {
      return { version: "unknown", error: String(error) };
    }
  },
};

export const OPA_CONFIG: BinaryConfig = {
  name: "OPA",
  configKey: "opa",
  repo: "open-policy-agent/opa",
  assetFilter: (assets, os, arch) => {
    const nodeArch = arch.indexOf("arm") !== -1 ? "arm64" : "amd64";

    let binaryName: string;
    let staticBinaryName: string | undefined;

    switch (os) {
      case "darwin":
        binaryName = `opa_darwin_${nodeArch}`;
        staticBinaryName = `opa_darwin_${nodeArch}_static`;
        break;
      case "linux":
        binaryName = `opa_linux_${nodeArch}`;
        staticBinaryName = `opa_linux_${nodeArch}_static`;
        break;
      case "win32":
        if (nodeArch === "arm64") {
          throw "OPA binaries are not supported for windows/arm architecture. To use the features of this plugin, compile OPA from source.";
        }
        binaryName = "opa_windows_amd64.exe";
        break;
      default:
        return { browser_download_url: "" };
    }

    // Prefer static binary if available (smaller, no CGO dependencies)
    if (staticBinaryName) {
      const staticAsset = assets.find((asset: { name: string }) => asset.name === staticBinaryName);
      if (staticAsset) {
        return staticAsset;
      }
    }

    return assets.find((asset: { name: string }) => asset.name === binaryName);
  },
  versionParser: (executablePath: string) => {
    try {
      const { spawnSync } = require("child_process");
      const result = spawnSync(executablePath, ["version"]);
      if (result.status !== 0) {
        return { version: "unknown", error: "Failed to get version" };
      }

      const firstLine = result.stdout.toString().split("\n")[0].trim();
      const parts = firstLine.split(": ");
      if (parts.length === 2 && parts[0] === "Version") {
        return { version: parts[1] };
      }
      return { version: "unknown" };
    } catch (error) {
      return { version: "unknown", error: String(error) };
    }
  },
};
