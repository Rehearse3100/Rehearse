/**
 * student-login-route.test.ts
 * POST /api/student/login (app/api/student/login/route.ts) with the failed-login
 * limits (lib/student-login-limits.ts): an unknown username and a wrong password
 * get the same reply; after 10 failures per username or 30 per IP in 15 minutes the
 * next attempt gets 429 (even with the right password) and isn't recorded; a
 * successful login records nothing; the check fails open when the table can't be
 * read. Fake database, mocked password check and session; no network, no live
 * database. Password hashing and sessions aren't exercised here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/student/login/route";
import {
  LOGIN_FAILURES_PER_IP_MAX,
  LOGIN_FAILURES_PER_USERNAME_MAX,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_REPLIES,
} from "@/lib/student-login-limits";

// ── Fakes ───

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  students: [] as Array<Record<string, unknown>>,
  failures: [] as Array<Record<string, unknown>>,
  /** When true, the failure count query returns an error (table unreachable). */
  isCountBroken: false,
  /** When true, recording a failure returns an error. */
  isInsertBroken: false,
}));

const session = vi.hoisted(() => ({ create: vi.fn(async (): Promise<void> => undefined) }));

vi.mock("@/lib/password", () => ({
  verifyPassword: vi.fn(async (password: string): Promise<boolean> => password === "right-password"),
}));

vi.mock("@/lib/student-session", () => ({
  createStudentSession: session.create,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      const rows = (): Row[] => (table === "students" ? state.students : state.failures);
      const filters: Array<(row: Row) => boolean> = [];
      let isCount = false;
      const matching = (): Row[] => rows().filter((row) => filters.every((keep) => keep(row)));
      const builder = {
        select: (_columns: string, options?: { count?: string; head?: boolean }) => {
          isCount = options?.head === true;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return builder;
        },
        gte: (column: string, value: string) => {
          filters.push((row) => String(row[column]) >= value);
          return builder;
        },
        single: () => Promise.resolve({ data: matching()[0] ?? null, error: null }),
        insert: (row: Row) => {
          if (state.isInsertBroken) {
            return Promise.resolve({ error: { message: "insert failed" } });
          }
          state.failures.push({ ...row, created_at: new Date().toISOString() });
          return Promise.resolve({ error: null });
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const result =
            isCount && state.isCountBroken
              ? { count: null, error: { message: 'relation "student_login_failures" does not exist' } }
              : { count: matching().length, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

/** Posts a login with the given credentials from the given IP. */
async function login(
  username: string,
  password: string,
  ip = "203.0.113.7"
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await POST(
    new Request("http://localhost/api/student/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
      body: JSON.stringify({ username, password }),
    })
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  state.students = [{ id: "student-1", username: "sam", display_name: "Sam Student", password_hash: "hash" }];
  state.failures = [];
  state.isCountBroken = false;
  state.isInsertBroken = false;
  session.create.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Same reply ───

describe("an unknown username and a wrong password", () => {
  it("get the same status and the same message", async () => {
    const unknown = await login("nobody", "whatever");
    const wrong = await login("sam", "wrong-password");
    expect(unknown).toEqual({ status: 401, body: { error: LOGIN_REPLIES.invalid } });
    expect(wrong).toEqual(unknown);
    expect(session.create).not.toHaveBeenCalled();
  });

  it("each counts as one failure; the IP is stored only as a hash", async () => {
    await login("nobody", "whatever");
    await login("Sam", "wrong-password");
    expect(state.failures.map((row) => row.username)).toEqual(["nobody", "sam"]);
    for (const row of state.failures) {
      expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    }
  });

  it("missing fields still get 400 and aren't counted (unchanged)", async () => {
    expect((await login("", "x")).status).toBe(400);
    expect(state.failures).toHaveLength(0);
  });
});

// ── Limits ───

describe("the failed-login limits", () => {
  it(`after ${LOGIN_FAILURES_PER_USERNAME_MAX} failures for a username, the next attempt gets 429, even with the right password`, async () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_USERNAME_MAX; i += 1) {
      expect((await login("sam", "wrong-password", `198.51.100.${i}`)).status).toBe(401);
    }
    const blocked = await login("SAM", "right-password", "192.0.2.50");
    expect(blocked).toEqual({ status: 429, body: { error: LOGIN_REPLIES.tooMany } });
    expect(session.create).not.toHaveBeenCalled();
    // The 429 isn't recorded, so retrying doesn't extend the lockout.
    expect(state.failures).toHaveLength(LOGIN_FAILURES_PER_USERNAME_MAX);
    // Another username is unaffected.
    expect((await login("other", "x", "192.0.2.50")).status).toBe(401);
  });

  it(`after ${LOGIN_FAILURES_PER_IP_MAX} failures from one IP, the next attempt from it gets 429; other IPs are unaffected`, async () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_IP_MAX; i += 1) {
      expect((await login(`user-${i}`, "x")).status).toBe(401);
    }
    expect((await login("sam", "right-password")).status).toBe(429);
    expect((await login("sam", "right-password", "192.0.2.99")).status).toBe(200);
  });

  it("failures older than the window don't count", async () => {
    const old = new Date(Date.now() - LOGIN_FAILURE_WINDOW_MS - 60_000).toISOString();
    for (let i = 0; i < LOGIN_FAILURES_PER_USERNAME_MAX; i += 1) {
      state.failures.push({ username: "sam", ip_hash: "old", created_at: old });
    }
    expect((await login("sam", "right-password")).status).toBe(200);
  });

  it("a successful login isn't counted", async () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_USERNAME_MAX - 1; i += 1) {
      await login("sam", "wrong-password");
    }
    for (let i = 0; i < 5; i += 1) {
      expect(await login("sam", "right-password")).toEqual({ status: 200, body: { success: true } });
    }
    expect(state.failures).toHaveLength(LOGIN_FAILURES_PER_USERNAME_MAX - 1);
    expect(session.create).toHaveBeenCalledTimes(5);
    expect(session.create).toHaveBeenCalledWith({ studentId: "student-1", username: "sam", displayName: "Sam Student" });
  });
});

// ── Fail open ───

describe("when the failures table can't be used", () => {
  it("the limit check fails open and logs", async () => {
    state.isCountBroken = true;
    expect((await login("sam", "right-password")).status).toBe(200);
    expect((await login("sam", "wrong-password")).status).toBe(401);
    expect(console.error).toHaveBeenCalledWith(
      "[student-login] login limits unavailable, allowing:",
      expect.anything()
    );
  });

  it("a failed insert is logged and the student still gets the normal reply", async () => {
    state.isInsertBroken = true;
    expect(await login("sam", "wrong-password")).toEqual({ status: 401, body: { error: LOGIN_REPLIES.invalid } });
    expect(console.error).toHaveBeenCalledWith("[student-login] recording a failed login failed:", expect.anything());
  });
});
