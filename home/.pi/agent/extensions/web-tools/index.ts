import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { config } from './config.ts';
import { createPerplexity } from './perplexity.ts';
import { registerTools } from './tools.ts';

// Pi discovers only this entry point. All knobs are in the commented config.ts.
export default function webTools(pi: ExtensionAPI) {
  registerTools(pi, config, createPerplexity(config.perplexity));
}
