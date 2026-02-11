// FILE: server/auth.ts
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy, type Profile as GoogleProfile } from "passport-google-oauth20";
import bcrypt from "bcryptjs";
import crypto from "crypto";
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

function isProd(app: Express) {
  return app.get("env") === "production";
}

function baseUrl() {
  // ✅ You can set BASE_URL=https://your-service.onrender.com
  // fallback: Render provides RENDER_EXTERNAL_URL sometimes; otherwise empty
  return (
    process.env.BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ""
  ).replace(/\/+$/, "");
}

function googleCallbackUrl() {
  // ✅ exact path used by client/shared/routes
  // /api/auth/google/callback
  const b = baseUrl();
  if (b) return `${b}/api/auth/google/callback`;

  // fallback: relative (works same-origin in many cases)
  return "/api/auth/google/callback";
}

async function getOrCreateGoogleUser(params: { email: string; name: string | null }) {
  const email = String(params.email || "").trim().toLowerCase();
  if (!email) throw new Error("Google account has no email");

  // If exists -> return safe user
  const existing = await storage.getUserByEmail(email);
  if (existing) {
    const { passwordHash, ...safe } = existing as any;
    return safe as AuthUser;
  }

  // Otherwise create with NULL password_hash (Google users)
  const pool = getPool();
  const id = crypto.randomUUID();
  const name = params.name ? String(params.name).trim() : null;

  const { rows } = await pool.query(
    `INSERT INTO app_users (id, email, name, password_hash, created_at)
     VALUES ($1, $2, $3, NULL, now())
     RETURNING id, email, name`,
    [id, email, name],
  );

  const u = rows[0];
  return AuthUserSchema.parse({
    id: u.id,
    email: u.email,
    name: u.name ?? null,
  });
}

/**
 * Create ONLY app tables. DO NOT touch "session" table here.
 * connect-pg-simple will create session table by itself when createTableIfMissing=true.
 */
export async function ensureCoreTables() {
  const pool = getPool();

  // ✅ app_users: make password_hash nullable (needed for Google users)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY,
      email text UNIQUE NOT NULL,
      name text,
      password_hash text,
      created_at timestamptz DEFAULT now()
    );
  `);

  // ✅ If table existed earlier with NOT NULL, fix it safely
  try {
    await pool.query(`ALTER TABLE app_users ALTER COLUMN password_hash DROP NOT NULL;`);
  } catch {
    // ignore (already nullable / no permission / etc.)
  }

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

  // ✅ Render/Proxy safety (so secure cookies + redirects behave)
  if (isProd(app)) {
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
        secure: isProd(app), // ✅ required for https on Render
        httpOnly: true,
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

        const { passwordHash, ...safe } = user as any;
        return done(null, safe);
      } catch (err) {
        return done(err);
      }
    }),
  );

  // -----------------------------
  // Google strategy
  // -----------------------------
  const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

  if (googleClientId && googleClientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: googleCallbackUrl(),
        },
        async (_accessToken: string, _refreshToken: string, profile: GoogleProfile, done) => {
          try {
            const email =
              profile.emails?.[0]?.value ||
              "";
            const name =
              profile.displayName ||
              [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(" ") ||
              null;

            const user = await getOrCreateGoogleUser({ email, name });
            return done(null, user);
          } catch (err) {
            return done(err as any);
          }
        },
      ),
    );

    // ✅ Start Google OAuth
    app.get(
      "/api/auth/google",
      passport.authenticate("google", {
        scope: ["profile", "email"],
        prompt: "select_account",
      }),
    );

    // ✅ Callback
    app.get(
      "/api/auth/google/callback",
      passport.authenticate("google", {
        failureRedirect: "/login",
      }),
      (_req, res) => {
        // same-origin SPA
        res.redirect("/dashboard");
      },
    );
  } else {
    // If env vars missing, keep endpoint but return a clear error (no silent fail)
    app.get("/api/auth/google", (_req, res) => {
      res.status(500).send("Google OAuth is not configured (missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET).");
    });
    app.get("/api/auth/google/callback", (_req, res) => {
      res.status(500).send("Google OAuth is not configured.");
    });
  }

  // -----------------------------
  // Session serialize/deserialize
  // -----------------------------
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUserById(id);
      if (!user) return done(null, false);

      const { passwordHash, ...safe } = user as any;
      return done(null, safe);
    } catch (err) {
      return done(err as any);
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

  // storage.createUser in your repo currently expects passwordHash required.
  // that's correct for email/password registrations.
  const user = await storage.createUser({
    email: input.email,
    passwordHash: hash,
    name: input.name ?? null,
  } as any);

  const { passwordHash, ...safe } = user as any;
  return safe;
}

export async function loginWithEmailPassword(input: { email: string; password: string }) {
  const user = await storage.getUserByEmail(input.email);
  if (!user || !user.passwordHash) throw new Error("Invalid credentials");

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new Error("Invalid credentials");

  const { passwordHash, ...safe } = user as any;
  return safe;
}
