import { z } from "zod";

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable().optional(),
});

export const RegisterInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(200).optional(),
});

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export const UserProfileSchema = z.object({
  userId: z.string().uuid(),

  // "Real" profile fields (editable)
  fullName: z.string().max(200).nullable().optional(),
  headline: z.string().max(200).nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  location: z.string().max(200).nullable().optional(),

  // CV / resume info (MVP is text-based; upload is converted to text)
  resumeText: z.string().nullable().optional(),
  cvFileUrl: z.string().url().nullable().optional(),
  linkedinUrl: z.string().url().nullable().optional(),

  parsedSkills: z.array(z.string()).default([]),
  experienceLevel: z.string().nullable().optional(),
  targetLocation: z.string().nullable().optional(),
  updatedAt: z.string(),
});

export const UpdateProfileInputSchema = z.object({
  fullName: z.string().max(200).optional().nullable(),
  headline: z.string().max(200).optional().nullable(),
  phone: z.string().max(60).optional().nullable(),
  location: z.string().max(200).optional().nullable(),

  resumeText: z.string().optional().nullable(),
  cvFileUrl: z.string().url().optional().nullable(),
  linkedinUrl: z.string().url().optional().nullable(),
  parsedSkills: z.array(z.string()).optional(),
  experienceLevel: z.string().optional().nullable(),
  targetLocation: z.string().optional().nullable(),
});

export const AnalyzeCvInputSchema = z.object({
  cvText: z.string().min(50),
});

export const AnalyzeCvResultSchema = z.object({
  summary: z.string(),
  skills: z.array(z.string()),
  roles: z.array(z.string()),
  seniority: z.enum(["intern", "junior", "mid", "senior", "lead", "unknown"]),
  suggestedHeadline: z.string(),
  keywords: z.array(z.string()),
});
