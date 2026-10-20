import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerFetchTool } from './fetch.ts';
import { registerSearchTool } from './search.ts';

export type { PerplexityFetchInput } from './fetch.ts';
export type { PerplexitySearchInput } from './search.ts';

export default function perplexityExtension(pi: ExtensionAPI) {
  registerSearchTool(pi);
  registerFetchTool(pi);
}
