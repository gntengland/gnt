import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { storage } from "./storage";
import { getPool } from "./db";

/**
 * IMPORTANT:
 * - server/index.ts expects BOTH: setupAuth + ensureCoreTables
 * - We MUST NOT create/alter the "session" table manually (connect-pg-simple does it).
 */

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable().optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}

/**
 * Create ONLY app tables. DO NOT touch "session" table here.
 * connect-pg-simple will create session table by itself when createTableIfMissing=true.
 */
export async function ensureCoreTables() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY,
      email text UNIQUE NOT NULL,
      name text,
      password_hash text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      full_name text,
      headline text,
      location text,
      phone text,
      linkedin_url text,
      portfolio_url text,
      resume_text text,
      cv_text text,
      skills jsonb,
      job_preferences jsonb,
      updated_at timestamptz DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_applications (
      id uuid PRIMARY KEY,
      user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
      job_title text,
      company text,
      url text,
      location text,
      match_percent int,
      created_at timestamptz DEFAULT now(),
      payload jsonb
    );
  `);
}

export function setupAuth(app: Express) {
  const PgSession = connectPgSimple(session);
  const pool = getPool();

  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
  }

  app.use(
    session({
      store: new PgSession({
        pool,
        createTableIfMissing: true, // ✅ session table handled here
      }),
      secret: process.env.SESSION_SECRET || "change_me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: app.get("env") === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
      try {
        const user = await storage.getUserByEmail(email);
        if (!user || !user.passwordHash) return done(null, false);

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return done(null, false);

        const { passwordHash, ...safe } = user;
        return done(null, safe);
      } catch (err) {
        return done(err);
      }
    }),
  );

  passport.serializeUser((user: any, done) => done(null, user.id));

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUserById(id);
      if (!user) return done(null, false);
      const { passwordHash, ...safe } = user;
      return done(null, safe);
    } catch (err) {
      return done(err);
    }
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

export function getAuthedUser(req: Request): AuthUser {
  if (!req.isAuthenticated?.() || !req.user) {
    throw new Error("Not authenticated");
  }
  return AuthUserSchema.parse(req.user);
}

export async function registerWithEmailPassword(input: { email: string; password: string; name?: string }) {
  const existing = await storage.getUserByEmail(input.email);
  if (existing) throw new Error("Email already exists");

  const hash = await bcrypt.hash(input.password, 10);
  const user = await storage.createUser({
    email: input.email,
    passwordHash: hash,
    name: input.name ?? null,
  });

  const { passwordHash, ...safe } = user;
  return safe;
}

export async function loginWithEmailPassword(input: { email: string; password: string }) {
  const user = await storage.getUserByEmail(input.email);
  if (!user || !user.passwordHash) throw new Error("Invalid credentials");

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new Error("Invalid credentials");

  const { passwordHash, ...safe } = user;
  return safe;
}
