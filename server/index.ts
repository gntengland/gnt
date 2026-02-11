// FILE: server/index.ts
import express from "express";
import path from "path";
import fs from "fs";

import { setupAuth, ensureCoreTables } from "./auth";
import { registerRoutes } from "./routes";

// ✅ CJS-safe paths (Render / esbuild)
const publicDir = path.resolve(process.cwd(), "dist", "public");
const indexHtml = path.join(publicDir, "index.html");
const uploadsDir = path.resolve(process.cwd(), "uploads");

async function main() {
  const app = express();

  // body parsers
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  // ✅ Ensure uploads folder + serve it
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use("/uploads", express.static(uploadsDir));

  // ✅ DB tables
  await ensureCoreTables();

  // ✅ Session + passport
  setupAuth(app);

  // ✅ API routes
  registerRoutes(app);

  // ✅ Health
  app.get("/healthz", (_req, res) => res.status(200).send("OK"));

  // ✅ Serve built client (STATIC + SPA fallback)
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));

    // ✅ IMPORTANT:
    // SPA fallback must be GET only
    // so POST /api/... does NOT get index.html
    app.get("*", (_req, res) => {
      res.sendFile(indexHtml);
    });
  } else {
    app.get("/", (_req, res) => res.status(200).send("Server running (client not built)"));
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => {
    console.log(`✅ Server listening on ${port}`);
  });
}

main().catch((e) => {
  console.error("🔥 Fatal:", e);
  process.exit(1);
});
