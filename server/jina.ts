// FILE: server/jina.ts
import axios from "axios";
import type { JobSearchItem } from "./serper";

const JINA_RERANK_URL = "https://api.jina.ai/v1/rerank";
const JINA_MODEL = "jina-reranker-v2-base-multilingual";

type JinaRerankResp = {
  results?: Array<{ index: number; relevance_score: number }>;
};

// ✅ NEW: this is what server/routes.ts expects
export async function rerankWithJina(params: {
  query: string;
  documents: string[];
  topN?: number;
}): Promise<Array<{ index: number; relevance_score: number }>> {
  const key = process.env.JINA_API_KEY;
  if (!key) return [];

  const docs = Array.isArray(params.documents) ? params.documents : [];
  if (docs.length === 0) return [];

  const body = {
    model: JINA_MODEL,
    query: String(params.query || "").slice(0, 400),
    documents: docs.map((d) => String(d || "").slice(0, 2000)),
    top_n: Math.min(params.topN ?? 20, docs.length),
  };

  const res = await axios.post<JinaRerankResp>(JINA_RERANK_URL, body, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    timeout: 15000,
  });

  return Array.isArray(res.data?.results) ? res.data.results : [];
}

// (kept) If you still want a helper that returns the jobs sorted:
export async function rerankJobsWithJina(params: {
  query: string;
  jobs: JobSearchItem[];
}): Promise<JobSearchItem[]> {
  const jobs = Array.isArray(params.jobs) ? params.jobs : [];
  if (jobs.length <= 1) return jobs;

  const documents = jobs.map((j) => {
    const t = String(j.title || "");
    const c = String(j.company || "");
    const l = String(j.location || "");
    const d = String(j.description || "");
    return `${t}\n${c}\n${l}\n${d}`.slice(0, 1800);
  });

  const ranked = await rerankWithJina({
    query: String(params.query || ""),
    documents,
    topN: Math.min(20, documents.length),
  });

  if (ranked.length === 0) return jobs;

  const byIndex = new Map<number, number>();
  for (const r of ranked) byIndex.set(r.index, r.relevance_score);

  // stable sort by score
  return jobs
    .map((j, idx) => ({ j, idx, score: byIndex.get(idx) ?? -1 }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.j);
}
