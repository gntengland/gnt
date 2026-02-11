import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool() {
  if (!pool) {
    // Prevents common pool hangs
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });

    // Pool error logging (helps debugging)
    pool.on("error", (err) => {
      console.error("PG pool error:", err);
    });
  }
  return pool;
}
