/**
 * tempo-reference-library.test.ts
 * The shared Tempo Reference Library: the data the server page builds (ICP rows,
 * each call from its saved stage_scores payload in both stages' formats), which
 * sections show and start open per stage, the "Upcoming" lock state, the call
 * pill, transcript search and highlighting, and the rendered drawer body.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TempoReferenceLibrary } from "@/components/tempo/TempoReferenceLibrary";
import {
  buildIcpRows,
  buildReferenceLibrary,
  callPillLabel,
  defaultOpenReferenceSection,
  filterTranscript,
  highlightParts,
  parseReferenceCall,
  visibleReferenceSections,
  type ReferenceLibraryData,
  type ReferenceLibraryStage,
} from "@/lib/tempo-reference-library";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

const EMPTY_ICP = {
  icpTargetVerticals: "",
  icpDecisionMakerRole: "",
  icpSizeMinLocations: "",
  icpSizeMaxLocations: "",
  icpOperationalSignals: "",
  icpDisqualifier1: "",
  icpDisqualifier2: "",
  icpDisqualifier3: "",
};

const DISCOVERY_PAYLOAD = JSON.stringify({
  callDurationSeconds: 840,
  transcript: "Persona: Thanks for jumping on.\nStudent: How do you book appointments today?",
  transcriptEntries: [
    { role: "dana", content: "Thanks for jumping on.", timestamp: "00:05" },
    { role: "student", content: "How do you book appointments today?", timestamp: "00:12" },
    { role: "dana", content: "Mostly by phone, and the front desk is swamped.", timestamp: "00:30" },
  ],
  preCallPrep: { openQuestions: ["q"], anticipatedProbe: "", anticipatedConfirm: "" },
});

const OBJECTIONS_PAYLOAD = JSON.stringify({
  callDurationSeconds: 30,
  transcript: "",
  transcriptEntries: [
    { role: "drKim", content: "Eight locations times that price adds up.", timestamp: "00:04" },
    { role: "student", content: "What would it need to pay back?", timestamp: "00:20" },
  ],
  objectionTracker: { price: true },
});

/** Library data for a stage, with both calls finished unless overridden. */
function library(currentStage: ReferenceLibraryStage, overrides: Partial<ReferenceLibraryData> = {}): ReferenceLibraryData {
  return {
    currentStage,
    icpRows: [{ label: "Target industry", value: "Multi-location dental groups" }],
    discovery: parseReferenceCall("discovery", DISCOVERY_PAYLOAD),
    objections: parseReferenceCall("objections", OBJECTIONS_PAYLOAD),
    ...overrides,
  };
}

const render = (data: ReferenceLibraryData): string => renderToStaticMarkup(React.createElement(TempoReferenceLibrary, { data }));

describe("Your ICP rows", () => {
  it("label/value rows for the filled fields only; the size range and disqualifiers combine", () => {
    expect(
      buildIcpRows({
        ...EMPTY_ICP,
        icpTargetVerticals: " Dental groups ",
        icpSizeMinLocations: "5",
        icpSizeMaxLocations: "15",
        icpOperationalSignals: "Phone-heavy scheduling",
        icpDisqualifier1: "Single location",
        icpDisqualifier3: "Already on a scheduler",
      })
    ).toEqual([
      { label: "Target industry", value: "Dental groups" },
      { label: "Size range", value: "5 – 15 locations" },
      { label: "Signals that predict fit", value: "Phone-heavy scheduling" },
      { label: "Disqualifiers", value: "Single location\nAlready on a scheduler" },
    ]);
    expect(buildIcpRows({ ...EMPTY_ICP, icpSizeMaxLocations: "8" })).toEqual([
      { label: "Size range", value: "— – 8 locations" },
    ]);
    expect(buildIcpRows(EMPTY_ICP)).toEqual([]);
  });
});

