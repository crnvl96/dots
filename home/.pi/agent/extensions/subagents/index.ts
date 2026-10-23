import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { bindMenu } from './menu.ts';
import { registerAgentCatalog } from './catalog.ts';
import { createRuntime } from './runtime.ts';
import { registerTools } from './tools.ts';

// Pi discovers only this entry point.
export default function subagents(pi: ExtensionAPI) {
  const runtime = createRuntime(pi);
  bindMenu(runtime);
  registerTools(pi, runtime);
  registerAgentCatalog(pi);
}
