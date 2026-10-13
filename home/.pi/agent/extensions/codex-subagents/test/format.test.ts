import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAgentSpecLines, formatDuration, runtimeLabel, stripPromptMarkers } from "../ui/format.js";
import type { AgentInfo } from "../runtime/types.js";

test("elapsed duration labels clamp negative values and use whole seconds, minutes, hours, or days", () => {
  for (const [milliseconds, expected] of [
    [-1, "0s"], [999, "0s"], [1_000, "1s"], [59_999, "59s"], [60_000, "1m"],
    [3_599_999, "59m"], [3_600_000, "1h"], [86_399_999, "23h"], [86_400_000, "1d"],
  ] as const) {
    assert.equal(formatDuration(milliseconds), expected);
  }
});

test("runtime labels use the clock for active agents and completion timestamps for terminal agents", (t) => {
  t.mock.method(Date, "now", () => 100_000);
  const info = { createdAt: 10_000, startedAt: 20_000, updatedAt: 70_000, completedAt: 80_000 };
  const label = (status: AgentInfo["status"], times = {}) => runtimeLabel({ ...info, status, ...times } as AgentInfo);
  assert.equal(label("running"), "1m");
  assert.equal(label("starting", { startedAt: undefined }), "1m");
  for (const status of ["completed", "failed", "interrupted"] as const) {
    assert.equal(label(status), "1m");
    assert.equal(label(status, { completedAt: undefined }), "50s");
    assert.equal(label(status, { completedAt: undefined, updatedAt: undefined }), "1m");
  }
});

test("agent specification labels include exact routing and default thinking to off", () => {
  assert.deepEqual(formatAgentSpecLines({ provider: "radius", modelId: "vendor/model", thinking: "max" }), [
    "Model: radius/vendor/model", "Thinking: max",
  ]);
  assert.deepEqual(formatAgentSpecLines({ provider: "openai", modelId: "model" }), [
    "Model: openai/model", "Thinking: off",
  ]);
});

test("prompt marker stripping removes OSC 133 A/B/C markers without altering other escapes or input", () => {
  const lines = ["\x1b]133;A\x07hello\x1b]133;B\x07 world\x1b]133;C\x07", "\x1b[31mred\x1b[0m", "\x1b]133;D\x07"];
  assert.deepEqual(stripPromptMarkers(lines), ["hello world", "\x1b[31mred\x1b[0m", "\x1b]133;D\x07"]);
  assert.ok(lines[0].includes("\x1b]133;A"));
});
