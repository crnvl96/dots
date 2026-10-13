import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_RETENTION_DAYS } from "./constants.js";
import { getRunsDir, loadSubagentConfig } from "./config.js";
import { LEGACY_RUNS_DIR, ensurePrivateDir } from "./paths.js";
import { normalizeTaskName } from "./normalization.js";
import { isRunActive, processAlive } from "./process.js";
import type { AgentInfo, AgentRuntimeStatus } from "./types.js";

const SCOPE_DIR_PATTERN = /^[0-9a-f]{24}$/;
const AGENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTPUT_FILE_PATTERN = /^\d+-[0-9a-f-]{36}\.txt$/i;
const TASK_LOCK_PATTERN = /^\.task-[0-9a-f]{24}\.lock$/;

function isAgentArtifact(name: string, agentId: string): boolean {
  return name === `${agentId}.jsonl`
    || name === `${agentId}.info.json`
    || name === `${agentId}.log`
    || new RegExp(`^${agentId}\\.info\\.json\\.\\d+\\.tmp$`).test(name);
}

function pruneScope(directory: string, cutoff: number): void {
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".info.json")) continue;
    const agentId = entry.name.slice(0, -".info.json".length);
    if (!AGENT_ID_PATTERN.test(agentId)) continue;
    const info = readInfoFile(path.join(directory, entry.name));
    const agentEntries = entries.filter((candidate) => candidate.isFile() && isAgentArtifact(candidate.name, agentId));
    let latest = Math.max(info?.lastActivity ?? 0, info?.updatedAt ?? 0, info?.createdAt ?? 0);
    for (const candidate of agentEntries) {
      try { latest = Math.max(latest, fs.statSync(path.join(directory, candidate.name)).mtimeMs); } catch {}
    }
    if (isRunActive(agentId) || latest >= cutoff) continue;
    let failed = false;
    for (const candidate of agentEntries.filter((candidate) => candidate.name !== entry.name)) {
      try { fs.rmSync(path.join(directory, candidate.name), { force: true }); } catch { failed = true; }
    }
    if (failed) continue;
    try { fs.rmSync(path.join(directory, entry.name), { force: true }); } catch {}
  }

  for (const entry of entries) {
    if (!entry.isFile() || !TASK_LOCK_PATTERN.test(entry.name)) continue;
    const lockFile = path.join(directory, entry.name);
    try {
      if (fs.statSync(lockFile).mtimeMs >= cutoff) continue;
      const owner = JSON.parse(fs.readFileSync(lockFile, "utf8")) as { pid?: number };
      if (typeof owner.pid === "number" && processAlive(owner.pid)) continue;
    } catch {}
    try { fs.rmSync(lockFile, { force: true }); } catch {}
  }

  try { fs.rmdirSync(directory); } catch {}
}

function pruneRunsRoot(root: string, cutoff: number): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.name === "_outputs" && entry.isDirectory()) {
      let outputs: fs.Dirent[];
      try { outputs = fs.readdirSync(target, { withFileTypes: true }); } catch { continue; }
      for (const output of outputs) {
        if (!output.isFile() || !OUTPUT_FILE_PATTERN.test(output.name)) continue;
        const outputPath = path.join(target, output.name);
        try {
          if (fs.statSync(outputPath).mtimeMs < cutoff) fs.rmSync(outputPath, { force: true });
        } catch {}
      }
      continue;
    }
    if (!entry.isDirectory() || !SCOPE_DIR_PATTERN.test(entry.name)) continue;
    try { pruneScope(target, cutoff); } catch {}
  }
}

export function pruneExpiredRuns(): void {
  const retentionDays = loadSubagentConfig().retentionDays ?? DEFAULT_RETENTION_DAYS;
  if (retentionDays === 0) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const root of runsRoots()) pruneRunsRoot(root, cutoff);
}

export function parentScopeKey(parentSessionId: string): string {
  return createHash("sha256").update(parentSessionId).digest("hex").slice(0, 24);
}

export function taskStorageKey(taskName: string): string {
  return createHash("sha256").update(taskName).digest("hex").slice(0, 24);
}

function runsRoots(): string[] {
  return [...new Set([getRunsDir(), LEGACY_RUNS_DIR])];
}

export function scopeDir(parentSessionId: string): string {
  return path.join(getRunsDir(), parentScopeKey(parentSessionId));
}

function scopeDirs(parentSessionId: string): string[] {
  const key = parentScopeKey(parentSessionId);
  return runsRoots().map((root) => path.join(root, key));
}

export function saveInfo(info: AgentInfo): void {
  fs.mkdirSync(path.dirname(info.infoFile), { recursive: true });
  info.updatedAt = Date.now();
  const temporary = `${info.infoFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(info, null, 2));
  fs.renameSync(temporary, info.infoFile);
}

export function readInfoFile(file: string): AgentInfo | undefined {
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8")) as Omit<AgentInfo, "status"> & { status: AgentRuntimeStatus | "closed"; closedAt?: number };
    if (info.status === "closed") {
      info.status = info.error ? "failed" : info.finalResponse !== undefined ? "completed" : "interrupted";
      delete info.closedAt;
    }
    return info as AgentInfo;
  } catch {
    return undefined;
  }
}

function readInfos(directory: string): AgentInfo[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".info.json"))
    .flatMap((name) => {
      const info = readInfoFile(path.join(directory, name));
      return info && typeof info.id === "string" && AGENT_ID_PATTERN.test(info.id) ? [info] : [];
    });
}

function sortInfos(infos: AgentInfo[]): AgentInfo[] {
  return infos.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export function readScopeInfos(parentSessionId: string): AgentInfo[] {
  return sortInfos(scopeDirs(parentSessionId).flatMap(readInfos));
}

export function readAllInfos(): AgentInfo[] {
  const directories = runsRoots().flatMap((root) => {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SCOPE_DIR_PATTERN.test(entry.name))
      .map((entry) => path.join(root, entry.name));
  });
  return sortInfos(directories.flatMap(readInfos));
}

export function getAgent(name: string, parentSessionId: string): AgentInfo | null {
  const taskName = normalizeTaskName(name);
  return readScopeInfos(parentSessionId).find((info) => info.taskName === taskName) ?? null;
}

export function writeFullToolOutput(content: string): string {
  const directory = path.join(getRunsDir(), "_outputs");
  ensurePrivateDir(directory, true);
  const file = path.join(directory, `${Date.now()}-${randomUUID()}.txt`);
  fs.writeFileSync(file, content);
  return file;
}
