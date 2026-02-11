// FILE: script/build.ts
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, mkdir, readdir, copyFile, stat } from "fs/promises";
import path from "node:path";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function existsDir(p: string) {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function copyDir(src: string, dest: string) {
  if (!(await existsDir(src))) return;

  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);

    if (e.isDirectory()) {
      await copyDir(from, to);
    } else if (e.isFile()) {
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
    }
  }
}

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // ✅ Copy fonts into dist so PDF can always find them
  // Source: server/assets/fonts
  // Dest:   dist/server/assets/fonts
  await copyDir(
    path.resolve(process.cwd(), "server", "assets", "fonts"),
    path.resolve(process.cwd(), "dist", "server", "assets", "fonts"),
  );

  console.log("✅ build done");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
