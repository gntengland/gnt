// FILE: server/services/pdf.ts
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";

type PdfInput =
  | string
  | {
      title?: string;
      content: string;
      author?: string;
      subject?: string;
      mode?: "resume" | "cover" | "qa" | "auto";
    };

function existsFile(p: string) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function existsDir(p: string) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function normalizeNewlines(s: string) {
  return String(s || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function safeTitle(s: any) {
  const t = String(s ?? "").trim();
  return t.length ? t.slice(0, 160) : "Document";
}

function splitLines(text: string) {
  return normalizeNewlines(text)
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""));
}

function isUnderline(line: string) {
  const t = (line || "").trim();
  return /^={3,}$/.test(t) || /^-{3,}$/.test(t);
}

function isBullet(line: string) {
  const t = (line || "").trim();
  return /^[-•]\s+/.test(t) || /^\d+\.\s+/.test(t);
}

function isAllCaps(s: string) {
  const t = (s || "").trim();
  if (!t) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && letters === letters.toUpperCase();
}

function looksLikeHeading(line: string) {
  const t = (line || "").trim();
  if (!t) return false;

  if (
    /^(professional summary|summary|experience|work experience|education|skills|technical skills|projects|certifications|additional information|profile|cover letter|interview q&a|interview qa)$/i.test(
      t,
    )
  )
    return true;

  if (isAllCaps(t)) return true;

  if (t.length <= 48 && /^[A-Za-z][A-Za-z0-9 &/(),.-]+$/.test(t)) return true;

  return false;
}

/**
 * IMPORTANT:
 * - This adds a new page when needed
 * - Header is redrawn automatically using the `pageAdded` handler (below)
 */
function ensureSpace(doc: PDFKit.PDFDocument, px: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + px > bottom) doc.addPage();
}

function resolveFontsDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "server", "assets", "fonts"),
    path.resolve(process.cwd(), "dist", "server", "assets", "fonts"),
  ];
  for (const d of candidates) if (existsDir(d)) return d;
  return null;
}

function listTtf(fontsDir: string): string[] {
  try {
    return fs
      .readdirSync(fontsDir)
      .filter((f) => /\.ttf$/i.test(f))
      .map((f) => path.join(fontsDir, f));
  } catch {
    return [];
  }
}

/**
 * Auto-detect fonts:
 * - Prefer Inter for sans (Regular/Bold)
 * - Prefer EBGaramond for serif (Regular/Bold)
 */
function pickFonts(fontFiles: string[]) {
  const lower = fontFiles.map((p) => ({ p, n: path.basename(p).toLowerCase() }));

  const pick = (includesAll: string[], includesAny: string[] = []) => {
    const found = lower.find(
      (x) =>
        includesAll.every((k) => x.n.includes(k)) &&
        (includesAny.length ? includesAny.some((k) => x.n.includes(k)) : true),
    );
    return found?.p || null;
  };

  const interRegular =
    pick(["inter", "regular"]) ||
    pick(["inter"], ["regular", "book", "text"]) ||
    pick(["inter"]) ||
    null;

  const interBold = pick(["inter", "bold"]) || pick(["inter"], ["semibold", "bold"]) || null;

  const garRegular =
    pick(["garamond", "regular"]) ||
    pick(["ebgaramond", "regular"]) ||
    pick(["garamond"]) ||
    pick(["ebgaramond"]) ||
    null;

  const garBold =
    pick(["garamond", "bold"]) ||
    pick(["ebgaramond", "bold"]) ||
    pick(["garamond"], ["semibold", "bold"]) ||
    pick(["ebgaramond"], ["semibold", "bold"]) ||
    null;

  return { interRegular, interBold, garRegular, garBold };
}

function registerThemeFonts(doc: PDFKit.PDFDocument) {
  const fontsDir = resolveFontsDir();

  const F = {
    sans: "Helvetica",
    sansBold: "Helvetica-Bold",
    serif: "Times-Roman",
    serifBold: "Times-Bold",
    mono: "Courier",
  };

  if (!fontsDir) return { F, fontsDir: null, loaded: {} as Record<string, boolean> };

  const files = listTtf(fontsDir);
  const { interRegular, interBold, garRegular, garBold } = pickFonts(files);

  const loaded: Record<string, boolean> = {};
  try {
    if (interRegular && existsFile(interRegular)) {
      doc.registerFont("Sans", interRegular);
      F.sans = "Sans";
      loaded.Sans = true;
    }
    if (interBold && existsFile(interBold)) {
      doc.registerFont("Sans-Bold", interBold);
      F.sansBold = "Sans-Bold";
      loaded["Sans-Bold"] = true;
    }
    if (garRegular && existsFile(garRegular)) {
      doc.registerFont("Serif", garRegular);
      F.serif = "Serif";
      loaded.Serif = true;
    }
    if (garBold && existsFile(garBold)) {
      doc.registerFont("Serif-Bold", garBold);
      F.serifBold = "Serif-Bold";
      loaded["Serif-Bold"] = true;
    }
  } catch {
    // keep fallbacks
  }

  return { F, fontsDir, loaded };
}

