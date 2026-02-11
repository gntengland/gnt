// FILE: server/routes.ts
import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import {
  AnalyzeCvInputSchema,
  GenerateMaterialsInputSchema,
  JobMatchInputSchema,
  JobSearchInputSchema,
  SaveJobApplicationInputSchema,
  PdfInputSchema,
  RegisterInputSchema,
  LoginInputSchema,
} from "../shared/routes";
import { analyzeCvText, aiGenerate, aiMatch, buildSearchQueryFromResume } from "./openai";
import { searchJobsUK } from "./serper";
import { rerankJobsWithJina } from "./jina";
import { createPdfFromText } from "./services/pdf";
import { getAuthedUser, requireAuth, registerWithEmailPassword, loginWithEmailPassword } from "./auth";

import multer from "multer";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import path from "path";

function safeTrim(s: any, fallback = "") {
  const t = String(s ?? "").trim();
  return t || fallback;
}

function isAutoQuery(q: string) {
  const t = safeTrim(q).toLowerCase();

  // Accept common UI labels / variants
  if (t === "auto" || t === "auto-from-cv" || t === "from-cv") return true;
  if (t === "auto from cv" || t === "auto (from cv)" || t === "auto-from-cv)") return true;
  if (t.includes("auto") && t.includes("cv")) return true;

  return false;
}

