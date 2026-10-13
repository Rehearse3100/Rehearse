/**
 * achievement-progress.test.ts
 * Results-page badge card: graded rows render exactly as before the background
 * badge grading change; pending rows show "Grading badges…" instead of locks.
 * Server-side render only (effects do not run), so no network calls happen.
 */

import { createHash } from "node:crypto";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AchievementProgress, pollStageGrading } from "@/components/tempo/AchievementProgress";
import { NEGOTIATION_BADGES, PROSPECTING_BADGES } from "@/lib/tempo-badges";
import type { StageScore } from "@/types";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

/** Builds a stage row the way the results page receives it (no badges_status field). */
function gradedRow(stage: StageScore["stage"], badgesEarned: string[]): StageScore {
  return {
    id: `row-${stage}`,
    attempt_id: "attempt-1",
    stage,
    score: 0,
    feedback: null,
    transcript: null,
    completed_at: "2026-10-01T00:00:00.000Z",
    badges_earned: badgesEarned,
  };
}

const GRADED_ROWS: StageScore[] = [
  gradedRow("prospecting", ["pros_directed_agent"]),
  gradedRow("discovery", ["disc_opc"]),
  gradedRow("presentation", []),
  gradedRow("objections", ["obj_acknowledged", "obj_held_line"]),
  gradedRow("close", ["neg_defended_value"]),
];

/** Renders the card to static HTML (no effects, no fetch). */
function renderCard(stageScores: StageScore[]): string {
  return renderToStaticMarkup(React.createElement(AchievementProgress, { stageScores }));
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("AchievementProgress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders graded rows (no badges_status) exactly as before the change", () => {
    const html = renderCard(GRADED_ROWS);
    expect(html).toContain("Achievements");
    expect(html).not.toContain("Grading badges");
    // Hash recorded from the unmodified component before this change.
    expect(sha256(html)).toBe("e4219584284aa4a427dcadec0134819415610cda2d60cd4fd3faf814de735c1a");
  });

  it("renders rows with badges_status 'done' exactly like rows without it", () => {
    const withDone = GRADED_ROWS.map((row) => ({ ...row, badges_status: "done" as const }));
    expect(renderCard(withDone)).toBe(renderCard(GRADED_ROWS));
  });

  it.each(["pending", "grading"] as const)(
    "shows 'Grading badges…' instead of locked icons for a %s stage",
    (status) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const rows = GRADED_ROWS.map((row) =>
        row.stage === "close" ? { ...row, badges_earned: [], badges_status: status } : row
      );
      const html = renderCard(rows);

      expect(html).toContain("Grading badges…");
      // "Defended Value Before Price" has no HTML-escaped characters, so absence is meaningful.
      expect(html).not.toContain(NEGOTIATION_BADGES[0].name);
      // Other sections still render their badge cells.
      expect(html).toContain(`Locked: ${PROSPECTING_BADGES[1].name}`);
      // Rendering alone never calls grade-badges (effects do not run on the server).
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});

// ── Results-page grading loop ───

describe("pollStageGrading", () => {
  const TARGET = { attemptId: "attempt-1", stage: "close" as const };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Fake fetch that answers from a list and records overlapping requests. */
  function fakeGradeFetch(replies: Array<{ status: string; badges?: string[] } | "network-error">): {
    fetchMock: ReturnType<typeof vi.fn>;
    maxInFlight: () => number;
  } {
    let inFlight = 0;
    let peak = 0;
    let index = 0;
    const fetchMock = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      await Promise.resolve();
      inFlight -= 1;
      if (reply === "network-error") {
        throw new TypeError("network");
      }
      return { ok: true, json: async () => reply };
    });
    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, maxInFlight: () => peak };
  }

  it("asks again 3 s after each 'grading' reply, one request at a time, until done", async () => {
    vi.useFakeTimers();
    const { fetchMock, maxInFlight } = fakeGradeFetch([
      { status: "grading" },
      { status: "grading" },
      { status: "done", badges: ["neg_traded"] },
    ]);
    const onDone = vi.fn();
    const onStalled = vi.fn();

    const run = pollStageGrading(TARGET, () => false, onDone, onStalled);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);
    await run;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maxInFlight()).toBe(1);
    expect(onDone).toHaveBeenCalledWith("close", ["neg_traded"]);
    expect(onStalled).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/student/grade-badges");
    expect(JSON.parse(String(init.body))).toEqual({ attemptId: "attempt-1", stage: "close" });
  });

  it("stops after 60 s of 'grading' replies and reports the stage as stalled", async () => {
    vi.useFakeTimers();
    const { fetchMock } = fakeGradeFetch([{ status: "grading" }]);
    const onDone = vi.fn();
    const onStalled = vi.fn();

    const run = pollStageGrading(TARGET, () => false, onDone, onStalled);
    await vi.advanceTimersByTimeAsync(120_000);
    await run;

    // Requests at 0, 3, …, 57 s; the next would start at 60 s, so it stops.
    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(onStalled).toHaveBeenCalledWith("close");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("reports stalled right away on a network error", async () => {
    const { fetchMock } = fakeGradeFetch(["network-error"]);
    const onDone = vi.fn();
    const onStalled = vi.fn();

    await pollStageGrading(TARGET, () => false, onDone, onStalled);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onStalled).toHaveBeenCalledWith("close");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("reports stalled on an HTTP error reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "Not found." }) }))
    );
    const onStalled = vi.fn();

    await pollStageGrading(TARGET, () => false, vi.fn(), onStalled);

    expect(onStalled).toHaveBeenCalledWith("close");
  });

  it("does nothing after it is cancelled", async () => {
    fakeGradeFetch([{ status: "done", badges: ["neg_traded"] }]);
    const onDone = vi.fn();
    const onStalled = vi.fn();

    await pollStageGrading(TARGET, () => true, onDone, onStalled);

    expect(onDone).not.toHaveBeenCalled();
    expect(onStalled).not.toHaveBeenCalled();
  });
});
