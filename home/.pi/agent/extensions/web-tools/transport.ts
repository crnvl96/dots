import { WebToolsError } from './contracts.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function normalizeUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new WebToolsError('invalid_input', 'Provide an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new WebToolsError('invalid_input', 'Only HTTP(S) URLs without embedded credentials are supported.');
  }
  return url.href;
}

/**
 * One request, no retries. Never forward credentials through a redirect.
 * Callers pass a validated URL, a trimmed nonempty key, and a validated timeout.
 */
export async function postJson(options: {
  url: string;
  body: unknown;
  apiKey: string;
  timeoutMs: number;
  signal?: AbortSignal;
  provider: string;
}): Promise<Record<string, unknown>> {
  const { apiKey, timeoutMs, signal, provider } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    combined.throwIfAborted();
    const response = await fetch(options.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body), signal: combined, redirect: 'error',
    });
    const raw = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch {
      throw new WebToolsError(response.ok ? 'invalid_response' : 'http_error',
        `${provider} returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!response.ok || (isRecord(payload) && payload.error)) {
      const error = isRecord(payload) ? payload.error : null;
      const message = typeof error === 'string' ? error
        : isRecord(error) && typeof error.message === 'string' ? error.message
        : isRecord(payload) && typeof payload.message === 'string' ? payload.message : response.statusText;
      // No raw bodies. Scrub the credential even from structured API messages.
      const safe = (message || 'Unknown API error').split(apiKey).join('[REDACTED]').slice(0, 500);
      throw new WebToolsError(response.status === 401 || response.status === 403 ? 'authentication' : 'http_error',
        `${provider} API error (HTTP ${response.status}): ${safe}`);
    }
    if (!isRecord(payload)) throw new WebToolsError('invalid_response', `${provider} returned an invalid response object.`);
    return payload;
  } catch (error) {
    if (signal?.aborted) throw new WebToolsError('cancelled', `${provider} request cancelled.`);
    if (timeout.aborted) throw new WebToolsError('timeout', `${provider} request timed out after ${timeoutMs / 1000} seconds.`);
    if (error instanceof WebToolsError) throw error;
    // Unexpected transport exceptions may contain URLs, headers, or credentials.
    throw new WebToolsError('http_error', `${provider} network request failed.`);
  }
}
