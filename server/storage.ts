// FILE: server/storage.ts
import { getPool } from "./db";
import crypto from "crypto";
import bcrypt from "bcryptjs";

type DbUserRow = {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null; // ✅ allow null for Google users
};

export const storage = {
  // =========================
  // AUTH USERS
  // =========================
  async getUserByEmail(email: string) {
    const pool = getPool();
    const { rows } = await pool.query<DbUserRow>(
      `SELECT id, email, name, password_hash
       FROM app_users
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [email],
    );

    const u = rows[0];
    if (!u) return null;

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      passwordHash: u.password_hash,
    };
  },

  async getUserById(id: string) {
    const pool = getPool();
    const { rows } = await pool.query<DbUserRow>(
      `SELECT id, email, name, password_hash
       FROM app_users
       WHERE id = $1
       LIMIT 1`,
      [id],
    );

    const u = rows[0];
    if (!u) return null;

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      passwordHash: u.password_hash,
    };
  },

  async loginWithEmail(input: { email: string; password: string }) {
    const email = String(input?.email || "").trim();
    const password = String(input?.password || "");
    if (!email || !password) throw new Error("Email and password are required");

    const user = await this.getUserByEmail(email);
    if (!user || !user.passwordHash) throw new Error("Invalid credentials");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new Error("Invalid credentials");

    return { id: user.id, email: user.email, name: user.name ?? null };
  },

  // ✅ IMPORTANT: passwordHash can be null for Google OAuth users
  async createUser(input: { email: string; name: string | null; passwordHash: string | null }) {
    const pool = getPool();

    const email = String(input.email || "").trim().toLowerCase();
    const name = input.name == null ? null : String(input.name).trim();
    const passwordHash = input.passwordHash == null ? null : String(input.passwordHash).trim();

    if (!email) throw new Error("email is required");

    const id = crypto.randomUUID();

    try {
      const { rows } = await pool.query<DbUserRow>(
        `INSERT INTO app_users (id, email, name, password_hash, created_at)
         VALUES ($1, $2, $3, $4, now())
         RETURNING id, email, name, password_hash`,
        [id, email, name, passwordHash],
      );

      const u = rows[0];
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        passwordHash: u.password_hash,
      };
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        throw new Error("Email already exists");
      }
      throw e;
    }
  },

  // =========================
  // PROFILE
  // =========================
  async getUserProfile(userId: string) {
    const pool = getPool();
    const { rows } = await pool.query(
      `
      SELECT
        user_id,
        full_name,
        headline,
        location,
        phone,
        linkedin_url,
        portfolio_url,
        COALESCE(resume_text, cv_text) AS resume_text,
        cv_file_url,
        skills,
        job_preferences,
        updated_at
      FROM user_profiles
      WHERE user_id = $1
      `,
      [userId],
    );

    if (!rows[0]) return undefined;
    const r = rows[0];

    return {
      userId: r.user_id,
      fullName: r.full_name ?? null,
      headline: r.headline ?? null,
      location: r.location ?? null,
      phone: r.phone ?? null,
      linkedinUrl: r.linkedin_url ?? null,
      portfolioUrl: r.portfolio_url ?? null,
      resumeText: r.resume_text ?? null,
      cvFileUrl: r.cv_file_url ?? null,
      skills: r.skills ?? null,
      jobPreferences: r.job_preferences ?? null,
      updatedAt: r.updated_at ?? null,
    };
  },

  async upsertUserProfile(userId: string, input: any) {
    const pool = getPool();

    const fullName = input?.fullName ?? null;
    const headline = input?.headline ?? null;
    const location = input?.location ?? null;
    const phone = input?.phone ?? null;
    const linkedinUrl = input?.linkedinUrl ?? null;
    const portfolioUrl = input?.portfolioUrl ?? null;
    const resumeText = input?.resumeText ?? null;
    const parsedSkills = input?.parsedSkills ?? input?.skills ?? null;
    const jobPreferences = input?.jobPreferences ?? null;
    const cvFileUrl = input?.cvFileUrl ?? null;

    await pool.query(
      `
      INSERT INTO user_profiles (
        user_id,
        full_name, headline, location, phone,
        linkedin_url, portfolio_url,
        resume_text,
        skills, job_preferences,
        cv_file_url,
        updated_at
      )
      VALUES (
        $1,
        $2, $3, $4, $5,
        $6, $7,
        $8,
        $9, $10,
        $11,
        now()
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        full_name = EXCLUDED.full_name,
        headline = EXCLUDED.headline,
        location = EXCLUDED.location,
        phone = EXCLUDED.phone,
        linkedin_url = EXCLUDED.linkedin_url,
        portfolio_url = EXCLUDED.portfolio_url,
        resume_text = EXCLUDED.resume_text,
        skills = EXCLUDED.skills,
        job_preferences = EXCLUDED.job_preferences,
        cv_file_url = EXCLUDED.cv_file_url,
        updated_at = now()
      `,
      [
        userId,
        fullName,
        headline,
        location,
        phone,
        linkedinUrl,
        portfolioUrl,
        resumeText,
        parsedSkills,
        jobPreferences,
        cvFileUrl,
      ],
    );

    return await this.getUserProfile(userId);
  },

  // =========================
  // JOB APPLICATIONS
  // =========================
  async saveJobApplication(userId: string, input: any) {
    const pool = getPool();

    const id = String(input?.id || crypto.randomUUID());
    const title = String(input?.title || input?.jobTitle || "").trim();
    const company = String(input?.company || "").trim();
    const location = input?.location ? String(input.location) : null;
    const url = input?.url ? String(input.url) : null;
    const matchPercent = input?.matchPercent == null ? null : Number(input.matchPercent);
    const payload = input ?? null;

    if (!title || !company) throw new Error("title and company are required");

    await pool.query(
      `
      INSERT INTO job_applications (
        id, user_id, job_title, company, url, location, match_percent, created_at, payload
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, now(), $8
      )
      ON CONFLICT (id)
      DO UPDATE SET
        job_title = EXCLUDED.job_title,
        company = EXCLUDED.company,
        url = EXCLUDED.url,
        location = EXCLUDED.location,
        match_percent = EXCLUDED.match_percent,
        payload = EXCLUDED.payload
      `,
      [id, userId, title, company, url, location, Number.isFinite(matchPercent) ? matchPercent : null, payload],
    );

    return { ok: true, id };
  },

  async listSavedJobApplications(userId: string) {
    const pool = getPool();
    const { rows } = await pool.query(
      `
      SELECT
        id,
        job_title,
        company,
        url,
        location,
        match_percent,
        created_at,
        payload
      FROM job_applications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 200
      `,
      [userId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      title: r.job_title,
      company: r.company,
      url: r.url,
      location: r.location,
      matchPercent: r.match_percent,
      createdAt: r.created_at,
      payload: r.payload,
    }));
  },
};
