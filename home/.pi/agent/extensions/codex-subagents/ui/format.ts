// Plain-text labels shared by the browser and detail overlay.
import type { AgentInfo } from "../runtime/types.js";

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function runtimeLabel(info: AgentInfo): string {
  const start = info.startedAt || info.createdAt;
  const final = ["completed", "failed", "interrupted"].includes(info.status);
  const end = final ? (info.completedAt || info.updatedAt || Date.now()) : Date.now();
  return formatDuration(end - start);
}

const OSC133_PROMPT_MARKER_RE = /\x1b\]133;[ABC]\x07/g;

export function stripPromptMarkers(lines: string[]): string[] {
  return lines.map((line) => line.replace(OSC133_PROMPT_MARKER_RE, ""));
}

export function formatAgentSpecLines(info: Pick<AgentInfo, "provider" | "modelId" | "thinking">): string[] {
  return [
    `Model: ${info.provider}/${info.modelId}`,
    `Thinking: ${info.thinking || "off"}`,
  ];
}
