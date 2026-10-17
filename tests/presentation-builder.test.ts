/**
 * presentation-builder.test.ts
 * Tempo Stage 3 as a slide-deck builder: six slides bound to the six existing
 * PresentationForm fields, the "N / 6 slides completed" counter, starting on the
 * first incomplete slide, thumbnail states (active, complete, empty) and the old
 * form content gone. Rendered to static HTML; no network.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PresentationStageLayout } from "@/components/tempo/stages/PresentationStageLayout";
import {
  EMPTY_PRESENTATION_FORM,
  PRESENTATION_PAYOFF_REFERENCE,
  PRESENTATION_SLIDES,
  type PresentationForm,
} from "@/lib/tempo-presentation";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

const render = (form: PresentationForm, canSubmit = false): string =>
  renderToStaticMarkup(
    React.createElement(PresentationStageLayout, {
      form,
      canSubmit,
      isSaving: false,
      isSubmitting: false,
      onUpdateField: vi.fn(),
      onSubmit: vi.fn(),
    })
  );

describe("the six slides", () => {
  it("bind the six existing fields in order, with their ValueSelling label, title and direction", () => {
    expect(PRESENTATION_SLIDES.map((slide) => [slide.number, slide.field, slide.label, slide.title])).toEqual([
      [1, "businessCase", "Business Issue", "What we heard"],
      [2, "underlyingPainPoints", "Problem", "The cost of the problem"],
      [3, "solution", "Solution", "How Tempo fixes it"],
      [4, "proofPoint", "Value", "The impact"],
      [5, "powerStakeholder", "Power", "Who's involved"],
      [6, "nextStep", "Plan", "Next steps"],
    ]);
    expect(PRESENTATION_SLIDES[3]?.direction).toBe("Put a number on what fixing this is worth to them.");
    expect(PRESENTATION_SLIDES[3]?.directionNote).toBe(PRESENTATION_PAYOFF_REFERENCE);
    expect(PRESENTATION_SLIDES.filter((slide) => slide.directionNote)).toHaveLength(1);
  });
});

describe("the builder", () => {
  it("shows the counter next to Submit and starts on the first incomplete slide", () => {
    const html = render({ ...EMPTY_PRESENTATION_FORM, businessCase: "They lose patients to phone tag.", underlyingPainPoints: "Front desk overload." });
    expect(html).toContain("2 / 6 slides completed");
    expect(html).toContain("Connect Tempo to the problems they named.");
    expect(html).toContain('aria-label="How Tempo fixes it"');
    expect(html).toContain('placeholder="Type here…"');
    expect(html).toContain("Section 03");
  });

  it("with every slide complete it starts on slide 1; an empty deck too", () => {
    const full: PresentationForm = {
      businessCase: "Phones are overloaded.",
      underlyingPainPoints: "Missed calls cost them.",
      solution: "Automated reminders.",
      proofPoint: "Recover lost revenue.",
      powerStakeholder: "Dana and Dr. Kim.",
      nextStep: "Pilot in two offices.",
    };
    expect(render(full, true)).toContain("6 / 6 slides completed");
    expect(render(full, true)).toContain('aria-label="What we heard"');
    expect(render(EMPTY_PRESENTATION_FORM)).toContain('aria-label="What we heard"');
  });

  it("thumbnails: six, the active one marked, complete ones checked, empty ones dashed", () => {
    const html = render({ ...EMPTY_PRESENTATION_FORM, businessCase: "They lose patients to phone tag." });
    expect(html.match(/aria-label="Slide \d: /g)).toHaveLength(6);
    expect(html).toContain('aria-label="Slide 1: What we heard (complete)"');
    expect(html).toContain('aria-current="step" aria-label="Slide 2: The cost of the problem"');
    expect(html).toContain("border-dashed");
    expect(html.match(/check_circle/g)).toHaveLength(1);
  });

  it("the old sidebar, hint and form are gone", () => {
    const html = render(EMPTY_PRESENTATION_FORM);
    for (const removed of ["Need a starting point?", "Your Mission", "Your Audience", "Present to Dana and Dr. Kim", "Type your answer"]) {
      expect(html, removed).not.toContain(removed);
    }
    expect(html).toContain("← Previous");
    expect(html).toContain("Next slide →");
  });
});
