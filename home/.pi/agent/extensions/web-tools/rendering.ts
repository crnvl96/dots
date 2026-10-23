import type { Theme } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { resultInput, type Operation, type ToolResultData } from './contracts.ts';

export interface Details {
  operation: Operation;
  result?: ToolResultData;
}
export function progressText(operation: Operation): string {
  return `${operation === 'search' ? 'Searching' : 'Fetching'} with Perplexity…`;
}
export function renderCall(operation: Operation, input: string | undefined, theme: Theme) {
  return new Text(theme.fg('toolTitle', theme.bold(`web_${operation} `)) + theme.fg('accent', input ?? ''), 0, 0);
}
export function renderResult(
  output: { details?: Details; isError?: boolean },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
) {
  const { details } = output;
  if (options.isPartial) return new Text(theme.fg('warning', progressText(details?.operation ?? 'search')), 0, 0);
  const result = details?.result;
  if (!result) return new Text(theme.fg('error', 'Web retrieval failed'), 0, 0);
  const failed = output.isError || result.status === 'error';
  const missing = result.status === 'not_found';
  const summary = failed ? `Web retrieval failed: ${result.error?.message ?? 'provider reported an error'}`
    : missing ? 'No relevant content found'
    : result.operation === 'search'
      ? `${result.results.length} result(s)`
      : result.content === null ? 'No matching provider excerpt'
        : `Retrieved ${result.title ?? result.url} (${result.content.length.toLocaleString()} provider-excerpt characters)`;
  let text = theme.fg(failed ? 'error' : missing ? 'warning' : 'success', summary);
  if (result.full_output_path) text += theme.fg('warning', ' (truncated)');
  if (options.expanded) {
    text += `\n${theme.fg('dim', resultInput(result))}`;
    for (const [i, source] of result.sources.entries()) text += `\n${theme.fg('muted', `${i + 1}. ${source.title}`)}\n${theme.fg('dim', `   ${source.url}`)}`;
    for (const warning of result.warnings) text += `\n${theme.fg('warning', warning)}`;
    if ((failed || missing) && result.report) text += `\n${theme.fg('muted', result.report)}`;
    text += `\n${theme.fg('dim', `Evidence: ${result.metadata.retrieval_evidence}`)}`;
    if (result.metadata.model) text += `\n${theme.fg('dim', `Model: ${result.metadata.model}`)}`;
    if (result.metadata.cost_usd !== null) text += `\n${theme.fg('dim', `API cost: $${result.metadata.cost_usd.toFixed(6)}`)}`;
    if (result.full_output_path) text += `\n${theme.fg('dim', `Full output: ${result.full_output_path}`)}`;
  }
  return new Text(text, 0, 0);
}
