import assert from "node:assert/strict";
import { test } from "node:test";
import { exactPair, resolveSpawnModels } from "../tools/models.js";
import { cleanTarget, parentSessionId, parseTargets } from "../tools/helpers.js";

function context() {
  const warnings: Array<[string, string]> = [];
  return {
    modelRegistry: { getAvailable: () => [{ provider: "openai", id: "model" }, { provider: "radius", id: "other" }] },
    scopedModels: [{ model: { provider: "radius", id: "other" } }],
    ui: { notify: (message: string, level: string) => warnings.push([message, level]) },
    warnings,
  };
}

test("exact model references strip recognized thinking suffixes but retain model ID slashes", () => {
  assert.deepEqual(exactPair("openai/model:high"), { provider: "openai", modelId: "model" });
  assert.deepEqual(exactPair("radius/vendor/model:max"), { provider: "radius", modelId: "vendor/model" });
  assert.deepEqual(exactPair("openai/model:custom"), { provider: "openai", modelId: "model:custom" });
});

test("exact model references reject missing providers and unresolved glob patterns", () => {
  for (const pattern of ["model", "/model", "openai/*", "openai/model?", "openai/[ab]"]) {
    assert.equal(exactPair(pattern), undefined);
  }
});

test("spawn model resolution unions available explicit routes and scoped models without duplicates", () => {
  const ctx = context();
  const models = resolveSpawnModels(ctx, { models: ["openai/model:high", "openai/model", "radius/other"], modelsFromEnabledModels: true });
  assert.deepEqual([...models], [
    ["openai/model", { provider: "openai", modelId: "model" }],
    ["radius/other", { provider: "radius", modelId: "other" }],
  ]);
  assert.deepEqual(ctx.warnings, []);
});

test("unavailable explicit routes are omitted and reported together in one warning", () => {
  const ctx = context();
  assert.deepEqual([...resolveSpawnModels(ctx, { models: ["typo/model", "openai/*", "openai/model"] }).keys()], ["openai/model"]);
  assert.deepEqual(ctx.warnings, [["spawn_agent models not available: typo/model, openai/*", "warning"]]);
});

test("provider-scoped tiers disable the allowlist without querying the registry", () => {
  const ctx = { modelRegistry: { getAvailable() { throw new Error("must not be queried"); } } };
  assert.deepEqual([...resolveSpawnModels(ctx, { providerAgents: {}, models: ["openai/model"], modelsFromEnabledModels: true })], []);
});

test("unconfigured spawn models stay empty and registry failures propagate", () => {
  assert.equal(resolveSpawnModels(context(), {}).size, 0);
  const error = new Error("registry unavailable");
  assert.throws(() => resolveSpawnModels({ modelRegistry: { getAvailable() { throw error; } } }, {}), (thrown) => thrown === error);
});

test("target parsing trims leading slashes, drops empty names, and preserves order", () => {
  assert.equal(cleanTarget(" ///review/api "), "review/api");
  assert.deepEqual(parseTargets([" /first ", "", " /// ", "second", "first"]), ["first", "second", "first"]);
  assert.equal(parseTargets("first"), undefined);
  assert.deepEqual(parseTargets([]), []);
});

test("parent session identity must exist and is returned as a string", () => {
  assert.equal(parentSessionId({ sessionManager: { getSessionId: () => "session-id" } }), "session-id");
  assert.equal(parentSessionId({ sessionManager: { getSessionId: () => 123 } }), "123");
  for (const ctx of [undefined, {}, { sessionManager: { getSessionId: () => "" } }]) {
    assert.throws(() => parentSessionId(ctx), { message: "The parent Pi session has no session id." });
  }
});
