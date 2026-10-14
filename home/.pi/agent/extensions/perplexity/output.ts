// Truncate model-facing output and persist complete Markdown only when truncated.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatSize,
  truncateHead,
  withFileMutationQueue,
  type TruncationResult,
} from '@earendil-works/pi-coding-agent';

// Deliberately half of Pi's defaults (2000 lines / 50KB) to keep web content lean.
// This is an experiment and easy to revert.
export const OUTPUT_MAX_LINES = 1000;
export const OUTPUT_MAX_BYTES = 25 * 1024;
export const OUTPUT_LIMITS_TEXT = `${OUTPUT_MAX_LINES} lines or ${formatSize(OUTPUT_MAX_BYTES)}`;

interface TruncatedOutput {
  text: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export async function truncateOutput(output: string, filePrefix: string): Promise<TruncatedOutput> {
  const truncation = truncateHead(output, {
    maxLines: OUTPUT_MAX_LINES,
    maxBytes: OUTPUT_MAX_BYTES,
  });
  if (!truncation.truncated) return { text: truncation.content };

  const tempDirectory = await mkdtemp(join(tmpdir(), `pi-${filePrefix}-`));
  const fullOutputPath = join(tempDirectory, 'output.md');
  await withFileMutationQueue(fullOutputPath, () => writeFile(fullOutputPath, output, 'utf8'));

  const text =
    `${truncation.content}\n\n` +
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `Full output saved to: ${fullOutputPath}]`;

  return { text, truncation, fullOutputPath };
}
