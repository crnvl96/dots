// Assemble Pi assistant deltas and retain partial tool arguments for peek sync.
import { parseStreamingJson, type AssistantMessage } from "@earendil-works/pi-ai";

export type RpcAssistantStreamStatus = "thinking" | "streaming" | "calling";

export class RpcAssistantStreamState {
  status: RpcAssistantStreamStatus = "thinking";
  message: AssistantMessage | null = null;
  private readonly toolArguments = new Map<number, string>();

  start(message: AssistantMessage): void {
    this.message = message;
    this.status = "thinking";
    this.toolArguments.clear();
  }

  update(delta: any, cumulativeMessage?: AssistantMessage): void {
    if (cumulativeMessage?.role === "assistant") {
      this.message = cumulativeMessage;
    } else if (this.message) {
      this.applyDelta(delta);
    }
    if (delta?.type === "thinking_start" || delta?.type === "thinking_delta" || delta?.type === "thinking_end") {
      this.status = "thinking";
    } else if (delta?.type === "text_start" || delta?.type === "text_delta" || delta?.type === "text_end") {
      this.status = "streaming";
    } else if (delta?.type === "toolcall_start" || delta?.type === "toolcall_delta" || delta?.type === "toolcall_end") {
      this.status = "calling";
    }
  }

  resume(
    message: AssistantMessage,
    status: RpcAssistantStreamStatus,
    toolArguments: Array<[number, string]> = [],
  ): void {
    this.message = message;
    this.status = status;
    this.toolArguments.clear();
    for (const [index, raw] of toolArguments) {
      if (Number.isInteger(index) && index >= 0 && typeof raw === "string") this.toolArguments.set(index, raw);
    }
  }

  snapshotToolArguments(): Array<[number, string]> {
    return [...this.toolArguments.entries()];
  }

  finish(message?: AssistantMessage): void {
    if (message?.role === "assistant") this.message = message;
    this.toolArguments.clear();
  }

  clear(): void {
    this.message = null;
    this.toolArguments.clear();
  }

  private applyDelta(delta: any): void {
    if (!this.message || !Number.isInteger(delta?.contentIndex) || delta.contentIndex < 0) return;
    const index = delta.contentIndex;
    const content = this.message.content as any[];
    if (delta.type === "thinking_start") {
      content[index] = { type: "thinking", thinking: "" };
    } else if (delta.type === "thinking_delta") {
      const block = content[index]?.type === "thinking" ? content[index] : { type: "thinking", thinking: "" };
      block.thinking += typeof delta.delta === "string" ? delta.delta : "";
      content[index] = block;
    } else if (delta.type === "thinking_end") {
      content[index] = { type: "thinking", thinking: typeof delta.content === "string" ? delta.content : "" };
    } else if (delta.type === "text_start") {
      content[index] = { type: "text", text: "" };
    } else if (delta.type === "text_delta") {
      const block = content[index]?.type === "text" ? content[index] : { type: "text", text: "" };
      block.text += typeof delta.delta === "string" ? delta.delta : "";
      content[index] = block;
    } else if (delta.type === "text_end") {
      content[index] = { type: "text", text: typeof delta.content === "string" ? delta.content : "" };
    } else if (delta.type === "toolcall_start") {
      this.toolArguments.set(index, "");
      content[index] = { type: "toolCall", id: `streaming-${index}`, name: "tool", arguments: {} };
    } else if (delta.type === "toolcall_delta") {
      const raw = `${this.toolArguments.get(index) ?? ""}${typeof delta.delta === "string" ? delta.delta : ""}`;
      this.toolArguments.set(index, raw);
      const block = content[index]?.type === "toolCall"
        ? content[index]
        : { type: "toolCall", id: `streaming-${index}`, name: "tool", arguments: {} };
      block.arguments = parseStreamingJson(raw);
      content[index] = block;
    } else if (delta.type === "toolcall_end" && delta.toolCall?.type === "toolCall") {
      this.toolArguments.delete(index);
      content[index] = delta.toolCall;
    }
  }
}
