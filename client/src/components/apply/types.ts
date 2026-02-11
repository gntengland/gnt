// FILE: client/src/components/apply/types.ts
export type ProfilePayload = {
  resumeText?: string;
  keywords?: string;
  location?: string;
};

export type MatchResult = {
  matchPercentage: number;
  matchingSkills: string[];
  missingSkills: string[];
  strengths?: string[];
  gaps?: string[];
  analysis: string;
  recommendedKeywords?: string[];
  salaryRange?: string;
  seniorityFit?: "perfect" | "good" | "average" | "poor";
};

export type JobMatchItem = {
  id: string;
  title: string;
  company: string;
  location?: string;
  applyUrl: string;
  description?: string;

  matchPercent: number;
  matchingSkills: string[];
  missingSkills: string[];
  strengths?: string[];
  gaps?: string[];
  analysis?: string;
  recommendedKeywords?: string[];
  salaryRange?: string;
  seniorityFit?: string;

  selected: boolean;

  generated?: {
    resumeAtsText: string;
    applicationLetterText: string;
    interviewQa: Array<{ q: string; a: string; type: "general" | "technical" }>;
  };
};

export type SearchResult = {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  date?: string;
};
