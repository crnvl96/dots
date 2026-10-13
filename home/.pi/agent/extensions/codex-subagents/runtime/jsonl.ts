// Incremental UTF-8 decoding; RPC records are separated by LF, not Unicode separators.
import { StringDecoder } from "node:string_decoder";

export class RpcJsonlDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";

  push(chunk: Buffer | string): string[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    const lines: string[] = [];
    while (true) {
      const index = this.buffer.indexOf("\n");
      if (index === -1) break;
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lines.push(line);
    }
    return lines;
  }

  end(): string[] {
    this.buffer += this.decoder.end();
    if (!this.buffer) return [];
    const line = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
    this.buffer = "";
    return [line];
  }
}
