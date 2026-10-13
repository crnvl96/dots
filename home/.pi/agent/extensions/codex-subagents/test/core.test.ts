import { after, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";

const TEST_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pi-codex-subagents-tests-"));
// Unix-domain socket paths have a small platform-dependent byte limit, so keep this root short.
const TEST_TEMP_DIR = process.platform === "win32"
  ? fs.mkdtempSync(path.join(os.tmpdir(), "pi-"))
  : fs.mkdtempSync("/tmp/pi-");
after(() => {
  fs.rmSync(TEST_AGENT_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
});
const FAKE_RPC_CHILD = path.join(import.meta.dirname, "fake-rpc-child.js");
process.env.PI_SUBAGENT_TEMP_DIR = TEST_TEMP_DIR;

const codingAgent = await import("@earendil-works/pi-coding-agent");
mock.module("@earendil-works/pi-coding-agent", {
  namedExports: {
    ...codingAgent,
    CONFIG_DIR_NAME: ".pi",
    getAgentDir: () => TEST_AGENT_DIR,
  },
});

const {
  AgentManager,
  RpcAssistantStreamState,
  RpcJsonlDecoder,
  consumeFirstMatchingMailboxEvent,
  formatAgentError,
  getAgent,
  listAgentDefinitions,
  getRunsDir,
  getSocketPath,
  loadSubagentConfig,
  parentScopeKey,
  parseAgentDefinitionText,
  taskStorageKey,
} = await import("../core.js");
const { formatAgentSpecLines } = await import("../peek.js");


test("formats the resolved subagent model and thinking for the detail overlay", () => {
  assert.deepStrictEqual(formatAgentSpecLines({ provider: "openai-codex", modelId: "gpt-5.5", thinking: "high" }), [
    "Model: openai-codex/gpt-5.5",
    "Thinking: high",
  ]);
});

describe("RPC streaming", () => {
  test("assembles delta-only messages and distinguishes tool calls from thinking", () => {
    const stream = new RpcAssistantStreamState();
    stream.start({
      role: "assistant",
      content: [],
      api: "test",
      provider: "test",
      model: "fake",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
      stopReason: "pending",
      timestamp: Date.now(),
    });

    stream.update({ type: "thinking_start", contentIndex: 0 });
    stream.update({ type: "thinking_delta", contentIndex: 0, delta: "checking" });
    assert.strictEqual(stream.status, "thinking");
    assert.partialDeepStrictEqual(stream.message?.content[0], { type: "thinking", thinking: "checking" });

    stream.update({ type: "toolcall_start", contentIndex: 1 });
    stream.update({ type: "toolcall_delta", contentIndex: 1, delta: '{"path":"src' });
    stream.update({ type: "toolcall_delta", contentIndex: 1, delta: '/ui.rs"}' });
    assert.strictEqual(stream.status, "calling");
    assert.partialDeepStrictEqual(stream.message?.content[0], { type: "thinking", thinking: "checking" });
    assert.partialDeepStrictEqual(stream.message?.content[1], { type: "toolCall", arguments: { path: "src/ui.rs" } });

    stream.update({
      type: "toolcall_end",
      contentIndex: 1,
      toolCall: { type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/ui.rs" } },
    });
    assert.deepStrictEqual(stream.message?.content[1], { type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/ui.rs" } });
  });
});

describe("RPC framing", () => {
  test("explains quota errors that Node leaves unnamed", () => {
    const error = Object.assign(new Error(`Unknown system error -${os.constants.errno.EDQUOT}, write`), {
      errno: -os.constants.errno.EDQUOT,
    });
    assert.ok(formatAgentError(error).includes("Disk quota exceeded (EDQUOT)."));
  });

  test("splits only on LF and preserves Unicode line separators", () => {
    const decoder = new RpcJsonlDecoder();
    const payload = JSON.stringify({ text: "before\u2028after" });
    assert.deepStrictEqual(decoder.push(Buffer.from(payload.slice(0, 7))), []);
    assert.deepStrictEqual(decoder.push(Buffer.from(`${payload.slice(7)}\n`)), [payload]);
    assert.deepStrictEqual(decoder.end(), []);
  });
});

describe("session-scoped identities", () => {
  test("separates parent sessions and formerly colliding task names", () => {
    assert.notStrictEqual(parentScopeKey("parent-a"), parentScopeKey("parent-b"));
    assert.notStrictEqual(taskStorageKey("review/api"), taskStorageKey("review__api"));
  });
});

describe("agent templates", () => {
  test("parses optional routing and extension fields", () => {
    const definition = parseAgentDefinitionText(`---
name: reviewer
provider: openai-codex
model: gpt-5.6-sol
thinking: high
extensions: @scope/tools, ~/.pi/helper.ts
skills: web-investigate
---
Review the requested files.`, "fallback");
    assert.partialDeepStrictEqual(definition, {
      name: "reviewer",
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      thinking: "high",
      extensions: ["@scope/tools", "~/.pi/helper.ts"],
      skills: ["web-investigate"],
      prompt: "Review the requested files.",
    });
  });
});

describe("run storage", () => {
  const packageDir = path.join(TEST_AGENT_DIR, "pi-codex-subagents");
  const configFile = path.join(packageDir, "config.json");
  const fixtureDir = path.join(TEST_AGENT_DIR, "retention-fixture");

  test("uses persistent package storage by default", () => {
    fs.rmSync(configFile, { force: true });
    assert.strictEqual(getRunsDir(), path.join(packageDir, "runs"));
  });

  test("loads the model response timeout from package configuration", () => {
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ modelResponseTimeoutMs: 1234 }));
    assert.strictEqual(loadSubagentConfig().modelResponseTimeoutMs, 1234);
    fs.rmSync(configFile, { force: true });
  });

  test("keeps legacy temporary runs discoverable", () => {
    fs.rmSync(configFile, { force: true });
    const parentSessionId = "legacy-parent";
    const id = "11111111-1111-4111-8111-111111111111";
    const legacyRoot = path.join(process.env.PI_SUBAGENT_TEMP_DIR!, "pi-codex-subagents", os.userInfo().username, "runs");
    const legacyScope = path.join(legacyRoot, parentScopeKey(parentSessionId));
    fs.mkdirSync(legacyScope, { recursive: true });
    fs.writeFileSync(path.join(legacyScope, `${id}.info.json`), JSON.stringify({
      id,
      taskName: "legacy",
      status: "closed",
      finalResponse: "legacy response",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    assert.partialDeepStrictEqual(getAgent("legacy", parentSessionId), { id, status: "completed", finalResponse: "legacy response" });
    fs.rmSync(legacyScope, { recursive: true, force: true });
  });

  test("keeps agent lists in creation order when activity changes", async () => {
    fs.rmSync(configFile, { force: true });
    const parentSessionId = "creation-order";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    const now = Date.now();
    const agents = [
      { id: "11111111-1111-4111-8111-111111111111", taskName: "older", createdAt: now - 2000, lastActivity: now },
      { id: "22222222-2222-4222-8222-222222222222", taskName: "newer", createdAt: now - 1000, lastActivity: now - 1000 },
    ];
    fs.mkdirSync(scope, { recursive: true });
    for (const agent of agents) {
      fs.writeFileSync(path.join(scope, `${agent.id}.info.json`), JSON.stringify({
        ...agent,
        canonicalName: `/${agent.taskName}`,
        parentSessionId,
        status: "completed",
        updatedAt: agent.lastActivity,
      }));
    }

    const manager = new AgentManager();
    try {
      assert.deepStrictEqual(manager.listAgents(undefined, parentSessionId).map((agent) => agent.agent_name), ["/newer", "/older"]);
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
    }
  });

  test("ignores malformed info records during reconciliation", async () => {
    fs.rmSync(configFile, { force: true });
    const parentSessionId = "malformed-info";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    const malformed = path.join(scope, "33333333-3333-4333-8333-333333333333.info.json");
    fs.rmSync(scope, { recursive: true, force: true });
    fs.mkdirSync(scope, { recursive: true });
    fs.writeFileSync(malformed, "{}");
    const manager = new AgentManager();
    try {
      await manager.ready();
      assert.deepStrictEqual(manager.listAgents(undefined, parentSessionId), []);
      assert.strictEqual(fs.existsSync(malformed), true);
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
    }
  });

  test("removes expired runs and outputs using configurable retention", () => {
    fs.mkdirSync(packageDir, { recursive: true });
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.writeFileSync(configFile, JSON.stringify({ storageDir: fixtureDir, retentionDays: 3 }));

    const now = Date.now();
    const oldTime = new Date(now - 4 * 24 * 60 * 60 * 1000);
    const scope = path.join(fixtureDir, "a".repeat(24));
    const unrelatedScope = path.join(fixtureDir, "unrelated");
    const outputs = path.join(fixtureDir, "_outputs");
    const expiredId = "11111111-1111-4111-8111-111111111111";
    const activeId = "22222222-2222-4222-8222-222222222222";
    const expiredInfo = path.join(scope, `${expiredId}.info.json`);
    const activeInfo = path.join(scope, `${activeId}.info.json`);
    const expiredOutput = path.join(outputs, `${oldTime.getTime()}-33333333-3333-4333-8333-333333333333.txt`);
    const activeMarker = path.join(process.env.PI_SUBAGENT_TEMP_DIR!, "pi-codex-subagents", os.userInfo().username, "sockets", `${activeId}.peek.json`);
    const unrelatedAgentFile = path.join(scope, `${expiredId}.notes`);
    const staleLock = path.join(scope, `.task-${"c".repeat(24)}.lock`);
    const liveOwnerLock = path.join(scope, `.task-${"d".repeat(24)}.lock`);

    try {
      fs.mkdirSync(scope, { recursive: true });
      fs.mkdirSync(unrelatedScope, { recursive: true });
      fs.mkdirSync(outputs, { recursive: true });
      fs.mkdirSync(path.dirname(activeMarker), { recursive: true });
      for (const [file, id] of [[expiredInfo, expiredId], [activeInfo, activeId]]) {
        fs.writeFileSync(file, JSON.stringify({
          id,
          createdAt: oldTime.getTime(),
          updatedAt: oldTime.getTime(),
          lastActivity: oldTime.getTime(),
        }));
        fs.utimesSync(file, oldTime, oldTime);
      }
      fs.writeFileSync(activeMarker, JSON.stringify({ pid: process.pid, startedAt: now, token: "test" }));
      fs.writeFileSync(unrelatedAgentFile, "keep");
      fs.writeFileSync(staleLock, "");
      fs.writeFileSync(liveOwnerLock, JSON.stringify({ pid: process.pid }));
      fs.utimesSync(staleLock, oldTime, oldTime);
      fs.utimesSync(liveOwnerLock, oldTime, oldTime);
      fs.writeFileSync(expiredOutput, "old");
      fs.utimesSync(expiredOutput, oldTime, oldTime);
      fs.writeFileSync(path.join(outputs, "unrelated.txt"), "keep");
      fs.writeFileSync(path.join(unrelatedScope, "unrelated.txt"), "keep");

      new AgentManager();
      assert.strictEqual(fs.existsSync(expiredInfo), false);
      assert.strictEqual(fs.existsSync(activeInfo), true);
      assert.strictEqual(fs.existsSync(unrelatedAgentFile), true);
      assert.strictEqual(fs.existsSync(staleLock), false);
      assert.strictEqual(fs.existsSync(liveOwnerLock), true);
      assert.strictEqual(fs.existsSync(expiredOutput), false);
      assert.strictEqual(fs.existsSync(path.join(outputs, "unrelated.txt")), true);
      assert.strictEqual(fs.existsSync(path.join(unrelatedScope, "unrelated.txt")), true);

      fs.writeFileSync(configFile, JSON.stringify({ storageDir: fixtureDir, retentionDays: 0 }));
      fs.writeFileSync(expiredInfo, "{}");
      fs.utimesSync(expiredInfo, oldTime, oldTime);
      new AgentManager();
      assert.strictEqual(fs.existsSync(expiredInfo), true);
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
      fs.rmSync(activeMarker, { force: true });
      fs.rmSync(configFile, { force: true });
    }
  });
});

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition.");
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function readSocketEvents(socketPath: string, count: number): Promise<any[]> {
  return await new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const events: any[] = [];
    let buffer = "";
    const finish = (error?: Error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve(events);
    };
    socket.setTimeout(1000, () => finish(new Error("Timed out waiting for subagent events.")));
    socket.on("error", (error) => finish(error));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      while (events.length < count) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        events.push(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
      }
      finish();
    });
  });
}

function spawnParams(parentSessionId: string, task_name: string, message: string) {
  return {
    task_name,
    message,
    cwd: TEST_AGENT_DIR,
    parentSessionId,
    inheritedProvider: "test",
    inheritedModelId: "fake",
  };
}

describe("spawn model and thinking resolution", () => {
  test("caller wins, then the template, then the inherited value, then the default", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "spawn-overrides";
    fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
    const templateFile = path.join(TEST_AGENT_DIR, "pi-codex-subagents", "agents", "routed.md");
    fs.mkdirSync(path.dirname(templateFile), { recursive: true });
    fs.writeFileSync(templateFile, "---\nname: routed\nprovider: template-provider\nmodel: template-model\nthinking: medium\n---\nRouted template.");
    const manager = new AgentManager();
    const spawn = async (task: string, overrides: Record<string, unknown>) => {
      await manager.spawnAgent({ ...spawnParams(parentSessionId, task, "work"), inheritedThinking: "low", ...overrides });
      return manager.getAgentInfo(task, parentSessionId);
    };
    const callerModel = { model: { provider: "openai", modelId: "gpt-5" } };
    try {
      assert.partialDeepStrictEqual(await spawn("inherited", {}), { model: "test:fake", thinking: "low" });
      assert.partialDeepStrictEqual(await spawn("caller-model", callerModel), { model: "openai:gpt-5", thinking: "low" });
      assert.partialDeepStrictEqual(await spawn("caller-thinking", { thinking: "max" }), { model: "test:fake", thinking: "max" });
      assert.partialDeepStrictEqual(await spawn("template", { agent_type: "routed" }), { model: "template-provider:template-model", thinking: "medium" });
      assert.partialDeepStrictEqual(await spawn("caller-beats-template", { agent_type: "routed", ...callerModel, thinking: "xhigh" }), { model: "openai:gpt-5", thinking: "xhigh" });
      // No level requested anywhere, not even by the parent, falls back to the package default.
      await manager.spawnAgent(spawnParams(parentSessionId, "default-thinking", "work"));
      assert.partialDeepStrictEqual(manager.getAgentInfo("default-thinking", parentSessionId), { model: "test:fake", thinking: "high" });
      await assert.rejects(spawn("missing", { agent_type: "absent" }), /Agent template not found/);
    } finally {
      await manager.shutdown();
      fs.rmSync(templateFile, { force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });
});

const ROUTING_CONFIG_FILE = path.join(TEST_AGENT_DIR, "pi-codex-subagents", "config.json");
const PROVIDER_AGENTS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../../pi-codex-subagents/config.json"), "utf8")).providerAgents;

function installProviderRoutes() {
  fs.mkdirSync(path.dirname(ROUTING_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(ROUTING_CONFIG_FILE, JSON.stringify({ providerAgents: PROVIDER_AGENTS }));
}

describe("provider-scoped tiers", () => {
  test("configures exactly the requested models and thinking levels", () => {
    const claude = {
      light: { model: "claude-haiku-5-5", thinking: "max" },
      medium: { model: "claude-sonnet-5-5", thinking: "high" },
      high: { model: "claude-opus-5-5", thinking: "high" },
      max: { model: "claude-fable-5-1", thinking: "high" },
    };
    assert.deepStrictEqual(PROVIDER_AGENTS, {
      openai: {
        light: { model: "gpt-6-luna", thinking: "max" },
        medium: { model: "gpt-5.6-terra", thinking: "high" },
        high: { model: "gpt-6.1-sol", thinking: "high" },
        max: { model: "gpt-6-astra", thinking: "high" },
      },
      anthropic: claude,
      radius: claude,
    });
  });

  test("launches every tier with the exact provider, model, and thinking CLI arguments", async () => {
    installProviderRoutes();
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const manager = new AgentManager();
    try {
      assert.deepStrictEqual(listAgentDefinitions().map((tier) => tier.name), ["light", "medium", "high", "max"]);
      for (const [provider, tiers] of Object.entries(PROVIDER_AGENTS)) {
        assert.strictEqual(listAgentDefinitions(provider).length, 4);
        for (const [tier, route] of Object.entries(tiers as any)) {
          const expected = route as any;
          const parent = `tiers-${provider}`;
          await manager.spawnAgent({ ...spawnParams(parent, tier, "hold"), agent_type: tier, inheritedProvider: provider, inheritedThinking: "off" });
          const info = manager.getAgentInfo(tier, parent);
          assert.partialDeepStrictEqual(info, { provider, modelId: expected.model, thinking: expected.thinking });
          const start = JSON.parse(fs.readFileSync(info.sessionFile, "utf8").split("\n")[0]);
          for (const [flag, value] of [["--provider", provider], ["--model", expected.model], ["--thinking", expected.thinking]]) {
            assert.strictEqual(start.args[start.args.indexOf(flag) + 1], value);
          }
        }
      }
      await assert.rejects(manager.spawnAgent({ ...spawnParams("bad-tiers", "generic", "hold"), inheritedProvider: "openai" }), /agent_type is required/);
      await assert.rejects(manager.spawnAgent({ ...spawnParams("bad-tiers", "unknown", "hold"), agent_type: "reviewer", inheritedProvider: "openai" }), /Agent template not found/);
      await assert.rejects(manager.spawnAgent({ ...spawnParams("bad-tiers", "provider", "hold"), agent_type: "light", inheritedProvider: "openai-codex" }), /No subagent tiers configured/);
      for (const override of [{ model: { provider: "radius", modelId: "wrong" } }, { thinking: "high" as const }]) {
        await assert.rejects(manager.spawnAgent({ ...spawnParams("bad-tiers", "override", "hold"), agent_type: "light", inheritedProvider: "openai", ...override }), /do not allow model or thinking overrides/);
      }
    } finally {
      await manager.shutdown();
      fs.rmSync(ROUTING_CONFIG_FILE, { force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("fails closed on malformed routing instead of inheriting a model", () => {
    try {
      fs.writeFileSync(ROUTING_CONFIG_FILE, JSON.stringify({ providerAgents: { openai: { light: { model: "gpt-6-luna", thinking: "typo" } } } }));
      assert.throws(() => loadSubagentConfig(), /Invalid providerAgents route/);
      fs.writeFileSync(ROUTING_CONFIG_FILE, "{");
      assert.throws(() => loadSubagentConfig());
    } finally {
      fs.rmSync(ROUTING_CONFIG_FILE, { force: true });
    }
  });
});

describe("child process lifecycle", () => {
  test("passes explicit Pi built-in extension identifiers to the child", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const configFile = path.join(TEST_AGENT_DIR, "pi-codex-subagents", "config.json");
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ defaults: { extensions: ["builtin:codemode"] } }));
    const manager = new AgentManager();
    try {
      await manager.spawnAgent(spawnParams("builtin-extension", "worker", "hold"));
      const info = manager.getAgentInfo("worker", "builtin-extension");
      assert.deepStrictEqual(info.extensionPaths, ["builtin:codemode"]);
      assert.strictEqual(info.tools, undefined);
      const start = JSON.parse(fs.readFileSync(info.sessionFile, "utf8").split("\n")[0]);
      assert.ok(start.args.includes("--no-extensions"));
      assert.deepStrictEqual(start.args.slice(start.args.indexOf("--extension"), start.args.indexOf("--extension") + 2), ["--extension", "builtin:codemode"]);
    } finally {
      await manager.shutdown();
      fs.rmSync(configFile, { force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("hibernates after settle and lazily restarts the persisted session", async () => {
    fs.rmSync(path.join(TEST_AGENT_DIR, "pi-codex-subagents", "config.json"), { force: true });
    fs.rmSync(path.join(TEST_AGENT_DIR, "pi-codex-subagents", "SYSTEM.md"), { force: true });
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "lifecycle-settle";
    fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
    const manager = new AgentManager();
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "first"));
      const first = manager.getAgentInfo("worker", parentSessionId);
      const firstPid = first.childProcess!.pid;
      await waitUntil(() => {
        const info = manager.getAgentInfo("worker", parentSessionId);
        return info.status === "completed" && !info.childProcess;
      });
      assert.strictEqual(pidAlive(firstPid), false);
      assert.strictEqual(manager.readAgentResponse("worker", parentSessionId).finalResponse, "response:first");

      assert.deepStrictEqual(await manager.sendMessage(parentSessionId, "worker", "second"), { delivery: "prompt" });
      const secondPid = manager.getAgentInfo("worker", parentSessionId).childProcess!.pid;
      assert.notStrictEqual(secondPid, firstPid);
      await waitUntil(() => {
        const info = manager.getAgentInfo("worker", parentSessionId);
        return info.status === "completed" && !info.childProcess;
      });
      assert.strictEqual(pidAlive(secondPid), false);
      assert.strictEqual(manager.readAgentResponse("worker", parentSessionId).finalResponse, "response:second");
      const sessionRecords = fs.readFileSync(first.sessionFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      const starts = sessionRecords.filter((entry) => entry.type === "started");
      assert.strictEqual(new Set(starts.map((entry) => entry.pid)).size, 2);
      const systemPromptIndex = starts[0].args.indexOf("--system-prompt");
      const systemPromptPath = starts[0].args[systemPromptIndex + 1];
      assert.strictEqual(path.isAbsolute(systemPromptPath), true);
      assert.strictEqual(fs.readFileSync(systemPromptPath, "utf8"), "You are a subagent working for a main agent. Work only on the assigned task and follow its scope precisely.");
      for (const start of starts) {
        assert.ok(start.args.includes("--no-context-files"));
        assert.deepStrictEqual(start.args.slice(start.args.indexOf("--system-prompt"), start.args.indexOf("--system-prompt") + 2), [
          "--system-prompt",
          systemPromptPath,
        ]);
        assert.deepStrictEqual(start.args.slice(start.args.indexOf("--append-system-prompt"), start.args.indexOf("--append-system-prompt") + 2), [
          "--append-system-prompt",
          "",
        ]);
      }
    } finally {
      await manager.shutdown();
      fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("records startup failure causes instead of leaving agents starting", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "lifecycle-startup-failure";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    const socketDir = path.dirname(getSocketPath("11111111-1111-4111-8111-111111111111"));
    fs.rmSync(scope, { recursive: true, force: true });
    const manager = new AgentManager();
    await manager.ready();
    fs.rmSync(socketDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(socketDir), { recursive: true });
    fs.writeFileSync(socketDir, "block startup marker creation");
    try {
      let returnedError = "";
      try {
        await manager.spawnAgent(spawnParams(parentSessionId, "worker", "first"));
      } catch (error) {
        returnedError = error instanceof Error ? error.message : String(error);
      }
      assert.ok(returnedError.includes("EEXIST"));
      const failed = manager.getAgentInfo("worker", parentSessionId);
      assert.strictEqual(failed.status, "failed");
      assert.strictEqual(failed.error, returnedError);
      assert.strictEqual(failed.childProcess, undefined);
      const failedResponses = (await manager.waitAllAgents(parentSessionId, ["worker"])).responses;
      assert.strictEqual(failedResponses.length, 1);
      assert.partialDeepStrictEqual(failedResponses[0], { agent_name: "/worker", status: "failed", error: failed.error });

      fs.rmSync(socketDir, { force: true });
      fs.mkdirSync(socketDir, { recursive: true });
      assert.deepStrictEqual(await manager.sendMessage(parentSessionId, "worker", "retry"), { delivery: "prompt" });
      await waitUntil(() => manager.getAgentInfo("worker", parentSessionId).status === "completed");
    } finally {
      fs.rmSync(socketDir, { recursive: true, force: true });
      fs.mkdirSync(socketDir, { recursive: true });
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("reconciles persisted startup records that never acquired a child", async () => {
    const parentSessionId = "lifecycle-reconcile-no-child";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    const id = "33333333-3333-4333-8333-333333333333";
    const infoFile = path.join(scope, `${id}.info.json`);
    fs.rmSync(scope, { recursive: true, force: true });
    fs.mkdirSync(scope, { recursive: true });
    fs.writeFileSync(infoFile, JSON.stringify({
      id,
      taskName: "orphan",
      canonicalName: "/orphan",
      parentSessionId,
      provider: "test",
      modelId: "fake",
      model: "test:fake",
      cwd: TEST_AGENT_DIR,
      sessionFile: path.join(scope, `${id}.jsonl`),
      infoFile,
      logFile: path.join(scope, `${id}.log`),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      status: "starting",
    }));
    const manager = new AgentManager();
    try {
      await manager.ready();
      assert.partialDeepStrictEqual(manager.getAgentInfo("orphan", parentSessionId), {
        status: "failed",
        error: "Agent startup did not complete before its owning extension stopped.",
      });
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
    }
  });

  test("hibernates after failure while preserving the error", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "lifecycle-failure";
    const systemPromptFile = path.join(TEST_AGENT_DIR, "pi-codex-subagents", "SYSTEM.md");
    const customSystemPrompt = "Use the custom subagent instructions.";
    fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(systemPromptFile), { recursive: true });
    fs.writeFileSync(systemPromptFile, customSystemPrompt);
    const manager = new AgentManager();
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "fail now"));
      const started = manager.getAgentInfo("worker", parentSessionId);
      const pid = started.childProcess!.pid;
      assert.strictEqual(fs.readFileSync(systemPromptFile, "utf8"), customSystemPrompt);
      await waitUntil(() => {
        const info = manager.getAgentInfo("worker", parentSessionId);
        return info.status === "failed" && !info.childProcess;
      });
      const failed = manager.readAgentResponse("worker", parentSessionId);
      assert.strictEqual(failed.error, "fake failure");
      assert.strictEqual(pidAlive(pid), false);
    } finally {
      await manager.shutdown();
      fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
      fs.rmSync(systemPromptFile, { force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("rejects an empty configured system prompt instead of falling back to Pi's default", async () => {
    const parentSessionId = "empty-system-prompt";
    const systemPromptFile = path.join(TEST_AGENT_DIR, "pi-codex-subagents", "SYSTEM.md");
    fs.mkdirSync(path.dirname(systemPromptFile), { recursive: true });
    fs.writeFileSync(systemPromptFile, "\n");
    const manager = new AgentManager();
    try {
      await assert.rejects(manager.spawnAgent(spawnParams(parentSessionId, "worker", "first")), /Subagent system prompt is empty/);
    } finally {
      await manager.shutdown();
      fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
      fs.rmSync(systemPromptFile, { force: true });
    }
  });

  test("accepts Darwin process ownership when ps cannot expose the token", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platformDescriptor, value: "darwin" });
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "lifecycle-darwin";
    fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
    const manager = new AgentManager();
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "hold darwin"));
      const running = manager.getAgentInfo("worker", parentSessionId);
      assert.strictEqual(typeof running.childProcess?.pid, "number");
      assert.strictEqual(pidAlive(running.childProcess!.pid), true);
    } finally {
      try {
        await manager.shutdown();
      } finally {
        Object.defineProperty(process, "platform", platformDescriptor);
        fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
        delete process.env.PI_SUBAGENT_PI_BIN;
      }
    }
  });

  test("broadcasts delta-only tool-call progress instead of reporting thinking", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "lifecycle-delta-only-progress";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const manager = new AgentManager({ modelResponseTimeoutMs: 2000 });
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "stream forever"));
      await new Promise((resolve) => setTimeout(resolve, 30));
      const running = manager.getAgentInfo("worker", parentSessionId);
      const [sync, update] = await readSocketEvents(getSocketPath(running.id), 2);
      assert.strictEqual(sync.status, "calling");
      assert.partialDeepStrictEqual(sync.partialMessage.content[0], { type: "toolCall" });
      assert.strictEqual(update.type, "message_update");
      assert.strictEqual(update.message, undefined);

      const persistedActivity = manager.getAgentInfo("worker", parentSessionId).updatedAt;
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.strictEqual(manager.getAgentInfo("worker", parentSessionId).updatedAt, persistedActivity);
    } finally {
      await manager.interruptAgent(parentSessionId, "worker");
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("does not apply the model response timeout to tool execution", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "lifecycle-tool-timeout";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const manager = new AgentManager({ modelResponseTimeoutMs: 50 });
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "tool hold"));
      const pid = manager.getAgentInfo("worker", parentSessionId).childProcess!.pid;
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.strictEqual(manager.getAgentInfo("worker", parentSessionId).status, "running");
      assert.strictEqual(pidAlive(pid), true);
    } finally {
      await manager.interruptAgent(parentSessionId, "worker");
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("fails and terminates a model response that streams forever", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "lifecycle-model-response-timeout";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const manager = new AgentManager({ modelResponseTimeoutMs: 50 });
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "stream forever"));
      const pid = manager.getAgentInfo("worker", parentSessionId).childProcess!.pid;
      await waitUntil(() => {
        const info = manager.getAgentInfo("worker", parentSessionId);
        return info.status === "failed" && !info.childProcess;
      });
      assert.ok(manager.readAgentResponse("worker", parentSessionId).error.includes("Model response exceeded 50 ms"));
      assert.strictEqual(pidAlive(pid), false);
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("interrupt terminates the child and clears runtime artifacts", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "lifecycle-interrupt";
    fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
    const manager = new AgentManager();
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "hold interrupt"));
      const running = manager.getAgentInfo("worker", parentSessionId);
      const pid = running.childProcess!.pid;
      assert.strictEqual((await manager.interruptAgent(parentSessionId, "worker")).previous_status, "running");
      const interrupted = manager.getAgentInfo("worker", parentSessionId);
      assert.strictEqual(interrupted.status, "interrupted");
      assert.strictEqual(interrupted.childProcess, undefined);
      assert.strictEqual(pidAlive(pid), false);
      const socketDir = path.join(process.env.PI_SUBAGENT_TEMP_DIR!, "pi-codex-subagents", os.userInfo().username, "sockets");
      assert.strictEqual(fs.existsSync(path.join(socketDir, `${running.id}.active.json`)), false);
      assert.strictEqual(fs.existsSync(path.join(socketDir, `${running.id}.peek.json`)), false);
      if (process.platform !== "win32") assert.strictEqual(fs.existsSync(getSocketPath(running.id)), false);
    } finally {
      await manager.shutdown();
      fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("reconciles owned children without risking PID-reuse kills", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "lifecycle-reconcile";
    fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
    const owner = new AgentManager();
    const reconcilers: AgentManager[] = [];
    try {
      await owner.spawnAgent(spawnParams(parentSessionId, "orphan", "hold orphan"));
      const orphanPid = owner.getAgentInfo("orphan", parentSessionId).childProcess!.pid;
      const reconciler = new AgentManager();
      reconcilers.push(reconciler);
      await waitUntil(() => {
        const info = reconciler.getAgentInfo("orphan", parentSessionId);
        return info.status === "interrupted" && !info.childProcess;
      });
      await waitUntil(() => !pidAlive(orphanPid));
      assert.strictEqual(pidAlive(orphanPid), false);

      await owner.spawnAgent(spawnParams(parentSessionId, "pid-reuse", "hold identity"));
      const mismatched = owner.getAgentInfo("pid-reuse", parentSessionId);
      const mismatchedPid = mismatched.childProcess!.pid;
      mismatched.childProcess!.processIdentity = "not-the-owned-process";
      fs.writeFileSync(mismatched.infoFile, JSON.stringify(mismatched, null, 2));
      const mismatchReconciler = new AgentManager();
      reconcilers.push(mismatchReconciler);
      await waitUntil(() => {
        const info = mismatchReconciler.getAgentInfo("pid-reuse", parentSessionId);
        return info.status === "interrupted" && !info.childProcess;
      });
      assert.strictEqual(pidAlive(mismatchedPid), true);
      await owner.shutdown();
      assert.strictEqual(pidAlive(mismatchedPid), false);
    } finally {
      await Promise.all([owner.shutdown(), ...reconcilers.map((manager) => manager.shutdown())]);
      fs.rmSync(path.join(getRunsDir(), parentScopeKey(parentSessionId)), { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });
});

describe("completion delivery", () => {
  test("publishes unclaimed settled and abnormal-exit completions", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "completion-callbacks";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const completions: any[] = [];
    const manager = new AgentManager({ onUnclaimedCompletion: (event: any) => completions.push(event) });
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "settled", "first"));
      await waitUntil(() => completions.some((event) => event.agentName === "/settled"));
      assert.strictEqual(completions.filter((event) => event.agentName === "/settled").length, 1);
      assert.partialDeepStrictEqual(completions.find((event) => event.agentName === "/settled"), {
        status: "completed",
        finalResponse: "response:first",
      });

      await manager.spawnAgent(spawnParams(parentSessionId, "crashed", "crash now"));
      await waitUntil(() => completions.some((event) => event.agentName === "/crashed"));
      assert.strictEqual(completions.filter((event) => event.agentName === "/crashed").length, 1);
      assert.partialDeepStrictEqual(completions.find((event) => event.agentName === "/crashed"), { status: "failed" });
      assert.ok(completions.find((event) => event.agentName === "/crashed").error.includes("code=23"));
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("delivers an externally persisted terminal state to an active waiter exactly once", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "completion-external-terminal";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const completions: any[] = [];
    const manager = new AgentManager({ onUnclaimedCompletion: (event: any) => completions.push(event) });
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "hold external"));
      const wait = manager.waitAgent(parentSessionId, ["worker"]);
      const persisted = manager.getAgentInfo("worker", parentSessionId);
      persisted.status = "interrupted";
      persisted.lastActivity = Date.now();
      fs.writeFileSync(persisted.infoFile, JSON.stringify(persisted, null, 2));

      // Force terminal-state observation through stdin failure before process exit.
      const live = (manager as any).live.get(persisted.id);
      live.proc.stdin.emit("error", new Error("forced stdin race"));
      assert.partialDeepStrictEqual((await wait).event, { agentName: "/worker", status: "interrupted" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepStrictEqual(completions, []);
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("delivers an adopted terminal state observed through child output to wait_all_agents", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "completion-external-output";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const completions: any[] = [];
    const manager = new AgentManager({ onUnclaimedCompletion: (event: any) => completions.push(event) });
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "hold external"));
      const wait = manager.waitAllAgents(parentSessionId, ["worker"]);
      const persisted = manager.getAgentInfo("worker", parentSessionId);
      persisted.status = "completed";
      persisted.finalResponse = "persisted response";
      persisted.completedAt = Date.now();
      fs.writeFileSync(persisted.infoFile, JSON.stringify(persisted, null, 2));

      const live = (manager as any).live.get(persisted.id);
      live.proc.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "agent_start" })}\n`));
      const responses = (await wait).responses;
      assert.strictEqual(responses.length, 1);
      assert.partialDeepStrictEqual(responses[0], { agent_name: "/worker", status: "completed", finalResponse: "persisted response" });
      assert.deepStrictEqual(completions, []);
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("automatically delivers an adopted terminal state observed through process exit once", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "completion-external-exit";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const completions: any[] = [];
    const manager = new AgentManager({ onUnclaimedCompletion: (event: any) => completions.push(event) });
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "hold external"));
      const persisted = manager.getAgentInfo("worker", parentSessionId);
      persisted.status = "failed";
      persisted.error = "persisted failure";
      persisted.completedAt = Date.now();
      fs.writeFileSync(persisted.infoFile, JSON.stringify(persisted, null, 2));

      process.kill(persisted.childProcess!.pid, "SIGKILL");
      await waitUntil(() => completions.length === 1);
      assert.partialDeepStrictEqual(completions[0], { agentName: "/worker", status: "failed", error: "persisted failure" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.strictEqual(completions.length, 1);
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("suppresses automatic delivery while wait tools claim completions", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "completion-waits";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const completions: any[] = [];
    const manager = new AgentManager({ onUnclaimedCompletion: (event: any) => completions.push(event) });
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "one", "first"));
      const waited = await manager.waitAgent(parentSessionId, ["one"]);
      assert.partialDeepStrictEqual(waited.event, { agentName: "/one", status: "completed" });
      assert.deepStrictEqual(completions, []);

      await manager.spawnAgent(spawnParams(parentSessionId, "two", "second"));
      const all = await manager.waitAllAgents(parentSessionId, ["two"]);
      assert.strictEqual(all.responses.length, 1);
      assert.partialDeepStrictEqual(all.responses[0], { agent_name: "/two", status: "completed" });
      assert.deepStrictEqual(completions, []);
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("releases suppressed completions when wait_all_agents is cancelled", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "completion-wait-cancel";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const completions: any[] = [];
    const manager = new AgentManager({ onUnclaimedCompletion: (event: any) => completions.push(event) });
    const controller = new AbortController();
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "slow", "hold slow"));
      await manager.spawnAgent(spawnParams(parentSessionId, "fast", "fast"));
      const wait = manager.waitAllAgents(parentSessionId, ["slow", "fast"], controller.signal);
      await waitUntil(() => manager.getAgentInfo("fast", parentSessionId).status === "completed");
      assert.deepStrictEqual(completions, []);
      controller.abort(new Error("cancelled"));
      await assert.rejects(wait, /aborted/);
      await waitUntil(() => completions.some((event) => event.agentName === "/fast"));
      assert.strictEqual(completions.filter((event) => event.agentName === "/fast").length, 1);
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });

  test("reports active and inactive lifecycle transitions", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const parentSessionId = "status-transitions";
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const activity: boolean[] = [];
    const manager = new AgentManager({
      onActivityChange: (event: any) => {
        if (event.parentSessionId === parentSessionId) activity.push(event.active);
      },
    });
    try {
      await manager.spawnAgent(spawnParams(parentSessionId, "worker", "first"));
      await waitUntil(() => manager.getAgentInfo("worker", parentSessionId).status === "completed");
      assert.ok(activity.includes(true));
      assert.strictEqual(activity.at(-1), false);

      const settled = manager.getAgentInfo("worker", parentSessionId);
      const rejectedAt = activity.length;
      await assert.rejects(manager.sendMessage(parentSessionId, "worker", "reject restart"), /fake prompt rejection/);
      assert.partialDeepStrictEqual(manager.getAgentInfo("worker", parentSessionId), {
        status: "completed",
        finalResponse: settled.finalResponse,
        completedAt: settled.completedAt,
      });
      assert.strictEqual(manager.getAgentInfo("worker", parentSessionId).childProcess, undefined);
      assert.ok(activity.slice(rejectedAt).includes(true));
      assert.strictEqual(activity.at(-1), false);

      const restartAt = activity.length;
      await manager.sendMessage(parentSessionId, "worker", "hold restart");
      assert.ok(activity.slice(restartAt).includes(true));
      await manager.interruptAgent(parentSessionId, "worker");
      assert.strictEqual(activity.at(-1), false);
    } finally {
      await manager.shutdown();
      fs.rmSync(scope, { recursive: true, force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });
});

describe("extension completion delivery and TUI", () => {
  for (const shortcut of [undefined, "", "ctrl+shift+a"]) {
    test(`opens the browser with optional shortcut ${shortcut ?? "undefined"}`, async () => {
    const configFile = path.join(TEST_AGENT_DIR, "pi-codex-subagents", "config.json");
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ shortcut }));
    const commands = new Map<string, any>();
    const shortcuts = new Map<string, any>();
    let shutdown: (() => Promise<void>) | undefined;
    let menusOpened = 0;
    const ctx: any = {
      mode: "tui",
      sessionManager: { getSessionId: () => "shortcut-test-parent" },
      ui: {
        async custom(create: any) {
          const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
          const menu = create({ requestRender() {} }, theme, {}, () => {});
          assert.ok(menu.render(80).join("\n").includes("Subagents"));
          menusOpened++;
          return undefined;
        },
      },
    };
    const { default: subagentExtension } = await import("../index.js");
    try {
      subagentExtension({
        on(name: string, handler: any) { if (name === "session_shutdown") shutdown = handler; },
        registerTool() {},
        registerMessageRenderer() {},
        registerCommand(name: string, command: any) { commands.set(name, command); },
        registerShortcut(key: string, options: any) { shortcuts.set(key, options); },
      } as any);
      assert.deepStrictEqual([...commands.keys()], ["subagents"]);
      assert.deepStrictEqual([...shortcuts.keys()], shortcut ? [shortcut] : []);
      await commands.get("subagents").handler("", ctx);
      assert.strictEqual(menusOpened, 1);
      if (shortcut) {
        await shortcuts.get(shortcut).handler(ctx);
        assert.strictEqual(menusOpened, 2);
      }
    } finally {
      await shutdown?.();
      fs.rmSync(configFile, { force: true });
    }
    });
  }

  test("registers commands, renders one-line activity, and delivers bounded completions", async () => {
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
    const tools = new Map<string, any>();
    const commands = new Map<string, any>();
    const renderers = new Map<string, any>();
    const sentMessages: Array<{ message: any; options: any }> = [];
    let widget: any;
    const pi: any = {
      on(name: string, handler: (event: any, ctx: any) => any) {
        const entries = handlers.get(name) ?? [];
        entries.push(handler);
        handlers.set(name, entries);
      },
      registerTool(tool: any) { tools.set(tool.name, tool); },
      registerCommand(name: string, command: any) { commands.set(name, command); },
      registerMessageRenderer(name: string, renderer: any) { renderers.set(name, renderer); },
      sendMessage(message: any, options: any) { sentMessages.push({ message, options }); },
      getThinkingLevel() { return "high"; },
      getActiveTools() { return ["read", "bash"]; },
    };
    const parentSessionId = "index-integration-parent";
    const availableModels = [
      { provider: "test", id: "fake" },
      { provider: "fireworks", id: "accounts/fireworks/models/glm-5p2" },
      { provider: "openai", id: "gpt-5" },
    ];
    const notifications: string[] = [];
    const ctx: any = {
      cwd: TEST_AGENT_DIR,
      mode: "tui",
      model: { provider: "test", id: "fake" },
      modelRegistry: { getAvailable: () => availableModels },
      // What pi resolved the enabledModels patterns to for this session, availability-checked.
      scopedModels: [
        { model: { provider: "fireworks", id: "accounts/fireworks/models/glm-5p2" } },
        { model: { provider: "openai", id: "gpt-5" } },
      ],
      sessionManager: {
        getSessionId: () => parentSessionId,
        getSessionFile: () => path.join(TEST_AGENT_DIR, "parent.jsonl"),
      },
      ui: {
        setWidget(_key: string, value: any) { widget = value; },
        notify(message: string) { notifications.push(message); },
      },
    };
    const scope = path.join(getRunsDir(), parentScopeKey(parentSessionId));
    fs.rmSync(scope, { recursive: true, force: true });
    const configFile = path.join(TEST_AGENT_DIR, "pi-codex-subagents", "config.json");
    // A thinking suffix on an allowlist entry is tolerated and stripped from the offered pair.
    fs.writeFileSync(configFile, JSON.stringify({ models: ["test/fake:high", "typo/nope"], modelsFromEnabledModels: true }));
    const { default: subagentExtension } = await import("../index.js");
    subagentExtension(pi);
    const emit = async (name: string, event: any = {}) => {
      for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
    };

    // Session start is the single resolution point, so before it the arguments are absent.
    const spawnArgs = () => tools.get("spawn_agent").parameters.properties;
    assert.strictEqual(spawnArgs().model, undefined);
    assert.strictEqual(spawnArgs().thinking, undefined);

    try {
      // Session start is authoritative: allowlist entries filtered to what is available,
      // unioned with pi's scoped models, and the schema must not wait for a first turn.
      await emit("session_start", { reason: "startup" });
      assert.deepStrictEqual(spawnArgs().model.enum, ["test/fake", "fireworks/accounts/fireworks/models/glm-5p2", "openai/gpt-5"]);
      assert.ok(spawnArgs().thinking.enum.includes("max"));
      assert.deepStrictEqual(notifications, ['spawn_agent models not available: typo/nope']);
      // The values live in the schema, but the description has to say the capability exists.
      assert.ok(tools.get("spawn_agent").description.includes("`model` takes one of the values its schema lists"));
      assert.deepStrictEqual([...commands.keys()], ["subagents"]);
      assert.strictEqual(renderers.has("pi-codex-subagent-completion"), true);

      fs.mkdirSync(scope, { recursive: true });
      const historyCreatedAt = Date.now();
      for (let index = 0; index < 12; index++) {
        const id = `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
        fs.writeFileSync(path.join(scope, `${id}.info.json`), JSON.stringify({
          id,
          taskName: `history/${index}`,
          canonicalName: `/history/${index}`,
          parentSessionId,
          status: index === 0 ? "running" : "completed",
          lastTaskMessage: `private task context ${index}`,
          provider: "test",
          modelId: index === 0 ? "MiniMax-M3" : "a-model-name-that-is-longer-than-the-column",
          thinking: index === 0 ? "high" : "medium",
          createdAt: historyCreatedAt - index,
          updatedAt: historyCreatedAt - index,
        }));
      }
      let browser: any;
      ctx.ui.custom = async (create: any) => {
        browser = create({ requestRender() {} }, {
          fg: (_color: string, text: string) => text,
          bold: (text: string) => text,
        }, {}, () => {});
        return undefined;
      };
      await commands.get("subagents").handler("", ctx);
      const browserLines = browser.render(120);
      const firstRowIndex = browserLines.findIndex((line: string) => line.includes("/history/0"));
      const firstRow = browserLines[firstRowIndex];
      assert.match(firstRow, /\/history\/0\s+running\s+\S+\s+MiniMax-M3\s+high/);
      assert.ok(browserLines[firstRowIndex + 1].includes("private task context 0"));
      const secondRow = browserLines.find((line: string) => line.includes("/history/1 "));
      assert.strictEqual(secondRow.indexOf("a-model-name"), firstRow.indexOf("MiniMax-M3"));
      assert.strictEqual(visibleWidth(secondRow.slice(0, secondRow.indexOf("medium"))), visibleWidth(firstRow.slice(0, firstRow.indexOf("high"))));
      assert.ok(!secondRow.includes("a-model-name-that-is-longer-than-the-column"));
      for (const width of [80, 50, 32]) {
        assert.strictEqual(browser.render(width).every((line: string) => visibleWidth(line) <= width), true);
      }
      const narrowRow = browser.render(50).find((line: string) => line.includes("/history/0"));
      assert.ok(narrowRow.includes("high"));
      assert.ok(!narrowRow.includes("MiniMax-M3"));
      browser.handleInput("\t");
      const allSessionRow = browser.render(80).find((line: string) => line.includes("/history/0"));
      assert.ok(allSessionRow.includes("MiniMax-M3"));
      assert.ok(allSessionRow.includes("high"));
      assert.ok(allSessionRow.trimEnd().endsWith(parentSessionId.slice(-8)));

      const firstAgentPage = await tools.get("list_agents").execute("list-1", {}, undefined, undefined, ctx);
      const firstAgentPayload = JSON.parse(firstAgentPage.content[0].text);
      assert.partialDeepStrictEqual(firstAgentPayload, { total: 12, returned: 10, offset: 0, limit: 10, next_offset: 10 });
      assert.deepStrictEqual(firstAgentPayload.agents[0], { agent_name: "/history/0", agent_status: "running" });
      assert.ok(!firstAgentPage.content[0].text.includes("private task context"));
      const secondAgentPage = await tools.get("list_agents").execute("list-2", { offset: 10 }, undefined, undefined, ctx);
      assert.partialDeepStrictEqual(JSON.parse(secondAgentPage.content[0].text), { total: 12, returned: 2, offset: 10, next_offset: null });

      const spawnResult = await tools.get("spawn_agent").execute("spawn-1", {
        task_name: "x".repeat(200),
        message: "slow finish",
      }, undefined, undefined, ctx);

      const spawnRendered = tools.get("spawn_agent").renderResult(spawnResult, {}, { fg: (_color: string, text: string) => text }).render(400);
      assert.strictEqual(spawnRendered.join("\n").trim(), `✓ ${spawnResult.details.task_name} · test/fake · high`);

      assert.strictEqual(typeof widget, "function");
      const theme = { fg: (_color: string, text: string) => text };
      const lines = widget({}, theme).render(40);
      assert.strictEqual(lines.length, 1);
      assert.ok(visibleWidth(lines[0]) <= 40);
      assert.ok(lines[0].includes("/subagents"));

      await waitUntil(() => sentMessages.length === 1);
      assert.strictEqual(widget, undefined);
      assert.deepStrictEqual(sentMessages[0].options, { deliverAs: "steer", triggerTurn: true });
      assert.ok(sentMessages[0].message.content.includes("response:slow finish"));

      await tools.get("spawn_agent").execute("spawn-2", {
        task_name: "large-output",
        message: "large response",
      }, undefined, undefined, ctx);
      await waitUntil(() => sentMessages.length === 2);
      const large = sentMessages[1].message;
      assert.ok(Buffer.byteLength(large.content, "utf8") <= 50 * 1024);
      assert.ok(large.content.includes("Output truncated"));
      assert.strictEqual(typeof large.details.fullOutputPath, "string");
      assert.strictEqual(fs.existsSync(large.details.fullOutputPath), true);

      await tools.get("spawn_agent").execute("spawn-3", {
        task_name: "routed",
        message: "slow finish",
        model: "fireworks/accounts/fireworks/models/glm-5p2",
        thinking: "max",
      }, undefined, undefined, ctx);
      assert.partialDeepStrictEqual(getAgent("routed", parentSessionId), {
        provider: "fireworks",
        modelId: "accounts/fireworks/models/glm-5p2",
        thinking: "max",
      });
      // A model the registry has, but neither list allows, is refused.
      await assert.rejects(tools.get("spawn_agent").execute("spawn-4", { task_name: "not-enabled", message: "x", model: "anthropic/claude-opus-4-6" }, undefined, undefined, ctx), /not in the configured spawn models/);

      // An allowlisted model whose provider dropped out mid-session is refused at spawn time,
      // covering both availability drift and schemas frozen before the session started.
      availableModels.splice(availableModels.findIndex((entry) => entry.provider === "openai"), 1);
      await assert.rejects(tools.get("spawn_agent").execute("spawn-5", { task_name: "gone", message: "x", model: "openai/gpt-5" }, undefined, undefined, ctx), /not currently available/);

      // Unconfigured takes both runtime arguments away again even though Pi still has enabledModels.
      fs.writeFileSync(configFile, "{}");
      await emit("session_start", { reason: "restart" });
      assert.strictEqual(spawnArgs().model, undefined);
      assert.strictEqual(spawnArgs().thinking, undefined);
      assert.ok(!tools.get("spawn_agent").description.includes("`model` takes one of the values"));
    } finally {
      await emit("session_shutdown", { reason: "quit" });
      fs.rmSync(scope, { recursive: true, force: true });
      fs.rmSync(configFile, { force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });
});

describe("provider-scoped tool exposure", () => {
  test("requires a tier, updates routes on provider switches, and refuses unavailable or unsupported routes", async () => {
    installProviderRoutes();
    process.env.PI_SUBAGENT_PI_BIN = FAKE_RPC_CHILD;
    const handlers = new Map<string, any[]>();
    let spawn: any;
    const pi: any = {
      on(name: string, handler: any) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
      registerTool(tool: any) { if (tool.name === "spawn_agent") spawn = tool; },
      registerMessageRenderer() {}, registerCommand() {}, sendMessage() {},
      getThinkingLevel: () => "off",
      getActiveTools: () => ["read", "bash"],
    };
    const available: any[] = Object.entries(PROVIDER_AGENTS).flatMap(([provider, tiers]) =>
      Object.values(tiers as any).map((route: any) => ({ provider, id: route.model, reasoning: true, thinkingLevelMap: { max: "max" } }))
    );
    const ctx: any = {
      cwd: TEST_AGENT_DIR, mode: "rpc", model: { provider: "openai", id: "parent-model" },
      modelRegistry: { getAvailable: () => available },
      sessionManager: { getSessionId: () => "scoped-tool-parent" },
      ui: { notify() {} },
    };
    const emit = async (name: string) => { for (const handler of handlers.get(name) ?? []) await handler({}, ctx); };
    const { default: extension } = await import("../index.js");
    extension(pi);
    const call = (params: any) => spawn.execute("call", { task_name: "bad-route", message: "hold", ...params }, undefined, undefined, ctx);
    try {
      await emit("session_start");
      assert.ok(spawn.parameters.required.includes("agent_type"));
      assert.deepStrictEqual(spawn.parameters.properties.agent_type.enum, ["light", "medium", "high", "max"]);
      assert.strictEqual(spawn.parameters.properties.model, undefined);
      assert.strictEqual(spawn.parameters.properties.thinking, undefined);
      assert.ok(spawn.description.includes("openai/gpt-5.6-terra"));
      await assert.rejects(call({}), /agent_type is required/);
      await assert.rejects(call({ agent_type: "reviewer" }), /not configured/);
      await assert.rejects(call({ agent_type: "light", model: "radius/claude-haiku-5-5" }), /do not allow model or thinking overrides/);
      await assert.rejects(call({ agent_type: "light", thinking: "off" }), /do not allow model or thinking overrides/);
      for (const provider of ["openai", "anthropic", "radius"]) {
        ctx.model = { provider, id: "parent-model" };
        await emit("model_select");
        assert.ok(spawn.description.includes(`${provider}/${PROVIDER_AGENTS[provider].light.model}`));
        const result = await call({ task_name: provider, agent_type: "light" });
        assert.partialDeepStrictEqual(result.details, { provider, modelId: PROVIDER_AGENTS[provider].light.model, thinking: "max" });
      }
      available.splice(0, available.length, ...available.filter((model) => model.provider !== "anthropic"));
      ctx.model = { provider: "anthropic", id: "parent-model" };
      await assert.rejects(call({ agent_type: "light" }), /not currently available/);
      ctx.model = { provider: "openai-codex", id: "parent-model" };
      await assert.rejects(call({ agent_type: "light" }), /not configured/);
      ctx.model = { provider: "openai", id: "parent-model" };
      delete available.find((model) => model.provider === "openai" && model.id === "gpt-6-luna").thinkingLevelMap.max;
      await assert.rejects(call({ agent_type: "light" }), /does not support thinking "max"/);
    } finally {
      await emit("session_shutdown");
      fs.rmSync(ROUTING_CONFIG_FILE, { force: true });
      delete process.env.PI_SUBAGENT_PI_BIN;
    }
  });
});

describe("completion mailbox", () => {
  test("waits until explicitly cancelled when no completion exists", async () => {
    const manager = new AgentManager();
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("cancelled")), 10);
    await assert.rejects(manager.waitAgent("empty-parent", undefined, controller.signal), /cancelled/);
    await manager.shutdown();
  });

  test("consumes one matching completion without dropping siblings", () => {
    const events = [
      { id: "1", parentSessionId: "parent", agentName: "/one", status: "completed", createdAt: 1 },
      { id: "2", parentSessionId: "parent", agentName: "/two", status: "completed", createdAt: 2 },
      { id: "3", parentSessionId: "other", agentName: "/one", status: "completed", createdAt: 3 },
    ] as any[];
    assert.strictEqual(consumeFirstMatchingMailboxEvent(events, "parent")?.agentName, "/one");
    assert.deepStrictEqual(events.map((event) => event.id), ["2", "3"]);
    assert.strictEqual(consumeFirstMatchingMailboxEvent(events, "parent", new Set(["/two"]))?.agentName, "/two");
    assert.deepStrictEqual(events.map((event) => event.id), ["3"]);
  });
});
