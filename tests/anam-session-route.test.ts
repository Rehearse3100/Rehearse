/**
 * anam-session-route.test.ts
 * POST /api/student/anam-session (app/api/student/anam-session/route.ts): when Supabase or
 * Anam fails, the browser gets a generic message and none of their text; the details are
 * logged on the server. A good request still returns { sessionToken, avatarId }. Sign-in,
 * the database and Anam's token endpoint (fetch) are mocked; nothing leaves the machine.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/student/anam-session/route";
import { TEMPO_SIMULATION_ID } from "@/lib/constants";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  attempt: null as Record<string, unknown> | null,
  simulation: null as Record<string, unknown> | null,
  simulationError: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/api-auth", () => ({ requireStudentApi: state.auth }));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          table === "attempts"
            ? { data: state.attempt, error: null }
            : { data: state.simulation, error: state.simulationError },
      };
      return builder;
    },
  }),
}));

const fetchMock = vi.fn();

function request(body: unknown): Request {
  return new Request("http://x/api/student/anam-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const session = (): Promise<Response> => POST(request({ attemptId: "attempt-1", stage: "discovery" }));

beforeEach(() => {
  state.auth.mockReset();
  state.auth.mockResolvedValue({ ok: true, session: { studentId: "student-1" } });
  state.attempt = { id: "attempt-1", simulation_id: TEMPO_SIMULATION_ID };
  state.simulation = {
    id: TEMPO_SIMULATION_ID,
    anam_avatar_ids: { discovery: "avatar-1" },
    anam_voice_ids: { discovery: "voice-1" },
  };
  state.simulationError = null;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ sessionToken: "token-1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ANAM_API_KEY", "test-key");
  // Silenced, and cleared so each test sees only its own log lines.
  vi.spyOn(console, "error").mockImplementation(() => undefined).mockClear();
});

describe("POST /api/student/anam-session", () => {
  it("success: the session token and the avatar id", async () => {
    const res = await session();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionToken: "token-1", avatarId: "avatar-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a Supabase error", { message: "secret internal detail", code: "XX000" }],
    ["a missing-column error (it used to name the columns and the setup file)", { message: "column anam_avatar_ids does not exist: secret" }],
  ])("the simulation lookup fails with %s: a generic 500, logged on the server", async (_name, error) => {
    state.simulationError = error;
    const res = await session();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Could not load the simulation." });
    for (const leaked of ["secret", "anam_avatar_ids", "FULL-SETUP"]) {
      expect(text, leaked).not.toContain(leaked);
    }
    expect(console.error).toHaveBeenCalledWith("[anam-session] simulation lookup failed:", error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a JSON message", JSON.stringify({ message: "secret internal detail" })],
    ["a JSON error", JSON.stringify({ error: "secret internal detail" })],
    ["plain text", "secret internal detail"],
  ])("Anam refuses the token with %s: a generic 502, the detail logged on the server", async (_name, body) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 401 }));
    const res = await session();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Could not create Anam session." });
    expect(text).not.toContain("secret");
    expect(console.error).toHaveBeenCalledWith("[anam-session] Anam token failure:", 401, "secret internal detail");
  });
});
