/**
 * tempo-reference-library.test.ts
 * The shared Tempo Reference Library: the data the server page builds (ICP rows
 * only once the ICP is submitted, each call from its saved stage_scores payload in
 * both stages' formats, the submitted pitch once Presentation is saved), all five
 * sections with the current stage's open, the locked "Upcoming" states, the call
 * pill, transcript search and highlighting, the submitted slides, and the
 * rendered drawer body.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TempoReferenceLibrary } from "@/components/tempo/TempoReferenceLibrary";
import { EMPTY_PRESENTATION_FORM, type PresentationForm } from "@/lib/tempo-presentation";
import {
  buildIcpRows,
  buildReferenceLibrary,
  callPillLabel,
  filterTranscript,
  highlightParts,
  isIcpSubmitted,
  parseReferenceCall,
  REFERENCE_SECTIONS,
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

/** A submitted pitch, one line per slide. */
const PITCH: PresentationForm = {
  businessCase: "Patients slip away before they ever book.",
  underlyingPainPoints: "One in six appointments is a no-show.",
  solution: "Automated reminders and online booking.",
  proofPoint: "Recover a third of the no-show revenue.",
  powerStakeholder: "Dana runs it; Dr. Kim signs.",
  nextStep: "Pilot in two offices next month.",
};

/** Library data for a stage, with the ICP submitted and every earlier stage finished unless overridden. */
function library(currentStage: ReferenceLibraryStage, overrides: Partial<ReferenceLibraryData> = {}): ReferenceLibraryData {
  return {
    currentStage,
    icpRows: [{ label: "Target industry", value: "Multi-location dental groups" }],
    icpNote: null,
    discovery: parseReferenceCall("discovery", DISCOVERY_PAYLOAD),
    objections: parseReferenceCall("objections", OBJECTIONS_PAYLOAD),
    presentation: PITCH,
    ...overrides,
  };
}

