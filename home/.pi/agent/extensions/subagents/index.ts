import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { bindDashboard } from './dashboard.ts';
import { createRuntime } from './runtime.ts';
import { registerTools } from './tools.ts';

// Pi discovers only this entry point.
export default function subagents(pi: ExtensionAPI) {
  const runtime = createRuntime(pi);
  bindDashboard(pi, runtime);
  registerTools(pi, runtime);
}
