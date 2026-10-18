/**
 * icp-grading.test.ts
 * The generic ICP grading library with Tempo's rubric: the code-scored size range,
 * quotes that aren't in the student's text get downgraded, score and band math,
 * the manager-note checks and the fallback note, the two prompts (what each model
 * may and may not see), the saved record parser (current and old shape), and the
 * ICP note in the same hovering manager window as the stage handoffs. No network.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HandoffModal } from "@/components/tempo/HandoffModal";
import { IcpManagerNoteModal } from "@/components/tempo/stages/ProspectingIcpStep";
import {
  applyEvidenceCheck,
  bandFor,
  buildFallbackNote,
  buildGradingMessages,
  buildGradingSchema,
  buildNoteMessages,
  checkManagerNote,
  gradeIcp,
  parseGradingReply,
  parseIcpGradeRecord,
  pointsFor,
  quoteAppearsIn,
  scoreSizeRange,
  splitLabelledText,
  toIcpNoteView,
  type IcpModelVerdict,
  type IcpSizeCriterion,
} from "@/lib/icp-grading";
import { TEMPO_ICP_NOTE_COPY, TEMPO_ICP_RUBRIC, TEMPO_TERRITORY_PLACES } from "@/lib/tempo-icp-criteria";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

const SIZE = TEMPO_ICP_RUBRIC.criteria.find((criterion): criterion is IcpSizeCriterion => criterion.kind === "size")!;

const STUDENT_TEXT = [
  "Target industry: Multi-location dental and veterinary groups",
  "Decision-maker role: Director of Operations who owns scheduling",
  "Size range: 3–10 locations",
  "Operational signals: Still books by phone; recently opened a new location",
  "Disqualifier 1: Locked into a scheduling vendor contract",
  "Disqualifier 2: Corporate vendor mandate",
].join("\n");

const FIELDS = splitLabelledText(STUDENT_TEXT);
const VALUES = FIELDS.map((field) => field.value).join("\n");

const verdict = (v: IcpModelVerdict["verdict"], evidence = "", gap = ""): IcpModelVerdict => ({ verdict: v, evidence, gap });

describe("rubric config", () => {
  it("five criteria worth 100 points, the size range scored in code, version tempo-icp-v1", () => {
    expect(TEMPO_ICP_RUBRIC.version).toBe("tempo-icp-v1");
    expect(TEMPO_ICP_RUBRIC.criteria.map((criterion) => [criterion.id, criterion.points])).toEqual([
      ["industry", 20],
      ["decision_maker", 15],
      ["size", 15],
      ["signals", 25],
      ["disqualifiers", 25],
    ]);
    expect(SIZE).toMatchObject({ realMin: 3, realMax: 12, metMin: [2, 4], metMax: [10, 15] });
    expect(TEMPO_ICP_RUBRIC.bands).toEqual({ strong: 80, developing: 50 });
  });

  it("the generic library names no product, place or company", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "lib/icp-grading.ts"), "utf8");
    expect(source).not.toMatch(/\b(tempo|summit|dental|veterinary|denver|colorado)\b/i);
  });
});

describe("size range (code only)", () => {
  it.each([
    [3, 12, "met"],
    [2, 15, "met"],
    [4, 10, "met"],
    [1, 12, "partial"],
    [5, 20, "partial"],
    [3, 9, "partial"],
    [12, 30, "partial"],
    [1, 2, "missing"],
    [13, 40, "missing"],
    [null, 12, "missing"],
    [10, 5, "missing"],
  ] as const)("%s–%s locations is %s", (min, max, expected) => {
    expect(scoreSizeRange(min, max, SIZE)).toBe(expected);
  });
});

describe("evidence check", () => {
  it("finds quotes ignoring case, whitespace and surrounding quote marks", () => {
    expect(quoteAppearsIn("director   of OPERATIONS", VALUES)).toBe(true);
    expect(quoteAppearsIn("“Still books by phone”", VALUES)).toBe(true);
    expect(quoteAppearsIn("", VALUES)).toBe(false);
  });

  it("a quote not in the student's text drops one level: met → partial → missing", () => {
    expect(applyEvidenceCheck(verdict("met", "COO who signs every contract"), VALUES).verdict).toBe("partial");
    expect(applyEvidenceCheck(verdict("partial", "invented words"), VALUES).verdict).toBe("missing");
    expect(applyEvidenceCheck(verdict("met", "Director of Operations"), VALUES).verdict).toBe("met");
    expect(applyEvidenceCheck(verdict("missing"), VALUES).verdict).toBe("missing");
  });
});

describe("score and band", () => {
  it("met = full, partial = half, missing = 0; bands at 80 and 50", () => {
    expect([pointsFor("met", 25), pointsFor("partial", 25), pointsFor("missing", 25)]).toEqual([25, 12.5, 0]);
    expect([bandFor(80, TEMPO_ICP_RUBRIC.bands), bandFor(79.5, TEMPO_ICP_RUBRIC.bands)]).toEqual(["strong", "developing"]);
    expect([bandFor(50, TEMPO_ICP_RUBRIC.bands), bandFor(49.5, TEMPO_ICP_RUBRIC.bands)]).toEqual(["developing", "needs_work"]);
  });

  it("totals the checked verdicts and the code-scored range, in rubric order", () => {
    const graded = gradeIcp({
      rubric: TEMPO_ICP_RUBRIC,
      verdicts: {
        industry: verdict("met", "Multi-location dental and veterinary groups"),
        decision_maker: verdict("met", "a VP who isn't in the text", "Name who owns scheduling."),
        signals: verdict("partial", "Still books by phone", "Add a current trigger."),
        disqualifiers: verdict("met", "Locked into a scheduling vendor contract"),
      },
      studentText: VALUES,
      sizeMin: 3,
      sizeMax: 10,
    });
    expect(graded.criteria.map((criterion) => [criterion.id, criterion.verdict, criterion.points])).toEqual([
      ["industry", "met", 20],
      ["decision_maker", "partial", 7.5],
      ["size", "met", 15],
      ["signals", "partial", 12.5],
      ["disqualifiers", "met", 25],
    ]);
    expect(graded.score).toBe(80);
    expect(graded.band).toBe("strong");
    expect(graded.criteria[2]).toMatchObject({ evidence: "3–10 locations", gap: "" });
  });

  it("a missing or unreadable reply criterion counts as missing", () => {
    expect(parseGradingReply("not json", TEMPO_ICP_RUBRIC)).toBeNull();
    expect(parseGradingReply(JSON.stringify({ industry: { verdict: "met", evidence: "", gap: "" } }), TEMPO_ICP_RUBRIC)).toBeNull();
    const reply = JSON.stringify(
      Object.fromEntries(["industry", "decision_maker", "signals", "disqualifiers"].map((id) => [id, { verdict: "missing", evidence: "", gap: "Gap." }]))
    );
    expect(Object.keys(parseGradingReply(reply, TEMPO_ICP_RUBRIC) ?? {})).toEqual(["industry", "decision_maker", "signals", "disqualifiers"]);
  });
});

describe("prompts", () => {
  it("step A: every model-graded criterion and the student's fields, never the size range; strict schema without size", () => {
    const { system, user } = buildGradingMessages(TEMPO_ICP_RUBRIC, FIELDS);
    for (const id of ["industry", "decision_maker", "signals", "disqualifiers"]) {
      expect(system, id).toContain(id);
    }
    expect(system).not.toMatch(/\b3\s*(-|–|to)\s*12\b/);
    expect(system).not.toContain("Size range");
    expect(system).toContain("Do not output a score");
    expect(user).toContain("Target industry: Multi-location dental and veterinary groups");
    const schema = buildGradingSchema(TEMPO_ICP_RUBRIC);
    expect(schema.strict).toBe(true);
    expect((schema.schema as { required: string[] }).required).toEqual(["industry", "decision_maker", "signals", "disqualifiers"]);
  });

  it("step B: only the student's fields and the verdicts, not the rubric's answer lists, range or territory", () => {
    const graded = gradeIcp({
      rubric: TEMPO_ICP_RUBRIC,
      verdicts: {
        industry: verdict("met", "dental and veterinary"),
        decision_maker: verdict("met", "Director of Operations"),
        signals: verdict("partial", "Still books by phone", "Add a current trigger such as hiring."),
        disqualifiers: verdict("met", "Corporate vendor mandate"),
      },
      studentText: VALUES,
      sizeMin: 3,
      sizeMax: 10,
    });
    const { system, user } = buildNoteMessages({ copy: TEMPO_ICP_NOTE_COPY, rubric: TEMPO_ICP_RUBRIC, fields: FIELDS, criteria: graded.criteria });
    const prompt = `${system}\n${user}`;
    for (const criterion of TEMPO_ICP_RUBRIC.criteria) {
      if (criterion.kind === "ai") {
        expect(prompt).not.toContain(criterion.met);
        expect(prompt).not.toContain(criterion.partial);
      }
    }
    expect(prompt).not.toMatch(/physical therapy|optometry|med spa|chiropractic|COO/);
    expect(prompt).not.toMatch(/\b3\s*(-|–|to)\s*12\b/);
    expect(TEMPO_TERRITORY_PLACES.some((place) => prompt.includes(place))).toBe(false);
    expect(prompt).toContain("Add a current trigger such as hiring.");
    expect(prompt).toContain("Never mention a score");
  });
});

describe("note checks and fallback", () => {
  const rules = { minWords: 80, maxWords: 140, realRange: [3, 12] as const, forbiddenNames: ["Summit Dental Group", ...TEMPO_TERRITORY_PLACES] };
  const words = (count: number): string => Array.from({ length: count }, () => "word").join(" ");

  it("passes a plain note of the right length", () => {
    expect(checkManagerNote(words(100), rules)).toEqual([]);
  });

  it("fails on length, the real range, a company or city name, score words, emoji or headings", () => {
    expect(checkManagerNote(words(60), rules)).toEqual(["word count 60"]);
    expect(checkManagerNote(`${words(100)} aim for 3-12 locations`, rules)).toContain("real range");
    expect(checkManagerNote(`${words(100)} aim for 3 to 12`, rules)).toContain("real range");
    expect(checkManagerNote(`${words(100)} like summit dental group`, rules)).toContain("names Summit Dental Group");
    expect(checkManagerNote(`${words(100)} start in Denver`, rules)).toContain("names Denver");
    expect(checkManagerNote(`${words(100)} your score is fine`, rules)).toContain("score words");
    expect(checkManagerNote(`${words(100)} 🎯`, rules)).toContain("emoji");
    expect(checkManagerNote(`# Feedback\n${words(100)}`, rules)).toContain("heading or list");
  });

  it("the fallback quotes the strongest met criterion, then the two biggest gaps, a question and the closing", () => {
    const criteria = [
      { id: "industry", verdict: "met" as const, evidence: "dental groups", gap: "", points: 20 },
      { id: "decision_maker", verdict: "partial" as const, evidence: "CEO", gap: "Name who owns scheduling.", points: 7.5 },
      { id: "size", verdict: "met" as const, evidence: "3–10 locations", gap: "", points: 15 },
      { id: "signals", verdict: "missing" as const, evidence: "", gap: "List signals you can verify.", points: 0 },
      { id: "disqualifiers", verdict: "met" as const, evidence: "vendor contract", gap: "", points: 25 },
    ];
    const note = buildFallbackNote(TEMPO_ICP_RUBRIC, criteria, TEMPO_ICP_NOTE_COPY);
    expect(note).toContain("“vendor contract”");
    expect(note.indexOf("List signals you can verify.")).toBeLessThan(note.indexOf("Name who owns scheduling."));
    expect(note).toContain(TEMPO_ICP_NOTE_COPY.fallback.gapQuestion);
    expect(note).toContain(TEMPO_ICP_NOTE_COPY.fallback.closing);
    expect(note).not.toMatch(/score|points|\d+\s*\/\s*100/i);
  });
});

describe("saved record", () => {
  it("reads the current shape; the student view is the note and its state only", () => {
    const record = parseIcpGradeRecord({
      rubricVersion: "tempo-icp-v1",
      fields: { icpTargetVerticals: "Dental" },
      criteria: [{ id: "industry", verdict: "met", evidence: "Dental", gap: "", points: 20 }, { bad: true }],
      score: 72.5,
      band: "developing",
      note: "Note text.",
      status: "graded",
      gradedAt: "2026-10-18T00:00:00.000Z",
      feedbackSeen: false,
    });
    expect(record).toMatchObject({ status: "graded", score: 72.5, band: "developing", feedbackSeen: false });
    expect(record?.criteria).toHaveLength(1);
    expect(toIcpNoteView(record!)).toEqual({ status: "graded", note: "Note text.", feedbackSeen: false });
  });

  it("still reads the old pass/fail shape (as ungraded, its fixed text as the note) without crashing", () => {
    expect(
      parseIcpGradeRecord({ originalText: "x", result: "corrected", displayText: "Sharper framing.", activeIcpText: "x", feedbackSeen: true })
    ).toEqual({
      rubricVersion: "legacy",
      fields: {},
      criteria: [],
      score: null,
      band: null,
      note: "Sharper framing.",
      status: "ungraded",
      gradedAt: "",
      feedbackSeen: true,
    });
    expect(parseIcpGradeRecord(null)).toBeNull();
    expect(parseIcpGradeRecord({ something: "else" })).toBeNull();
    expect(parseIcpGradeRecord([1, 2])).toBeNull();
  });
});

describe("ICP note window", () => {
  const html = renderToStaticMarkup(
    React.createElement(IcpManagerNoteModal, { note: "First paragraph.\n\nSecond paragraph.", onContinue: vi.fn(), isContinuing: false })
  );

  it("the hovering manager-message window: the manager, the note's paragraphs, up next, Continue to research", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain("modal-overlay");
    expect(html).toContain("MESSAGE FROM YOUR MANAGER");
    expect(html).toContain("ICP review");
    expect(html).toContain("Alex Torres");
    expect(html).toMatch(/<p class="[^"]*italic">First paragraph\.<\/p><p class="[^"]*italic">Second paragraph\.<\/p>/);
    expect(html).toContain("Up next");
    expect(html).toContain("Data Room");
    expect(html).toContain("Continue to research");
    expect(html).not.toMatch(/score|band/i);
  });

  it("is the same window as the stage handoffs (top bar and manager)", () => {
    const handoff = renderToStaticMarkup(
      React.createElement(HandoffModal, {
        stageNumber: 2,
        stageName: "Discovery",
        stageIcon: "forum",
        message: "Book the call.",
        hasAIRestriction: true,
        onBegin: vi.fn(),
        onDismiss: vi.fn(),
      })
    );
    const shell = (markup: string): string => markup.slice(0, markup.indexOf("bg-surface-container-low p-4"));
    expect(shell(html).replace("ICP review", "X")).toBe(shell(handoff).replace("Stage 2 of 5", "X"));
    expect(handoff).toContain("Begin Stage 2");
  });
});