function stripDecorativeUnderlines(lines: string[]) {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = (lines[i] || "").trim();
    const next = (lines[i + 1] || "").trim();
    if (cur && isUnderline(next)) {
      out.push(lines[i] || "");
      i++;
      continue;
    }
    if (isUnderline(cur)) continue;
    out.push(lines[i] || "");
  }
  return out;
}

function detectQA(lines: string[]) {
  let qCount = 0;
  let aCount = 0;
  for (const raw of lines) {
    const t = (raw || "").trim().toLowerCase();
    if (t.startsWith("q:")) qCount++;
    if (t.startsWith("a:")) aCount++;
  }
  return qCount >= 3 && aCount >= 3;
}

function parseQA(lines: string[]) {
  const blocks: Array<{ q: string; a: string }> = [];
  let q = "";
  let a = "";
  const flush = () => {
    if (q.trim() && a.trim()) blocks.push({ q: q.trim(), a: a.trim() });
    q = "";
    a = "";
  };

  for (const raw of lines) {
    const line = (raw || "").trim();
    if (!line) continue;

    if (/^q:\s*/i.test(line)) {
      flush();
      q = line.replace(/^q:\s*/i, "").trim();
      continue;
    }
    if (/^a:\s*/i.test(line)) {
      a = line.replace(/^a:\s*/i, "").trim();
      continue;
    }

    if (a) a += " " + line;
    else if (q) q += " " + line;
  }
  flush();
  return blocks;
}

/**
 * Main: themed PDF.
 * Fixes included:
 * - Header redraw on every page (pageAdded handler)
 * - Footer position inside page (not outside)
 * - Correct page numbering with bufferPages
 * - Footer also applied in QA mode
 */
