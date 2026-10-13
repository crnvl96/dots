import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PACKAGE_BASENAME, SOCKET_DIR } from "./paths.js";
import type { ChildProcessOwnership, PeekMarker } from "./types.js";

export function getSocketPath(agentId: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${PACKAGE_BASENAME}-${os.userInfo().username}-${agentId}`
    : path.join(SOCKET_DIR, `${agentId}.sock`);
}

function markerPath(agentId: string, kind: "active" | "peek"): string {
  return path.join(SOCKET_DIR, `${agentId}.${kind}.json`);
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === "EPERM"; }
}

export interface ProcessSnapshot {
  identity: string;
  tokenMatches?: boolean;
}

function hashIdentity(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function inspectProcess(pid: number, token?: string): ProcessSnapshot | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !processAlive(pid)) return undefined;
  try {
    if (process.platform === "linux") {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const startTicks = fields[19];
      const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`);
      if (!startTicks || !commandLine.length) return undefined;
      const environment = token ? fs.readFileSync(`/proc/${pid}/environ`) : undefined;
      return {
        identity: `linux:${startTicks}:${hashIdentity(commandLine)}`,
        ...(token ? { tokenMatches: environment?.includes(Buffer.from(`PI_SUBAGENT_OWNER_TOKEN=${token}\0`)) ?? false } : {}),
      };
    }
    if (process.platform === "win32") {
      const script = `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($null -ne $p) { [Console]::Out.Write($p.CreationDate.ToUniversalTime().Ticks.ToString() + [char]0 + $p.CommandLine) }`;
      const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 3000 });
      const output = result.status === 0 ? result.stdout : "";
      return output ? { identity: `windows:${hashIdentity(output)}` } : undefined;
    }
    // Darwin does not reliably expose another process's environment through ps, even to its parent.
    const canVerifyToken = process.platform !== "darwin";
    const result = spawnSync("ps", [canVerifyToken ? "eww" : "ww", "-p", String(pid), "-o", "lstart=", "-o", "command="], { encoding: "utf8", timeout: 3000 });
    const output = result.status === 0 ? result.stdout.trim() : "";
    if (!output) return undefined;
    return {
      identity: `unix:${hashIdentity(output)}`,
      ...(token && canVerifyToken ? { tokenMatches: output.includes(`PI_SUBAGENT_OWNER_TOKEN=${token}`) } : {}),
    };
  } catch {
    return undefined;
  }
}

export function ownershipMatches(ownership: ChildProcessOwnership): boolean {
  const snapshot = inspectProcess(ownership.pid, ownership.token);
  return snapshot?.identity === ownership.processIdentity && snapshot.tokenMatches !== false;
}

export function markActive(agentId: string, kind: "active" | "peek", marker: PeekMarker): void {
  fs.writeFileSync(markerPath(agentId, kind), JSON.stringify(marker, null, 2));
}

export function clearActive(agentId: string, kind: "active" | "peek", owner?: Pick<PeekMarker, "pid" | "token">): void {
  const file = markerPath(agentId, kind);
  try {
    if (owner && fs.existsSync(file)) {
      const current = JSON.parse(fs.readFileSync(file, "utf8"));
      if (current.pid !== owner.pid || current.token !== owner.token) return;
    }
    fs.unlinkSync(file);
  } catch {}
}

function isActive(agentId: string, kind: "active" | "peek"): boolean {
  const file = markerPath(agentId, kind);
  try {
    if (!fs.existsSync(file)) return false;
    const marker = JSON.parse(fs.readFileSync(file, "utf8")) as PeekMarker;
    if (processAlive(marker.pid)) return true;
    clearActive(agentId, kind, marker);
  } catch {
    clearActive(agentId, kind);
  }
  return false;
}

export function isRunActive(agentId: string): boolean {
  return isActive(agentId, "active") || isActive(agentId, "peek");
}

export function isPeekActive(agentId: string): boolean {
  return isActive(agentId, "peek");
}

export function getPiCommand(): { command: string; prefixArgs: string[] } {
  if (process.env.PI_SUBAGENT_PI_BIN) return { command: process.env.PI_SUBAGENT_PI_BIN, prefixArgs: [] };
  const currentEntry = process.argv[1];
  if (currentEntry && fs.existsSync(currentEntry)) return { command: process.execPath, prefixArgs: [currentEntry] };
  return { command: process.execPath, prefixArgs: [] };
}
