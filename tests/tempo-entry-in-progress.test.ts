/**
 * tempo-entry-in-progress.test.ts
 * The in-progress Tempo entry page layout: each roadmap stage shows its expected
 * time; the bottom row is Continue (normal-size gold button, same link and label)
 * then Restart (the red "danger" variant), and Restart is no longer in the hero;
 * the onboarding video button sits inside Assignment Objective; Key KPI and Sim
 * Time are plain facts, not boxes. Rendered to static HTML; no network.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TempoEntryInProgress } from "@/components/tempo/TempoEntryInProgress";
import { ToastProvider } from "@/hooks/useToast";
import { TEMPO_STAGES } from "@/lib/tempo-simulation";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

const CTA_HREF = "/student/simulation/sim-1?classId=class-1";

const render = (restartAttemptId: string | null = "attempt-1"): string =>
  renderToStaticMarkup(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(TempoEntryInProgress, {
        classId: "class-1",
        simulationId: "sim-1",
        simulationTitle: "Tempo",
        ctaHref: CTA_HREF,
        ctaLabel: "Continue Stage 2",
        currentStage: "discovery",
        completedStageKeys: new Set(["prospecting"]),
        lastStageScore: 82,
        restartAttemptId,
      })
    )
  );

describe("in-progress entry page", () => {
  const html = render();

  it("roadmap: each stage shows its expected time under its name, in the fresh-start size and font", () => {
    for (const stage of TEMPO_STAGES) {
      expect(html, stage.title).toContain(
        `${stage.title}</p><p class="mt-1 text-[11px] font-code-md text-white/60">${stage.time}</p>`
      );
    }
  });

  it("buttons row: Continue (normal size, same link and label), then the red Restart; none in the hero", () => {
    const continueLink = html.match(new RegExp(`<a class="([^"]*)" href="${CTA_HREF.replace(/[?]/g, "\\?")}">Continue Stage 2`));
    expect(continueLink).not.toBeNull();
    const continueClasses = continueLink?.[1]?.split(" ") ?? [];
    for (const part of ["bg-tertiary-container", "h-12", "px-6", "text-base", "rounded-lg"]) {
      expect(continueClasses, part).toContain(part);
    }
    expect(continueClasses).not.toContain("hover:scale-105");

    expect(html.match(/>Restart</g)).toHaveLength(1);
    const restart = html.match(/<button type="button" class="([^"]*)"><span[^>]*>restart_alt<\/span>Restart<\/button>/);
    const restartClasses = restart?.[1]?.split(" ") ?? [];
    for (const part of ["bg-[#b3261e]", "text-white", "h-12", "px-5", "rounded-lg"]) {
      expect(restartClasses, part).toContain(part);
    }
    expect(html.indexOf("Continue Stage 2")).toBeLessThan(html.indexOf(">Restart<"));
    // The hero keeps its Back link; Restart sits after the roadmap now.
    expect(html.indexOf(">Restart<")).toBeGreaterThan(html.indexOf("Simulation Roadmap"));
    expect(html).toContain("Back");
  });

  it("no Restart without an attempt to restart", () => {
    expect(render(null)).not.toContain(">Restart<");
  });

  it("the onboarding video button sits at the bottom of Assignment Objective, not in the buttons row", () => {
    const video = html.indexOf("Watch onboarding video");
    expect(video).toBeGreaterThan(html.indexOf("Assignment Objective"));
    expect(video).toBeLessThan(html.indexOf("Product Focus"));
    expect(html.match(/Watch onboarding video/g)).toHaveLength(1);
    expect(html).toContain("play_circle");
  });

  it("Key KPI and Sim Time are plain facts in one row, not bordered boxes", () => {
    expect(html).toContain("<dt class=\"font-bold text-on-surface\">Key KPI</dt>");
    expect(html).toContain("<dt class=\"font-bold text-on-surface\">Sim Time</dt>");
    expect(html).toContain("sm:border-l sm:border-outline-variant sm:pl-6");
    expect(html).not.toContain("p-4 border border-outline-variant rounded-lg");
  });
});
