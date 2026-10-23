import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { truncateHead, withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import type { WebToolsConfig } from './config.ts';
import type { RetrievalResult } from './contracts.ts';
import { untrustedWarning } from './prompts.ts';

export function formatResult(result: RetrievalResult): string {
  const input = result.operation === 'search' ? result.query : result.url;
  const parts = [untrustedWarning, '', `# Web ${result.operation}`, `Input: ${input}`, `Status: ${result.status}`];
  if (result.error) parts.push(`Error (${result.error.code}): ${result.error.message}`);
  for (const warning of result.warnings) parts.push(`Warning: ${warning}`);
  parts.push(`Retrieval evidence: ${result.metadata.retrieval_evidence}`, `Source order: ${result.metadata.result_order}`);
  parts.push('', '## Provider source excerpts');
  if (!result.sources.length) parts.push('No provider source excerpts returned.');
  for (const [i, source] of result.sources.entries()) {
    parts.push(`### ${i + 1}. ${source.title}`, `URL: ${source.url}`);
    if (source.date) parts.push(`Published: ${source.date}`);
    if (source.last_updated) parts.push(`Updated: ${source.last_updated}`);
    parts.push('', source.snippet ?? '(No excerpt provided.)', '');
  }
  if (result.operation === 'fetch' && result.content === null) parts.push('No provider excerpt matched the requested URL; any notes below are model-written, not verified page text.');
  if (result.report !== null) parts.push('', '## Model-written fetch notes', result.report);
  return parts.join('\n');
}
export async function formatAndTruncate(result: RetrievalResult, limits: WebToolsConfig['output']) {
  const full = formatResult(result);
  const truncated = truncateHead(full, limits);
  if (!truncated.truncated) return { text: full, full_output_path: null };
  const directory = await mkdtemp(join(tmpdir(), 'pi-web-tools-'));
  const path = join(directory, 'output.md');
  await withFileMutationQueue(path, () => writeFile(path, full, { encoding: 'utf8', mode: 0o600 }));
  return { text: `${truncated.content}\n\n[Output truncated to ${limits.maxLines} lines/${limits.maxBytes} bytes. Full output: ${path}]`, full_output_path: path };
}
