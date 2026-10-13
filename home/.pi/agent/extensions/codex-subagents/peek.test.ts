import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import { SubagentPeekOverlay } from "./peek.js";

before(() => initTheme("dark", false));

function createTool(name: string, args: Record<string, unknown>): ToolExecutionComponent {
  return SubagentPeekOverlay.prototype["createToolComponent"].call(
    { cwd: process.cwd(), tui: { requestRender() {} } } as any,
    name,
    "call-1",
    args,
  );
}

function renderTool(component: ToolExecutionComponent): string {
  return stripVTControlCharacters(component.render(100).join("\n"));
}

describe("peek tool rendering", () => {
  for (const name of ["bash", "edit", "find", "grep", "ls", "powershell", "read", "write"]) {
    test(`passes an explicit built-in definition for ${name}`, () => {
      const component = createTool(name, {});
      assert.strictEqual(component["toolDefinition"]?.name, name);
      assert.strictEqual(typeof component["toolDefinition"]?.renderCall, "function");
      assert.strictEqual(typeof component["toolDefinition"]?.renderResult, "function");
    });
  }

  test("read shows only its compact header instead of raw arguments and the full file", () => {
    const component = createTool("read", { path: "src/catalog.rs", offset: 100, limit: 45 });
    component.updateResult({
      content: [{ type: "text", text: Array.from({ length: 45 }, (_, i) => `file_line_${i + 1}`).join("\n") }],
      isError: false,
    });

    const text = renderTool(component);
    assert.ok(text.includes("src/catalog.rs"));
    assert.ok(!text.includes('"path":'));
    assert.ok(text.includes("100-144"));
    assert.ok(!text.includes("file_line_"));
  });

  test("bash output stays collapsed while streaming and after completion", () => {
    const component = createTool("bash", { command: "printf output" });
    const result = {
      content: [{ type: "text" as const, text: Array.from({ length: 30 }, (_, i) => `output_line_${i + 1}`).join("\n") }],
      isError: false,
    };

    for (const isPartial of [true, false]) {
      component.updateResult(result, isPartial);
      const text = renderTool(component);
      assert.ok(text.includes("printf output"));
      assert.ok(!text.includes('"command":'));
      assert.ok(!text.includes("output_line_1"));
      assert.ok(text.includes("output_line_30"));
      assert.ok(text.includes("25 earlier lines"));
    }
  });
});
