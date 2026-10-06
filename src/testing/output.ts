"use strict";

export function decodeOutput(output: string): string {
  return Buffer.from(output, "base64").toString("utf-8").replace(/\n/g, "\r\n");
}
