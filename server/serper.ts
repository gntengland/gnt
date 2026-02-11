// FILE: server/serper.ts
import axios from "axios";

const SERPER_ENDPOINT = "https://google.serper.dev/search";

type SiteRule = {
  base: string;
  host: string;
  includeAnyInUrl: string[];
  excludeInUrl: string[];
};

const UK_SITES: SiteRule[] = [
  {
    base: "https://uk.indeed.com",
    host: "uk.indeed.com",
    includeAnyInUrl: ["viewjob", "clk", "rc/clk", "pagead/clk", "job", "cmp"],
    excludeInUrl: ["career-advice", "salaries", "companies", "interview-questions", "insights"],
  },
  {
    base: "https://www.linkedin.com",
    host: "www.linkedin.com",
    includeAnyInUrl: ["jobs/view", "jobs/collections", "jobs/search"],
    excludeInUrl: ["learning", "feed", "posts", "pulse"],
  },
  {
    base: "https://www.reed.co.uk",
    host: "www.reed.co.uk",
    includeAnyInUrl: ["jobs", "job"],
    excludeInUrl: ["career-advice", "salary", "recruiter", "courses", "blog"],
  },
  {
    base: "https://www.glassdoor.co.uk",
    host: "www.glassdoor.co.uk",
    includeAnyInUrl: ["job-listing", "Job"],
    excludeInUrl: ["Reviews", "Salaries", "Interview", "Overview", "Benefits"],
  },
  {
    base: "https://www.cv-library.co.uk",
    host: "www.cv-library.co.uk",
    includeAnyInUrl: ["job", "jobs"],
    excludeInUrl: ["career-advice", "salary-guide", "blog"],
  },
  {
    base: "https://uk.welcometothejungle.com",
    host: "uk.welcometothejungle.com",
    includeAnyInUrl: ["jobs", "job"],
    excludeInUrl: ["companies", "salaries", "magazine", "articles"],
  },
];

function safeTrim(s: any, fallback = "") {
  const t = String(s ?? "").trim();
  return t || fallback;
}

function guessCompanyFromTitle(rawTitle: string) {
  const t = safeTrim(rawTitle);
  const m1 = t.split(" - ");
  if (m1.length >= 2) return m1[m1.length - 1].trim();
  const m2 = t.split(" at ");
  if (m2.length >= 2) return m2[m2.length - 1].trim();
  return "Unknown";
}

function normalizeQuery(q: string) {
  return safeTrim(q).replace(/[,\|]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function buildSiteQuery(rule: SiteRule, q: string) {
  const inurlPart =
    rule.includeAnyInUrl.length > 0
      ? `(${rule.includeAnyInUrl.map((x) => `inurl:${x}`).join(" OR ")})`
      : "";

  const excludePart =
    rule.excludeInUrl.length > 0 ? rule.excludeInUrl.map((x) => `-inurl:${x}`).join(" ") : "";

  const extraExcludes = [
    "-salary",
    "-salaries",
    "-wage",
    "-review",
    "-reviews",
    "-interview",
    "-interviews",
    "-blog",
    "-article",
    "-articles",
    "-guide",
    "-guides",
  ].join(" ");

  const rolePart = q.length <= 80 ? `"${q}"` : q;

  // ✅ UK-only hint (keeps results inside UK, but still allows Remote UK)
  const ukHint = `(UK OR "United Kingdom" OR "Remote UK" OR "Remote (UK)")`;

  // ✅ Always include the word "job" to avoid getting advice pages.
  // ✅ We still DO NOT inject city names (London, etc.) – those can over-filter.
  return `site:${rule.host} ${inurlPart} (${rolePart}) ${ukHint} job ${excludePart} ${extraExcludes}`.replace(
    /\s{2,}/g,
    " ",
  );
}

function looksLikeJobPosting(url: string, rule: SiteRule) {
  try {
    const u = new URL(url);

    // Serper can return variations like www.* or m.*. Accept host if it matches
    // rule host, or is the same root domain.
    const host = String(u.host || "").toLowerCase();
    const ruleHost = String(rule.host || "").toLowerCase();

    const hostNoWww = host.replace(/^www\./, "");
    const ruleNoWww = ruleHost.replace(/^www\./, "");

    const hostOk =
      host === ruleHost ||
      hostNoWww === ruleNoWww ||
      hostNoWww.endsWith("." + ruleNoWww) ||
      ruleNoWww.endsWith("." + hostNoWww);

    if (!hostOk) return false;

    const path = (u.pathname + " " + u.search).toLowerCase();

    for (const bad of rule.excludeInUrl) {
      if (path.includes(String(bad).toLowerCase())) return false;
    }

    // at least one "job-like" token exists in URL
    return rule.includeAnyInUrl.some((tok) => path.includes(String(tok).toLowerCase()));
  } catch {
    return false;
  }
}

export type JobSearchItem = {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  date?: string;
};

export async function searchJobsUK(params: { query: string; location: string }): Promise<JobSearchItem[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY is missing");

  const q = normalizeQuery(safeTrim(params.query, "Software Engineer"));
  const loc = safeTrim(params.location, "Worldwide");

  const all: JobSearchItem[] = [];
  const seen = new Set<string>();

  for (const rule of UK_SITES) {
    const query = buildSiteQuery(rule, q);

    const res = await axios.post(
      SERPER_ENDPOINT,
      {
        q: query,
        gl: "gb",
        hl: "en",
        num: 10,
      },
      { headers: { "X-API-KEY": key, "Content-Type": "application/json" }, timeout: 15000 },
    );

    const organic = Array.isArray(res.data?.organic) ? res.data.organic : [];
    for (const r of organic) {
      const link = safeTrim(r?.link);
      if (!link) continue;
      if (seen.has(link)) continue;

      if (!looksLikeJobPosting(link, rule)) continue;

      const title = safeTrim(r?.title, "Untitled");
      const snippet = safeTrim(r?.snippet, "");

      seen.add(link);
      all.push({
        title,
        company: guessCompanyFromTitle(title),
        location: loc, // meta/display only
        description: snippet || "No description available (snippet empty).",
        url: link,
        date: safeTrim(r?.date, undefined as any) || undefined,
      });
    }
  }

  // fallback if strict filters got nothing
  if (all.length === 0) {
    for (const rule of UK_SITES) {
      const fallbackQuery = `site:${rule.host} "${q}" (UK OR "United Kingdom" OR "Remote UK") job`;
      const res = await axios.post(
        SERPER_ENDPOINT,
        { q: fallbackQuery, gl: "gb", hl: "en", num: 10 },
        { headers: { "X-API-KEY": key, "Content-Type": "application/json" }, timeout: 15000 },
      );

      const organic = Array.isArray(res.data?.organic) ? res.data.organic : [];
      for (const r of organic) {
        const link = safeTrim(r?.link);
        if (!link) continue;
        if (seen.has(link)) continue;

        const title = safeTrim(r?.title, "Untitled");
        const snippet = safeTrim(r?.snippet, "");

        seen.add(link);
        all.push({
          title,
          company: guessCompanyFromTitle(title),
          location: loc,
          description: snippet || "No description available (snippet empty).",
          url: link,
          date: safeTrim(r?.date, undefined as any) || undefined,
        });
      }
    }
  }

  return all.slice(0, 40);
}
