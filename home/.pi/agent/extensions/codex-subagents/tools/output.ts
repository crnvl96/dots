import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { writeFullToolOutput } from "../runtime/storage.js";

export function textResult(text: string, details?: any) {
  return { content: [{ type: "text" as const, text }], details };
}

interface BoundedText {
  text: string;
  fullOutputPath?: string;
  truncated?: true;
}

export function boundedText(text: string, maxBytes = DEFAULT_MAX_BYTES, maxLines = DEFAULT_MAX_LINES): BoundedText {
  const truncation = truncateHead(text, { maxBytes, maxLines });
  if (!truncation.truncated) return { text };
  const fullOutputPath = writeFullToolOutput(text);
  const notice = `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
  return { text: truncation.content + notice, fullOutputPath, truncated: true };
}

export function boundedTextResult(text: string, details?: any) {
  const bounded = boundedText(text);
  if (!bounded.truncated) return textResult(bounded.text, details);
  return textResult(bounded.text, { ...details, fullOutputPath: bounded.fullOutputPath, truncated: true });
}
