"use strict";

import * as assert from "node:assert";
import { describe, it } from "node:test";
import { packageRef } from "./package-ref";

describe("packageRef", () => {
  it("returns data for an empty path", () => {
    assert.strictEqual(packageRef([]), "data");
  });

  it("uses dots for simple names", () => {
    assert.strictEqual(packageRef(["foo"]), "data.foo");
    assert.strictEqual(packageRef(["foo", "bar_1", "_baz"]), "data.foo.bar_1._baz");
  });

  it("uses quoted brackets for names that are not simple", () => {
    assert.strictEqual(packageRef(["foo-bar"]), "data[\"foo-bar\"]");
    assert.strictEqual(packageRef(["1abc"]), "data[\"1abc\"]");
    assert.strictEqual(packageRef(["has space"]), "data[\"has space\"]");
    assert.strictEqual(packageRef([""]), "data[\"\"]");
  });

  it("escapes quotes and backslashes", () => {
    assert.strictEqual(packageRef(["a\"b"]), "data[\"a\\\"b\"]");
    assert.strictEqual(packageRef(["a\\b"]), "data[\"a\\\\b\"]");
  });

  it("mixes both forms in one path", () => {
    assert.strictEqual(packageRef(["foo", "bar-baz", "qux"]), "data.foo[\"bar-baz\"].qux");
  });
});
