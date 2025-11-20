"use strict";

export interface Logger {
  appendLine(message: string): void;
  show?(preserveFocus?: boolean): void;
}

export interface BinaryConfig {
  name: string;
  configKey: string;
  repo: string;
  minimumVersion?: string;
  assetFilter: (assets: any[], os: string, arch: string) => any;
  versionParser: (executablePath: string) => { version: string; error?: string };
}

export interface BinaryInfo {
  path?: string;
  source: "configured" | "system" | "missing";
  originalPath?: string;
  version: string;
  error?: string;
}
