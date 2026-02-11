// FILE: server/routes.ts
import type { Express, Request, Response } from "express";
import { storage } from "./storage";

import {
  // ✅ auth schemas (fix .then crash)
  RegisterInputSchema,
  LoginInputSchema,

  // profile/job/pdf schemas
  UpdateProfileInputSchema,
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
import fs from "fs";

function safeTrim(s: any, fallback = "") {
  const t = String(s ?? "").trim();
  return t || fallback;
}

function isAutoQuery(q: string) {
  const t = safeTrim(q).toLowerCase();
  if (t === "auto" || t === "auto-from-cv" || t === "from-cv") return true;
  if (t === "auto from cv" || t === "auto (from cv)" || t === "auto-from-cv)") return true;
  if (t.includes("auto") && t.includes("cv")) return true;
  return false;
}

// uploads folder (served by server/index.ts at /uploads)
const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "");
      const base = path
        .basename(file.originalname || "cv", ext)
        .replace(/[^\w\-]+/g, "_")
        .slice(0, 60);
      cb(null, `${Date.now()}_${base}${ext}`);
    },
  }),
  limits: { fileSize: 1 * 1024 * 1024 }, // 1MB
});

async function extractTextFromUploadedFile(filePath: string, originalName: string) {
  const lower = String(originalName || "").toLowerCase();

  if (lower.endsWith(".pdf")) {
    const buf = fs.readFileSync(filePath);
    const out = await pdfParse(buf);
    return String(out.text || "").trim();
  }

  if (lower.endsWith(".docx")) {
    const buf = fs.readFileSync(filePath);
    const out = await mammoth.extractRawText({ buffer: buf });
    return String(out.value || "").trim();
  }

  // default: treat as text
  const buf = fs.readFileSync(filePath);
  return buf.toString("utf-8").trim();
}

export async function registerRoutes(app: Express) {
  app.get("/api/healthz", (_req, res) => res.json({ ok: true }));

  // -----------------------------
  // AUTH
  // -----------------------------
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      // ✅ FIX: no dynamic import + .then
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
      // ✅ FIX: no dynamic import + .then
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
      req.logout?.(() => {
        req.session?.destroy?.(() => res.json({ ok: true }));
      });
    } catch {
      res.json({ ok: true });
    }
  });

  app.get("/api/auth/me", (req: any, res: any) => {
    try {
      if (req.isAuthenticated?.() && req.user) return res.json(req.user);
      return res.json(null);
    } catch {
      return res.json(null);
    }
  });

  // -----------------------------
  // PROFILE
  // -----------------------------
  app.get("/api/profile", requireAuth, async (req: any, res: any) => {
    try {
      const user = getAuthedUser(req);
      const profile = await (storage as any).getUserProfile?.(user.id);
      res.json(profile ?? null);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Failed to fetch profile" });
    }
  });

  app.patch("/api/profile", requireAuth, async (req: any, res: any) => {
    try {
      const user = getAuthedUser(req);
      const body = UpdateProfileInputSchema.parse(req.body);
      const out = await (storage as any).upsertUserProfile?.(user.id, body);
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Failed to update profile" });
    }
  });

  // Upload CV (pdf/docx/txt)
  app.post("/api/profile/upload-cv", requireAuth, upload.single("file"), async (req: any, res: any) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const text = await extractTextFromUploadedFile(file.path, file.originalname);
      if (text.length < 10) return res.status(400).json({ error: "Extracted text is empty" });

      // public URL via /uploads static
      const fileUrl = `/uploads/${path.basename(file.path)}`;

      // save to profile too (optional but useful)
      try {
        const user = getAuthedUser(req);
        await (storage as any).upsertUserProfile?.(user.id, { resumeText: text, cvFileUrl: fileUrl });
      } catch {}

      return res.json({ ok: true, text, filename: file.originalname, fileUrl });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Upload failed" });
    }
  });

  // ✅ Compatibility alias (ApplyWizard uses /api/resume/upload in some code)
  app.post("/api/resume/upload", requireAuth, upload.single("file"), async (req: any, res: any) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const text = await extractTextFromUploadedFile(file.path, file.originalname);
      if (text.length < 10) return res.status(400).json({ error: "Extracted text is empty" });

      const fileUrl = `/uploads/${path.basename(file.path)}`;

      try {
        const user = getAuthedUser(req);
        await (storage as any).upsertUserProfile?.(user.id, { resumeText: text, cvFileUrl: fileUrl });
      } catch {}

      return res.json({ ok: true, text, filename: file.originalname, fileUrl });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Upload failed" });
    }
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
      const rows = await (storage as any).listSavedJobs?.(user.id);
      return res.json(rows ?? []);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "List failed" });
    }
  });

  // -----------------------------
  // PDF
  // -----------------------------
  app.post("/api/pdf", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = PdfInputSchema.parse(req.body);
      const buf = await createPdfFromText(body.content);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTrim(body.title, "document")}.pdf"`);
      return res.send(buf);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "PDF failed" });
    }
  });
}
