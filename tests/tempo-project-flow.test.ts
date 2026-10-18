/**
 * tempo-project-flow.test.ts
 * The top-bar stage strip: the current and upcoming stages show their expected
 * time in brackets after the name (from TEMPO_STAGES); completed stages show only
 * the name. Rendered to static HTML; no network.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TEMPO_FLOW_STAGES, TempoProjectFlow } from "@/components/tempo/TempoProjectFlow";
import { TEMPO_STAGES } from "@/lib/tempo-simulation";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

const render = (currentIndex: number): string =>
  renderToStaticMarkup(React.createElement(TempoProjectFlow, { currentIndex }));

/** The text of each segment, in order. */
const segmentTexts = (html: string): string[] =>
  Array.from(html.matchAll(/<span class="font-label-md[^"]*">(.*?)<\/span><\/div><\/div>/g), (match) =>
    (match[1] ?? "").replace(/<[^>]*>/g, "")
  );

describe("project flow times", () => {
  it("on Presentation: completed stages plain, current and upcoming with their time in brackets", () => {
    expect(segmentTexts(render(2))).toEqual([
      "Prospecting",
      "Discovery",
      "Presentation (~10 min)",
      "Objections (~15 min)",
      "Negotiation (~10 min)",
    ]);
  });

  it("on Prospecting every stage shows its time; on Negotiation only Negotiation does", () => {
    const first = segmentTexts(render(0));
    TEMPO_FLOW_STAGES.forEach((stage, index) => {
      expect(first[index]).toBe(`${stage.label} (${TEMPO_STAGES[index]?.time})`);
    });
    expect(segmentTexts(render(4))).toEqual(["Prospecting", "Discovery", "Presentation", "Objections", "Negotiation (~10 min)"]);
  });
});