export async function textToPdfBuffer(
  titleOrInput: PdfInput,
  content?: string,
  author?: string,
): Promise<Buffer> {
  const input: { title?: string; content: string; author?: string; subject?: string; mode?: "resume" | "cover" | "qa" | "auto" } =
    typeof titleOrInput === "string"
      ? { title: titleOrInput, content: content || "", author }
      : titleOrInput;

  const title = safeTitle(input.title);
  const raw = normalizeNewlines(input.content || "").trim();

  const THEME = {
    accent: "#0F766E",
    accentSoft: "#0F766E",
    ink: "#111111",
    muted: "#444444",
    light: "#F3F4F6",
  };

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 54, left: 54, right: 54, bottom: 54 },
    compress: true,
    bufferPages: true,
    info: {
      Title: title,
      Author: input.author ?? "Agent",
      Subject: input.subject ?? "",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const { F } = registerThemeFonts(doc);

  const getGeom = () => {
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = doc.page.margins.left;
    const contentW = pageW - doc.page.margins.left - doc.page.margins.right;
    return { pageW, pageH, margin, contentW };
  };

  const bandH = 64;

  const drawHeader = () => {
    const { pageW, margin, contentW } = getGeom();

    doc.save();
    doc.rect(0, 0, pageW, bandH).fill(THEME.accent);
    doc.restore();

    doc.fillColor("#FFFFFF");
    doc.font(F.sansBold).fontSize(18);
    doc.text(title, margin, 22, { width: contentW });

    // Move cursor below header band
    doc.y = bandH + 18;

    // Accent divider
    doc.save();
    doc.rect(margin, doc.y, contentW, 2).fill(THEME.accentSoft);
    doc.restore();
    doc.y += 14;
  };

  // ✅ Draw header for first page + every new page
  drawHeader();
  doc.on("pageAdded", drawHeader);

  // ---- Content prep ----
  let lines = splitLines(raw);
  lines = stripDecorativeUnderlines(lines);

  const forcedMode = input.mode || "auto";
  const qaMode = forcedMode === "qa" || (forcedMode === "auto" && detectQA(lines));

  const drawSectionTitle = (t: string) => {
    ensureSpace(doc, 52);
    const { margin, contentW } = getGeom();

    const y = doc.y;
    const chipH = 18;

    doc.save();
    doc.rect(margin, y - 2, contentW, chipH + 6).fill(THEME.light);
    doc.restore();

    doc.save();
    doc.rect(margin, y - 2, 6, chipH + 6).fill(THEME.accent);
    doc.restore();

    doc.fillColor(THEME.ink);
    doc.font(F.sansBold).fontSize(12);
    doc.text(t.trim().replace(/:$/, ""), margin + 14, y, { width: contentW - 14 });

    doc.y = y + chipH + 10;
  };

  const drawParagraph = (t: string) => {
    ensureSpace(doc, 22);
    const { contentW } = getGeom();

    doc.fillColor(THEME.ink);
    doc.font(F.serif).fontSize(11);
    doc.text(t.trim(), { width: contentW, align: "left", lineGap: 3 });
    doc.moveDown(0.45);
  };

  const drawSubheading = (t: string) => {
    ensureSpace(doc, 18);
    const { contentW } = getGeom();

    doc.fillColor(THEME.ink);
    doc.font(F.serifBold).fontSize(11);
    doc.text(t.trim(), { width: contentW });
    doc.moveDown(0.15);
  };

  const drawBullet = (t: string) => {
    ensureSpace(doc, 18);
    const { margin, contentW } = getGeom();

    const clean = t.trim().replace(/^[-•]\s+/, "").trim();

    const dotX = margin;
    const dotY = doc.y + 4;

    doc.save();
    doc.fillColor(THEME.accent);
    doc.circle(dotX + 4, dotY + 4, 2.2).fill();
    doc.restore();

    doc.fillColor(THEME.ink);
    doc.font(F.serif).fontSize(11);
    doc.text(clean, margin + 14, doc.y, { width: contentW - 14, lineGap: 3 });
    doc.moveDown(0.25);
  };

  const drawQA = (q: string, a: string) => {
    ensureSpace(doc, 80);
    const { margin, contentW } = getGeom();

    doc.save();
    const qY = doc.y;
    doc.rect(margin, qY - 2, contentW, 22).fill("#EEF2FF");
    doc.restore();

    doc.fillColor("#111827");
    doc.font(F.sansBold).fontSize(11);
    doc.text(`Q: ${q}`, margin + 10, doc.y + 3, { width: contentW - 20 });

    doc.y += 28;

    doc.fillColor(THEME.ink);
    doc.font(F.serif).fontSize(11);
    doc.text(`A: ${a}`, { width: contentW, lineGap: 3 });
    doc.moveDown(0.6);

    doc.save();
    doc.fillColor("#E5E7EB");
    doc.rect(margin, doc.y, contentW, 1).fill();
    doc.restore();

    doc.y += 10;
  };

  // ---- Render ----
  if (qaMode) {
    const blocks = parseQA(lines);
    drawSectionTitle("Interview Q&A");
    for (const b of blocks) drawQA(b.q, b.a);
  } else {
    let buffer: string[] = [];
    const flush = () => {
      const block = buffer.join("\n").trim();
      buffer = [];
      if (!block) return;

      const parts = block.split("\n").map((x) => x.trim());
      for (const p of parts) {
        if (!p) continue;

        if (isBullet(p)) {
          drawBullet(p.replace(/^[-•]\s+/, ""));
          continue;
        }

        if (p.length <= 120 && (p.includes("—") || p.includes("|") || /\b(20\d{2}|19\d{2})\b/.test(p))) {
          drawSubheading(p);
          continue;
        }

        drawParagraph(p);
      }
    };

    let sawHeading = false;

    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] || "").trim();

      if (!line) {
        flush();
        continue;
      }

      if (/^resume$/i.test(line)) continue;

      if (looksLikeHeading(line)) {
        sawHeading = true;
        flush();
        drawSectionTitle(line);
        continue;
      }

      buffer.push(lines[i] || "");
    }
    flush();

    if (!sawHeading && raw.trim()) {
      drawSectionTitle("Content");
      drawParagraph(raw.trim());
    }
  }

  // ---- Footer: ALWAYS apply (all pages) ----
  const generatedOn = new Date().toISOString().slice(0, 10);

  const range = doc.bufferedPageRange();
  const start = range.start;
  const totalPages = range.count;

  for (let i = start; i < start + totalPages; i++) {
    doc.switchToPage(i);

    const pageNumber = i - start + 1;

    const footerX = doc.page.margins.left;
    const footerW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // ✅ FIX: must be INSIDE the page (NOT +14)
    const footerY = doc.page.height - doc.page.margins.bottom - 18;

    doc.save();
    doc.fillColor(THEME.muted);
    doc.font(F.sans).fontSize(9);

    doc.text(`Generated on ${generatedOn}`, footerX, footerY, { width: footerW, align: "left" });
    doc.text(`Page ${pageNumber} of ${totalPages}`, footerX, footerY, { width: footerW, align: "right" });

    doc.restore();
  }

  doc.flushPages();
  doc.end();
  return done;
}

// ✅ Compatibility export (your server/routes.ts imports this name)
export const createPdfFromText = textToPdfBuffer;
