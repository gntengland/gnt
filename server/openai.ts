// FILE: server/openai.ts
import OpenAI from "openai";

function envAny(keys: string[]) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function getClientOrNull(): OpenAI | null {
  const key = envAny(["OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_KEY"]);
  if (!key) return null;

  const baseURL = envAny(["OPENAI_BASE_URL", "AI_INTEGRATIONS_OPENAI_BASE_URL"]) || undefined;
  return new OpenAI({ apiKey: key, baseURL });
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function friendlyOpenAIError(e: any) {
  const msg = String(e?.message || "");
  const status = e?.status || e?.response?.status;
  const data = e?.response?.data || e?.error?.message;
  const extra = data ? ` | ${JSON.stringify(data).slice(0, 400)}` : "";
  return status ? `OpenAI error ${status}: ${msg}${extra}` : `OpenAI error: ${msg}${extra}`;
}

function modelName() {
  return process.env.OPENAI_MODEL || "gpt-5-mini";
}

function clampText(s: string, n: number) {
  const t = String(s || "").trim();
  return t.length > n ? t.slice(0, n) : t;
}

/**
 * Heuristic: extract a reasonable job search query from a resume text.
 * Works even without OpenAI key (basic, but solid).
 */
function heuristicQueryFromResume(resumeText: string): string {
  const t = (resumeText || "").toLowerCase();

  // Title-like phrases
  const titleHints = [
    "software engineer",
    "frontend developer",
    "backend developer",
    "full stack",
    "devops",
    "data analyst",
    "data scientist",
    "product manager",
    "project manager",
    "program manager",
    "technical program manager",
    "it support",
    "helpdesk",
    "field service",
    "network engineer",
    "system administrator",
    "cybersecurity",
    "qa engineer",
    "tester",
    "account manager",
    "sales",
    "customer support",
    "delivery driver",
    "courier",
    "warehouse",
    "cook",
    "chef",
    "kitchen",
    "barista",
    "cashier",
    "retail",
    "cleaner",
  ];

  const foundTitles: string[] = [];
  for (const x of titleHints) {
    if (t.includes(x)) foundTitles.push(x);
    if (foundTitles.length >= 2) break;
  }

  // Skills (very simple)
  const skillHints = [
    "react",
    "next.js",
    "node",
    "typescript",
    "javascript",
    "python",
    "java",
    "c#",
    "sql",
    "postgres",
    "mongodb",
    "aws",
    "azure",
    "docker",
    "kubernetes",
    "jira",
    "itil",
    "windows",
    "linux",
    "network",
    "troubleshooting",
  ];
  const skills: string[] = [];
  for (const s of skillHints) {
    if (t.includes(s)) skills.push(s);
    if (skills.length >= 4) break;
  }

  // Build query
  const base = foundTitles.length ? foundTitles[0] : "job";
  const extra = skills.length ? ` ${skills.slice(0, 3).join(" ")}` : "";
  return `${base}${extra}`.replace(/\s{2,}/g, " ").trim();
}

export async function buildSearchQueryFromResume(params: {
  resumeText?: string;
  userKeywords?: string;
}): Promise<string> {
  const userKw = String(params.userKeywords || "").trim();
  const resume = String(params.resumeText || "").trim();

  // If user provided keywords, keep them but still allow enrichment
  const hasUser = userKw.length >= 2;

  const client = getClientOrNull();
  if (!client) {
    // No OpenAI configured → heuristic
    if (hasUser) return userKw;
    return heuristicQueryFromResume(resume);
  }

  // OpenAI is available → produce clean, English query
  const system = `
You build a single, high-quality English job search query from a resume.
Return STRICT JSON only:
{ "query": string }

Rules:
- query MUST NOT include any city/country names.
- query should be 2 to 8 words.
- Focus on role + 2-4 key skills (if relevant).
- If resume suggests non-technical roles, use practical role terms (e.g., "delivery driver", "kitchen assistant").
- If userKeywords provided, incorporate them but still follow the rules.
Return ONLY JSON.`;

  try {
    const resp = await client.chat.completions.create({
      model: modelName(),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system.trim() },
        {
          role: "user",
          content: JSON.stringify({
            userKeywords: hasUser ? userKw : null,
            resumeText: clampText(resume, 20000),
          }),
        },
      ],
    });

    const out = resp.choices?.[0]?.message?.content?.trim() || "{}";
    const parsed = safeJsonParse<{ query: string }>(out);
    const q = String(parsed?.query || "").trim();

    if (q.length >= 2) return q;
    if (hasUser) return userKw;
    return heuristicQueryFromResume(resume);
  } catch (e: any) {
    // Fail soft
    if (hasUser) return userKw;
    return heuristicQueryFromResume(resume);
  }
}

