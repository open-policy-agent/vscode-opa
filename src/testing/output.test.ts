"use strict";

import * as assert from "node:assert";
import { describe, it } from "node:test";
import { decodeOutput } from "./output";

const encode = (s: string) => Buffer.from(s, "utf-8").toString("base64");

describe("decodeOutput", () => {
  it("decodes base64 text", () => {
    assert.strictEqual(decodeOutput(encode("hello")), "hello");
  });

  it("converts newlines to CRLF", () => {
    assert.strictEqual(decodeOutput(encode("a\nb\n")), "a\r\nb\r\n");
  });

  it("decodes multi-byte characters", () => {
    assert.strictEqual(decodeOutput(encode("héllo ✓")), "héllo ✓");
  });

  it("returns an empty string for empty input", () => {
    assert.strictEqual(decodeOutput(""), "");
  });
});
