import assert from "node:assert/strict";
import { test } from "node:test";
import * as os from "node:os";
import * as path from "node:path";
import {
  abortError,
  canonicalAgentName,
  consumeFirstMatchingMailboxEvent,
  expandHome,
  extractTextFromMessage,
  formatAgentError,
  normalizeConfig,
  normalizeList,
  normalizeTaskName,
  normalizeTools,
  parseAgentDefinitionText,
  previewText,
  stringList,
  throwIfAborted,
} from "../runtime/normalization.js";
import type { AgentCompletionEvent } from "../runtime/types.js";

// These tests exercise only stdlib-backed modules; no Pi installation is needed.

test("config normalization ignores non-record input and unknown fields", () => {
  for (const value of [undefined, null, [], false, "config", 12, { unknown: true }]) {
    assert.deepEqual(normalizeConfig(value), {});
  }
});

test("config normalization trims strings, keeps zero limits, and normalizes lists", () => {
  assert.deepEqual(normalizeConfig({
    shortcut: " ctrl+shift+a ",
    storageDir: " ~/runs ",
    retentionDays: 0,
    modelResponseTimeoutMs: 0,
    models: " openai/model, , anthropic/model ",
    modelsFromEnabledModels: true,
    defaults: { skills: [" browser ", null, ""], extensions: "builtin:codemode, ./helper.ts" },
  }), {
    shortcut: "ctrl+shift+a",
    storageDir: "~/runs",
    retentionDays: 0,
    modelResponseTimeoutMs: 0,
    models: ["openai/model", "anthropic/model"],
    modelsFromEnabledModels: true,
    defaults: { skills: ["browser"], extensions: ["builtin:codemode", "./helper.ts"] },
  });
});

test("config normalization omits empty values and invalid numeric limits", () => {
  for (const limit of [-1, Infinity, NaN, "1", null]) {
    assert.deepEqual(normalizeConfig({
      shortcut: " ", storageDir: "", retentionDays: limit, modelResponseTimeoutMs: limit,
      models: [], modelsFromEnabledModels: "true", defaults: { skills: [], extensions: " " },
    }), {});
  }
  assert.deepEqual(normalizeConfig({ retentionDays: 1.5, modelResponseTimeoutMs: 250 }), {
    retentionDays: 1.5, modelResponseTimeoutMs: 250,
  });
});

test("provider-scoped routes are trimmed and retain exact provider and tier IDs", () => {
  assert.deepEqual(normalizeConfig({ providerAgents: {
    radius: { light: { model: " model-id ", thinking: "max", ignored: true } },
    openai: {},
  } }), { providerAgents: {
    radius: { light: { model: "model-id", thinking: "max" } }, openai: {},
  } });
});

test("malformed provider-scoped routing fails closed instead of inheriting", () => {
  for (const value of [null, [], "routes", 12]) {
    assert.throws(() => normalizeConfig({ providerAgents: value }), { message: "providerAgents must be an object." });
  }
  for (const tiers of [null, [], "tier"]) {
    assert.throws(() => normalizeConfig({ providerAgents: { openai: tiers } }), { message: "Invalid providerAgents entry: openai" });
  }
  for (const route of [null, [], {}, { model: " ", thinking: "high" }, { model: "model", thinking: "HIGH" }, { model: "model" }]) {
    assert.throws(() => normalizeConfig({ providerAgents: { openai: { light: route } } }), { message: "Invalid providerAgents route: openai/light" });
  }
});

test("template parsing preserves metadata, aliases, quoted strings, and the prompt", () => {
  assert.deepEqual(parseAgentDefinitionText(`---
name: 'reviewer'
description: "Focused review"
caller_hint: Read only
provider: openai
model: model-id
thinking: high
tools: read,grep
skills: browser, files
extensions: builtin:codemode, ./helper.ts
---

Review the requested files.
`, "fallback"), {
    name: "reviewer", description: "Focused review", hint: "Read only", provider: "openai", model: "model-id",
    thinking: "high", tools: "read,grep", skills: ["browser", "files"],
    extensions: ["builtin:codemode", "./helper.ts"], prompt: "Review the requested files.",
  });
});

test("templates without frontmatter use the fallback name and trimmed body", () => {
  const definition = parseAgentDefinitionText("  Plain prompt. \n", "fallback");
  assert.equal(definition.name, "fallback");
  assert.equal(definition.prompt, "Plain prompt.");
  assert.equal(definition.thinking, undefined);
  assert.equal(parseAgentDefinitionText(" \n", "empty").prompt, undefined);
});

