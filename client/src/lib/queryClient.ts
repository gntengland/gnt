// FILE: client/src/lib/queryClient.ts
import { QueryClient } from "@tanstack/react-query";

async function readTextSafe(res: Response) {
  return await res.text().catch(() => "");
}

function looksLikeHtml(s: string) {
  const t = (s || "").trim().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

function isProbablyBinary(contentType: string) {
  const ct = (contentType || "").toLowerCase();

  // ✅ allow binary types (PDF downloads etc.)
  if (ct.includes("application/pdf")) return true;
  if (ct.includes("application/octet-stream")) return true;

  // images
  if (ct.startsWith("image/")) return true;

  // other binary-ish (safe)
  if (ct.includes("application/zip")) return true;

  return false;
}

/**
 * ✅ Stable API helper:
 * - Always includes credentials
 * - Produces clean error messages
 * - Detects HTML (SPA fallback / proxy / wrong route) and fails fast
 * - ✅ Allows binary responses (e.g., application/pdf) without throwing
 */
export async function apiRequest(method: string, url: string, body?: any) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  // ✅ If response is OK and is binary (PDF, images, etc.), return it directly.
  // Caller will use res.blob() or res.arrayBuffer().
  if (res.ok && isProbablyBinary(contentType)) {
    return res;
  }

  // For JSON/text OR for errors we read text to:
  // - detect HTML fallback
  // - build good error messages
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
    try {
      const j = JSON.parse(raw);
      throw new Error(j?.error || j?.message || raw || `Request failed: ${res.status}`);
    } catch {
      throw new Error(raw || `Request failed: ${res.status}`);
    }
  }

  // ✅ OK responses:
  // If caller expects JSON, they will do res.json().
  // But guard non-JSON ok responses (except empty).
  if (contentType && !contentType.includes("application/json") && raw) {
    throw new Error(`Expected JSON but got "${contentType}". Endpoint: ${method} ${url}`);
  }

  return res;
}

export const queryClient = new QueryClient();
