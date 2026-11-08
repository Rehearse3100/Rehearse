/**
 * student-login-limits.ts
 * Failed-login limits for the student login route (app/api/student/login): at most
 * LOGIN_FAILURES_PER_USERNAME_MAX failures per username and LOGIN_FAILURES_PER_IP_MAX
 * per client IP in LOGIN_FAILURE_WINDOW_MS; past either, the route answers 429 before
 * checking the password. Each failure (unknown username or wrong password) is one row
 * in public.student_login_failures (supabase/FULL-SETUP.sql; service client only); a
 * successful login writes nothing. The limit check fails open: if the table can't be
 * read, it logs and allows the login. The IP is stored only as a SHA-256 hash. The
 * fixed replies live here so the route and its tests share one text.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Limits ───

export const LOGIN_FAILURE_TABLE = "student_login_failures";
/** The window the failures are counted over: 15 minutes. */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
/** Failures per username in the window; the next attempt gets 429. */
export const LOGIN_FAILURES_PER_USERNAME_MAX = 10;
/** Failures per client IP in the window; the next attempt gets 429. */
export const LOGIN_FAILURES_PER_IP_MAX = 30;
/** Longest username kept as a limit key (real usernames are far shorter), so a huge input can't bloat the table. */
const USERNAME_KEY_MAX_CHARS = 100;

// ── Fixed replies ───

export const LOGIN_REPLIES = {
  /** One reply for an unknown username and a wrong password, so neither reveals which usernames exist. */
  invalid: "Invalid username or password.",
  tooMany: "Too many attempts. Try again in a few minutes.",
} as const;

// ── Keys ───

/** Who a failure counts against: the username and, when the request has one, the client IP's hash. */
export type LoginLimitKey = {
  username: string;
  ipHash: string | null;
};

/**
 * The limit key for a username: trimmed, lowercased and capped, so "Sam" and "sam"
 * share one count.
 */
export function loginUsernameKey(username: string): string {
  return username.trim().toLowerCase().slice(0, USERNAME_KEY_MAX_CHARS);
}

/**
 * SHA-256 (hex) of the client IP: the first x-forwarded-for entry, else x-real-ip.
 * Null when the request has neither, so requests without an IP never share one
 * per-IP count (the per-username limit still applies).
 */
export function clientIpHash(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "";
  return ip ? createHash("sha256").update(ip).digest("hex") : null;
}

// ── Checks ───

/**
 * True once the username or the IP has reached its failure limit in the last
 * LOGIN_FAILURE_WINDOW_MS (two count queries, run in parallel; the IP count is
 * skipped without an IP). Fails open: a read error is logged and allows the login.
 */
export async function isLoginLimited(
  supabase: SupabaseClient,
  key: LoginLimitKey,
  now: number = Date.now()
): Promise<boolean> {
  const since = new Date(now - LOGIN_FAILURE_WINDOW_MS).toISOString();
  const countSince = async (column: "username" | "ip_hash", value: string): Promise<number> => {
    const { count, error } = await supabase
      .from(LOGIN_FAILURE_TABLE)
      .select("id", { count: "exact", head: true })
      .eq(column, value)
      .gte("created_at", since);
    if (error) {
      throw error;
    }
    return count ?? 0;
  };

  try {
    const [byUsername, byIp] = await Promise.all([
      countSince("username", key.username),
      key.ipHash ? countSince("ip_hash", key.ipHash) : Promise.resolve(0),
    ]);
    return byUsername >= LOGIN_FAILURES_PER_USERNAME_MAX || byIp >= LOGIN_FAILURES_PER_IP_MAX;
  } catch (error) {
    console.error("[student-login] login limits unavailable, allowing:", error);
    return false;
  }
}

/**
 * Records one failed login (one row). A failed insert is logged and ignored, so the
 * student still gets the normal reply.
 */
export async function recordLoginFailure(supabase: SupabaseClient, key: LoginLimitKey): Promise<void> {
  try {
    const { error } = await supabase
      .from(LOGIN_FAILURE_TABLE)
      .insert({ username: key.username, ip_hash: key.ipHash ?? "unknown" });
    if (error) {
      throw error;
    }
  } catch (error) {
    console.error("[student-login] recording a failed login failed:", error);
  }
}
