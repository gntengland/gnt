// FILE: shared/routes.ts
import { z } from "zod";
import {
  RegisterInputSchema,
  LoginInputSchema,
  AuthUserSchema,
  UserProfileSchema,
  UpdateProfileInputSchema,
  AnalyzeCvInputSchema,
  AnalyzeCvResultSchema,
} from "./schema";

// ✅ IMPORTANT: re-export auth/profile schemas so server/client can import from "@shared/routes"
export {
  RegisterInputSchema,
  LoginInputSchema,
  AuthUserSchema,
  UserProfileSchema,
  UpdateProfileInputSchema,
  AnalyzeCvInputSchema,
  AnalyzeCvResultSchema,
};

/**
 * Types used by client hooks
 */
export type InsertUserProfile = z.infer<typeof UpdateProfileInputSchema>;

/* -------------------------------------------------------
   APPLY WIZARD: Jobs / Matching / Generate
------------------------------------------------------- */
export const JobSearchInputSchema = z.object({
  query: z.string().min(2),
  location: z.string().min(2),
  // ✅ optional resume text for rerank (Jina)
  resumeText: z.string().optional(),
});

export const JobSearchItemSchema = z.object({
  title: z.string(),
  company: z.string().optional().default(""),
  location: z.string().optional().default(""),
  description: z.string().optional().default(""),
  url: z.string().url(),
  date: z.string().optional(),
});
export type JobSearchItem = z.infer<typeof JobSearchItemSchema>;

export const JobMatchInputSchema = z.object({
  jobDescription: z.string().min(10),
});

export const JobMatchItemSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string().optional().default(""),
  url: z.string().url().optional(),
  matchPercent: z.number().min(0).max(100),
  reasoning: z.string().optional().default(""),
  matchingSkills: z.array(z.string()).optional().default([]),
  missingSkills: z.array(z.string()).optional().default([]),
  recommendedKeywords: z.array(z.string()).optional().default([]),
});
export type JobMatchItem = z.infer<typeof JobMatchItemSchema>;

export const JobMatchLegacyResultSchema = z.object({
  matchPercentage: z.number().min(0).max(100),
  matchingSkills: z.array(z.string()).optional().default([]),
  missingSkills: z.array(z.string()).optional().default([]),
  analysis: z.string().optional().default(""),
  strengths: z.array(z.string()).optional().default([]),
  gaps: z.array(z.string()).optional().default([]),
  recommendedKeywords: z.array(z.string()).optional().default([]),
  salaryRange: z.string().optional().default("N/A"),
  seniorityFit: z.enum(["perfect", "good", "average", "poor"]).optional().default("average"),
});
export type JobMatchLegacyResult = z.infer<typeof JobMatchLegacyResultSchema>;

export const JobMatchResponseSchema = z.union([z.array(JobMatchItemSchema), JobMatchLegacyResultSchema]);

export const GenerateMaterialsInputSchema = z.object({
  jobTitle: z.string().min(1),
  companyName: z.string().min(1),
  combinedText: z.string().min(10),
});

export const GenerateMaterialsResultSchema = z.object({
  customCv: z.string(),
  coverLetter: z.string(),
  interviewQa: z
    .array(
      z.object({
        q: z.string(),
        a: z.string(),
        type: z.enum(["general", "technical"]),
      }),
    )
    .optional(),
});
export type GenerateMaterialsResult = z.infer<typeof GenerateMaterialsResultSchema>;

export const SaveJobApplicationInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().optional(),
  url: z.string().url().optional(),
  matchPercent: z.number().min(0).max(100).optional(),
  reasoning: z.string().optional(),
  createdAt: z.string().optional(),
});
export type InsertJobApplication = z.infer<typeof SaveJobApplicationInputSchema>;

export const PdfInputSchema = z.object({
  title: z.string().optional(),
  content: z.string().min(1),
});

export const routes = {
  auth: {
    register: { path: "/api/auth/register" },
    login: { path: "/api/auth/login" },
    logout: { path: "/api/auth/logout" },
    me: { path: "/api/auth/me" },
    googleStart: { path: "/api/auth/google" },
    googleCallback: { path: "/api/auth/google/callback" },
  },
  profile: {
    get: { path: "/api/profile" },
    update: { path: "/api/profile" },
    uploadCv: { path: "/api/profile/upload-cv" },
    analyzeCv: { path: "/api/profile/analyze-cv" },
  },
  jobs: {
    search: { path: "/api/jobs/search" },
    match: { path: "/api/jobs/match" },
    generate: { path: "/api/jobs/generate" },
    save: { path: "/api/jobs/save" },
    listSaved: { path: "/api/jobs/saved" },
  },
  pdf: {
    create: { path: "/api/pdf" },
  },
} as const;

export const api = {
  auth: {
    register: {
      method: "POST",
      path: routes.auth.register.path,
      input: RegisterInputSchema,
      responses: { 200: AuthUserSchema },
    },
    login: {
      method: "POST",
      path: routes.auth.login.path,
      input: LoginInputSchema,
      responses: { 200: AuthUserSchema },
    },
    logout: {
      method: "POST",
      path: routes.auth.logout.path,
      responses: { 200: z.any() },
    },
    me: {
      method: "GET",
      path: routes.auth.me.path,
      responses: { 200: AuthUserSchema.nullable() },
    },
  },

  profile: {
    get: {
      method: "GET",
      path: routes.profile.get.path,
      responses: { 200: UserProfileSchema.nullable() },
    },
    update: {
      method: "PATCH",
      path: routes.profile.update.path,
      input: UpdateProfileInputSchema,
      responses: { 200: UserProfileSchema },
    },
    analyzeCv: {
      method: "POST",
      path: routes.profile.analyzeCv.path,
      input: AnalyzeCvInputSchema,
      responses: { 200: AnalyzeCvResultSchema },
    },
  },

  jobs: {
    search: {
      method: "POST",
      path: routes.jobs.search.path,
      input: JobSearchInputSchema,
      responses: { 200: z.array(JobSearchItemSchema) },
    },
    match: {
      method: "POST",
      path: routes.jobs.match.path,
      input: JobMatchInputSchema,
      responses: { 200: JobMatchResponseSchema },
    },
    generate: {
      method: "POST",
      path: routes.jobs.generate.path,
      input: GenerateMaterialsInputSchema,
      responses: { 200: GenerateMaterialsResultSchema },
    },
    save: {
      method: "POST",
      path: routes.jobs.save.path,
      input: SaveJobApplicationInputSchema,
      responses: { 201: z.any(), 200: z.any() },
    },
    listSaved: {
      method: "GET",
      path: routes.jobs.listSaved.path,
      responses: { 200: z.array(z.any()) },
    },
  },

  pdf: {
    create: {
      method: "POST",
      path: routes.pdf.create.path,
      input: PdfInputSchema,
      responses: { 200: z.any() },
    },
  },
} as const;
