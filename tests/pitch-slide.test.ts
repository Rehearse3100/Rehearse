/**
 * pitch-slide.test.ts
 * The reusable, simulation-neutral pitch-slide template: every layout renders
 * with its config data and falls back to the plain master without it (or with
 * partial data); the one editable area writes the slide's own field; read-only
 * slides (thumbnails) have no text area; theme colors and defaults; no Tempo
 * strings in the shared files. Plus Tempo's deck config: each value traced to the
 * existing Tempo copy it comes from. Rendered to static HTML; no network.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PitchSlide } from "@/components/presentation/PitchSlide";
import {
  DEFAULT_PITCH_ACCENT,
  DEFAULT_PITCH_PRIMARY,
  formatPitchSlideNumber,
  pitchInitials,
  resolvePitchLayout,
  type PitchDeckTheme,
  type PitchSlideConfig,
} from "@/lib/pitch-deck";
import { DISCOVERY_PERSONA } from "@/lib/tempo-discovery";
import { OBJECTION_PERSONA } from "@/lib/tempo-objections";
import {
  PRESENTATION_PAYOFF_REFERENCE,
  TEMPO_PITCH_SLIDES,
  TEMPO_PITCH_THEME,
} from "@/lib/tempo-presentation";
import { TEMPO_RESEARCH_SYSTEM_PROMPT } from "@/lib/tempo-prospecting";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

const THEME: PitchDeckTheme = { productName: "Acme", customerName: "Globex" };

const BASE = {
  id: "s1",
  field: "pitchField",
  sectionLabel: "Section label",
  title: "A neutral title",
  direction: "Write something.",
};

/** One config per layout, each with complete data. */
const WITH_DATA: PitchSlideConfig[] = [
  { ...BASE, layout: "plain" },
  { ...BASE, layout: "quote", data: { attribution: "Globex · first call" } },
  { ...BASE, layout: "split-stat", data: { value: "$42", label: "lost every day", caption: "6 × $7" } },
  { ...BASE, layout: "text-rail", data: { items: ["Faster", "Cheaper", "Safer"] } },
  {
    ...BASE,
    layout: "before-after",
    data: { before: { value: "10%", label: "fail today" }, after: { value: "2%", label: "fail after" } },
  },
  {
    ...BASE,
    layout: "people",
    data: { people: [{ name: "Grace Hopper", title: "Admiral" }, { name: "Dr. Ada Lovelace", title: "Analyst", role: "Sponsor" }] },
  },
  { ...BASE, layout: "timeline", data: { steps: ["Meet", "Trial", "Launch"] } },
];

/** The strings each layout's data should put on the slide. */
const DATA_STRINGS: Record<string, string[]> = {
  plain: [],
  quote: ["Globex · first call", "“"],
  "split-stat": ["$42", "lost every day", "6 × $7"],
  "text-rail": ["Faster", "Cheaper", "Safer"],
  "before-after": ["Today", "With Acme", "10%", "fail today", "2%", "fail after"],
  people: ["GH", "Grace Hopper", "Admiral", "AL", "Dr. Ada Lovelace", "Analyst", "Sponsor"],
  timeline: ["Meet", "Trial", "Launch"],
};

const render = (slide: PitchSlideConfig, value = "Student words.", onChange?: (field: string, value: string) => void): string =>
  renderToStaticMarkup(
    React.createElement(PitchSlide<string>, { theme: THEME, slide, slideNumber: 3, value, onChange })
  );

/**
 * Finds the first host element of a type by expanding the tree; PitchSlide and its
 * parts are hook-free, so function components can be called directly.
 */
function findHost(node: React.ReactNode, type: string): React.ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findHost(child, type);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (!React.isValidElement(node)) {
    return null;
  }
  const element = node as React.ReactElement<Record<string, unknown>>;
  if (typeof element.type === "function") {
    return findHost((element.type as (props: unknown) => React.ReactNode)(element.props), type);
  }
  if (element.type === type) {
    return element;
  }
  return findHost(element.props.children as React.ReactNode, type);
}

