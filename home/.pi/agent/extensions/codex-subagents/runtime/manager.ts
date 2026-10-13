// Lifecycle coordinator. Storage, transport, and validation live in sibling modules.
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  ACTIVITY_PERSIST_INTERVAL_MS,
  DEFAULT_MODEL_RESPONSE_TIMEOUT_MS,
  DEFAULT_STARTUP_TIMEOUT_MS,
  DEFAULT_THINKING,
  FINAL_STATUSES,
} from "./constants.js";
import { ensureBaseDirs, getAgentDefinition, loadSubagentConfig, readSystemPrompt } from "./config.js";
import { SYSTEM_PROMPT_PATH, ensurePrivateDir } from "./paths.js";
import {
  abortError,
  canonicalAgentName,
  consumeFirstMatchingMailboxEvent,
  extractTextFromMessage,
  formatAgentError,
  normalizeList,
  normalizeTaskName,
  normalizeTools,
  previewText,
  targetMatches,
  throwIfAborted,
} from "./normalization.js";
import {
  getAgent,
  pruneExpiredRuns,
  readAllInfos,
  readInfoFile,
  readScopeInfos,
  saveInfo,
  scopeDir,
  taskStorageKey,
} from "./storage.js";
import { getPiCommand, inspectProcess, isRunActive, ownershipMatches, type ProcessSnapshot } from "./process.js";
import { resolveExtensionPaths, resolveSkillPaths } from "./resources.js";
import { EventBroadcaster, SessionLogger } from "./events.js";
import { RpcJsonlDecoder } from "./jsonl.js";
import type {
  AgentCompletionEvent,
  AgentInfo,
  AgentListEntry,
  AgentManagerOptions,
  AgentResponseEntry,
  AgentRuntimeStatus,
  ChildProcessOwnership,
  SpawnAgentParams,
} from "./types.js";

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface LiveAgent {
  info: AgentInfo;
  proc: ChildProcessWithoutNullStreams;
  broadcaster: EventBroadcaster;
  logger: SessionLogger;
  pending: Map<string, PendingRequest>;
  reqId: number;
  stderr: string;
  expectedExit: boolean;
  processFinished: boolean;
  finalizedRun: boolean;
  exitPromise: Promise<void>;
  resolveExit: () => void;
  termination?: Promise<void>;
  candidateResponse: string;
  candidateError?: string;
  modelResponseTimer?: ReturnType<typeof setTimeout>;
  lastActivityPersistedAt: number;
}

interface Waiter {
  parentSessionId: string;
  targets?: Set<string>;
  resolve: (event: AgentCompletionEvent) => void;
}

export class AgentManager {
  private readonly live = new Map<string, LiveAgent>();
  private readonly mailbox: AgentCompletionEvent[] = [];
  private waiters: Waiter[] = [];
  private readonly waitAllClaims = new Set<{
    parentSessionId: string;
    targets: Set<string>;
    suppressedEventIds: Set<string>;
  }>();
  private readonly defaultWaitAllTargets = new Map<string, Set<string>>();
  private readonly shutdownController = new AbortController();
  private readonly ownerProcessIdentity = inspectProcess(process.pid)?.identity;
  private readonly reconciliation: Promise<void>;

  constructor(private readonly options: AgentManagerOptions = {}) {
    ensureBaseDirs();
    pruneExpiredRuns();
    this.reconciliation = this.reconcilePersistedChildren();
  }

  async ready(): Promise<void> {
    await this.reconciliation;
  }

  private notifyStatusChange(info: AgentInfo): void {
    try {
      this.options.onActivityChange?.({
        parentSessionId: info.parentSessionId,
        agentName: info.canonicalName,
        active: info.status === "starting" || info.status === "running",
      });
    } catch {}
  }

  private notifyUnclaimedCompletion(event: AgentCompletionEvent): void {
    try { this.options.onUnclaimedCompletion?.(event); } catch {}
  }

  // Recovery: only terminate persisted children whose ownership still matches.

  private clearChildOwnership(info: AgentInfo, expectedToken: string): void {
    const persisted = readInfoFile(info.infoFile);
    if (persisted?.childProcess?.token === expectedToken) {
      delete persisted.childProcess;
      saveInfo(persisted);
    }
    if (info.childProcess?.token === expectedToken) delete info.childProcess;
  }

  private markPersistedStartupFailed(info: AgentInfo, error: unknown): void {
    const persisted = readInfoFile(info.infoFile) ?? info;
    if (FINAL_STATUSES.has(persisted.status)) return;
    persisted.status = "failed";
    persisted.error = formatAgentError(error);
    delete persisted.finalResponse;
    delete persisted.childProcess;
    persisted.completedAt = Date.now();
    persisted.lastActivity = Date.now();
    saveInfo(persisted);
    Object.assign(info, persisted);
    this.notifyStatusChange(persisted);
  }

