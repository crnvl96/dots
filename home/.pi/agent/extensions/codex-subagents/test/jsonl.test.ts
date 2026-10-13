import assert from "node:assert/strict";
import { test } from "node:test";
import { RpcJsonlDecoder } from "../runtime/jsonl.js";

test("JSONL decoding preserves multibyte UTF-8 split at every possible byte boundary", () => {
  const line = JSON.stringify({ text: "café 🌍 漢字" });
  const bytes = Buffer.from(`${line}\n`);
  for (let boundary = 0; boundary <= bytes.length; boundary++) {
    const decoder = new RpcJsonlDecoder();
    assert.deepEqual([...decoder.push(bytes.subarray(0, boundary)), ...decoder.push(bytes.subarray(boundary)), ...decoder.end()], [line]);
  }
});

test("JSONL decoding handles multiple lines, CRLF, empty records, and a final unterminated line", () => {
  const decoder = new RpcJsonlDecoder();
  assert.deepEqual(decoder.push("first\r\n\nsecond\nlast\r"), ["first", "", "second"]);
  assert.deepEqual(decoder.end(), ["last"]);
  assert.deepEqual(decoder.end(), []);
});

test("JSONL decoding buffers a split CRLF and strips only the trailing carriage return", () => {
  const decoder = new RpcJsonlDecoder();
  assert.deepEqual(decoder.push("inside\rrecord\r"), []);
  assert.deepEqual(decoder.push("\n"), ["inside\rrecord"]);
});

test("JSONL decoding does not split Unicode line separators inside JSON strings", () => {
  const decoder = new RpcJsonlDecoder();
  const line = JSON.stringify({ text: "a\u2028b\u2029c" });
  assert.deepEqual(decoder.push(`${line}\n`), [line]);
});

test("JSONL end flushes an incomplete UTF-8 sequence using the standard replacement character", () => {
  const decoder = new RpcJsonlDecoder();
  assert.deepEqual(decoder.push(Buffer.from([0xe2, 0x82])), []);
  assert.deepEqual(decoder.end(), ["�"]);
  assert.deepEqual(decoder.end(), []);
});

test("JSONL decoding accepts mixed complete string and buffer chunks", () => {
  const decoder = new RpcJsonlDecoder();
  assert.deepEqual(decoder.push("first"), []);
  assert.deepEqual(decoder.push(Buffer.from("\nsecond")), ["first"]);
  assert.deepEqual(decoder.end(), ["second"]);
});
