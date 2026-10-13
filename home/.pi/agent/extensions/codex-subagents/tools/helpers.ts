// Target parsing and session identity are shared by tools and the browser.
export function cleanTarget(target: string): string {
  return target.trim().replace(/^\/+/, "");
}

export function parseTargets(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((target) => cleanTarget(String(target))).filter(Boolean) : undefined;
}

export function parentSessionId(ctx: any): string {
  const id = ctx?.sessionManager?.getSessionId?.();
  if (!id) throw new Error("The parent Pi session has no session id.");
  return String(id);
}