const render = (data: ReferenceLibraryData): string =>
  renderToStaticMarkup(React.createElement(TempoReferenceLibrary, { attemptId: "attempt-1", data }));

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
  const stageData = { icpTargetVerticals: "Dental groups", icpDisqualifier2: "Solo practice" };

  it("the ICP shows only once submitted: past the ICP step, or Prospecting finished", () => {
    for (const step of ["onboarding", "icp"]) {
      expect(isIcpSubmitted(step, false), step).toBe(false);
    }
    for (const step of ["research", "select_lead", "opening", "agent"]) {
      expect(isIcpSubmitted(step, false), step).toBe(true);
    }
    expect(isIcpSubmitted("onboarding", true)).toBe(true);

    // A fresh attempt with fields already filled (e.g. test-mode autofill) on the Welcome step.
    expect(buildReferenceLibrary({ currentStage: "prospecting", stageData, scores: [] })).toEqual({
      currentStage: "prospecting",
      icpRows: null,
      icpNote: null,
      discovery: null,
      objections: null,
      presentation: null,
    });
    expect(
      buildReferenceLibrary({ currentStage: "prospecting", stageData: { ...stageData, currentStepId: "research" }, scores: [] })
        .icpRows
    ).toEqual([
      { label: "Target industry", value: "Dental groups" },
      { label: "Disqualifiers", value: "Solo practice" },
    ]);
    expect(
      buildReferenceLibrary({ currentStage: "discovery", stageData, scores: [{ stage: "prospecting", transcript: null }] }).icpRows
    ).toHaveLength(2);
  });

  it("each call is null (Upcoming) until its stage_scores row exists; the pitch likewise", () => {
    const afterDiscovery = buildReferenceLibrary({
      currentStage: "presentation",
      // A draft in progress is not shown until the stage is submitted.
      stageData: { ...stageData, presentation: PITCH },
      scores: [
        { stage: "prospecting", transcript: null },
        { stage: "discovery", transcript: DISCOVERY_PAYLOAD },
      ],
    });
    expect(afterDiscovery.discovery?.durationMinutes).toBe(14);
    expect(afterDiscovery.objections).toBeNull();
    expect(afterDiscovery.presentation).toBeNull();
    const afterObjections = buildReferenceLibrary({
      currentStage: "negotiation",
      stageData: { presentation: PITCH },
      scores: [
        { stage: "discovery", transcript: DISCOVERY_PAYLOAD },
        { stage: "presentation", transcript: "{}" },
        { stage: "objections", transcript: OBJECTIONS_PAYLOAD },
      ],
    });
    expect(afterObjections.objections?.personaName).toBe("Dr. Saul Kim");
    expect(afterObjections.presentation).toEqual(PITCH);
  });

  it("the submitted pitch reads like the stage does: old field names mapped, missing ones empty", () => {
    const build = (stageData: Record<string, unknown>): PresentationForm | null =>
      buildReferenceLibrary({ currentStage: "objections", stageData, scores: [{ stage: "presentation", transcript: null }] })
        .presentation;
    expect(build({})).toEqual(EMPTY_PRESENTATION_FORM);
    expect(build({ presentation: "not an object" })).toEqual(EMPTY_PRESENTATION_FORM);
    expect(build({ presentation: { businessIssue: "Old key text", nextStep: "Pilot" } })).toEqual({
      ...EMPTY_PRESENTATION_FORM,
      businessCase: "Old key text",
      nextStep: "Pilot",
    });
  });

  it("all five stages, in order, on every stage", () => {
    expect(REFERENCE_SECTIONS).toEqual(["prospecting", "discovery", "presentation", "objections", "negotiation"]);
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
  it("Prospecting: all five sections; the open one shows the ICP and reading list; later stages are Upcoming", () => {
    const html = render(
      library("prospecting", { discovery: null, objections: null, presentation: null })
    );
    for (const title of ["Prospecting", "Discovery Call", "Presentation", "Objection Handling Call", "Negotiation"]) {
      expect(html, title).toContain(title);
    }
    expect(html).toContain("Your ICP");
    expect(html).toContain("Multi-location dental groups");
    expect(html).toContain("Tempo Sell Sheet");
    expect(html).toContain("2 items");
    expect(html.match(/Upcoming/g)).toHaveLength(4);
    // Closed sections render no body: no lock text until a section is opened.
    expect(html).not.toContain("Available after the call.");
    expect(html).not.toContain("Available when you reach Negotiation.");
  });

  it("the manager's note on the ICP shows under Your ICP once it exists; never a score", () => {
    const note = "You named \"multi-location dental groups\" clearly.\n\nWhat would you change about the signals?";
    const html = render(library("prospecting", { icpNote: note }));
    expect(html).toContain("Manager feedback");
    expect(html).toContain("You named &quot;multi-location dental groups&quot; clearly.");
    expect(html).toContain("What would you change about the signals?");
    expect(html).toContain("3 items");
    expect(html.indexOf("Your ICP")).toBeLessThan(html.indexOf("Manager feedback"));
    expect(html.indexOf("Manager feedback")).toBeLessThan(html.indexOf("Tempo Sell Sheet"));
    expect(html).not.toMatch(/score|band|\/100/i);
    expect(render(library("prospecting"))).not.toContain("Manager feedback");
  });

  it("the library reads only the note from stage_data.icp (current or old shape)", () => {
    const graded = {
      rubricVersion: "tempo-icp-v1",
      fields: {},
      criteria: [{ id: "industry", verdict: "met", evidence: "dental", gap: "", points: 20 }],
      score: 87.5,
      band: "strong",
      note: "Strong start on the industry.",
      status: "graded",
      gradedAt: "2026-10-18T00:00:00.000Z",
      feedbackSeen: true,
    };
    const data = buildReferenceLibrary({ currentStage: "discovery", stageData: { icp: graded }, scores: [] });
    expect(data.icpNote).toBe("Strong start on the industry.");
    expect(JSON.stringify(data)).not.toMatch(/87\.5|strong"|criteria|evidence/);
    expect(
      buildReferenceLibrary({
        currentStage: "discovery",
        stageData: { icp: { result: "affirmed", displayText: "Old fixed text.", originalText: "x", activeIcpText: "x" } },
        scores: [],
      }).icpNote
    ).toBe("Old fixed text.");
    expect(buildReferenceLibrary({ currentStage: "discovery", stageData: {}, scores: [] }).icpNote).toBeNull();
  });

  it("before the ICP is submitted, its card is locked and shows none of the fields", () => {
    const html = render(library("prospecting", { icpRows: null }));
    expect(html).toContain("Available after you submit your ICP.");
    expect(html).not.toContain("Multi-location dental groups");
    expect(html).toContain("Tempo Sell Sheet");
  });

  it("Presentation: locked before submitting; after, the six submitted slides, read-only, each enlargeable", () => {
    const locked = render(library("presentation", { presentation: null }));
    expect(locked).toContain("Available after you submit your presentation.");
    expect(locked).not.toContain("Your slides");

    const submitted = render(library("presentation"));
    expect(submitted).toContain("6 slides");
    expect(submitted).toContain("Your slides");
    expect(submitted).toContain("Click a slide to enlarge");
    for (const text of Object.values(PITCH)) {
      expect(submitted, text).toContain(text);
    }
    ["Business Issue", "Problem", "Solution", "Value", "Power", "Plan"].forEach((title, index) => {
      expect(submitted, title).toContain(`aria-label="Slide ${index + 1}: ${title}. Enlarge"`);
    });
    expect(submitted.match(/Tempo · Prepared for Summit Dental Group/g)).toHaveLength(6);
    expect(submitted).not.toContain("<textarea");
    expect(submitted).not.toContain('role="dialog"');
    expect(submitted).not.toContain("Your ICP");
  });

  it("on later stages the Presentation section starts closed, its pill showing the slides", () => {
    // Closed by default on Objection Handling: no slide markup until it is opened.
    expect(render(library("objections"))).not.toContain("Your slides");
    expect(render(library("objections"))).toContain("6 slides");
  });

  it("Objection Handling before the call: its open section is locked, nothing else inside", () => {
    const html = render(library("objections", { objections: null }));
    expect(html).toContain("Available after the call.");
    expect(html).not.toContain("Dr. Saul Kim");
    expect(html).not.toContain("Your ICP");
  });

  it("a finished call: pill, meta row, the Call notes card (loading first), and a collapsed transcript row", () => {
    const html = render(library("discovery"));
    expect(html).toContain("Call · 14 min");
    expect(html).toContain("Dana Reyes");
    expect(html).toContain("Director of Operations");
    expect(html).toContain("Call notes");
    expect(html).toContain("AI notes");
    expect(html).toContain("Writing your call notes…");
    expect(html).toContain("View full transcript");
    expect(html).not.toContain("Mostly by phone");
    expect(html).not.toContain("Search transcript");
  });

  it("a saved call with no transcript gets no Call notes card; the transcript row still shows", () => {
    const skipped = parseReferenceCall("discovery", JSON.stringify({ callDurationSeconds: 0, transcriptEntries: [] }));
    const html = render(library("discovery", { discovery: skipped }));
    expect(html).not.toContain("Call notes");
    expect(html).toContain("View full transcript");
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