export async function analyzeCvText(params: { cvText: string }) {
  const client = getClientOrNull();
  if (!client) throw new Error("OPENAI_API_KEY is missing");

  const system = `
You are a resume analyst.
Return STRICT JSON only:
{
  "summary": string,
  "skills": string[],
  "roles": string[],
  "seniority": "intern"|"junior"|"mid"|"senior"|"lead"|"unknown",
  "suggestedHeadline": string,
  "keywords": string[]
}
Rules:
- summary <= 80 words
- max 20 items per array
Return ONLY JSON.`;

  try {
    const resp = await client.chat.completions.create({
      model: modelName(),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system.trim() },
        { role: "user", content: clampText(params.cvText, 20000) },
      ],
    });

    const out = resp.choices?.[0]?.message?.content?.trim() || "{}";
    const parsed =
      safeJsonParse<{
        summary: string;
        skills: string[];
        roles: string[];
        seniority: "intern" | "junior" | "mid" | "senior" | "lead" | "unknown";
        suggestedHeadline: string;
        keywords: string[];
      }>(out) || {
        summary: "",
        skills: [],
        roles: [],
        seniority: "unknown",
        suggestedHeadline: "",
        keywords: [],
      };

    return {
      summary: String(parsed.summary || "").slice(0, 800),
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 20).map(String) : [],
      roles: Array.isArray(parsed.roles) ? parsed.roles.slice(0, 20).map(String) : [],
      seniority: ("" + (parsed.seniority || "unknown")) as any,
      suggestedHeadline: String(parsed.suggestedHeadline || "").slice(0, 200),
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 20).map(String) : [],
    };
  } catch (e: any) {
    throw new Error(friendlyOpenAIError(e));
  }
}

export async function aiMatch(combinedText: string) {
  const client = getClientOrNull();
  if (!client) throw new Error("OPENAI_API_KEY is missing");

  const system = `You are an ATS-style job matching evaluator.
Return STRICT JSON only:
{
  "matchPercentage": number (0-100),
  "matchingSkills": string[],
  "missingSkills": string[],
  "strengths": string[],
  "gaps": string[],
  "analysis": string,
  "recommendedKeywords": string[],
  "salaryRange": string,
  "seniorityFit": "perfect"|"good"|"average"|"poor"
}
INPUT FORMAT:
Everything above "Candidate:" is JOB.
Everything below "Candidate:" is CANDIDATE.
Return ONLY JSON.`;

  try {
    const resp = await client.chat.completions.create({
      model: modelName(),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system.trim() },
        { role: "user", content: clampText(combinedText, 25000) },
      ],
    });

    const out = resp.choices?.[0]?.message?.content?.trim() || "{}";
    const parsed =
      safeJsonParse<{
        matchPercentage: number;
        matchingSkills: string[];
        missingSkills: string[];
        strengths: string[];
        gaps: string[];
        analysis: string;
        recommendedKeywords: string[];
        salaryRange: string;
        seniorityFit: "perfect" | "good" | "average" | "poor";
      }>(out) || {
        matchPercentage: 0,
        matchingSkills: [],
        missingSkills: [],
        strengths: [],
        gaps: [],
        analysis: "Could not analyze match.",
        recommendedKeywords: [],
        salaryRange: "N/A",
        seniorityFit: "average",
      };

    return {
      matchPercentage: Math.max(0, Math.min(100, Number(parsed.matchPercentage || 0))),
      matchingSkills: Array.isArray(parsed.matchingSkills) ? parsed.matchingSkills.slice(0, 12).map(String) : [],
      missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills.slice(0, 12).map(String) : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 8).map(String) : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 8).map(String) : [],
      analysis: String(parsed.analysis || "").slice(0, 1000),
      recommendedKeywords: Array.isArray(parsed.recommendedKeywords) ? parsed.recommendedKeywords.slice(0, 10).map(String) : [],
      salaryRange: String(parsed.salaryRange || "N/A").slice(0, 50),
      seniorityFit: (parsed.seniorityFit || "average") as any,
    };
  } catch (e: any) {
    throw new Error(friendlyOpenAIError(e));
  }
}

export async function aiGenerate(params: { jobTitle: string; companyName: string; combinedText: string }) {
  const client = getClientOrNull();
  if (!client) throw new Error("OPENAI_API_KEY is missing");

  // (بقیه کد generate شما می‌تواند همان قبلی بماند؛ اینجا فقط کلید/کراس-کراش را درست کردیم)
  const system = `Return STRICT JSON only: {"customCv":string,"coverLetter":string,"interviewQa":[{"q":string,"a":string,"type":"general"|"technical"}]}`;

  try {
    const resp = await client.chat.completions.create({
      model: modelName(),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system.trim() },
        { role: "user", content: clampText(params.combinedText, 25000) },
      ],
    });

    const out = resp.choices?.[0]?.message?.content?.trim() || "{}";
    const parsed = safeJsonParse<any>(out) || { customCv: "", coverLetter: "", interviewQa: [] };
    return parsed;
  } catch (e: any) {
    throw new Error(friendlyOpenAIError(e));
  }
}