describe("layouts", () => {
  it("each renders with its config data: the master plus the layout's content", () => {
    for (const slide of WITH_DATA) {
      const html = render(slide);
      expect(html, slide.layout).toContain(`data-pitch-layout="${slide.layout}"`);
      for (const text of [
        "Section label",
        "A neutral title",
        "Student words.",
        "Acme · Prepared for Globex",
        "03",
        ...(DATA_STRINGS[slide.layout] ?? []),
      ]) {
        expect(html, `${slide.layout}: ${text}`).toContain(text);
      }
    }
  });

  it("without its config data each falls back to the plain master without breaking", () => {
    for (const slide of WITH_DATA) {
      const bare = { ...slide, data: undefined } as PitchSlideConfig;
      const html = render(bare);
      expect(html, slide.layout).toContain('data-pitch-layout="plain"');
      expect(html).toContain("A neutral title");
      expect(html).toContain("Student words.");
      for (const text of DATA_STRINGS[slide.layout] ?? []) {
        expect(html, `${slide.layout} fallback: ${text}`).not.toContain(text);
      }
    }
  });

  it("partial data falls back too; lists are cut to 3", () => {
    const partials: PitchSlideConfig[] = [
      { ...BASE, layout: "quote", data: { attribution: "  " } },
      { ...BASE, layout: "split-stat", data: { value: "$42", label: "" } },
      { ...BASE, layout: "text-rail", data: { items: [" "] } },
      { ...BASE, layout: "before-after", data: { before: { value: "10%", label: "today" }, after: { value: "", label: "after" } } },
      { ...BASE, layout: "people", data: { people: [] } },
      { ...BASE, layout: "timeline", data: { steps: ["Only one"] } },
    ];
    for (const slide of partials) {
      expect(resolvePitchLayout(slide), slide.layout).toEqual({ layout: "plain" });
    }
    expect(resolvePitchLayout({ ...BASE, layout: "text-rail", data: { items: ["a", "b", "c", "d"] } })).toEqual({
      layout: "text-rail",
      data: { items: ["a", "b", "c"] },
    });
    expect(resolvePitchLayout({ ...BASE, layout: "timeline", data: { steps: ["a", "b"] } })).toMatchObject({
      layout: "timeline",
    });
  });
});

describe("the student's text", () => {
  it("is one editable area that writes the slide's own field", () => {
    const onChange = vi.fn();
    for (const slide of WITH_DATA) {
      onChange.mockClear();
      const tree = PitchSlide({ theme: THEME, slide: { ...slide, field: `${slide.layout}-field` }, slideNumber: 1, value: "", onChange });
      const textarea = findHost(tree, "textarea");
      expect(textarea, slide.layout).not.toBeNull();
      (textarea?.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "New text" } });
      expect(onChange, slide.layout).toHaveBeenCalledWith(`${slide.layout}-field`, "New text");
      expect(render(slide, "", onChange).match(/<textarea/g), slide.layout).toHaveLength(1);
    }
  });

  it("read-only (no onChange, as in thumbnails): no text area, the text still shows", () => {
    const html = render(WITH_DATA[0]!, "Shown as text.");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("Shown as text.");
    expect(findHost(PitchSlide({ theme: THEME, slide: WITH_DATA[0]!, slideNumber: 1, value: "x" }), "textarea")).toBeNull();
  });

  it("the placeholder defaults to Type here… and can be changed", () => {
    expect(render(WITH_DATA[0]!, "", vi.fn())).toContain('placeholder="Type here…"');
    const custom = renderToStaticMarkup(
      React.createElement(PitchSlide<string>, {
        theme: THEME,
        slide: WITH_DATA[0]!,
        slideNumber: 1,
        value: "",
        onChange: vi.fn(),
        placeholder: "Start typing",
      })
    );
    expect(custom).toContain('placeholder="Start typing"');
  });
});

