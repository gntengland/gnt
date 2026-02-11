// FILE: client/src/lib/queryClient.ts
import { QueryClient } from "@tanstack/react-query";

async function readTextSafe(res: Response) {
  return await res.text().catch(() => "");
}

function looksLikeHtml(s: string) {
  const t = (s || "").trim().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

/**
 * ✅ Stable API helper:
 * - Always includes credentials
 * - Produces clean error messages
 * - Detects HTML (SPA fallback / proxy / wrong route) and fails fast
 */
export async function apiRequest(method: string, url: string, body?: any) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  const raw = await readTextSafe(res);

  // ❌ If server returned HTML, this is almost always:
  // - wrong route / missing route
  // - SPA fallback responding
  // - proxy misrouting
  if (looksLikeHtml(raw)) {
    throw new Error(
      `Server returned HTML instead of JSON. This usually means the API route is missing or misrouted: ${method} ${url}`,
    );
  }

  // If not ok -> show server error (json or text)
  if (!res.ok) {
    // Try parse JSON error
    try {
      const j = JSON.parse(raw);
      throw new Error(j?.error || j?.message || raw || `Request failed: ${res.status}`);
    } catch {
      throw new Error(raw || `Request failed: ${res.status}`);
    }
  }

  // ✅ For OK responses:
  // If caller expects JSON, they will do res.json().
  // But we can pre-guard common mistake: non-json ok response
  if (contentType && !contentType.includes("application/json") && raw) {
    // allow empty responses, but not HTML/text payload
    // return a "fake" Response? no — better to throw with clear message.
    throw new Error(
      `Expected JSON but got "${contentType}". Endpoint: ${method} ${url}`,
    );
  }

  // We consumed body with readTextSafe -> we must return a fresh Response-like object.
  // Easiest stable approach: reconstruct Response from raw.
  return new Response(raw, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});
