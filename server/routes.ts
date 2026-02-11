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
      const body = (await import("../shared/routes")).then((m) => m.RegisterInputSchema.parse(req.body));
      const parsed = await body;
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
      const body = (await import("../shared/routes")).then((m) => m.LoginInputSchema.parse(req.body));
      const parsed = await body;

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
    req.logout?.(() => {});
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req: any, res: any) => {
    res.json(req.user ?? null);
  });

  // -----------------------------
  // APPLY WIZARD: RESUME UPLOAD (no auth)
  // -----------------------------
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB (>= 1MB)
  });

  app.post("/api/resume/upload", upload.single("file"), async (req: any, res: any) => {
    try {
      const f = req.file;
      if (!f) return res.status(400).json({ error: "No file uploaded" });

      const filename = String(f.originalname || "resume").slice(0, 200);
      const ext = path.extname(filename).toLowerCase();
      const mime = String(f.mimetype || "").toLowerCase();
      const buf: Buffer = f.buffer;

      if (!buf || buf.length === 0) return res.status(400).json({ error: "Empty file" });

      let text = "";

      const isPdf = mime.includes("pdf") || ext === ".pdf";
      const isDocx = mime.includes("word") || ext === ".docx" || ext === ".doc";
      const isTxt = mime.startsWith("text/") || ext === ".txt";

      if (isPdf) {
        const out = await pdfParse(buf);
        text = String(out?.text || "");
      } else if (isDocx) {
        const out = await mammoth.extractRawText({ buffer: buf });
        text = String(out?.value || "");
      } else if (isTxt) {
        text = buf.toString("utf8");
      } else {
        return res.status(400).json({ error: "Unsupported file type. Use PDF/DOC/DOCX/TXT." });
      }

      text = text.replace(/\u0000/g, "").trim();

      if (text.length < 20) {
        return res.status(400).json({ error: "Could not extract enough text from this file." });
      }

      return res.json({ filename, text });
    } catch (e: any) {
      console.error("❌ /api/resume/upload:", e);
      return res.status(400).json({ error: e?.message || "Upload failed" });
    }
  });

  // -----------------------------
  // PROFILE
  // -----------------------------
  app.get("/api/profile", requireAuth, async (req: any, res: any) => {
    const user = getAuthedUser(req);
    const profile = await storage.getProfile(user.id);
    res.json(profile || null);
  });

  app.patch("/api/profile", requireAuth, async (req: any, res: any) => {
    const user = getAuthedUser(req);
    const next = await storage.upsertProfile(user.id, req.body);
    res.json(next);
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

  // -----------------------------
  // PDF
  // -----------------------------
  app.post("/api/pdf", requireAuth, async (req: any, res: any) => {
    try {
      const body = PdfInputSchema.parse(req.body);
      const pdf = await createPdfFromText({
        title: body.title || "Document",
        content: body.content,
      });

      const filename = safeTrim(body.filename, "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(pdf);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "PDF failed" });
    }
  });
}