test("template hint takes precedence over caller_hint and invalid thinking is omitted", () => {
  const definition = parseAgentDefinitionText("---\r\nname: \r\nhint: Preferred\r\ncaller_hint: Alias\r\nthinking: HIGH\r\n---\r\nBody", "fallback");
  assert.equal(definition.name, "fallback");
  assert.equal(definition.hint, "Preferred");
  assert.equal(definition.thinking, undefined);
  assert.equal(definition.prompt, "Body");
});

test("task names trim surrounding slashes but reject traversal and ambiguous separators", () => {
  assert.equal(normalizeTaskName(" /review/api/ "), "review/api");
  assert.equal(normalizeTaskName("Task_1/foo-bar"), "Task_1/foo-bar");
  for (const name of ["", " / ", "../review", "review//api", "review/api.txt", "two words", "review\\api"]) {
    assert.throws(() => normalizeTaskName(name), /task_name must use letters/);
  }
});

test("list and tool normalization retain their distinct defaults and deduplication rules", () => {
  assert.equal(normalizeTools(undefined), "read,bash,grep,find,ls");
  assert.equal(normalizeTools(""), "");
  assert.equal(normalizeTools(" read, , bash,read "), "read,bash,read");
  assert.deepEqual(stringList([" a ", null, "a", ""]), ["a", "a"]);
  assert.deepEqual(normalizeList([" a ", "a", "b", ""]), ["a", "b"]);
  assert.equal(normalizeList([]), undefined);
  assert.equal(stringList(" , "), undefined);
});

test("home expansion leaves unrelated paths unchanged", () => {
  assert.equal(expandHome("~"), os.homedir());
  assert.equal(expandHome("~/runs"), path.join(os.homedir(), "runs"));
  assert.equal(expandHome("~someone/runs"), "~someone/runs");
  assert.equal(expandHome("./runs"), "./runs");
});

test("text extraction excludes thinking, tools, and malformed content", () => {
  assert.equal(extractTextFromMessage({ content: "Raw response" }), "Raw response");
  assert.equal(extractTextFromMessage({ content: [null, { type: "thinking", thinking: "secret" }, { type: "text", text: "First" }, { type: "text", text: 1 }, { type: "text", text: "Second" }] }), "First\n\nSecond");
  assert.equal(extractTextFromMessage(null), "");
});

test("previews collapse whitespace, cap length with an ellipsis, and distinguish missing input", () => {
  assert.equal(previewText(undefined), null);
  assert.equal(previewText(""), null);
  assert.equal(previewText("  alpha\n beta  "), "alpha beta");
  assert.equal(previewText("abcdef", 4), "abc…");
  assert.equal(previewText("abcd", 4), "abcd");
  assert.equal(previewText("   "), "");
});

test("quota errors add a useful cause without duplicating it or altering other errors", () => {
  assert.match(formatAgentError(Object.assign(new Error("write failed"), { code: "EDQUOT" })), /Cause: Disk quota exceeded \(EDQUOT\)\./);
  assert.equal(formatAgentError(new Error("Disk quota exceeded (EDQUOT).")), "Disk quota exceeded (EDQUOT).");
  assert.equal(formatAgentError(new Error("ordinary error")), "ordinary error");
  assert.equal(formatAgentError("plain error"), "plain error");
});

test("abort helpers preserve Error reasons and provide a default for other reasons", () => {
  const controller = new AbortController();
  throwIfAborted(controller.signal);
  const reason = new Error("stop now");
  controller.abort(reason);
  assert.equal(abortError(controller.signal), reason);
  assert.throws(() => throwIfAborted(controller.signal), (error) => error === reason);
  assert.equal(abortError(AbortSignal.abort("stop")).message, "Wait canceled.");
});

test("mailbox consumption removes only the first event matching session and targets", () => {
  const event = (id: string, parentSessionId: string, agentName: string): AgentCompletionEvent => ({
    id, parentSessionId, agentName, status: "completed", createdAt: 1,
  });
  const events = [event("other-session", "other", "/review"), event("other-task", "parent", "/build"), event("first", "parent", "/review"), event("second", "parent", "/review")];
  assert.equal(consumeFirstMatchingMailboxEvent(events, "parent", new Set(["/review"]))?.id, "first");
  assert.deepEqual(events.map(({ id }) => id), ["other-session", "other-task", "second"]);
  assert.equal(consumeFirstMatchingMailboxEvent(events, "missing"), undefined);
  assert.equal(consumeFirstMatchingMailboxEvent(events, "parent", new Set()), undefined);
  assert.equal(consumeFirstMatchingMailboxEvent(events, "parent")?.id, "other-task");
  assert.equal(canonicalAgentName("review"), "/review");
  assert.equal(canonicalAgentName("/review"), "/review");
});
