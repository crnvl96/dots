import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const PACKAGE_BASENAME = "pi-codex-subagents";
export const SUBAGENT_DIR = path.join(getAgentDir(), PACKAGE_BASENAME);
export const CONFIG_PATH = path.join(SUBAGENT_DIR, "config.json");
export const SYSTEM_PROMPT_PATH = path.join(SUBAGENT_DIR, "SYSTEM.md");
export const AGENTS_DIR = path.join(SUBAGENT_DIR, "agents");
const TEMP_ROOT = path.join(process.env.PI_SUBAGENT_TEMP_DIR || os.tmpdir(), PACKAGE_BASENAME, os.userInfo().username);
export const LEGACY_RUNS_DIR = path.join(TEMP_ROOT, "runs");
export const SOCKET_DIR = path.join(TEMP_ROOT, "sockets");

export function ensurePrivateDir(directory: string, enforceMode = false): void {
  const existed = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32" && (enforceMode || !existed)) fs.chmodSync(directory, 0o700);
}
