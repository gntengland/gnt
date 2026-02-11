// FILE: client/src/components/apply/MatchStep.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, RefreshCw, TrendingUp, AlertCircle, DollarSign, Target } from "lucide-react";
import type { JobMatchItem, ProfilePayload, SearchResult, MatchResult } from "./types";

function uid() {
  return crypto.randomUUID();
}

function shortenFail(s: string) {
  const t = (s || "").trim();
  if (!t) return "Unknown";
  return t.length > 200 ? t.slice(0, 200) + "…" : t;
}

async function readErrorMessage(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    return j?.error || j?.message || text || `HTTP ${res.status}`;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

function getSeniorityColor(fit?: string) {
  switch (fit) {
    case "perfect":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "good":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "average":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "poor":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getSeniorityIcon(fit?: string) {
  switch (fit) {
    case "perfect":
    case "good":
      return <TrendingUp className="w-3 h-3" />;
    case "poor":
      return <AlertCircle className="w-3 h-3" />;
    default:
      return <Target className="w-3 h-3" />;
  }
}

export default function MatchStep({
  profile,
  jobs,
  onJobsChange,
}: {
  profile: ProfilePayload;
  jobs: JobMatchItem[];
  onJobsChange: (jobs: JobMatchItem[]) => void;
}) {
  const { toast } = useToast();

  const totalMatches = 5;
  const pageSize = 1;
  const resultsPageIndex = 5;
  const totalPages = 6;

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: totalMatches });
  const [page, setPage] = useState(0);

  const [uiPercent, setUiPercent] = useState(0);
  const [countdown, setCountdown] = useState(45);

  const cancelledRef = useRef(false);

  const selectedKey = useMemo(() => {
    const q = (profile.keywords ?? "").trim().toLowerCase();
    const l = (profile.location ?? "").trim().toLowerCase();
    return `${q}__${l}`;
  }, [profile.keywords, profile.location]);

  const candidateText = useMemo(() => (profile.resumeText ?? "").trim(), [profile.resumeText]);

  // ✅ KEY CHANGE:
  // keywords optional -> if empty, tell server to build query from CV
  const queryRaw = useMemo(() => (profile.keywords || "").trim(), [profile.keywords]);
  const query = useMemo(() => (queryRaw.length >= 2 ? queryRaw : "auto"), [queryRaw]);

  // ✅ Location becomes display/meta (server will NOT inject into query text anymore)
  const locationRaw = useMemo(() => (profile.location || "").trim(), [profile.location]);
  const location = useMemo(() => (locationRaw.length >= 2 ? locationRaw : "Worldwide"), [locationRaw]);

  function mergeKeepSelected(next: JobMatchItem[]) {
    const prevMap = new Map(jobs.map((j) => [j.id, j]));
    const merged = next.map((j) => {
      const prev = prevMap.get(j.id);
      return prev ? { ...j, selected: prev.selected } : j;
    });

    merged.sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0));
    onJobsChange(merged);
  }

  async function matchOne(job: SearchResult): Promise<JobMatchItem> {
    const jd =
      `${job.title} @ ${job.company}\nLocation: ${job.location}\n\n` +
      `${job.description}\n\nCandidate:\n${candidateText}`;

    try {
      const matchRes = await apiRequest("POST", "/api/jobs/match", { jobDescription: jd });
      const match = (await matchRes.json()) as MatchResult;

      const pct = Math.max(0, Math.min(100, Math.round(match.matchPercentage ?? 0)));

      return {
        id: uid(),
        title: job.title,
        company: job.company,
        location: job.location,
        applyUrl: job.url,
        description: job.description,
        matchPercent: pct,
        matchingSkills: match.matchingSkills ?? [],
        missingSkills: match.missingSkills ?? [],
        strengths: match.strengths ?? [],
        gaps: match.gaps ?? [],
        analysis: match.analysis ?? "",
        recommendedKeywords: match.recommendedKeywords ?? [],
        salaryRange: match.salaryRange ?? "N/A",
        seniorityFit: match.seniorityFit ?? "average",
        selected: false,
      };
    } catch (err: any) {
      let reason = err?.message || "Match failed";
      try {
        const r = await fetch("/api/jobs/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobDescription: jd }),
          credentials: "include",
        });
        if (!r.ok) reason = await readErrorMessage(r);
      } catch {}

      return {
        id: uid(),
        title: job.title,
        company: job.company,
        location: job.location,
        applyUrl: job.url,
        description: job.description,
        matchPercent: 0,
        matchingSkills: [],
        missingSkills: [],
        strengths: [],
        gaps: [],
        analysis: `Match failed: ${shortenFail(String(reason))}`,
        recommendedKeywords: [],
        salaryRange: "N/A",
        seniorityFit: "average",
        selected: false,
      };
    }
  }

  async function runSearchAndMatchOnce() {
    setLoading(true);
    setPage(0);
    setProgress({ done: 0, total: totalMatches });
    setUiPercent(0);
    setCountdown(45);
    onJobsChange([]);

    try {
      const searchRes = await apiRequest("POST", "/api/jobs/search", {
        query,
        location,
        resumeText: candidateText,
      });

      const found = (await searchRes.json()) as SearchResult[];
      const top5 = (Array.isArray(found) ? found : []).slice(0, totalMatches);

      if (top5.length === 0) {
        toast({
          title: "No jobs found",
          description: "Try different keywords or refresh. (Query can be auto from your CV.)",
          variant: "destructive",
        });
        return;
      }

      const allMatched: JobMatchItem[] = [];

      for (const j of top5) {
        if (cancelledRef.current) break;
        const one = await matchOne(j);
        if (cancelledRef.current) break;

        allMatched.push(one);
        mergeKeepSelected([...allMatched]);
        setProgress({ done: allMatched.length, total: totalMatches });
      }
    } catch (e: any) {
      toast({
        title: "Search / matching failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
      onJobsChange([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, [selectedKey]);

  useEffect(() => {
    if (jobs.length === 0) runSearchAndMatchOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const realPercent = useMemo(() => {
    const t = progress.total || totalMatches;
    return Math.max(0, Math.min(100, Math.round((progress.done / t) * 100)));
  }, [progress.done, progress.total, totalMatches]);

  useEffect(() => {
    let alive = true;

    const tick = setInterval(() => {
      if (!alive) return;

      setUiPercent((p) => {
        const target = loading ? Math.min(99, Math.max(p, realPercent)) : realPercent;
        if (p >= target) return p;
        const step = Math.max(1, Math.ceil((target - p) / 6));
        return Math.min(target, p + step);
      });

      if (loading) setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);

    return () => {
      alive = false;
      clearInterval(tick);
    };
  }, [loading, realPercent]);

  useEffect(() => {
    if (!loading) setUiPercent(realPercent);
  }, [loading, realPercent]);

  const selectedCount = jobs.filter((j) => j.selected).length;

  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0));
  }, [jobs]);

  const pageJobs = useMemo(() => {
    const start = page * pageSize;
    return sortedJobs.slice(start, start + pageSize);
  }, [sortedJobs, page, pageSize]);

  const isResultsPage = page === resultsPageIndex;

  function PageLabel(idx: number) {
    if (idx === resultsPageIndex) return "Results";
    return `Page ${idx + 1}`;
  }

  const queryLabel = query === "auto" ? "Auto (from CV)" : query;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-lg font-semibold">Matched jobs ({totalMatches}) • 5 pages + Results</div>
          <div className="text-sm text-muted-foreground">
            Query: <span className="text-foreground">{queryLabel}</span> • Location:{" "}
            <span className="text-foreground">{location}</span>
          </div>

          <div className="text-sm text-muted-foreground">
            Progress: <span className="text-foreground font-medium">{progress.done}</span> / {progress.total}
            {loading ? (
              <>
                {" "}
                • Matching… <span className="text-foreground font-medium">{uiPercent}%</span>{" "}
                <span className="text-muted-foreground">({countdown}s)</span>
              </>
            ) : (
              <> • Done</>
            )}
          </div>

          <div className="pt-2 max-w-sm">
            <Progress value={loading ? uiPercent : realPercent} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => {
              onJobsChange([]);
              runSearchAndMatchOnce();
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Viewing: <span className="text-foreground font-medium">{PageLabel(page)}</span>
          {isResultsPage ? (
            <>
              {" "}
              • Selected: <span className="text-foreground font-medium">{selectedCount}</span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={!canPrev} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Prev
          </Button>
          <Button variant="secondary" disabled={!canNext} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
            Next
          </Button>
        </div>
      </div>

      {isResultsPage ? (
        <div className="grid gap-3">
          {sortedJobs.length === 0 ? (
            <Card className="p-6">
              <div className="text-sm text-muted-foreground">No results yet. Please wait for matching to finish.</div>
            </Card>
          ) : (
            sortedJobs.slice(0, totalMatches).map((j) => (
              <Card key={j.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-medium text-base">{j.title}</div>
                      <Badge variant="secondary" className="text-xs">
                        {j.company}
                      </Badge>
                      <Badge className="text-xs">{j.matchPercent ?? 0}%</Badge>
                      <Badge className={`text-xs border ${getSeniorityColor(j.seniorityFit)}`}>
                        <span className="inline-flex items-center gap-1">
                          {getSeniorityIcon(j.seniorityFit)}
                          {j.seniorityFit ?? "average"}
                        </span>
                      </Badge>
                    </div>

                    <div className="text-sm text-muted-foreground">{j.location}</div>

                    <div className="flex items-center gap-3 pt-1">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={!!j.selected}
                          onCheckedChange={(v) => {
                            const checked = !!v;
                            onJobsChange(jobs.map((x) => (x.id === j.id ? { ...x, selected: checked } : x)));
                          }}
                        />
                        Select
                      </label>

                      {j.applyUrl ? (
                        <a href={j.applyUrl} target="_blank" rel="noreferrer" className="text-sm inline-flex items-center">
                          <ExternalLink className="w-4 h-4 mr-1" />
                          Apply
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-right text-xs text-muted-foreground space-y-1">
                    <div className="inline-flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {j.salaryRange || "N/A"}
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      ) : jobs.length === 0 && !loading ? (
        <Card className="p-6">
          <div className="text-sm text-muted-foreground">This page is not ready yet. Please refresh.</div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {pageJobs.map((j) => (
            <Card key={j.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium text-lg">{j.title}</div>
                    <Badge variant="secondary" className="text-xs">
                      {j.company}
                    </Badge>
                    <Badge className="text-xs">{j.matchPercent ?? 0}%</Badge>

                    <Badge className={`text-xs border ${getSeniorityColor(j.seniorityFit)}`}>
                      <span className="inline-flex items-center gap-1">
                        {getSeniorityIcon(j.seniorityFit)}
                        {j.seniorityFit ?? "average"}
                      </span>
                    </Badge>
                  </div>

                  <div className="text-sm text-muted-foreground">{j.location}</div>

                  <div className="flex items-center gap-3 pt-1">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={!!j.selected}
                        onCheckedChange={(v) => {
                          const checked = !!v;
                          onJobsChange(jobs.map((x) => (x.id === j.id ? { ...x, selected: checked } : x)));
                        }}
                      />
                      Select this job
                    </label>

                    {j.applyUrl ? (
                      <a href={j.applyUrl} target="_blank" rel="noreferrer" className="text-sm inline-flex items-center">
                        <ExternalLink className="w-4 h-4 mr-1" />
                        Apply
                      </a>
                    ) : null}
                  </div>

                  {j.analysis ? <div className="text-sm text-muted-foreground pt-2">{j.analysis}</div> : null}
                </div>

                <div className="text-right text-xs text-muted-foreground space-y-1">
                  <div className="inline-flex items-center gap-1">
                    <DollarSign className="w-3 h-3" />
                    {j.salaryRange || "N/A"}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
