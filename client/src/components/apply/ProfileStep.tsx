// FILE: client/src/components/apply/ProfileStep.tsx
import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Upload, FileText } from "lucide-react";
import type { ProfilePayload } from "./types";

async function uploadResumeFile(file: File): Promise<{ filename: string; text: string }> {
  const fd = new FormData();
  // ✅ server expects "file"
  fd.append("file", file);

  const res = await fetch("/api/resume/upload", {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  const raw = await res.text().catch(() => "");
  let data: any = null;
  try {
    data = JSON.parse(raw);
  } catch {
    // ignore
  }

  if (!res.ok) {
    throw new Error(data?.error || raw || `Upload failed: HTTP ${res.status}`);
  }

  const text = String(data?.text || "").trim();
  const filename = String(data?.filename || file.name || "resume").trim();

  if (text.length < 10) throw new Error("Upload succeeded, but extracted text is empty.");

  return { filename, text };
}

export default function ProfileStep({
  value,
  onChange,
}: {
  value: ProfilePayload;
  onChange: (next: ProfilePayload) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedName, setSelectedName] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(file?: File | null) {
    if (!file) return;
    setError(null);
    setSelectedName(file.name);
    setUploading(true);

    try {
      const out = await uploadResumeFile(file);
      onChange({ ...value, resumeText: out.text });
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-5 glass-panel">
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">Step 1 / 3</div>
          <div className="text-xl font-semibold">Resume: upload a file or paste text</div>
        </div>

        <div
          className="rounded-xl border border-white/10 bg-card/40 p-4 flex items-center gap-4 cursor-pointer hover:bg-card/55 transition-colors"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            handlePick(f);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="w-11 h-11 rounded-lg bg-muted/40 flex items-center justify-center">
            <Upload className="w-5 h-5" />
          </div>

          <div className="flex-1">
            <div className="font-medium">Drag & drop your resume here</div>
            <div className="text-sm text-muted-foreground">or choose a file (PDF/DOC/DOCX/TXT)</div>

            {selectedName ? (
              <div className="text-sm mt-1 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span className="text-muted-foreground">Selected:</span> <span>{selectedName}</span>
              </div>
            ) : null}

            {error ? <div className="text-sm mt-2 text-red-400">{error}</div> : null}
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Choose file"}
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className="hidden"
            onChange={(e) => handlePick(e.target.files?.[0])}
          />
        </div>

        <div className="space-y-2">
          <Label>Paste resume text</Label>
          <Textarea
            value={value.resumeText || ""}
            onChange={(e) => onChange({ ...value, resumeText: e.target.value })}
            placeholder="Paste your resume here..."
            className="min-h-[180px]"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Keywords (optional)</Label>
            <Input
              value={value.keywords}
              onChange={(e) => onChange({ ...value, keywords: e.target.value })}
              placeholder='e.g. "IT Support Windows Active Directory"'
            />
            <div className="text-xs text-muted-foreground">Leave empty to auto-generate keywords from your CV.</div>
          </div>

          <div className="space-y-2">
            <Label>Location</Label>
            <Input
              value={value.location}
              onChange={(e) => onChange({ ...value, location: e.target.value })}
              placeholder="United Kingdom"
            />
            <div className="text-xs text-muted-foreground">UK only (Remote is OK if it is UK-based).</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
