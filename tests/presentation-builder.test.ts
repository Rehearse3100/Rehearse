/**
 * presentation-builder.test.ts
 * Tempo Stage 3 as a slide-deck builder: six slides (Tempo's config for the
 * reusable PitchSlide) bound to the six existing PresentationForm fields in section
 * order, the "N / 6 slides completed" counter, starting on the first incomplete
 * slide, thumbnail states (active, complete, empty; read-only) and the old form
 * content gone. Rendered to static HTML; no network.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PresentationStageLayout } from "@/components/tempo/stages/PresentationStageLayout";
import {
  EMPTY_PRESENTATION_FORM,
  PRESENTATION_PAYOFF_REFERENCE,
  PRESENTATION_SECTIONS,
  TEMPO_PITCH_SLIDES,
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
  it("bind the six existing fields in section order, with their ValueSelling label, title and direction", () => {
    expect(TEMPO_PITCH_SLIDES.map((slide) => [slide.field, slide.sectionLabel, slide.title])).toEqual([
      ["businessCase", "Business Issue", "What we heard"],
      ["underlyingPainPoints", "Problem", "The cost of the problem"],
      ["solution", "Solution", "How Tempo fixes it"],
      ["proofPoint", "Value", "The impact"],
      ["powerStakeholder", "Power", "Who's involved"],
      ["nextStep", "Plan", "Next steps"],
    ]);
    // Slide N is section N (completion and the counter use section numbers).
    expect(TEMPO_PITCH_SLIDES.map((slide) => slide.field)).toEqual(PRESENTATION_SECTIONS.map((section) => section.field));
    expect(TEMPO_PITCH_SLIDES.map((slide) => slide.sectionLabel)).toEqual(PRESENTATION_SECTIONS.map((section) => section.title));
    expect(TEMPO_PITCH_SLIDES[3]?.direction).toBe("Put a number on what fixing this is worth to them.");
    expect(TEMPO_PITCH_SLIDES[3]?.directionNote).toBe(PRESENTATION_PAYOFF_REFERENCE);
    expect(TEMPO_PITCH_SLIDES.filter((slide) => slide.directionNote)).toHaveLength(1);
  });
});

describe("the builder", () => {
  it("shows the counter next to Submit and starts on the first incomplete slide", () => {
    const html = render({ ...EMPTY_PRESENTATION_FORM, businessCase: "They lose patients to phone tag.", underlyingPainPoints: "Front desk overload." });
    expect(html).toContain("2 / 6 slides completed");
    expect(html).toContain("Connect Tempo to the problems they named.");
    expect(html).toContain('aria-label="How Tempo fixes it"');
    expect(html).toContain('placeholder="Type here…"');
    // The active slide is the editable one; thumbnails are read-only (one text area on the page).
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).toContain("Tempo · Prepared for Summit Dental Group");
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

  it("keeps the stage's navy mission sidebar; the old hint, heading and form are gone", () => {
    const html = render(EMPTY_PRESENTATION_FORM);
    for (const kept of ["Current Phase", "Stage 3: Presentation", "Your Mission", "Your Audience"]) {
      expect(html, kept).toContain(kept);
    }
    for (const removed of ["Need a starting point?", "Present to Dana and Dr. Kim", "Type your answer"]) {
      expect(html, removed).not.toContain(removed);
    }
    expect(html).toContain("← Previous");
    expect(html).toContain("Next slide →");
  });
});
