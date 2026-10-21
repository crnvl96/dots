import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { WebToolsConfig } from './config.ts';
import { WebToolsError, type ProviderId } from './contracts.ts';
import { providerId, type ProviderRegistry } from './providers/index.ts';
import { providerContext } from './tools.ts';
import { isRecord } from './transport.ts';

export const SELECTION_ENTRY = 'web-tools-provider';
export function registerSelection(pi: ExtensionAPI, config: WebToolsConfig, providers: ProviderRegistry) {
  let selected = providerId(config.defaultProvider, providers);
  let selectionError: Error | undefined;
  pi.registerFlag('web-provider', { type: 'string', description: 'Web provider for sessions without a saved override: openrouter | perplexity' });
  function defaultId() { return providerId(pi.getFlag('web-provider') ?? config.defaultProvider, providers); }
  function showStatus(ctx: ExtensionContext) {
    if (ctx.mode === 'tui') ctx.ui.setStatus('web-tools', selectionError ? 'web: configuration error' : `web: ${selected}`);
  }
  function restore(ctx: ExtensionContext) {
    try {
      const saved = ctx.sessionManager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === SELECTION_ENTRY).at(-1);
      if (saved?.type === 'custom') {
        if (!isRecord(saved.data) || !Object.hasOwn(saved.data, 'provider')) {
          throw new WebToolsError('configuration', 'Invalid saved web provider selection. Use /web provider <id> or reset.');
        }
        selected = saved.data.provider === null ? defaultId() : providerId(saved.data.provider, providers);
      } else {
        selected = defaultId();
      }
      selectionError = undefined;
    } catch (error) {
      // Do not silently send queries to a different provider on invalid config.
      selectionError = error instanceof Error ? error : new WebToolsError('configuration', 'Invalid web provider selection.');
      if (ctx.hasUI) ctx.ui.notify(selectionError.message, 'error');
    }
    showStatus(ctx);
  }
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));
  pi.registerCommand('web', {
    description: 'Web provider: /web status | /web provider [openrouter|perplexity|reset]. Selection is saved in this session branch.',
    getArgumentCompletions(prefix) {
      return ['status', 'provider', 'provider openrouter', 'provider perplexity', 'provider reset']
        .filter(value => value.startsWith(prefix)).map(value => ({ value, label: value }));
    },
    async handler(args, ctx) {
      const respond = (message: string, error = false) => {
        if (ctx.hasUI) ctx.ui.notify(message, error ? 'error' : 'info');
        else pi.sendMessage({ customType: 'web-tools-status', content: message, display: true });
      };
      try {
        const words = args.trim().split(/\s+/).filter(Boolean);
        if (!words.length || (words.length === 1 && words[0] === 'status')) {
          if (selectionError) throw selectionError;
          respond(`Web provider: ${selected}. Recency filter: ${providers[selected].capabilities.recencyFilter ? 'supported' : 'unsupported'}. Both web_search and web_fetch use this provider. Configure defaults in web-tools/config.ts.`);
          return;
        }
        if (words[0] !== 'provider' || words.length > 2) throw new WebToolsError('invalid_input', 'Usage: /web status | /web provider [openrouter|perplexity|reset]');
        let choice = words[1];
        if (!choice) {
          if (!ctx.hasUI) throw new WebToolsError('invalid_input', 'Specify a provider in noninteractive mode: /web provider openrouter|perplexity|reset');
          choice = await ctx.ui.select('Web provider (search + fetch)', [...Object.keys(providers), 'reset']) ?? '';
          if (!choice) return;
        }
        // Commands can wait for an active turn. No request gets half-switched.
        await ctx.waitForIdle();
        const next = choice === 'reset' ? defaultId() : providerId(choice, providers);
        await providers[next].validate(providerContext(ctx));
        pi.appendEntry(SELECTION_ENTRY, { provider: choice === 'reset' ? null : next });
        selected = next;
        selectionError = undefined;
        showStatus(ctx);
        respond(`Web provider: ${selected}. Saved for this session branch; applies to both web_search and web_fetch.`);
      } catch (error) {
        respond(error instanceof WebToolsError ? error.message : 'Could not change web provider. Check configuration and credentials.', true);
      }
    },
  });
  return () => {
    if (selectionError) throw selectionError;
    return providers[selected];
  };
}
