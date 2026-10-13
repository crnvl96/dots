import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { randomUUID } from "node:crypto";
import { SOCKET_DIR, ensurePrivateDir } from "./paths.js";
import { clearActive, getSocketPath, markActive } from "./process.js";
import { RpcAssistantStreamState, type RpcAssistantStreamStatus } from "./stream.js";
import type { PeekMarker } from "./types.js";

export class SessionLogger {
  private stream: fs.WriteStream | null = null;
  constructor(private readonly file: string) {}
  write(level: string, category: string, message: string, data?: any): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!this.stream) {
      const stream = fs.createWriteStream(this.file, { flags: "a" });
      stream.on("error", () => {
        if (this.stream === stream) this.stream = null;
      });
      this.stream = stream;
    }
    this.stream.write(JSON.stringify({ ts: new Date().toISOString(), level, category, message, ...(data !== undefined ? { data } : {}) }) + "\n");
    if (process.env.PI_SUBAGENT_DEBUG) console.error(`[${level}] ${category}: ${message}`, data ?? "");
  }
  info(category: string, message: string, data?: any): void { this.write("INFO", category, message, data); }
  stderr(chunk: string): void { this.write("STDERR", "pi-process", chunk.trim()); }
  close(): void { this.stream?.end(); this.stream = null; }
}

export class EventBroadcaster {
  private server: net.Server | null = null;
  private connections: net.Socket[] = [];
  private readonly marker: PeekMarker = { pid: process.pid, startedAt: Date.now(), token: randomUUID() };
  private status: RpcAssistantStreamStatus | "tool" | "done" = "thinking";
  private toolName?: string;
  private readonly assistantStream = new RpcAssistantStreamState();
  private userMessage: any = null;
  private readonly activeTools = new Map<string, { toolCallId: string; toolName: string; args: any; partialResult?: any; result?: any; isError?: boolean }>();

  constructor(private readonly agentId: string) {}

  start(): void {
    try {
      ensurePrivateDir(SOCKET_DIR, true);
      markActive(this.agentId, "active", this.marker);
    } catch (error) {
      clearActive(this.agentId, "active");
      throw error;
    }
    const socketPath = getSocketPath(this.agentId);
    if (process.platform !== "win32") {
      try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch {}
    }
    this.server = net.createServer((connection) => {
      this.connections.push(connection);
      try {
        connection.write(JSON.stringify({
          type: "sync",
          status: this.status,
          toolName: this.toolName,
          partialMessage: this.assistantStream.message,
          toolArguments: this.assistantStream.snapshotToolArguments(),
          userMessage: this.userMessage,
          activeTools: [...this.activeTools.values()],
        }) + "\n");
      } catch {}
      const remove = () => { this.connections = this.connections.filter((candidate) => candidate !== connection); };
      connection.on("close", remove);
      connection.on("error", remove);
    });
    this.server.on("listening", () => markActive(this.agentId, "peek", this.marker));
    this.server.on("error", () => this.stopSocket());
    try { this.server.listen(socketPath); } catch { this.stopSocket(); }
  }

  broadcast(event: any): void {
    if (event.type === "message_start" && event.message?.role === "user") {
      this.userMessage = event.message;
    } else if (event.type === "message_start" && event.message?.role === "assistant") {
      this.assistantStream.start(event.message);
      this.status = "thinking";
    } else if (event.type === "message_update") {
      this.assistantStream.update(event.assistantMessageEvent, event.message);
      this.status = this.assistantStream.status;
    } else if (event.type === "tool_execution_start") {
      this.status = "tool";
      this.toolName = event.toolName;
      if (event.toolCallId) {
        this.activeTools.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
      }
    } else if (event.type === "tool_execution_update" && event.toolCallId) {
      const active = this.activeTools.get(event.toolCallId);
      if (active) active.partialResult = event.partialResult;
    } else if (event.type === "tool_execution_end" && event.toolCallId) {
      const active = this.activeTools.get(event.toolCallId);
      if (active) {
        active.result = event.result;
        active.isError = event.isError ?? false;
      }
    } else if (event.type === "message_end") {
      if (event.message?.role === "assistant") this.assistantStream.finish(event.message);
      if (event.message?.role === "toolResult" && event.message.toolCallId) {
        this.activeTools.delete(event.message.toolCallId);
      }
      this.assistantStream.clear();
      this.userMessage = null;
    } else if (event.type === "agent_settled") {
      this.assistantStream.clear();
      this.userMessage = null;
      this.activeTools.clear();
      this.status = "done";
      this.toolName = undefined;
    }
    const line = JSON.stringify(event) + "\n";
    for (const connection of this.connections) {
      try { connection.write(line); } catch {}
    }
  }

  private stopSocket(): void {
    clearActive(this.agentId, "peek", this.marker);
    for (const connection of this.connections) {
      try { connection.destroy(); } catch {}
    }
    this.connections = [];
    try { this.server?.close(); } catch {}
    this.server = null;
    if (process.platform !== "win32") {
      try { if (fs.existsSync(getSocketPath(this.agentId))) fs.unlinkSync(getSocketPath(this.agentId)); } catch {}
    }
  }

  stop(): void {
    clearActive(this.agentId, "active", this.marker);
    this.stopSocket();
  }
}
