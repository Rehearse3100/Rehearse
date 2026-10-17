/**
 * pitch-slide.test.ts
 * The reusable, simulation-neutral pitch-slide template: one layout that renders
 * the title, the student's text and the footer from config; a visible text box
 * that writes the slide's own field while editing, and plain text (no box) when
 * read-only (thumbnails); the footer is only the product line and the slide
 * number; a different background design per slide number in the theme's colours,
 * behind the content, with the accent line under the title; every colour
 * from the deck's theme (no colour values in the component); no Tempo strings in
 * the shared files. Plus Tempo's deck config. Rendered to static HTML; no network.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PitchSlide } from "@/components/presentation/PitchSlide";
import {
  formatPitchSlideNumber,
  NEUTRAL_PITCH_THEME,
  resolvePitchTheme,
  type PitchDeck,
  type PitchSlideConfig,
} from "@/lib/pitch-deck";
import {
  PRESENTATION_PAYOFF_REFERENCE,
  TEMPO_PITCH_DECK,
  TEMPO_PITCH_SLIDES,
} from "@/lib/tempo-presentation";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

const DECK: PitchDeck = { productName: "Acme", customerName: "Globex" };

const THEMED_DECK: PitchDeck = {
  ...DECK,
  theme: { primary: "#0f3d3e", accent: "#e07a5f", text: "#222233", muted: "#777788", background: "#fffdf8" },
};

const SLIDE: PitchSlideConfig = { id: "s1", field: "pitchField", title: "A neutral title", direction: "Write something." };

const render = (
  slide: PitchSlideConfig,
  value = "Student words.",
  onChange?: (field: string, value: string) => void,
  deck: PitchDeck = DECK
): string =>
  renderToStaticMarkup(React.createElement(PitchSlide<string>, { deck, slide, slideNumber: 3, value, onChange }));

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

const readSource = (file: string): string => readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("the slide", () => {
  it("renders the title, the student's text and the footer from config", () => {
    const html = render(SLIDE);
    for (const text of ["A neutral title", "Student words.", "Acme · Prepared for Globex", "03"]) {
      expect(html, text).toContain(text);
    }
    expect(html.match(/<h3/g)).toHaveLength(1);
  });

  it("the footer is only the product line and the slide number", () => {
    expect(render(SLIDE)).toMatch(
      /<div class="flex items-center justify-between shrink-0"[^>]*><p class="min-w-0">Acme · Prepared for Globex<\/p><span class="shrink-0 font-bold"[^>]*>03<\/span><\/div>/
    );
  });

  it("has no images, icons or emoji (the background design is plain CSS shapes)", () => {
    const html = render(SLIDE, "Student words.", vi.fn());
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("material-symbols");
    expect(html).not.toContain("“");
    // Emoji sit outside the Basic Multilingual Plane (surrogate pairs).
    expect(html).not.toMatch(/[\uD800-\uDFFF]/);
  });
});

describe("background design", () => {
  /** The decoration layer: one wrapper of empty shape divs. */
  const decorationOf = (html: string): string =>
    html.match(/<div[^>]*data-pitch-decoration[^>]*>(?:<div[^>]*><\/div>)+<\/div>/)?.[0] ?? "";

  const renderNumber = (slideNumber: number, slide: PitchSlideConfig = SLIDE, onChange?: (field: string, value: string) => void): string =>
    renderToStaticMarkup(
      React.createElement(PitchSlide<string>, { deck: THEMED_DECK, slide, slideNumber, value: "Words.", onChange })
    );

  const NUMBERS = [1, 2, 3, 4, 5, 6];

  it("each of the six slide numbers has its own design; slide 7 starts over", () => {
    const designs = NUMBERS.map((number) => decorationOf(renderNumber(number)));
    for (const design of designs) {
      expect(design).not.toBe("");
    }
    expect(new Set(designs).size).toBe(6);
    expect(decorationOf(renderNumber(7))).toBe(designs[0]);
  });

  it("every design uses the theme's primary and accent at full strength", () => {
    for (const number of NUMBERS) {
      const design = decorationOf(renderNumber(number));
      expect(design, `slide ${number}`).toMatch(/(background:|solid )#0f3d3e/);
      expect(design, `slide ${number}`).toMatch(/(background:|solid )#e07a5f/);
    }
  });

  it("the design depends only on the slide number, not its content, and is the same editing or read-only (thumbnails)", () => {
    const other: PitchSlideConfig = { id: "s2", field: "otherField", title: "Another title", direction: "Other." };
    for (const number of NUMBERS) {
      const design = decorationOf(renderNumber(number, SLIDE, vi.fn()));
      expect(decorationOf(renderNumber(number, other)), `slide ${number}`).toBe(design);
    }
    TEMPO_PITCH_SLIDES.forEach((slide: PitchSlideConfig, index) => {
      const tempoSlide = (onChange?: (field: string, value: string) => void): string =>
        renderToStaticMarkup(
          React.createElement(PitchSlide<string>, { deck: TEMPO_PITCH_DECK, slide, slideNumber: index + 1, value: "x", onChange })
        );
      const editing = decorationOf(tempoSlide(vi.fn()));
      expect(editing, slide.id).toContain("#1a1a2e");
      expect(editing, slide.id).toContain("#c9a84c");
      expect(decorationOf(tempoSlide()), slide.id).toBe(editing);
    });
  });

  it("title and footer turn light where a design puts them on the primary colour", () => {
    const titleColor = (html: string): string | undefined => html.match(/<h3[^>]*style="[^"]*color:([^;"]+)/)?.[1];
    expect(titleColor(renderNumber(1))).toBe("#fffdf8");
    for (const number of [2, 3, 4, 5, 6]) {
      expect(titleColor(renderNumber(number)), `slide ${number}`).toBe("#0f3d3e");
    }
    // Slide 4: the footer sits on the bottom band.
    expect(renderNumber(4)).toContain("color:color-mix(in srgb, #fffdf8 80%, #0f3d3e)");
    expect(renderNumber(4)).toMatch(/<span class="shrink-0 font-bold" style="color:#e07a5f">04<\/span>/);
    expect(renderNumber(2)).toMatch(/<span class="shrink-0 font-bold" style="color:#0f3d3e">02<\/span>/);
  });

  it("the accent line sits directly under the title", () => {
    for (const number of NUMBERS) {
      expect(renderNumber(number), `slide ${number}`).toMatch(
        /<\/h3><div aria-hidden="true"[^>]*style="width:5.8cqw;height:0.36cqw;background:#e07a5f;/
      );
    }
  });

  it("sits behind the content, takes no clicks and holds no text; the text box keeps its own solid background", () => {
    for (const number of NUMBERS) {
      const html = renderNumber(number, SLIDE, vi.fn());
      const decoration = decorationOf(html);
      expect(decoration).toContain('aria-hidden="true"');
      expect(decoration).toContain("pointer-events-none");
      expect(decoration.replace(/<[^>]*>/g, "")).toBe("");
      expect(html.indexOf(decoration)).toBeLessThan(html.indexOf("<h3"));
      expect(html).toContain("--pitch-box-bg:color-mix(in srgb, #e07a5f 4%, #fffdf8)");
    }
  });
});

describe("the student's text", () => {
  it("while editing: one visible text box that writes the slide's own field", () => {
    const onChange = vi.fn();
    const tree = PitchSlide({ deck: DECK, slide: { ...SLIDE, field: "ownField" }, slideNumber: 1, value: "", onChange });
    const textarea = findHost(tree, "textarea");
    expect(textarea).not.toBeNull();
    (textarea?.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "New text" } });
    expect(onChange).toHaveBeenCalledWith("ownField", "New text");

    const html = render(SLIDE, "", onChange);
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).toContain('placeholder="Type here…"');
    expect(html).toContain('aria-label="A neutral title"');
    // The box: border, light background, rounded, 12px padding, darker border and ring on focus.
    const className = String(textarea?.props.className);
    for (const part of ["border", "rounded-lg", "p-3", "bg-[color:var(--pitch-box-bg)]", "focus:border-[color:var(--pitch-box-focus)]", "focus:ring-[3px]"]) {
      expect(className.split(" "), part).toContain(part);
    }
    expect(html).toContain("--pitch-box-border");
  });

  it("read-only (no onChange, as in thumbnails): no box, the text still shows", () => {
    const html = render(SLIDE, "Shown as text.");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("--pitch-box");
    expect(html).not.toContain("rounded-lg");
    expect(html).toContain("Shown as text.");
    expect(findHost(PitchSlide({ deck: DECK, slide: SLIDE, slideNumber: 1, value: "x" }), "textarea")).toBeNull();
  });

  it("the placeholder can be changed", () => {
    const custom = renderToStaticMarkup(
      React.createElement(PitchSlide<string>, { deck: DECK, slide: SLIDE, slideNumber: 1, value: "", onChange: vi.fn(), placeholder: "Start typing" })
    );
    expect(custom).toContain('placeholder="Start typing"');
  });
});