export async function registerRoutes(app: Express) {
  app.get("/api/healthz", (_req, res) => res.json({ ok: true }));

  // -----------------------------
  // AUTH
  // -----------------------------
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const parsed = RegisterInputSchema.parse(req.body);
      const user = await registerWithEmailPassword(parsed);

      (req as any).login(user, (err: any) => {
        if (err) return res.status(500).json({ error: "Login after register failed" });
        return res.json(user);
      });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Register failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const parsed = LoginInputSchema.parse(req.body);

      const user = await loginWithEmailPassword(parsed);
      (req as any).login(user, (err: any) => {
        if (err) return res.status(500).json({ error: "Login failed" });
        return res.json(user);
      });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req: any, res: any) => {
    try {
      req.logout?.(() => {});
    } catch {}
    req.session?.destroy?.(() => {});
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req: any, res: any) => {
    res.json(req.user ?? null);
  });

  // -----------------------------
  // PROFILE
  // -----------------------------
  app.get("/api/profile", requireAuth, async (req: any, res: any) => {
    try {
      const user = getAuthedUser(req);
      const profile = await (storage as any).getUserProfile?.(user.id);
      return res.json(profile ?? null);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Failed to load profile" });
    }
  });

  app.patch("/api/profile", requireAuth, async (req: any, res: any) => {
    try {
      const user = getAuthedUser(req);
      const updates = req.body || {};
      const out = await (storage as any).upsertUserProfile?.(user.id, updates);
      return res.json(out);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Profile update failed" });
    }
  });

  // -----------------------------
  // CV UPLOAD (Profile)
  // -----------------------------
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 1 * 1024 * 1024 }, // 1MB
  });

  async function extractTextFromBuffer(file: Express.Multer.File) {
    const name = (file.originalname || "").toLowerCase();

    if (name.endsWith(".pdf")) {
      const out = await pdfParse(file.buffer);
      return (out.text || "").trim();
    }

    if (name.endsWith(".docx")) {
      const out = await mammoth.extractRawText({ buffer: file.buffer });
      return (out.value || "").trim();
    }

    if (name.endsWith(".txt")) {
      return file.buffer.toString("utf8").trim();
    }

    // fallback: تلاش برای متن ساده (اگر کاربر پسوند اشتباه داد)
    const asText = file.buffer.toString("utf8").trim();
    if (asText.length > 30) return asText;

    throw new Error("Unsupported file type. Please upload .pdf, .docx, or .txt.");
  }

  app.post("/api/profile/upload-cv", requireAuth, async (req: any, res: any) => {
    upload.single("file")(req, res, async (err: any) => {
      try {
        if (err) return res.status(400).json({ error: err?.message || "Upload failed" });
        const file = req.file as Express.Multer.File | undefined;
        if (!file) return res.status(400).json({ error: "No file" });

        const text = await extractTextFromBuffer(file);

        if (!text || text.length < 10) {
          return res.status(400).json({ error: "Could not extract text. Try another file or paste manually." });
        }

        const user = getAuthedUser(req);
        const out = await (storage as any).upsertUserProfile?.(user.id, {
          resumeText: text,
          cvFileUrl: null,
        });

        return res.json({ ok: true, filename: file.originalname, text, profile: out ?? null });
      } catch (e: any) {
        return res.status(400).json({ error: e?.message || "Upload failed" });
      }
    });
  });

  app.post("/api/profile/analyze-cv", requireAuth, async (req: any, res: any) => {
    try {
      const body = AnalyzeCvInputSchema.parse(req.body);
      const result = await analyzeCvText({ cvText: body.cvText });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Analyze failed" });
    }
  });

  // -----------------------------
  // JOBS: SEARCH (UK)
  // -----------------------------
  app.post("/api/jobs/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = JobSearchInputSchema.parse(req.body);

      const effectiveQuery = await buildSearchQueryFromResume({
        userKeywords: isAutoQuery(body.query) ? "" : body.query,
        resumeText: body.resumeText || "",
      });

      const effectiveLocation = safeTrim(body.location, "Worldwide");

      const found = await searchJobsUK({ query: effectiveQuery, location: effectiveLocation });

      if (body.resumeText && safeTrim(body.resumeText).length > 20 && found.length > 1) {
        const rerankQuery = `Find the best matching jobs for this profile: ${effectiveQuery}`;
        const ranked = await rerankJobsWithJina({ query: rerankQuery, jobs: found });
        return res.json(ranked.slice(0, 30));
      }

      return res.json(found.slice(0, 30));
    } catch (e: any) {
      console.error("❌ /api/jobs/search error:", e);
      return res.status(400).json({ error: e?.message || "Search failed" });
    }
  });

  // -----------------------------
  // JOBS: MATCH
  // -----------------------------
  app.post("/api/jobs/match", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = JobMatchInputSchema.parse(req.body);
      const result = await aiMatch(body.jobDescription);
      res.json(result);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Match failed" });
    }
  });

  // -----------------------------
  // JOBS: GENERATE
  // -----------------------------
  app.post("/api/jobs/generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = GenerateMaterialsInputSchema.parse(req.body);
      const result = await aiGenerate({
        jobTitle: body.jobTitle,
        companyName: body.companyName,
        combinedText: body.combinedText,
      });
      res.json(result);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Generate failed" });
    }
  });

  // -----------------------------
  // JOBS: SAVE / LIST SAVED
  // -----------------------------
  app.post("/api/jobs/save", requireAuth, async (req: any, res: any) => {
    try {
      const user = getAuthedUser(req);
      const body = SaveJobApplicationInputSchema.parse(req.body);
      const out = await (storage as any).saveJobApplication?.(user.id, body);
      return res.status(201).json(out ?? { ok: true });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Save failed" });
    }
  });

  app.get("/api/jobs/saved", requireAuth, async (req: any, res: any) => {
    try {
      const user = getAuthedUser(req);
      const out = await (storage as any).listSavedJobs?.(user.id);
      return res.json(out ?? []);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Load saved jobs failed" });
    }
  });

  // -----------------------------
  // PDF
  // -----------------------------
  app.post("/api/pdf", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = PdfInputSchema.parse(req.body);

      const buf = await createPdfFromText({
        title: safeTrim((body as any).title, "Document"),
        content: body.content,
      } as any);

      res.setHeader("Content-Type", "application/pdf");
      return res.status(200).send(buf);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "PDF failed" });
    }
  });

  // -----------------------------
  // (اختیاری) اگر جایی resume/upload داری، اینجا نگهش می‌داریم:
  // -----------------------------
  app.post("/api/resume/upload", requireAuth, async (req: any, res: any) => {
    upload.single("file")(req, res, async (err: any) => {
      try {
        if (err) return res.status(400).json({ error: err?.message || "Upload failed" });
        const file = req.file as Express.Multer.File | undefined;
        if (!file) return res.status(400).json({ error: "No file" });

        const text = await extractTextFromBuffer(file);
        return res.json({ ok: true, filename: file.originalname, text });
      } catch (e: any) {
        return res.status(400).json({ error: e?.message || "Upload failed" });
      }
    });
  });
}