describe("theme", () => {
  it("defaults to Rehearse navy and gold; a theme's own colors replace them", () => {
    const split = WITH_DATA[2]!;
    const defaults = render(split);
    expect(defaults).toContain(DEFAULT_PITCH_PRIMARY);
    expect(defaults).toContain(DEFAULT_PITCH_ACCENT);
    const themed = renderToStaticMarkup(
      React.createElement(PitchSlide<string>, {
        theme: { ...THEME, primaryColor: "#0f3d3e", accentColor: "#e07a5f" },
        slide: split,
        slideNumber: 1,
        value: "",
      })
    );
    expect(themed).toContain("#0f3d3e");
    expect(themed).toContain("#e07a5f");
    expect(themed).not.toContain(DEFAULT_PITCH_PRIMARY);
  });

  it("helpers: initials skip honorifics; slide numbers have two digits", () => {
    expect(pitchInitials("Grace Hopper")).toBe("GH");
    expect(pitchInitials("Dr. Ada Lovelace")).toBe("AL");
    expect(pitchInitials("Cher")).toBe("C");
    expect(formatPitchSlideNumber(4)).toBe("04");
    expect(formatPitchSlideNumber(12)).toBe("12");
  });
});

describe("simulation-neutral", () => {
  const TEMPO_WORDS = /\b(tempo|summit|dental|dana|reyes|saul|kim)\b/i;

  it("the shared component and its types contain no Tempo strings", () => {
    for (const file of ["components/presentation/PitchSlide.tsx", "lib/pitch-deck.ts"]) {
      const source = readFileSync(path.resolve(__dirname, "..", file), "utf8");
      expect(source.match(TEMPO_WORDS), file).toBeNull();
    }
    for (const slide of WITH_DATA) {
      expect(render(slide).match(TEMPO_WORDS), slide.layout).toBeNull();
    }
  });
});

describe("Tempo's deck config", () => {
  it("theme: Tempo for Summit Dental Group, template colors", () => {
    expect(TEMPO_PITCH_THEME).toEqual({ productName: "Tempo", customerName: "Summit Dental Group" });
  });

  it("each slide renders its configured layout (none falls back)", () => {
    expect(TEMPO_PITCH_SLIDES.map((slide) => resolvePitchLayout(slide).layout)).toEqual([
      "quote",
      "split-stat",
      "text-rail",
      "before-after",
      "people",
      "timeline",
    ]);
  });

  it("every value comes from existing Tempo copy", () => {
    const [quote, split, rail, beforeAfter, people, timeline] = TEMPO_PITCH_SLIDES;
    expect(quote).toMatchObject({ layout: "quote", data: { attribution: "Summit Dental Group · discovery call" } });

    // The ROI reference keeps its exact text; the stat and caption are its parts.
    expect(PRESENTATION_PAYOFF_REFERENCE).toBe("Reference: 6,400 appts × 18% no-shows × $120 = $138,240/month lost");
    expect(split).toMatchObject({
      layout: "split-stat",
      data: { value: "$138,240", label: "lost to no-shows every month", caption: "6,400 appts × 18% no-shows × $120" },
    });

    // ABOUT TEMPO key values in the research prompt.
    expect(rail).toMatchObject({ layout: "text-rail", data: { items: ["Cut no-shows", "Free the front desk", "Capture after-hours demand"] } });
    expect(TEMPO_RESEARCH_SYSTEM_PROMPT).toContain("Key value: cut no-shows, free the front desk, capture after-hours demand");

    // Both cards are the no-show rate: 18% from the ROI reference; ~12% is 18% × (1 − 0.35),
    // the 35% drop in 90 days from the ABOUT TEMPO proof points (11.7%, rounded).
    expect(beforeAfter).toMatchObject({
      layout: "before-after",
      data: {
        before: { value: "18%", label: "no-show rate today" },
        after: { value: "~12%", label: "no-show rate with Tempo (35% fewer within 90 days)" },
      },
    });
    expect(Math.round(18 * (1 - 0.35))).toBe(12);
    expect(PRESENTATION_PAYOFF_REFERENCE).toContain("18% no-shows");
    expect(TEMPO_RESEARCH_SYSTEM_PROMPT).toContain("35% drop in no-shows in 90 days");

    // The two call personas (no third Summit person exists in config).
    expect(people).toMatchObject({
      layout: "people",
      data: {
        people: [
          { name: DISCOVERY_PERSONA.name, title: DISCOVERY_PERSONA.role },
          { name: OBJECTION_PERSONA.name, title: OBJECTION_PERSONA.role },
        ],
      },
    });
    expect(timeline).toMatchObject({ layout: "timeline", data: { steps: ["Walkthrough", "Pilot", "Rollout"] } });
  });
});
