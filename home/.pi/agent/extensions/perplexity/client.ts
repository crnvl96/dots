// Shared transport: credentials, cancellation, JSON validation, and API errors.
const DEFAULT_API_BASE_URL = 'https://api.perplexity.ai';
const REQUEST_TIMEOUT_MS = 60_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getApiKey(): string {
  const apiKey = process.env.PERPLEXITY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY is not set. Export it in the environment that starts pi, then restart pi.');
  }
  return apiKey;
}

function getApiBaseUrl(): string {
  return (process.env.PERPLEXITY_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export function describeApiError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;

  if (typeof payload.error === 'string') return payload.error;
  if (isRecord(payload.error) && typeof payload.error.message === 'string') return payload.error.message;
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.detail === 'string') return payload.detail;
  if (Array.isArray(payload.detail)) {
    const messages = payload.detail
      .map((entry) => (isRecord(entry) && typeof entry.msg === 'string' ? entry.msg : undefined))
      .filter((entry): entry is string => Boolean(entry));
    if (messages.length > 0) return messages.join('; ');
  }
  return fallback;
}

export async function postJson(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: requestSignal(signal),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Perplexity request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  }

  const raw = await response.text();
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const fallback = raw.trim().slice(0, 1_000) || response.statusText || 'Unknown API error';
    throw new Error(`Perplexity API error ${response.status}: ${describeApiError(payload, fallback)}`);
  }
  if (!isRecord(payload)) throw new Error('Perplexity returned an invalid JSON response.');
  return payload;
}