  private async waitForOwnedExit(ownership: ChildProcessOwnership, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!ownershipMatches(ownership)) return true;
      await delay(25);
    }
    return !ownershipMatches(ownership);
  }

  private signalOwnedProcess(ownership: ChildProcessOwnership, signal: NodeJS.Signals): void {
    if (!ownershipMatches(ownership)) return;
    try {
      if (process.platform !== "win32") process.kill(-ownership.pid, signal);
      else process.kill(ownership.pid, signal);
    } catch {
      try { process.kill(ownership.pid, signal); } catch {}
    }
  }

  private async terminateOwnedChild(info: AgentInfo): Promise<void> {
    const ownership = info.childProcess;
    if (!ownership) return;
    if (!ownershipMatches(ownership)) {
      this.clearChildOwnership(info, ownership.token);
      return;
    }
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(ownership.pid), "/T", "/F"], { stdio: "ignore" });
        killer.once("error", () => resolve());
        killer.once("exit", () => resolve());
      });
      await this.waitForOwnedExit(ownership, 2000);
    } else {
      this.signalOwnedProcess(ownership, "SIGTERM");
      if (!await this.waitForOwnedExit(ownership, 1000)) {
        this.signalOwnedProcess(ownership, "SIGKILL");
        await this.waitForOwnedExit(ownership, 1000);
      }
    }
    if (ownershipMatches(ownership)) throw new Error(`Unable to terminate owned child process for ${info.canonicalName}.`);
    this.clearChildOwnership(info, ownership.token);
  }

  private async reconcilePersistedChildren(): Promise<void> {
    for (const info of readAllInfos()) {
      const ownership = info.childProcess;
      if (!ownership) {
        if ((info.status === "starting" || info.status === "running") && !isRunActive(info.id)) {
          try {
            this.markPersistedStartupFailed(info, "Agent startup did not complete before its owning extension stopped.");
          } catch {}
        }
        continue;
      }
      try {
        if (!ownershipMatches(ownership)) {
          if (info.status === "starting" || info.status === "running") {
            info.status = "interrupted";
            info.lastActivity = Date.now();
            saveInfo(info);
            this.notifyStatusChange(info);
          }
          this.clearChildOwnership(info, ownership.token);
          continue;
        }
        const ownerSnapshot = inspectProcess(ownership.ownerPid);
        const ownerStillActive = ownership.ownerPid !== process.pid
          && ownerSnapshot
          && (!ownership.ownerProcessIdentity || ownerSnapshot.identity === ownership.ownerProcessIdentity);
        if (ownerStillActive) continue;
        if (info.status === "starting" || info.status === "running") {
          info.status = "interrupted";
          info.lastActivity = Date.now();
          saveInfo(info);
          this.notifyStatusChange(info);
        }
        await this.terminateOwnedChild(info);
      } catch {}
    }
  }

  // Launch: resolve settings, reserve the task name, and start an isolated RPC child.

  async spawnAgent(params: SpawnAgentParams): Promise<{ task_name: string; nickname: null }> {
    await this.reconciliation;
    const taskName = normalizeTaskName(params.task_name);
    const config = loadSubagentConfig();
    if (config.providerAgents) {
      if (!Object.hasOwn(config.providerAgents, params.inheritedProvider)) throw new Error(`No subagent tiers configured for provider: ${params.inheritedProvider}`);
      if (!params.agent_type) throw new Error("agent_type is required: choose a configured subagent tier.");
      if (params.model !== undefined || params.thinking !== undefined) throw new Error("Configured subagent tiers do not allow model or thinking overrides.");
    }
    const definition = getAgentDefinition(params.agent_type, params.inheritedProvider);
    if (params.agent_type && !definition) throw new Error(`Agent template not found for ${params.inheritedProvider}: ${params.agent_type}`);
    const templateModel = definition?.provider && definition.model ? { provider: definition.provider, modelId: definition.model } : undefined;
    const { provider, modelId } = params.model ?? templateModel ?? { provider: params.inheritedProvider, modelId: params.inheritedModelId };
    readSystemPrompt();
    const configuredSkills = definition?.skills ?? config.defaults?.skills;
    const skills = normalizeList([...(configuredSkills ?? []), ...(params.skills ?? [])]);
    const extensions = normalizeList(definition?.extensions ?? config.defaults?.extensions);
    const tools = definition?.tools !== undefined
      ? normalizeTools(definition.tools)
      : extensions?.length
        ? undefined
        : normalizeTools(params.inheritedTools);
    const thinking = params.thinking ?? definition?.thinking ?? params.inheritedThinking ?? DEFAULT_THINKING;
    const cwd = path.resolve(params.cwd);
    const directory = scopeDir(params.parentSessionId);
    ensurePrivateDir(directory, true);

    const lockFile = path.join(directory, `.task-${taskStorageKey(taskName)}.lock`);
    let lock: number | undefined;
    try {
      try {
        lock = fs.openSync(lockFile, "wx");
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      } catch (error: any) {
        if (error?.code === "EEXIST") throw new Error(`Agent ${taskName} is already being created.`);
        throw error;
      }
      if (readScopeInfos(params.parentSessionId).some((info) => info.taskName === taskName)) {
        throw new Error(`Agent ${taskName} already exists in this parent session. Use a new task_name.`);
      }
      const id = randomUUID();
      const info: AgentInfo = {
        id,
        taskName,
        canonicalName: `/${taskName}`,
        parentSessionId: params.parentSessionId,
        parentSessionFile: params.parentSessionFile,
        agentType: params.agent_type,
        provider,
        modelId,
        model: `${provider}:${modelId}`,
        thinking,
        tools,
        skills,
        skillPaths: resolveSkillPaths(skills, cwd, params.loadedSkillPaths),
        extensions,
        extensionPaths: resolveExtensionPaths(extensions, cwd),
        cwd,
        sessionFile: path.join(directory, `${id}.jsonl`),
        infoFile: path.join(directory, `${id}.info.json`),
        logFile: path.join(directory, `${id}.log`),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        startedAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
        status: "starting",
        lastTaskMessage: params.message,
      };
      saveInfo(info);
      this.notifyStatusChange(info);
      const targets = this.defaultWaitAllTargets.get(params.parentSessionId) ?? new Set<string>();
      targets.add(info.canonicalName);
      this.defaultWaitAllTargets.set(params.parentSessionId, targets);
      const prompt = [definition?.prompt, params.message].filter(Boolean).join("\n\n");
      try {
        await this.startLiveAgent(info, prompt, params.message);
      } catch (error) {
        const message = formatAgentError(error);
        try { this.markPersistedStartupFailed(info, message); } catch {}
        if (error instanceof Error && error.message === message) throw error;
        throw new Error(message, { cause: error });
      }
      return { task_name: info.canonicalName, nickname: null };
    } finally {
      if (lock !== undefined) {
        fs.closeSync(lock);
        try { fs.unlinkSync(lockFile); } catch {}
      }
    }
  }

  private async startLiveAgent(info: AgentInfo, initialMessage?: string, displayMessage?: string): Promise<LiveAgent> {
    readSystemPrompt();
    if (info.status !== "starting" && info.status !== "running") {
      this.notifyStatusChange({ ...info, status: "starting", lastActivity: Date.now() });
    }
    const logger = new SessionLogger(info.logFile);
    const broadcaster = new EventBroadcaster(info.id);
    broadcaster.start();
    const launch = getPiCommand();
    const args = [
      ...launch.prefixArgs,
      "--mode", "rpc",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--system-prompt", SYSTEM_PROMPT_PATH,
      "--append-system-prompt", "",
      "--provider", info.provider,
      "--model", info.modelId,
      "--session", info.sessionFile,
    ];
    if (info.thinking) args.push("--thinking", info.thinking);
    if (info.tools !== undefined) {
      if (info.tools) args.push("--tools", info.tools);
      else args.push("--no-builtin-tools");
    }
    for (const extensionPath of info.extensionPaths ?? []) args.push("--extension", extensionPath);
    for (const skillPath of info.skillPaths ?? []) args.push("--skill", skillPath);
    const childToken = randomUUID();
    let proc: ChildProcessWithoutNullStreams;
    try {
      logger.info("spawn", "starting child pi", { command: launch.command, args, cwd: info.cwd });
      proc = spawn(launch.command, args, {
        cwd: info.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PI_SUBAGENT_OWNER_TOKEN: childToken },
        detached: process.platform !== "win32",
      });
    } catch (error) {
      broadcaster.stop();
      logger.close();
      throw error;
    }
    let resolveExit!: () => void;
    const exitPromise = new Promise<void>((resolve) => { resolveExit = resolve; });
    const live: LiveAgent = {
      info,
      proc,
      broadcaster,
      logger,
      pending: new Map(),
      reqId: 0,
      stderr: "",
      expectedExit: false,
      processFinished: false,
      finalizedRun: false,
      exitPromise,
      resolveExit,
      candidateResponse: "",
      lastActivityPersistedAt: info.updatedAt,
    };
    this.live.set(info.id, live);
    const decoder = new RpcJsonlDecoder();
    const finishProcess = (error?: Error) => {
      if (live.processFinished) return;
      this.clearModelResponseTimer(live);
      live.processFinished = true;
      const persisted = readInfoFile(live.info.infoFile);
      if (persisted && FINAL_STATUSES.has(persisted.status)) {
        this.adoptTerminalState(live, persisted);
      }
      for (const [requestId, pending] of live.pending) {
        clearTimeout(pending.timer);
        pending.reject(error ?? new Error("Child Pi process exited before responding."));
        live.pending.delete(requestId);
      }
      if (!live.expectedExit && !live.finalizedRun && !FINAL_STATUSES.has(live.info.status)) {
        this.markFailed(live, error?.message ?? "Child Pi process exited unexpectedly.");
      }
      const ownership = live.info.childProcess;
      if (ownership) this.clearChildOwnership(live.info, ownership.token);
      if (this.live.get(info.id) === live) this.live.delete(info.id);
      broadcaster.stop();
      logger.close();
      proc.stdin.removeAllListeners();
      proc.stdout.removeAllListeners();
      proc.stderr.removeAllListeners();
      proc.removeAllListeners();
      try { proc.stdin.destroy(); } catch {}
      try { proc.stdout.destroy(); } catch {}
      try { proc.stderr.destroy(); } catch {}
      live.resolveExit();
    };
    proc.stdout.on("data", (chunk) => {
      for (const line of decoder.push(chunk)) this.handleLine(live, line);
    });
    proc.stdout.on("end", () => {
      for (const line of decoder.end()) this.handleLine(live, line);
    });
    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      live.stderr = `${live.stderr}${chunk}`.slice(-64 * 1024);
      logger.stderr(chunk);
    });
    proc.stdin.on("error", (error) => {
      logger.info("stdin", "child stdin error", { error: error.message });
      if (!live.expectedExit) {
        const persisted = readInfoFile(live.info.infoFile);
        if (persisted && FINAL_STATUSES.has(persisted.status)) {
          this.adoptTerminalState(live, persisted);
        } else if (!live.finalizedRun) {
          this.markFailed(live, error.message);
        }
        void this.terminateProcess(live);
      }
    });
    proc.on("error", (error) => finishProcess(error));
    proc.on("exit", (code, signal) => {
      logger.info("exit", "child exited", { code, signal });
      const suffix = live.stderr.trim() ? `: ${live.stderr.trim().slice(-1000)}` : "";
      finishProcess(live.expectedExit ? undefined : new Error(`Child Pi exited (code=${code}, signal=${signal})${suffix}`));
    });

    try {
      if (!proc.pid) throw new Error("Child Pi process did not provide a PID.");
      await this.sendCommand(live, { type: "get_state" }, DEFAULT_STARTUP_TIMEOUT_MS);
      let snapshot: ProcessSnapshot | undefined;
      for (let attempt = 0; attempt < 20 && !snapshot; attempt++) {
        snapshot = inspectProcess(proc.pid, childToken);
        if (!snapshot || snapshot.tokenMatches === false) await delay(10);
      }
      if (!snapshot || snapshot.tokenMatches === false) throw new Error("Unable to verify child Pi process ownership.");
      info.childProcess = {
        pid: proc.pid,
        processIdentity: snapshot.identity,
        token: childToken,
        ownerPid: process.pid,
        ownerProcessIdentity: this.ownerProcessIdentity,
        startedAt: Date.now(),
      };
      saveInfo(info);
      if (initialMessage) await this.prompt(live, initialMessage, displayMessage);
      return live;
    } catch (error) {
      if (!live.finalizedRun) this.markFailed(live, error instanceof Error ? error.message : String(error));
      await this.terminateProcess(live);
      throw error;
    }
  }

  // RPC: track command replies separately from streamed model/tool activity.

  private sendCommand(live: LiveAgent, command: Record<string, unknown>, timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS): Promise<any> {
    if (live.processFinished || live.expectedExit) return Promise.reject(new Error(`Agent ${live.info.taskName} process is not available.`));
    const id = `req-${++live.reqId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        live.pending.delete(id);
        reject(new Error(`Timed out waiting for child Pi RPC command: ${String(command.type ?? "unknown")}`));
      }, timeoutMs);
      live.pending.set(id, { resolve, reject, timer });
      live.proc.stdin.write(JSON.stringify({ id, ...command }) + "\n", (error) => {
        if (!error) return;
        const pending = live.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        live.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  private async prompt(live: LiveAgent, message: string, displayMessage?: string): Promise<void> {
    const previousFinalState = {
      status: live.info.status,
      finalResponse: live.info.finalResponse,
      error: live.info.error,
      completedAt: live.info.completedAt,
    };
    this.removeMailboxEvents(live.info.parentSessionId, live.info.canonicalName);
    const targets = this.defaultWaitAllTargets.get(live.info.parentSessionId) ?? new Set<string>();
    targets.add(live.info.canonicalName);
    this.defaultWaitAllTargets.set(live.info.parentSessionId, targets);
    live.info.status = "running";
    live.info.lastTaskMessage = displayMessage ?? message;
    live.info.lastActivity = Date.now();
    live.info.messageCount += 1;
    live.finalizedRun = false;
    live.candidateResponse = "";
    live.candidateError = undefined;
    delete live.info.finalResponse;
    delete live.info.error;
    delete live.info.completedAt;
    saveInfo(live.info);
    live.lastActivityPersistedAt = live.info.updatedAt;
    this.notifyStatusChange(live.info);
    try {
      await this.sendCommand(live, { type: "prompt", message });
    } catch (error) {
      live.info.status = previousFinalState.status;
      if (previousFinalState.finalResponse !== undefined) live.info.finalResponse = previousFinalState.finalResponse;
      else delete live.info.finalResponse;
      if (previousFinalState.error !== undefined) live.info.error = previousFinalState.error;
      else delete live.info.error;
      if (previousFinalState.completedAt !== undefined) live.info.completedAt = previousFinalState.completedAt;
      else delete live.info.completedAt;
      saveInfo(live.info);
      this.notifyStatusChange(live.info);
      throw error;
    }
  }

  private clearModelResponseTimer(live: LiveAgent): void {
    if (live.modelResponseTimer) clearTimeout(live.modelResponseTimer);
    delete live.modelResponseTimer;
  }

  private startModelResponseTimer(live: LiveAgent): void {
    this.clearModelResponseTimer(live);
    const timeoutMs = Math.max(
      0,
      this.options.modelResponseTimeoutMs ?? loadSubagentConfig().modelResponseTimeoutMs ?? DEFAULT_MODEL_RESPONSE_TIMEOUT_MS,
    );
    if (timeoutMs === 0) return;
    live.modelResponseTimer = setTimeout(() => {
      delete live.modelResponseTimer;
      if (live.processFinished || live.expectedExit || live.finalizedRun) return;
      const error = `Model response exceeded ${timeoutMs} ms without completing.`;
      this.markFailed(live, error);
      void this.terminateProcess(live).catch((terminationError) => {
        live.logger.info("timeout", "failed to terminate timed-out child", {
          error: terminationError instanceof Error ? terminationError.message : String(terminationError),
        });
      });
    }, timeoutMs);
    live.modelResponseTimer.unref?.();
  }

  private handleLine(live: LiveAgent, line: string): void {
    if (!line.trim()) return;
    let event: any;
    try { event = JSON.parse(line); } catch {
      live.logger.info("rpc", "ignored invalid JSON line", { line: line.slice(0, 1000) });
      return;
    }
    live.broadcaster.broadcast(event);
    if (event.type === "response") {
      const pending = event.id ? live.pending.get(event.id) : undefined;
      if (!pending) return;
      clearTimeout(pending.timer);
      live.pending.delete(event.id);
      if (event.success) pending.resolve(event.data);
      else pending.reject(new Error(event.error || "RPC command failed"));
      return;
    }
    const highFrequencyUpdate = event.type === "message_update" || event.type === "tool_execution_update";
    if (!highFrequencyUpdate) {
      const persisted = readInfoFile(live.info.infoFile);
      if (persisted && FINAL_STATUSES.has(persisted.status) && persisted.status !== live.info.status) {
        this.adoptTerminalState(live, persisted);
        return;
      }
    }
    if (live.finalizedRun || live.expectedExit) return;
    if (event.type === "agent_start") {
      live.info.status = "running";
      live.info.lastActivity = Date.now();
      live.candidateResponse = "";
      live.candidateError = undefined;
      saveInfo(live.info);
      live.lastActivityPersistedAt = live.info.updatedAt;
      this.notifyStatusChange(live.info);
      return;
    }
    if (event.type === "message_start" && event.message?.role === "assistant") {
      this.startModelResponseTimer(live);
      return;
    }
    if (highFrequencyUpdate) {
      live.info.status = "running";
      live.info.lastActivity = Date.now();
      if (live.info.lastActivity - live.lastActivityPersistedAt >= ACTIVITY_PERSIST_INTERVAL_MS) {
        saveInfo(live.info);
        live.lastActivityPersistedAt = live.info.updatedAt;
      }
      return;
    }
    if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
      live.info.status = "running";
      live.info.lastActivity = Date.now();
      saveInfo(live.info);
      live.lastActivityPersistedAt = live.info.updatedAt;
      return;
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      this.clearModelResponseTimer(live);
      live.candidateResponse = extractTextFromMessage(event.message).trim();
      live.candidateError = event.message.stopReason === "error" || event.message.stopReason === "aborted"
        ? event.message.errorMessage || `Agent ended with ${event.message.stopReason}.`
        : undefined;
      return;
    }
    if (event.type === "agent_end") {
      const lastAssistant = [...(event.messages ?? [])].reverse().find((message: any) => message?.role === "assistant");
      if (lastAssistant) {
        live.candidateResponse = extractTextFromMessage(lastAssistant).trim();
        live.candidateError = lastAssistant.stopReason === "error" || lastAssistant.stopReason === "aborted"
          ? lastAssistant.errorMessage || `Agent ended with ${lastAssistant.stopReason}.`
          : undefined;
      }
      return;
    }
    if (event.type === "auto_retry_end" && event.success === false && event.finalError) {
      live.candidateError = event.finalError;
      return;
    }
    if (event.type === "agent_settled") {
      this.clearModelResponseTimer(live);
      if (live.info.status === "interrupted" || live.finalizedRun) return;
      if (live.candidateError) this.markFailed(live, live.candidateError);
      else this.markCompleted(live);
      void this.terminateProcess(live).catch((error) => {
        live.logger.info("hibernate", "failed to terminate settled child", { error: error instanceof Error ? error.message : String(error) });
      });
    }
  }

  // Finalization: persist the result once and route its completion to the parent.

  private adoptTerminalState(live: LiveAgent, persisted: AgentInfo): void {
    if (live.finalizedRun) return;
    live.info = persisted;
    live.finalizedRun = true;
    this.notifyStatusChange(persisted);
    this.pushMailbox({
      id: randomUUID(),
      parentSessionId: persisted.parentSessionId,
      agentName: persisted.canonicalName,
      status: persisted.status,
      finalResponse: persisted.finalResponse,
      error: persisted.error,
      createdAt: Date.now(),
    });
  }

  private markCompleted(live: LiveAgent): void {
    if (live.finalizedRun) return;
    live.finalizedRun = true;
    live.info.status = "completed";
    live.info.finalResponse = live.candidateResponse;
    delete live.info.error;
    live.info.completedAt = Date.now();
    live.info.lastActivity = Date.now();
    saveInfo(live.info);
    this.notifyStatusChange(live.info);
    this.pushMailbox({
      id: randomUUID(),
      parentSessionId: live.info.parentSessionId,
      agentName: live.info.canonicalName,
      status: "completed",
      finalResponse: live.info.finalResponse,
      createdAt: Date.now(),
    });
  }

  private markFailed(live: LiveAgent, error: string): void {
    if (live.finalizedRun) return;
    live.finalizedRun = true;
    live.info.status = "failed";
    live.info.error = formatAgentError(error);
    delete live.info.finalResponse;
    live.info.completedAt = Date.now();
    live.info.lastActivity = Date.now();
    saveInfo(live.info);
    this.notifyStatusChange(live.info);
    this.pushMailbox({
      id: randomUUID(),
      parentSessionId: live.info.parentSessionId,
      agentName: live.info.canonicalName,
      status: "failed",
      error,
      createdAt: Date.now(),
    });
  }

  // Delivery: explicit waiters claim completions before automatic notifications.

  private removeMailboxEvents(parentSessionId: string, agentName: string): void {
    for (let index = this.mailbox.length - 1; index >= 0; index--) {
      const event = this.mailbox[index];
      if (event.parentSessionId === parentSessionId && event.agentName === agentName) this.mailbox.splice(index, 1);
    }
  }

  private pushMailbox(event: AgentCompletionEvent, notify = true): void {
    this.removeMailboxEvents(event.parentSessionId, event.agentName);
    const waiterIndex = this.waiters.findIndex((waiter) => waiter.parentSessionId === event.parentSessionId && targetMatches(event, waiter.targets));
    if (waiterIndex !== -1) {
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      waiter.resolve(event);
      return;
    }
    this.mailbox.push(event);
    const matchingClaims = [...this.waitAllClaims].filter((claim) =>
      claim.parentSessionId === event.parentSessionId && claim.targets.has(event.agentName)
    );
    if (notify) {
      for (const claim of matchingClaims) claim.suppressedEventIds.add(event.id);
      if (!matchingClaims.length) this.notifyUnclaimedCompletion(event);
    }
  }

  listAgents(pathPrefix: string | undefined, parentSessionId: string, includeAll = false): AgentListEntry[] {
    const prefix = pathPrefix?.trim().replace(/^\/+/, "");
    const infos = includeAll ? readAllInfos() : readScopeInfos(parentSessionId);
    return infos
      .filter((info) => !prefix || info.taskName.startsWith(prefix))
      .map((info) => ({
        agent_name: info.canonicalName,
        agent_status: info.status,
        last_task_message: previewText(info.lastTaskMessage),
        ...(includeAll ? { parent_session_id: info.parentSessionId } : {}),
      }));
  }

  getAgentInfo(target: string, parentSessionId: string): AgentInfo {
    const info = getAgent(target, parentSessionId);
    if (!info) throw new Error(`Agent not found in this parent session: ${target}`);
    return info;
  }

  readAgentResponse(target: string, parentSessionId: string): AgentResponseEntry {
    return this.agentResponse(this.getAgentInfo(target, parentSessionId));
  }

  private agentResponse(info: AgentInfo): AgentResponseEntry {
    return {
      agent_name: info.canonicalName,
      status: info.status,
      ...(info.finalResponse !== undefined ? { finalResponse: info.finalResponse } : {}),
      ...(info.error ? { error: info.error } : {}),
      last_task_message: previewText(info.lastTaskMessage),
    };
  }

  private finishWaitTarget(parentSessionId: string, agentName: string): void {
    this.defaultWaitAllTargets.get(parentSessionId)?.delete(canonicalAgentName(agentName));
  }

  async waitAgent(parentSessionId: string, targets?: string[], signal?: AbortSignal): Promise<{ message: string; event?: AgentCompletionEvent }> {
    const waitSignal = signal ? AbortSignal.any([signal, this.shutdownController.signal]) : this.shutdownController.signal;
    throwIfAborted(waitSignal);
    const normalizedTargets = targets?.length ? new Set(targets.map(canonicalAgentName)) : undefined;
    const existing = consumeFirstMatchingMailboxEvent(this.mailbox, parentSessionId, normalizedTargets);
    if (existing) {
      this.finishWaitTarget(parentSessionId, existing.agentName);
      return { message: `Wait completed: ${existing.agentName} ${existing.status}.`, event: existing };
    }
    if (normalizedTargets) {
      const targetInfos = readScopeInfos(parentSessionId).filter((info) => normalizedTargets.has(info.canonicalName));
      if (!targetInfos.length) throw new Error(`Agent not found in this parent session: ${Array.from(normalizedTargets).join(", ")}`);
      const finalInfo = targetInfos.find((info) => FINAL_STATUSES.has(info.status));
      if (finalInfo) {
        this.finishWaitTarget(parentSessionId, finalInfo.canonicalName);
        return {
          message: `Wait completed: ${finalInfo.canonicalName} ${finalInfo.status}.`,
          event: {
            id: randomUUID(),
            parentSessionId,
            agentName: finalInfo.canonicalName,
            status: finalInfo.status,
            finalResponse: finalInfo.finalResponse,
            error: finalInfo.error,
            createdAt: Date.now(),
          },
        };
      }
    }
    return await new Promise((resolve, reject) => {
      let waiter: Waiter;
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        waitSignal.removeEventListener("abort", onAbort);
        this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
        callback();
      };
      const onAbort = () => settle(() => reject(abortError(waitSignal)));
      waiter = {
        parentSessionId,
        targets: normalizedTargets,
        resolve: (event) => settle(() => {
          this.finishWaitTarget(parentSessionId, event.agentName);
          resolve({ message: `Wait completed: ${event.agentName} ${event.status}.`, event });
        }),
      };
      this.waiters.push(waiter);
      waitSignal.addEventListener("abort", onAbort, { once: true });
      if (waitSignal.aborted) onAbort();
    });
  }

  async waitAllAgents(parentSessionId: string, targets?: string[], signal?: AbortSignal): Promise<{ message: string; responses: AgentResponseEntry[] }> {
    const waitSignal = signal ? AbortSignal.any([signal, this.shutdownController.signal]) : this.shutdownController.signal;
    throwIfAborted(waitSignal);
    const explicitTargets = targets?.length ? new Set(targets.map(canonicalAgentName)) : undefined;
    const defaultTargets = this.defaultWaitAllTargets.get(parentSessionId) ?? new Set<string>();
    const targetSet = explicitTargets ?? new Set(defaultTargets);
    if (explicitTargets) {
      const infos = readScopeInfos(parentSessionId);
      const missing = [...explicitTargets].filter((target) => !infos.some((info) => target === info.canonicalName));
      if (missing.length) throw new Error(`Agent not found in this parent session: ${missing.join(", ")}`);
    }
    const matchingInfos = () => readScopeInfos(parentSessionId).filter((info) => targetSet.has(info.canonicalName));
    const pendingNames = () => matchingInfos().filter((info) => !FINAL_STATUSES.has(info.status)).map((info) => info.canonicalName);
    const finalize = () => {
      const responses = matchingInfos().filter((info) => FINAL_STATUSES.has(info.status)).map((info) => this.agentResponse(info));
      for (const response of responses) this.finishWaitTarget(parentSessionId, response.agent_name);
      for (let index = this.mailbox.length - 1; index >= 0; index--) {
        const event = this.mailbox[index];
        if (event.parentSessionId === parentSessionId && targetSet.has(event.agentName)) this.mailbox.splice(index, 1);
      }
      return {
        message: "All target agents reached final status.",
        responses,
      };
    };
    const claim = { parentSessionId, targets: targetSet, suppressedEventIds: new Set<string>() };
    this.waitAllClaims.add(claim);
    try {
      while (true) {
        throwIfAborted(waitSignal);
        if (!pendingNames().length) return finalize();
        await delay(250, undefined, { signal: waitSignal });
      }
    } finally {
      this.waitAllClaims.delete(claim);
      for (const eventId of claim.suppressedEventIds) {
        const event = this.mailbox.find((candidate) => candidate.id === eventId);
        if (!event) continue;
        const claimedElsewhere = [...this.waitAllClaims].some((candidate) =>
          candidate.parentSessionId === event.parentSessionId && candidate.targets.has(event.agentName)
        );
        if (!claimedElsewhere) this.notifyUnclaimedCompletion(event);
      }
    }
  }

  // Control: steer live children or resume hibernated sessions on demand.

  async sendMessage(parentSessionId: string, target: string, message: string): Promise<{ delivery: "steer" | "prompt" }> {
    await this.reconciliation;
    let info = this.getAgentInfo(target, parentSessionId);
    let live = this.live.get(info.id);
    if (live?.expectedExit) {
      await live.termination;
      live = undefined;
      info = this.getAgentInfo(target, parentSessionId);
    }
    const wasLive = Boolean(live);
    if (!live) {
      if (info.childProcess) await this.terminateOwnedChild(info);
      if (info.status === "starting" || info.status === "running") {
        info.status = "interrupted";
        info.lastActivity = Date.now();
        saveInfo(info);
      }
      live = await this.startLiveAgent(info);
    }
    if (wasLive && (info.status === "starting" || info.status === "running")) {
      await this.sendCommand(live, { type: "steer", message });
      info.lastTaskMessage = message;
      info.lastActivity = Date.now();
      saveInfo(info);
      return { delivery: "steer" };
    }
    try {
      await this.prompt(live, message, message);
      return { delivery: "prompt" };
    } catch (error) {
      await this.terminateProcess(live);
      throw error;
    }
  }

  async interruptAgent(parentSessionId: string, target: string): Promise<{ previous_status: AgentRuntimeStatus }> {
    await this.reconciliation;
    const info = this.getAgentInfo(target, parentSessionId);
    const previous = info.status;
    if (previous !== "starting" && previous !== "running") return { previous_status: previous };
    const live = this.live.get(info.id);
    info.status = "interrupted";
    info.lastActivity = Date.now();
    saveInfo(info);
    this.notifyStatusChange(info);
    if (live) {
      live.info.status = "interrupted";
      live.info.lastActivity = info.lastActivity;
      live.finalizedRun = true;
      await this.terminateProcess(live);
    } else {
      await this.terminateOwnedChild(info);
    }
    this.finishWaitTarget(parentSessionId, info.canonicalName);
    this.pushMailbox({ id: randomUUID(), parentSessionId, agentName: info.canonicalName, status: "interrupted", createdAt: Date.now() }, false);
    return { previous_status: previous };
  }

  // Cleanup: abort first, then escalate termination of the child process tree.

  private signalProcessTree(live: LiveAgent, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && live.proc.pid) process.kill(-live.proc.pid, signal);
      else live.proc.kill(signal);
    } catch {
      try { live.proc.kill(signal); } catch {}
    }
  }

  private async forceKillWindowsTree(live: LiveAgent): Promise<void> {
    if (process.platform !== "win32" || !live.proc.pid) return;
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(live.proc.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
  }

  private terminateProcess(live: LiveAgent): Promise<void> {
    this.clearModelResponseTimer(live);
    if (live.processFinished) return Promise.resolve();
    if (live.termination) return live.termination;
    live.termination = (async () => {
      const abortRequest = this.sendCommand(live, { type: "abort" }, 1000);
      live.expectedExit = true;
      try { await abortRequest; } catch {}
      try { live.proc.stdin.end(); } catch {}
      await Promise.race([live.exitPromise, delay(500)]);
      if (!live.processFinished) {
        this.signalProcessTree(live, "SIGTERM");
        await Promise.race([live.exitPromise, delay(1000)]);
      }
      if (!live.processFinished) {
        if (process.platform === "win32") await this.forceKillWindowsTree(live);
        else this.signalProcessTree(live, "SIGKILL");
        await Promise.race([live.exitPromise, delay(1000)]);
      }
      if (!live.processFinished) throw new Error(`Unable to terminate child Pi process for ${live.info.canonicalName}.`);
    })();
    return live.termination;
  }

  async shutdown(): Promise<void> {
    this.shutdownController.abort(new Error("Agent manager shut down."));
    await this.reconciliation;
    const terminations: Promise<void>[] = [];
    for (const live of this.live.values()) {
      if (live.info.status === "starting" || live.info.status === "running") {
        live.info.status = "interrupted";
        live.info.lastActivity = Date.now();
        live.finalizedRun = true;
        saveInfo(live.info);
        this.notifyStatusChange(live.info);
      }
      terminations.push(this.terminateProcess(live));
    }
    await Promise.allSettled(terminations);
  }
}
