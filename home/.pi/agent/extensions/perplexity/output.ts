// Keep Pi's output limits and persist complete Markdown only when truncated.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
  type TruncationResult,
} from '@earendil-works/pi-coding-agent';

interface TruncatedOutput {
  text: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export async function truncateOutput(output: string, filePrefix: string): Promise<TruncatedOutput> {
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
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
