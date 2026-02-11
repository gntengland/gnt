// FILE: server/upload.ts
import multer from "multer";
import type { Request, Response } from "express";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

const MAX_BYTES = 1 * 1024 * 1024; // 1MB (هم‌راستا با فرانت Apply Wizard)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

function extLower(name: string) {
  const n = (name || "").toLowerCase().trim();
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i) : "";
}

async function extractTextFromBuffer(file: Express.Multer.File): Promise<string> {
  const ext = extLower(file.originalname || "");

  if (ext === ".pdf") {
    const parsed = await pdfParse(file.buffer);
    return String(parsed.text || "").trim();
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return String(result.value || "").trim();
  }

  if (ext === ".txt") {
    return file.buffer.toString("utf8").trim();
  }

  if (ext === ".doc") {
    // DOC قدیمی: خروجی garbage می‌دهد (NTable...) پس واضح ردش می‌کنیم
    throw new Error("Legacy .doc is not supported. Please upload .docx, .pdf, or .txt.");
  }

  // fallback: تلاش برای متن ساده (اگر کاربر پسوند اشتباه داد)
  const asText = file.buffer.toString("utf8").trim();
  if (asText.length > 30) return asText;

  throw new Error("Unsupported file type. Please upload .pdf, .docx, or .txt.");
}

function makeUploadHandler(fieldName: "resume" | "file") {
  return async function handleUpload(req: Request, res: Response) {
    upload.single(fieldName)(req, res, async (err) => {
      try {
        if (err) {
          console.error("❌ Upload error:", err);
          return res.status(400).json({ error: err.message || "Upload failed" });
        }

        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) {
          return res.status(400).json({ error: "No file" });
        }

        console.log("📄 Extracting text from:", file.originalname, `(${file.size} bytes)`);

        const extractedText = await extractTextFromBuffer(file);

        console.log("✅ Extracted text length:", extractedText.length, "characters");

        if (!extractedText || extractedText.length < 10) {
          return res.status(400).json({
            error: "Could not extract text from file. Please upload a clearer PDF/DOCX or paste text manually.",
          });
        }

        return res.status(200).json({
          ok: true,
          extractedText,
          extractedChars: extractedText.length,
          fileName: file.originalname,
          url: null,
        });
      } catch (e: any) {
        const msg = String(e?.message || "Upload failed");
        console.error("❌ Upload processing error:", msg);
        return res.status(400).json({ error: msg });
      }
    });
  };
}

// Apply Wizard: frontend fd.append("resume", file)
export const handleResumeUpload = makeUploadHandler("resume");

// Profile page: frontend fd.append("file", file)
export const handleCvUpload = makeUploadHandler("file");
