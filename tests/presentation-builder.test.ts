/**
 * presentation-builder.test.ts
 * Tempo Stage 3 as a slide-deck builder: six slides (Tempo's config for the
 * reusable PitchSlide) bound to the six existing PresentationForm fields in section
 * order, the section heading and direction above the slide, the "N / 6 slides
 * completed" counter, starting on the first incomplete slide, thumbnail states
 * (active, complete, empty; read-only) and the old form content and slide layouts
 * gone. Rendered to static HTML; no network.
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
  it("bind the six existing fields in section order, titled with their ValueSelling section name", () => {
    expect(TEMPO_PITCH_SLIDES.map((slide) => [slide.field, slide.title])).toEqual([
      ["businessCase", "Business Issue"],
      ["underlyingPainPoints", "Problem"],
      ["solution", "Solution"],
      ["proofPoint", "Value"],
      ["powerStakeholder", "Power"],
      ["nextStep", "Plan"],
    ]);
    // Slide N is section N (completion and the counter use section numbers).
    expect(TEMPO_PITCH_SLIDES.map((slide) => slide.field)).toEqual(PRESENTATION_SECTIONS.map((section) => section.field));
    expect(TEMPO_PITCH_SLIDES.map((slide) => slide.title)).toEqual(PRESENTATION_SECTIONS.map((section) => section.title));
    expect(TEMPO_PITCH_SLIDES[0]?.direction).toBe(
      "Recap the business issue in their words. What did they say matters most? 2–3 short lines."
    );
    expect(TEMPO_PITCH_SLIDES[3]?.direction).toBe("Put a number on what fixing this is worth to them.");
    expect(TEMPO_PITCH_SLIDES[3]?.directionNote).toBe(PRESENTATION_PAYOFF_REFERENCE);
    expect(TEMPO_PITCH_SLIDES.filter((slide) => slide.directionNote)).toHaveLength(1);
  });
});

describe("the builder", () => {
  it("shows the counter next to Submit and starts on the first incomplete slide", () => {
    const html = render({ ...EMPTY_PRESENTATION_FORM, businessCase: "They lose patients to phone tag.", underlyingPainPoints: "Front desk overload." });
    expect(html).toContain("2 / 6 slides completed");
    expect(html).toContain('aria-label="Solution"');
    expect(html).toContain('placeholder="Type here…"');
    // The active slide is the editable one; thumbnails are read-only (one text area on the page).
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).toContain("Tempo · Prepared for Summit Dental Group");
  });

  it("above the slide: the section name as a large navy heading, then the direction at 16px", () => {
    const html = render({ ...EMPTY_PRESENTATION_FORM, businessCase: "They lose patients to phone tag.", underlyingPainPoints: "Front desk overload." });
    expect(html).toContain('<h2 class="text-[30px] leading-tight font-bold" style="color:#1a1a2e">Solution</h2>');
    expect(html).toContain(
      '<p class="mt-1 text-[16px] leading-relaxed text-on-surface-variant">Connect Tempo to the problems they named. Only what they need. 2–3 short lines.</p>'
    );
    expect(html).not.toContain(PRESENTATION_PAYOFF_REFERENCE);
    // The old small direction line is gone.
    expect(html).not.toContain('<p class="text-body-md text-on-surface-variant">');
  });

  it("the Value slide keeps the ROI reference as a second line", () => {
    const html = render({
      ...EMPTY_PRESENTATION_FORM,
      businessCase: "They lose patients to phone tag.",
      underlyingPainPoints: "Front desk overload.",
      solution: "Automated reminders.",
    });
    expect(html).toContain('style="color:#1a1a2e">Value</h2>');
    expect(html).toContain("Put a number on what fixing this is worth to them.");
    expect(html).toContain(PRESENTATION_PAYOFF_REFERENCE);
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
    expect(render(full, true)).toContain('aria-label="Business Issue"');
    expect(render(EMPTY_PRESENTATION_FORM)).toContain('aria-label="Business Issue"');
  });

  it("thumbnails: six read-only slides, the active one marked, complete ones checked, empty ones dashed", () => {
    const html = render({ ...EMPTY_PRESENTATION_FORM, businessCase: "They lose patients to phone tag." });
    expect(html.match(/aria-label="Slide \d: /g)).toHaveLength(6);
    expect(html).toContain('aria-label="Slide 1: Business Issue (complete)"');
    expect(html).toContain('aria-current="step" aria-label="Slide 2: Problem"');
    expect(html).toContain("border-dashed");
    expect(html.match(/check_circle/g)).toHaveLength(1);
    // Thumbnails show the slide's text without a box; only the active slide has one.
    expect(html.match(/--pitch-box-border:/g)).toHaveLength(1);
    expect(html).toContain("They lose patients to phone tag.");
    // No "1 Business Issue" caption under the thumbnails (each slide shows its own title and number).
    expect(html).not.toMatch(/<span class="font-semibold">\d<\/span>/);
  });

  it("the old slide layouts and their data are gone", () => {
    const html = render(EMPTY_PRESENTATION_FORM);
    for (const removed of ["data-pitch-layout", "What we heard", "The cost of the problem", "Walkthrough", "With Tempo", "“"]) {
      expect(html, removed).not.toContain(removed);
    }
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