describe("theme", () => {
  it("every colour comes from the deck's theme", () => {
    const html = render(SLIDE, "Words.", vi.fn(), THEMED_DECK);
    for (const color of Object.values(THEMED_DECK.theme ?? {})) {
      expect(html, color).toContain(color);
    }
    expect(html).not.toContain(NEUTRAL_PITCH_THEME.primary);
  });

  it("falls back to the neutral theme when the deck sets none", () => {
    expect(resolvePitchTheme(DECK)).toBe(NEUTRAL_PITCH_THEME);
    expect(resolvePitchTheme(THEMED_DECK)).toBe(THEMED_DECK.theme);
    expect(render(SLIDE)).toContain(NEUTRAL_PITCH_THEME.primary);
  });

  it("the component has no colour values of its own", () => {
    const source = readSource("components/presentation/PitchSlide.tsx");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(/\b(rgba?|hsla?)\(/i);
    // No Tailwind palette colour classes either.
    expect(source).not.toMatch(/\b(text|bg|border|ring|shadow|outline)-(white|black|slate|gray|zinc|neutral|stone|red|blue|green|amber|yellow)\b/);
  });

  it("slide numbers have two digits", () => {
    expect(formatPitchSlideNumber(4)).toBe("04");
    expect(formatPitchSlideNumber(12)).toBe("12");
  });
});

describe("simulation-neutral", () => {
  const TEMPO_WORDS = /\b(tempo|summit|dental|dana|reyes|saul|kim)\b/i;

  it("the shared component and its types contain no Tempo strings", () => {
    for (const file of ["components/presentation/PitchSlide.tsx", "lib/pitch-deck.ts"]) {
      expect(readSource(file).match(TEMPO_WORDS), file).toBeNull();
    }
    expect(render(SLIDE, "Student words.", vi.fn()).match(TEMPO_WORDS)).toBeNull();
  });
});

describe("Tempo's deck config", () => {
  it("deck: Tempo for Summit Dental Group in navy and gold on white", () => {
    expect(TEMPO_PITCH_DECK).toMatchObject({
      productName: "Tempo",
      customerName: "Summit Dental Group",
      theme: { primary: "#1a1a2e", accent: "#c9a84c", background: "#ffffff" },
    });
    const html = render(TEMPO_PITCH_SLIDES[0]!, "Words.", vi.fn(), TEMPO_PITCH_DECK);
    expect(html).toContain("Tempo · Prepared for Summit Dental Group");
    expect(html).toContain("#1a1a2e");
    expect(html).toContain("#c9a84c");
  });

  it("slides carry only the one layout's config, no footer note; the Value slide has the ROI reference", () => {
    const allowed = ["id", "field", "title", "direction", "directionNote"];
    for (const slide of TEMPO_PITCH_SLIDES) {
      for (const key of Object.keys(slide)) {
        expect(allowed, `${slide.id}: ${key}`).toContain(key);
      }
      expect(render(slide, "Words.", vi.fn(), TEMPO_PITCH_DECK), slide.id).not.toContain("discovery call");
    }
    expect(PRESENTATION_PAYOFF_REFERENCE).toBe("Reference: 6,400 appts × 18% no-shows × $120 = $138,240/month lost");
    expect(TEMPO_PITCH_SLIDES[3]?.directionNote).toBe(PRESENTATION_PAYOFF_REFERENCE);
  });
});
