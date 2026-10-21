import type { WebToolsConfig } from '../config.ts';
import { WebToolsError, type ProviderId, type WebProvider } from '../contracts.ts';
import { createOpenRouterProvider } from './openrouter.ts';
import { createPerplexityProvider } from './perplexity.ts';

export type ProviderRegistry = Record<ProviderId, WebProvider>;
export function createProviders(config: WebToolsConfig): ProviderRegistry {
  return { openrouter: createOpenRouterProvider(config.openrouter), perplexity: createPerplexityProvider(config.perplexity) };
}
export function providerId(value: unknown, providers: ProviderRegistry): ProviderId {
  if (typeof value !== 'string' || !Object.hasOwn(providers, value)) {
    throw new WebToolsError('configuration', `Unknown web provider. Choose: ${Object.keys(providers).join(', ')}.`);
  }
  return value as ProviderId;
}
