// FILE: server/auth.ts
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { storage } from "./storage";
import { getPool } from "./db";

/**
 * IMPORTANT:
 * - server/index.ts expects BOTH: setupAuth + ensureCoreTables
 * - DO NOT manually manage the connect-pg-simple session table (it does it itself).
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
 * Create ONLY app tables.
 * Also: Google users may not have password_hash, so it MUST be nullable.
 */
export async function ensureCoreTables() {
  const pool = getPool();

  // 1) Create if missing (password_hash nullable ✅)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY,
      email text UNIQUE NOT NULL,
      name text,
      password_hash text,
      created_at timestamptz DEFAULT now()
    );
  `);

  // 2) If table existed before with NOT NULL, relax it (safe in Postgres)
  await pool.query(`
    DO $$
    BEGIN
      -- only if column exists
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name='app_users' AND column_name='password_hash'
      ) THEN
        BEGIN
          ALTER TABLE app_users ALTER COLUMN password_hash DROP NOT NULL;
        EXCEPTION WHEN others THEN
          -- ignore if already nullable / or insufficient privilege
        END;
      END IF;
    END
    $$;
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

function envAny(keys: string[]) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function baseUrlFromEnv() {
  // You can set BASE_URL in Render env: https://your-app.onrender.com
  // or use RENDER_EXTERNAL_URL if you have it.
  return envAny(["BASE_URL", "RENDER_EXTERNAL_URL", "PUBLIC_URL"]).replace(/\/$/, "");
}

export function setupAuth(app: Express) {
  const PgSession = connectPgSimple(session);
  const pool = getPool();

  // trust proxy so secure cookies + oauth redirect work on Render
  if (app.get("env") === "production") app.set("trust proxy", 1);

  app.use(
    session({
      store: new PgSession({
        pool,
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || "change_me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: app.get("env") === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // -----------------------------
  // Local strategy (email/password)
  // -----------------------------
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

  // -----------------------------
  // Google strategy
  // -----------------------------
  const googleClientId = envAny(["GOOGLE_CLIENT_ID"]);
  const googleClientSecret = envAny(["GOOGLE_CLIENT_SECRET"]);

  if (googleClientId && googleClientSecret) {
    const base = baseUrlFromEnv();
    const callbackURL =
      envAny(["GOOGLE_CALLBACK_URL"]) ||
      (base ? `${base}/api/auth/google/callback` : "/api/auth/google/callback");

    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL,
          proxy: true, // important behind proxies (Render)
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = String(profile?.emails?.[0]?.value || "").trim().toLowerCase();
            const name = String(profile?.displayName || "").trim() || null;

            if (!email) return done(null, false);

            // If user exists -> login
            const existing = await storage.getUserByEmail(email);
            if (existing) {
              const { passwordHash, ...safe } = existing;
              return done(null, safe);
            }

            // Else create user with NULL password_hash
            const created = await storage.createUser({
              email,
              name,
              passwordHash: null,
            });

            const { passwordHash, ...safe } = created;
            return done(null, safe);
          } catch (err) {
            return done(err as any);
          }
        },
      ),
    );

    // Start Google OAuth
    app.get(
      "/api/auth/google",
      passport.authenticate("google", {
        scope: ["profile", "email"],
        prompt: "select_account",
      }),
    );

    // Callback
    app.get(
      "/api/auth/google/callback",
      passport.authenticate("google", {
        failureRedirect: "/login",
        session: true,
      }),
      (_req, res) => {
        // successful auth
        res.redirect("/dashboard");
      },
    );
  } else {
    // Optional: expose a clear error in logs
    console.warn("⚠️ Google OAuth disabled: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set");
  }

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

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
