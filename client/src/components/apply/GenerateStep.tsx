// FILE: client/src/components/apply/GenerateStep.tsx
import { useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, Download } from "lucide-react";
import type { JobMatchItem, ProfilePayload } from "./types";

type InterviewQAItem = { q: string; a: string; type: "general" | "technical" };

type GenerateResult = {
  customCv: string;
  coverLetter: string;
  interviewQa?: InterviewQAItem[];
};

function toSafeFilename(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

// Very small heuristic name extraction for PDF titles
function guessCandidateName(resumeText: string) {
  const lines = String(resumeText || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const first = lines[0] || "";
  if (first.length >= 3 && first.length <= 60 && /^[a-zA-Z\s'.-]+$/.test(first)) return first;
  return "";
}

export default function GenerateStep({
  profile,
  jobs,
  onJobsChange,
}: {
  profile: ProfilePayload;
  jobs: JobMatchItem[];
  onJobsChange: (jobs: JobMatchItem[]) => void;
}) {
  const { toast } = useToast();

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState<number>(0);

  const selected = useMemo(() => jobs.filter((j) => j.selected), [jobs]);

  const candidateText = useMemo(() => (profile.resumeText ?? "").trim(), [profile.resumeText]);
  const candidateName = useMemo(() => guessCandidateName(candidateText), [candidateText]);

  function updateJob(jobId: string, patch: Partial<JobMatchItem>) {
    onJobsChange(
      jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              ...patch,
            }
          : j,
      ),
    );
  }

  async function generateFor(jobId: string) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    setLoadingId(jobId);
    setGenStatus("Generating…");
    setGenProgress(5);

    let timer: any = null;
    try {
      const started = Date.now();
      timer = setInterval(() => {
        const elapsed = Date.now() - started;

        if (elapsed < 1500) setGenStatus("Reading job + CV…");
        else if (elapsed < 4500) setGenStatus("Generating custom CV…");
        else if (elapsed < 9000) setGenStatus("Generating cover letter…");
        else setGenStatus("Finalizing…");

        setGenProgress((p) => {
          const next = p + Math.max(1, Math.round((92 - p) / 18));
          return Math.min(92, next);
        });
      }, 700);

      const combinedText =
        `${job.title} @ ${job.company}\nLocation: ${job.location ?? ""}\n\n` +
        `${job.description ?? ""}\n\nCandidate:\n${candidateText}`;

      const res = await apiRequest("POST", "/api/jobs/generate", {
        jobTitle: job.title,
        companyName: job.company,
        combinedText,
      });

      const data = (await res.json()) as GenerateResult;

      updateJob(jobId, {
        generated: {
          customCv: String(data?.customCv || ""),
          coverLetter: String(data?.coverLetter || ""),
          interviewQa: Array.isArray(data?.interviewQa) ? data.interviewQa : [],
        } as any,
      });

      toast({ title: "Generated", description: "Materials created successfully." });
      setGenProgress(100);
      setGenStatus("Done");
    } catch (e: any) {
      toast({ title: "Generate failed", description: e?.message || "Failed", variant: "destructive" });
    } finally {
      if (timer) clearInterval(timer);
      setGenProgress(100);
      setGenStatus(null);
      setLoadingId(null);
      setTimeout(() => setGenProgress(0), 400);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard not available.", variant: "destructive" });
    }
  }

  async function downloadPdf(pdfTitle: string, content: string) {
    setDownloading(pdfTitle);
    try {
      const res = await apiRequest("POST", "/api/pdf", {
        title: pdfTitle,
        content,
        filename: toSafeFilename(pdfTitle) + ".pdf",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/pdf")) {
        const txt = await res.text().catch(() => "");
        throw new Error(
          `Server returned HTML instead of PDF. This usually means the API route is missing or misrouted: POST /api/pdf` +
            (txt ? `\n\n${txt.slice(0, 400)}` : ""),
        );
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = toSafeFilename(pdfTitle) + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "PDF failed", description: e?.message || "Failed", variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  }

  if (selected.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-sm text-muted-foreground">No jobs selected.</div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {loadingId ? (
        <Card className="p-4 glass-panel">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium">{genStatus || "Generating…"}</div>
              <div className="text-muted-foreground text-xs">Please wait — this can take a moment.</div>
            </div>
            <div className="text-sm font-semibold tabular-nums">{Math.min(99, Math.max(0, genProgress))}%</div>
          </div>
          <div className="pt-3">
            <Progress value={loadingId ? Math.min(99, Math.max(0, genProgress)) : 0} />
          </div>
        </Card>
      ) : null}

      {selected.map((job) => {
        const g: any = (job as any).generated || null;

        const customCv = String(g?.customCv || "");
        const coverLetter = String(g?.coverLetter || "");
        const qa = Array.isArray(g?.interviewQa) ? (g.interviewQa as InterviewQAItem[]) : [];

        const customCvTitle = `${candidateName ? candidateName + " - " : ""}Custom CV - ${job.title} @ ${job.company}`;
        const coverTitle = `${candidateName ? candidateName + " - " : ""}Cover Letter - ${job.title} @ ${job.company}`;

        const cvPdfTitle = `${candidateName ? candidateName + " - " : ""}CV - ${job.title} @ ${job.company}`;
        const coverPdfTitle = `${candidateName ? candidateName + " - " : ""}Cover Letter - ${job.title} @ ${job.company}`;

        return (
          <Card key={job.id} className="p-5 space-y-4 glass-panel">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-lg">{job.title}</div>
                <div className="text-sm text-muted-foreground">
                  {job.company} • {job.location || "United Kingdom"}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {job.applyUrl ? (
                  <Button asChild variant="secondary">
                    <a href={job.applyUrl} target="_blank" rel="noreferrer">
                      Apply <ExternalLink className="w-4 h-4 ml-2" />
                    </a>
                  </Button>
                ) : null}

                <Button onClick={() => generateFor(job.id)} disabled={loadingId !== null}>
                  {loadingId === job.id ? "Generating..." : "Generate"}
                </Button>
              </div>
            </div>

            {!g ? (
              <div className="text-sm text-muted-foreground">
                Click <span className="text-foreground font-medium">Generate</span> to create a custom CV, cover letter,
                interview Q&A and PDFs.
              </div>
            ) : (
              <Tabs defaultValue="cv" className="w-full">
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="cv">Custom CV</TabsTrigger>
                  <TabsTrigger value="cover">Cover Letter</TabsTrigger>
                  <TabsTrigger value="qa">Interview Q&A</TabsTrigger>
                </TabsList>

                <TabsContent value="cv" className="space-y-3 pt-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => copy(customCv)} disabled={!customCv.trim()}>
                      <Copy className="w-4 h-4 mr-2" /> Copy
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => downloadPdf(cvPdfTitle, customCv)}
                      disabled={!customCv.trim() || downloading !== null}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {downloading === cvPdfTitle ? "Downloading..." : "Download PDF"}
                    </Button>
                  </div>
                  <pre className="whitespace-pre-wrap text-sm bg-background/40 rounded-lg p-4 border border-white/10">
                    {customCv || "—"}
                  </pre>
                </TabsContent>

                <TabsContent value="cover" className="space-y-3 pt-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => copy(coverLetter)} disabled={!coverLetter.trim()}>
                      <Copy className="w-4 h-4 mr-2" /> Copy
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => downloadPdf(coverPdfTitle, coverLetter)}
                      disabled={!coverLetter.trim() || downloading !== null}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {downloading === coverPdfTitle ? "Downloading..." : "Download PDF"}
                    </Button>
                  </div>
                  <pre className="whitespace-pre-wrap text-sm bg-background/40 rounded-lg p-4 border border-white/10">
                    {coverLetter || "—"}
                  </pre>
                </TabsContent>

                <TabsContent value="qa" className="space-y-3 pt-3">
                  {qa.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No Q&A generated.</div>
                  ) : (
                    <div className="space-y-3">
                      {qa.map((x, idx) => (
                        <div key={idx} className="rounded-lg border border-white/10 p-4 bg-background/30">
                          <div className="text-xs text-muted-foreground mb-1">{x.type.toUpperCase()}</div>
                          <div className="font-medium">{x.q}</div>
                          <div className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{x.a}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </Card>
        );
      })}
    </div>
  );
}
