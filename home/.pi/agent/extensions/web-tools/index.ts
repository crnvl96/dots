import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { config } from './config.ts';
import { createProviders } from './providers/index.ts';
import { registerSelection } from './selection.ts';
import { registerTools } from './tools.ts';

// Pi discovers only this entry point. All knobs are in the commented config.ts.
export default function webTools(pi: ExtensionAPI) {
  const providers = createProviders(config);
  const selectedProvider = registerSelection(pi, config, providers);
  registerTools(pi, config, selectedProvider);
}
