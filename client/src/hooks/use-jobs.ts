import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type InsertJobApplication, JobMatchLegacyResultSchema, type JobMatchLegacyResult } from "@shared/routes";

async function normalizeMatchResponse(raw: unknown): Promise<JobMatchLegacyResult> {
  const legacyParsed = JobMatchLegacyResultSchema.safeParse(raw);
  if (legacyParsed.success) {
    // Add new fields with defaults if not present
    const data = legacyParsed.data;
    return {
      matchPercentage: data.matchPercentage,
      matchingSkills: data.matchingSkills,
      missingSkills: data.missingSkills,
      analysis: data.analysis,
      // New fields with defaults
      strengths: (data as any).strengths ?? [],
      gaps: (data as any).gaps ?? [],
      recommendedKeywords: (data as any).recommendedKeywords ?? [],
      salaryRange: (data as any).salaryRange ?? "N/A",
      seniorityFit: (data as any).seniorityFit ?? "average",
    };
  }

  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0] as any;
    return {
      matchPercentage: typeof first?.matchPercent === "number" ? first.matchPercent : 0,
      matchingSkills: Array.isArray(first?.matchingSkills) ? first.matchingSkills : [],
      missingSkills: Array.isArray(first?.missingSkills) ? first.missingSkills : [],
      analysis: typeof first?.reasoning === "string" ? first.reasoning : "",
      strengths: [],
      gaps: [],
      recommendedKeywords: [],
      salaryRange: "N/A",
      seniorityFit: "average",
    };
  }

  return { 
    matchPercentage: 0, 
    matchingSkills: [], 
    missingSkills: [], 
    analysis: "",
    strengths: [],
    gaps: [],
    recommendedKeywords: [],
    salaryRange: "N/A",
    seniorityFit: "average",
  };
}

export function useMatchJob() {
  return useMutation({
    mutationFn: async (params: { jobDescription: string }) => {
      const validated = api.jobs.match.input.parse(params);
      const res = await fetch(api.jobs.match.path, {
        method: api.jobs.match.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to analyze job match");

      const parsed = api.jobs.match.responses[200].parse(await res.json());
      return normalizeMatchResponse(parsed);
    },
  });
}

export function useGenerateApplication() {
  return useMutation({
    mutationFn: async (params: { jobTitle: string; companyName: string; combinedText: string }) => {
      const validated = api.jobs.generate.input.parse(params);
      const res = await fetch(api.jobs.generate.path, {
        method: api.jobs.generate.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to generate application materials");
      return api.jobs.generate.responses[200].parse(await res.json());
    },
  });
}

export function useSaveJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertJobApplication) => {
      const validated = api.jobs.save.input.parse(data);
      const res = await fetch(api.jobs.save.path, {
        method: api.jobs.save.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to save job");
      // Some deployments return 201, others 200
      const json = await res.json();
      return (api.jobs.save.responses as any)[res.status]?.parse ? (api.jobs.save.responses as any)[res.status].parse(json) : json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.jobs.listSaved.path] });
    },
  });
}

export function useSavedJobs() {
  return useQuery({
    queryKey: [api.jobs.listSaved.path],
    queryFn: async () => {
      const res = await fetch(api.jobs.listSaved.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch saved jobs");
      return api.jobs.listSaved.responses[200].parse(await res.json());
    },
  });
}
