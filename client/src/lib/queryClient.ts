// FILE: client/src/lib/queryClient.ts
import { QueryClient } from "@tanstack/react-query";

async function readTextSafe(res: Response) {
  return await res.text().catch(() => "");
}

function looksLikeHtml(s: string) {
  const t = (s || "").trim().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

function isBinaryContentType(ct: string) {
  const t = (ct || "").toLowerCase();
  return (
    t.includes("application/pdf") ||
    t.includes("application/octet-stream") ||
    t.includes("application/zip") ||
    t.startsWith("image/")
  );
}

/**
 * ✅ Stable API helper (FIXED):
 * - Always includes credentials
 * - Produces clean error messages
 * - Detects HTML (SPA fallback / proxy / wrong route) and fails fast
 * - ✅ Allows binary responses (PDF) without consuming body
 * - ✅ Never consumes body on successful JSON responses
 */
export async function apiRequest(method: string, url: string, body?: any) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  // ✅ If OK and binary (PDF download, etc.), return as-is.
  // Caller will do res.blob().
  if (res.ok && isBinaryContentType(contentType)) {
    return res;
  }

  // ✅ If OK and JSON -> return as-is.
  // Caller will do res.json().
  if (res.ok && contentType.includes("application/json")) {
    return res;
  }

  // ❌ If not OK: read body ONCE to create a useful error, then throw.
  if (!res.ok) {
    const raw = await readTextSafe(res);

    // HTML usually indicates route/proxy fallback
    if (looksLikeHtml(raw)) {
      throw new Error(
        `Server returned HTML instead of JSON. This usually means the API route is missing or misrouted: ${method} ${url}`,
      );
    }

    // Try parse JSON error
    try {
      const j = JSON.parse(raw);
      throw new Error(j?.error || j?.message || raw || `Request failed: ${res.status}`);
    } catch {
      throw new Error(raw || `Request failed: ${res.status}`);
    }
  }

  // ✅ OK but NOT JSON (and not binary): this is a client/server mismatch.
  // Read body only to detect HTML and provide a clear message, then throw.
  // ✅ Allow PDF/binary responses without consuming body
if (res.ok && contentType.toLowerCase().includes("application/pdf")) {
  return res;
}
  const raw = await readTextSafe(res);

  if (looksLikeHtml(raw)) {
    throw new Error(
      `Server returned HTML instead of JSON. This usually means the API route is missing or misrouted: ${method} ${url}`,
    );
  }

  // If it's plain text or something unexpected, throw with the content-type
  throw new Error(`Expected JSON but got "${contentType}". Endpoint: ${method} ${url}`);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});