describe("a saved call", () => {
  it("Discovery's payload: Dana's lines as the persona, the student as You, whole minutes", () => {
    expect(parseReferenceCall("discovery", DISCOVERY_PAYLOAD)).toEqual({
      stage: "discovery",
      personaName: "Dana Reyes",
      personaRole: "Director of Operations",
      durationMinutes: 14,
      messages: [
        { speaker: "persona", name: "Dana Reyes", timestamp: "00:05", content: "Thanks for jumping on." },
        { speaker: "student", name: "You", timestamp: "00:12", content: "How do you book appointments today?" },
        {
          speaker: "persona",
          name: "Dana Reyes",
          timestamp: "00:30",
          content: "Mostly by phone, and the front desk is swamped.",
        },
      ],
    });
  });

  it("Objection Handling's payload (role drKim); a call under a minute reads as 1 min", () => {
    const call = parseReferenceCall("objections", OBJECTIONS_PAYLOAD);
    expect(call).toMatchObject({ personaName: "Dr. Saul Kim", personaRole: "Founder & Owner", durationMinutes: 1 });
    expect(call.messages.map((message) => [message.speaker, message.name])).toEqual([
      ["persona", "Dr. Saul Kim"],
      ["student", "You"],
    ]);
  });

  it("an older payload with only the plain-text transcript is split into lines", () => {
    const call = parseReferenceCall(
      "objections",
      JSON.stringify({ callDurationSeconds: 120, transcript: "Persona: Too pricey.\nStudent: Compared to what?" })
    );
    expect(call.messages.map((message) => [message.name, message.content])).toEqual([
      ["Dr. Saul Kim", "Too pricey."],
      ["You", "Compared to what?"],
    ]);
  });

  it("a skipped call (no entries, 0 seconds), no duration, or unreadable text", () => {
    expect(
      parseReferenceCall("discovery", JSON.stringify({ callDurationSeconds: 0, transcript: "[TEST] Skipped discovery call", transcriptEntries: [] }))
    ).toMatchObject({ durationMinutes: 0, messages: [] });
    expect(parseReferenceCall("discovery", JSON.stringify({ transcriptEntries: [] })).durationMinutes).toBeNull();
    for (const raw of [null, "", "not json", "[1,2]"]) {
      expect(parseReferenceCall("discovery", raw), String(raw)).toMatchObject({ durationMinutes: null, messages: [] });
    }
  });

  it("the pill: Call · N min when saved (Call with no duration), Upcoming when not", () => {
    expect(callPillLabel(parseReferenceCall("discovery", DISCOVERY_PAYLOAD))).toBe("Call · 14 min");
    expect(callPillLabel(parseReferenceCall("discovery", "{}"))).toBe("Call");
    expect(callPillLabel(null)).toBe("Upcoming");
  });
});

describe("sections per stage progress", () => {
  it("each call is null (Upcoming) until its stage_scores row exists", () => {
    const stageData = { icpTargetVerticals: "Dental groups", icpDisqualifier2: "Solo practice" };
    expect(buildReferenceLibrary({ currentStage: "prospecting", stageData, scores: [] })).toEqual({
      currentStage: "prospecting",
      icpRows: [
        { label: "Target industry", value: "Dental groups" },
        { label: "Disqualifiers", value: "Solo practice" },
      ],
      discovery: null,
      objections: null,
    });
    const afterDiscovery = buildReferenceLibrary({
      currentStage: "presentation",
      stageData,
      scores: [
        { stage: "prospecting", transcript: null },
        { stage: "discovery", transcript: DISCOVERY_PAYLOAD },
      ],
    });
    expect(afterDiscovery.discovery?.durationMinutes).toBe(14);
    expect(afterDiscovery.objections).toBeNull();
    const afterObjections = buildReferenceLibrary({
      currentStage: "negotiation",
      stageData: {},
      scores: [
        { stage: "discovery", transcript: DISCOVERY_PAYLOAD },
        { stage: "objections", transcript: OBJECTIONS_PAYLOAD },
      ],
    });
    expect(afterObjections.objections?.personaName).toBe("Dr. Saul Kim");
  });

  it("Negotiation joins only on the Negotiation stage; the current stage's section starts open", () => {
    for (const stage of ["prospecting", "discovery", "presentation", "objections"] as const) {
      expect(visibleReferenceSections(stage), stage).toEqual(["prospecting", "discovery", "objections"]);
    }
    expect(visibleReferenceSections("negotiation")).toEqual(["prospecting", "discovery", "objections", "negotiation"]);
    expect(defaultOpenReferenceSection("prospecting")).toBe("prospecting");
    expect(defaultOpenReferenceSection("discovery")).toBe("discovery");
    expect(defaultOpenReferenceSection("presentation")).toBe("discovery");
    expect(defaultOpenReferenceSection("objections")).toBe("objections");
    expect(defaultOpenReferenceSection("negotiation")).toBe("negotiation");
  });
});

