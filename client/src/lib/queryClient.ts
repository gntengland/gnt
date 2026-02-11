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

export async function apiRequest(method: string, url: string, body?: any) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  // ✅ OK + binary (PDF etc.) -> caller handles res.blob()
  if (res.ok && isBinaryContentType(contentType)) {
    return res;
  }

  // ✅ OK + JSON -> caller handles res.json()
  if (res.ok && contentType.includes("application/json")) {
    return res;
  }

  // ❌ Not OK -> read body ONCE and throw useful error
  if (!res.ok) {
    const raw = await readTextSafe(res);

    if (looksLikeHtml(raw)) {
      throw new Error(
        `Server returned HTML instead of JSON. This usually means the API route is missing or misrouted: ${method} ${url}`,
      );
    }

    try {
      const j = JSON.parse(raw);
      throw new Error(j?.error || j?.message || raw || `Request failed: ${res.status}`);
    } catch {
      throw new Error(raw || `Request failed: ${res.status}`);
    }
  }

  // ✅ OK but NOT JSON and NOT binary => mismatch
  // Read body only to detect HTML and provide a clear message, then throw.
  const raw = await readTextSafe(res);

  if (looksLikeHtml(raw)) {
    throw new Error(
      `Server returned HTML instead of JSON. This usually means the API route is missing or misrouted: ${method} ${url}`,
    );
  }

  throw new Error(`Expected JSON but got "${contentType}". Endpoint: ${method} ${url}`);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});