describe("transcript search", () => {
  const call = parseReferenceCall("discovery", DISCOVERY_PAYLOAD);

  it("keeps the messages containing the query, any case; an empty query keeps all", () => {
    expect(filterTranscript(call.messages, "  FRONT desk ").map((message) => message.timestamp)).toEqual(["00:30"]);
    expect(filterTranscript(call.messages, "book")).toHaveLength(1);
    expect(filterTranscript(call.messages, "")).toHaveLength(3);
    expect(filterTranscript(call.messages, "voicemail")).toEqual([]);
  });

  it("splits text into highlighted matches, any case, every occurrence", () => {
    expect(highlightParts("Phones, phones, PHONES.", "phones")).toEqual([
      { text: "Phones", isMatch: true },
      { text: ", ", isMatch: false },
      { text: "phones", isMatch: true },
      { text: ", ", isMatch: false },
      { text: "PHONES", isMatch: true },
      { text: ".", isMatch: false },
    ]);
    expect(highlightParts("No match here", "zzz")).toEqual([{ text: "No match here", isMatch: false }]);
    expect(highlightParts("Anything", " ")).toEqual([{ text: "Anything", isMatch: false }]);
  });
});

describe("the rendered library", () => {
  it("Prospecting: the open section shows the ICP and reading list; the calls are locked and Upcoming", () => {
    const html = render(library("prospecting", { discovery: null, objections: null }));
    expect(html).toContain("Your ICP");
    expect(html).toContain("Multi-location dental groups");
    expect(html).toContain("Tempo Sell Sheet");
    expect(html).toContain("2 items");
    expect(html.match(/Upcoming/g)).toHaveLength(2);
    expect(html).not.toContain("Negotiation");
    // Closed sections render no body: no lock text until a call section is opened.
    expect(html).not.toContain("Available after the call.");
  });

  it("Objection Handling before the call: its open section is locked, nothing else inside", () => {
    const html = render(library("objections", { objections: null }));
    expect(html).toContain("Available after the call.");
    expect(html).not.toContain("Dr. Saul Kim");
    expect(html).not.toContain("Your ICP");
  });

  it("a finished call: pill, meta row, and a collapsed transcript row (no messages until opened)", () => {
    const html = render(library("discovery"));
    expect(html).toContain("Call · 14 min");
    expect(html).toContain("Dana Reyes");
    expect(html).toContain("Director of Operations");
    expect(html).toContain("View full transcript");
    expect(html).not.toContain("Mostly by phone");
    expect(html).not.toContain("Search transcript");
  });

  it("Negotiation: the extra section, open, with the levers and pricing; removed sections are gone", () => {
    const html = render(library("negotiation"));
    expect(html).toContain("Pricing &amp; levers");
    expect(html).toContain("Tradeable levers");
    expect(html).toContain("Annual commitment");
    expect(html).toContain("~$14,600/yr");
    for (const removed of ["Prior Context", "Persona", "Tempo Product", "Value Drivers", "Rehearse Tips", "Tempo Core Facts"]) {
      expect(html, removed).not.toContain(removed);
    }
  });
});
