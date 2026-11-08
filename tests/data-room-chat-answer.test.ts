/**
 * data-room-chat-answer.test.ts
 * Data Room chat pane UI, rendered to static HTML (no effects run, no network): a
 * reply without a layout (every reply saved before tables) renders exactly as the old
 * text list; the result table (10 rows at full height, 11 or more scrolling with a
 * sticky header); the compare table (a label column, one column per company); the
 * "Search all companies" pill; the "Selected | All companies" switch (a radiogroup
 * whose pill slides), its hint line, the keys it answers and the placeholder by mode.
 * 2026-11-07: "Research" and "Public" tags before research findings and public
 * signals, card facts untagged, the note in small text under the answer, and old
 * saved replies (no sources, no note) exactly as before. 2026-11-07: company names
 * are buttons that open the company (table cell, compare headers, list headings)
 * when the pane can open them; otherwise, and without the prop, plain text as before.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AnswerLines,
  answerLayoutOf,
  CompanyName,
  CompareTable,
  DataRoomChatAnswer,
  ResultTable,
  SearchAllCompaniesButton,
  TABLE_SCROLL_FROM_ROWS,
  type ChatAnswer,
} from "@/components/tempo/stages/DataRoomChatAnswer";
import {
  ALL_COMPANIES_PLACEHOLDER,
  chatPlaceholder,
  ScopeHint,
  ScopeSwitch,
  scopeSwitchTarget,
  SELECTED_PLACEHOLDER,
} from "@/components/tempo/stages/ProspectingDataRoomChat";
import { getDataRoomChatConfig } from "@/lib/data-room-chat-config";
import type { ScopedAnswerItem } from "@/lib/data-room-chat-scope";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

const html = (element: React.ReactElement): string => renderToStaticMarkup(element);

/** A table row as the server sends it: the list line plus the card. */
function row(i: number, overrides: Partial<ScopedAnswerItem["card"]> = {}): ScopedAnswerItem {
  return {
    companyId: `c${i}`,
    companyName: `Clinic ${String(i).padStart(2, "0")}`,
    text: `Dental · ${i} locations · Denver, CO`,
    card: { industry: "Dental", locations: i, metro: "Denver, CO", inTerritory: true, onlineBooking: false, ...overrides },
  };
}

const SUMMIT: ScopedAnswerItem = {
  companyId: "summit",
  companyName: "Summit Dental Group",
  text: "Dental · 8 locations · Front Range, CO\nIn territory.\nNo online booking.",
  card: { industry: "Dental", locations: 8, metro: "Front Range, CO", inTerritory: true, onlineBooking: false },
  signals: ["Opened 8th location three months ago", "Job listing: Front Desk Coordinator"],
};
const NORTHVIEW: ScopedAnswerItem = {
  companyId: "northview",
  companyName: "Northview Family Dentistry",
  text: "Dental · 3 locations · Boulder, CO",
  card: { industry: "Dental", locations: 3, metro: "Boulder, CO", inTerritory: true, onlineBooking: true },
  signals: ["Recently refreshed patient portal branding"],
};
const FALCON: ScopedAnswerItem = {
  companyId: "falcon",
  companyName: "Falcon Market",
  text: "Retail · 1 location · Denver, CO",
  card: { industry: "Retail", locations: null, metro: null, inTerritory: null, onlineBooking: null },
  signals: [],
};

describe("a reply without a layout (and every reply saved before tables)", () => {
  /** The reply body exactly as the pane rendered it before tables existed. */
  function oldList(answer: ChatAnswer): string {
    return html(
      React.createElement(
        React.Fragment,
        null,
        answer.intro
          ? React.createElement(
              "p",
              { className: `whitespace-pre-wrap ${answer.isError ? "text-error" : "text-on-surface-variant"}` },
              answer.intro
            )
          : null,
        ...answer.items.map((item) =>
          React.createElement(
            "div",
            { key: item.companyId },
            React.createElement("p", { className: "text-[12px] font-semibold text-on-surface mb-1" }, item.companyName),
            React.createElement("p", { className: "text-on-surface-variant whitespace-pre-wrap" }, item.text)
          )
        )
      )
    );
  }

  it("renders exactly as the old text list", () => {
    for (const answer of [
      { intro: "Here's what's on record.", items: [{ companyId: "a", companyName: "A", text: "In territory.\nNo online booking." }] },
      { intro: "", items: [SUMMIT, NORTHVIEW].map(({ companyId, companyName, text }) => ({ companyId, companyName, text })) },
      { intro: "Nothing about that is publicly findable for this company.", items: [] },
      { intro: "Sorry, I couldn't respond right now.", items: [], isError: true },
    ] satisfies ChatAnswer[]) {
      expect(html(React.createElement(DataRoomChatAnswer, { answer })), answer.intro).toBe(oldList(answer));
      expect(answerLayoutOf(answer)).toBe("list");
    }
  });

  it("a layout without card values, an error, or one company to compare falls back to the list", () => {
    const noCards: ChatAnswer = { intro: "2 companies match.", layout: "table", items: [{ companyId: "a", companyName: "A", text: "Dental" }] };
    expect(answerLayoutOf(noCards)).toBe("list");
    expect(html(React.createElement(DataRoomChatAnswer, { answer: noCards }))).not.toContain("<table");
    expect(answerLayoutOf({ intro: "x", layout: "table", items: [row(1)], isError: true })).toBe("list");
    expect(answerLayoutOf({ intro: "", layout: "compare", items: [SUMMIT] })).toBe("list");
    expect(answerLayoutOf({ intro: "", layout: "list", items: [row(1)] })).toBe("list");
  });

  it("one company's research facts stay the clean list", () => {
    const research: ChatAnswer = {
      intro: "This company signed a multi-year agreement.",
      items: [{ companyId: "summit", companyName: "Summit Dental Group", text: "Signed a multi-year agreement with a scheduling vendor last year." }],
    };
    expect(html(React.createElement(DataRoomChatAnswer, { answer: research }))).toBe(oldList(research));
  });
});

describe("the result table (layout 'table')", () => {
  it("the count line, then Company (name + tags) | Industry | Loc | City, A–Z as sent", () => {
    const answer: ChatAnswer = { intro: "2 companies match.", layout: "table", items: [row(3), row(7, { inTerritory: false, onlineBooking: true })] };
    expect(answerLayoutOf(answer)).toBe("table");
    const markup = html(React.createElement(DataRoomChatAnswer, { answer }));
    expect(markup.startsWith('<p class="text-[13px] font-medium text-on-surface whitespace-pre-wrap">2 companies match.</p>')).toBe(true);
    for (const header of [">Company<", ">Industry<", ">Loc<", ">City<"]) {
      expect(markup, header).toContain(header);
    }
    expect(markup.indexOf("Clinic 03")).toBeLessThan(markup.indexOf("Clinic 07"));
    for (const tag of [">In territory<", ">No online booking<", ">Out of territory<", ">Online booking<"]) {
      expect(markup, tag).toContain(tag);
    }
    expect(markup).toContain(">Denver, CO<");
    // The text lines are the fallback only: not shown under the table.
    expect(markup).not.toContain("Dental · 3 locations · Denver, CO");
  });

  it("10 rows: full height, no scroll; 11 rows: about 320px, scrolling inside the reply, with a sticky header", () => {
    expect(TABLE_SCROLL_FROM_ROWS).toBe(11);
    const ten = html(React.createElement(ResultTable, { items: Array.from({ length: 10 }, (_, i) => row(i + 1)) }));
    expect(ten).toContain('data-scrolls="false"');
    expect(ten).not.toContain("max-h-[320px]");
    expect(ten).not.toContain("sticky top-0");
    expect(ten.match(/<tr /g)).toHaveLength(10);

    const eleven = html(React.createElement(ResultTable, { items: Array.from({ length: 11 }, (_, i) => row(i + 1)) }));
    expect(eleven).toContain('data-scrolls="true"');
    expect(eleven).toContain("max-h-[320px] overflow-y-auto");
    expect(eleven).toContain('<thead class="sticky top-0 z-10">');
    expect(eleven.match(/<tr /g)).toHaveLength(11);
  });

  it("missing values show a dash, and a tag only when the value is on record", () => {
    const markup = html(React.createElement(ResultTable, { items: [FALCON] }));
    expect(markup.match(/>—</g)).toHaveLength(2);
    expect(markup).not.toContain("territory<");
    expect(markup).not.toContain("booking<");
  });
});

describe("the compare table (layout 'compare')", () => {
  const answer: ChatAnswer = { intro: "Which one to pursue is your call; the facts below can help you compare.", layout: "compare", items: [SUMMIT, NORTHVIEW, FALCON] };

  it("a label column on the left and one column per company, in answer order", () => {
    expect(answerLayoutOf(answer)).toBe("compare");
    const markup = html(React.createElement(DataRoomChatAnswer, { answer }));
    expect(markup).toContain(">Which one to pursue is your call; the facts below can help you compare.<");
    const headers = Array.from(markup.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g), (match) => match[1]);
    expect(headers).toEqual(["Attribute", "Summit Dental Group", "Northview Family Dentistry", "Falcon Market"]);
    const labels = Array.from(markup.matchAll(/<th scope="row"[^>]*>([^<]*)<\/th>/g), (match) => match[1]);
    expect(labels).toEqual(["Industry", "Locations", "City", "Territory", "Online booking", "Signals"]);
    for (const value of [">8<", ">3<", ">Front Range, CO<", ">Boulder, CO<", ">In territory<", ">No<", ">Yes<"]) {
      expect(markup, value).toContain(value);
    }
    expect(markup).toContain(">Opened 8th location three months ago<");
    expect(markup).toContain(">Recently refreshed patient portal branding<");
    // Falcon has nothing on record for most rows.
    expect(markup.match(/>—</g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("a compare limited to some details shows only those rows (plus the company headers)", () => {
    const markup = html(React.createElement(CompareTable, { items: [SUMMIT, NORTHVIEW], rows: ["locations"] }));
    const labels = Array.from(markup.matchAll(/<th scope="row"[^>]*>([^<]*)<\/th>/g), (match) => match[1]);
    expect(labels).toEqual(["Locations"]);
    expect(markup).toContain(">Summit Dental Group<");
    expect(markup).toContain(">Northview Family Dentistry<");
    const two = html(React.createElement(DataRoomChatAnswer, { answer: { intro: "", layout: "compare", compareRows: ["signals", "industry"], items: [SUMMIT, NORTHVIEW] } }));
    expect(Array.from(two.matchAll(/<th scope="row"[^>]*>([^<]*)<\/th>/g), (match) => match[1])).toEqual(["Industry", "Signals"]);
  });

  it("the label column stays fixed while the companies scroll sideways; the hint only once it overflows", () => {
    const markup = html(React.createElement(CompareTable, { items: [SUMMIT, NORTHVIEW] }));
    expect(markup).toContain("overflow-x-auto");
    expect(markup.match(/sticky left-0/g)).toHaveLength(7);
    expect(markup).toContain("min-width:400px");
    // Overflow is measured after render, so a static render never shows the hint.
    expect(markup).not.toContain("Scroll horizontally");
  });
});

describe("the 'Search all companies' pill", () => {
  it("one pill with the label and an arrow", () => {
    const markup = html(React.createElement(SearchAllCompaniesButton, { onClick: () => undefined }));
    expect(markup).toContain("<span>Search all companies</span>");
    expect(markup).toContain(">arrow_forward<");
    expect(markup.match(/<button/g)).toHaveLength(1);
  });
});

describe("the 'Selected | All companies' switch", () => {
  const radios = (markup: string): string[] => Array.from(markup.matchAll(/<button[^>]*role="radio"[^>]*>/g), (match) => match[0]);

  it("a radiogroup of two sides; the chosen one is checked, the only tab stop, and the navy pill sits under it", () => {
    const selected = html(React.createElement(ScopeSwitch, { isAll: false, onChange: () => undefined }));
    expect(selected).toContain('role="radiogroup"');
    expect(selected).toContain(">Selected<");
    expect(selected).toContain(">All companies<");
    expect(selected).toContain(">corporate_fare<");
    expect(selected).toContain(">domain_verification<");
    const [first, second] = radios(selected);
    expect(first).toContain('aria-checked="true"');
    expect(first).toContain('tabindex="0"');
    expect(second).toContain('aria-checked="false"');
    expect(second).toContain('tabindex="-1"');
    expect(selected).toContain('data-side="selected"');
    expect(selected).toContain("translate-x-0");

    const all = html(React.createElement(ScopeSwitch, { isAll: true, onChange: () => undefined }));
    const [allFirst, allSecond] = radios(all);
    expect(allFirst).toContain('aria-checked="false"');
    expect(allSecond).toContain('aria-checked="true"');
    expect(allSecond).toContain('tabindex="0"');
    expect(all).toContain('data-side="all"');
    expect(all).toContain("translate-x-full");
  });

  it("the pill slides (200ms) unless motion is reduced; a visible focus ring", () => {
    const markup = html(React.createElement(ScopeSwitch, { isAll: false, onChange: () => undefined }));
    expect(markup).toContain("transition-transform duration-200");
    expect(markup).toContain("motion-reduce:transition-none");
    expect(markup).toContain("focus-visible:ring-2");
  });

  it("keys: ←/↑/Home → Selected, →/↓/End → All companies, anything else nothing", () => {
    for (const key of ["ArrowLeft", "ArrowUp", "Home"]) {
      expect(scopeSwitchTarget(key), key).toBe(false);
    }
    for (const key of ["ArrowRight", "ArrowDown", "End"]) {
      expect(scopeSwitchTarget(key), key).toBe(true);
    }
    for (const key of ["Enter", " ", "Tab", "a"]) {
      expect(scopeSwitchTarget(key), key).toBeNull();
    }
  });

  it("the hint: the companies asked about (in on-surface medium), the 'none' wording, or the All companies line", () => {
    const company = { id: "summit", name: "Summit Dental Group", industry: "Dental" };
    expect(html(React.createElement(ScopeHint, { isAll: false, preview: { kind: "companies", companies: [company] }, total: 64 }))).toBe(
      '<p class="px-1 text-[12px] leading-tight text-on-surface-variant">Asking about <span class="font-medium text-on-surface">Summit Dental Group</span>. Name other companies to compare.</p>'
    );
    expect(html(React.createElement(ScopeHint, { isAll: false, preview: { kind: "none" }, total: 64 }))).toContain(
      ">Open a company or type a company&#x27;s name<"
    );
    expect(html(React.createElement(ScopeHint, { isAll: true, preview: { kind: "all" }, total: 64 }))).toContain(
      ">Filtering all 64 companies by industry, city or state, locations, territory or online booking.<"
    );
  });

  it("the placeholder by mode (no sample question)", () => {
    expect(chatPlaceholder(false)).toBe(SELECTED_PLACEHOLDER);
    expect(SELECTED_PLACEHOLDER).toBe("Ask about this company…");
    expect(chatPlaceholder(true)).toBe(ALL_COMPANIES_PLACEHOLDER);
    expect(ALL_COMPANIES_PLACEHOLDER).toBe("Filter all companies…");
  });
});

describe("line tags and the note (2026-11-07)", () => {
  const TAGGED: ScopedAnswerItem = {
    companyId: "summit",
    companyName: "Summit Dental Group",
    text: "Finance memo cites a freeze.\nHiring two hygienists\n8 locations across Front Range, CO.",
    lines: [
      { text: "Finance memo cites a freeze.", source: "research" },
      { text: "Hiring two hygienists", source: "public" },
      { text: "8 locations across Front Range, CO.", source: "card" },
    ],
  };

  it("a small 'Research' tag before a finding and 'Public' before a signal; card facts get none", () => {
    const markup = html(React.createElement(AnswerLines, { item: TAGGED }));
    expect(markup.match(/data-source="research"[^>]*>Research</g)).toHaveLength(1);
    expect(markup.match(/data-source="public"[^>]*>Public</g)).toHaveLength(1);
    expect(markup).not.toContain('data-source="card"');
    // Each line in order, the tag just before its text.
    expect(markup.indexOf(">Research</span>Finance memo cites a freeze.")).toBeGreaterThan(-1);
    expect(markup.indexOf(">Public</span>Hiring two hygienists")).toBeGreaterThan(-1);
    // 2026-11-08: each line is a bullet (was a plain paragraph); a card fact's has no tag.
    expect(markup).toContain('<span class="min-w-0 whitespace-pre-wrap">8 locations across Front Range, CO.</span>');
    // Coloured pills, not grey text.
    expect(markup).toContain("bg-secondary-fixed text-on-secondary-fixed");
    expect(markup).toContain("bg-tertiary-fixed text-on-tertiary-fixed");
  });

  it("no lines (an old saved reply, the nothing-findable message): the text exactly as before", () => {
    const oldText = html(React.createElement("p", { className: "text-on-surface-variant whitespace-pre-wrap" }, TAGGED.text));
    const { lines: _lines, ...saved } = TAGGED;
    expect(html(React.createElement(AnswerLines, { item: saved }))).toBe(oldText);
    const nothing: ScopedAnswerItem = { companyId: "a", companyName: "A", text: "Nothing about that is publicly findable for this company." };
    expect(html(React.createElement(AnswerLines, { item: nothing }))).toBe(
      '<p class="text-on-surface-variant whitespace-pre-wrap">Nothing about that is publicly findable for this company.</p>'
    );
  });

  it("a block with lines is a bulleted list: one bullet per fact, in order, card facts too (2026-11-08)", () => {
    // 2026-11-08: card facts only used to show as the plain text paragraph; now bullets too.
    const cardOnly: ScopedAnswerItem = { ...TAGGED, lines: (TAGGED.lines ?? []).map((line) => ({ ...line, source: "card" as const })) };
    const markup = html(React.createElement(AnswerLines, { item: cardOnly }));
    expect(markup.startsWith('<ul class="text-on-surface-variant space-y-1">')).toBe(true);
    expect(markup.match(/<li class="flex items-start gap-2">/g)).toHaveLength(3);
    expect(markup.match(/<span aria-hidden="true" class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-secondary"><\/span>/g)).toHaveLength(3);
    expect(markup).not.toContain("data-source");
    const texts = Array.from(markup.matchAll(/<span class="min-w-0 whitespace-pre-wrap">([^<]*)<\/span>/g), (match) => match[1]);
    expect(texts).toEqual(["Finance memo cites a freeze.", "Hiring two hygienists", "8 locations across Front Range, CO."]);
    // In the reply body, under the company's name.
    const body = html(React.createElement(DataRoomChatAnswer, { answer: { intro: "x", items: [TAGGED] } }));
    expect(body).toContain('<p class="text-[12px] font-semibold text-on-surface mb-1">Summit Dental Group</p><ul class="text-on-surface-variant space-y-1">');
  });

  it("the note shows under the answer in small muted text; none without one", () => {
    const answer: ChatAnswer = {
      intro: "Here's what's publicly findable about budget.",
      items: [TAGGED],
      note: "Ask about one company at a time to see its research findings.",
    };
    const markup = html(React.createElement(DataRoomChatAnswer, { answer }));
    expect(markup.endsWith('<p class="text-[12px] leading-snug text-on-surface-variant">Ask about one company at a time to see its research findings.</p>')).toBe(
      true
    );
    const { note: _note, ...without } = answer;
    expect(html(React.createElement(DataRoomChatAnswer, { answer: without }))).not.toContain("leading-snug");
  });

  it("a table answer's note sits under the table", () => {
    const answer: ChatAnswer = {
      intro: "1 company matches the filters I could apply (state).",
      layout: "table",
      items: [row(1)],
      note: "I can't search research like software, budget or risks across all companies. Switch to Selected and ask about a company to check.",
    };
    const markup = html(React.createElement(DataRoomChatAnswer, { answer }));
    // (The markup escapes the apostrophe in "can't".)
    expect(markup.indexOf("search research like software")).toBeGreaterThan(markup.indexOf("</table>"));
    expect(markup.indexOf("</table>")).toBeGreaterThan(-1);
  });

  it("the tag labels come from the config", () => {
    const tempo = getDataRoomChatConfig();
    const other = { ...tempo, lineSourceTags: { research: "Findings", public: "Signals" } };
    const markup = html(React.createElement(AnswerLines, { item: TAGGED, config: other }));
    expect(markup).toContain(">Findings<");
    expect(markup).toContain(">Signals<");
  });
});

describe("company names open the company (2026-11-07)", () => {
  const open = { onOpenCompany: (): void => undefined, openableCompanyIds: new Set(["summit", "northview", "c1", "c2"]) };
  /** Every "Open …" button in the markup, by its label. */
  const openButtons = (markup: string): string[] =>
    Array.from(markup.matchAll(/<button type="button" aria-label="Open ([^"]+)"/g), (match) => match[1] ?? "");
  const BUTTON_CLASS =
    "text-left cursor-pointer rounded-sm hover:text-primary hover:underline underline-offset-2 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1";

  it("the name is a real button: type button, 'Open {name}', primary + underline on hover, a focus ring; same size and weight", () => {
    const markup = html(React.createElement(CompanyName, { item: SUMMIT, ...open }));
    expect(markup).toBe(`<button type="button" aria-label="Open Summit Dental Group" class="${BUTTON_CLASS}">Summit Dental Group</button>`);
    // No size or weight of its own: it takes the heading's or cell's.
    expect(BUTTON_CLASS).not.toMatch(/text-\[|font-/);
  });

  it("list (one company or several): each heading is a button for a known company, plain text for an unknown id", () => {
    const one: ChatAnswer = { intro: "Here's the public overview of this company.", items: [SUMMIT] };
    expect(openButtons(html(React.createElement(DataRoomChatAnswer, { answer: one, ...open })))).toEqual(["Summit Dental Group"]);
    const several: ChatAnswer = { intro: "", items: [SUMMIT, NORTHVIEW, FALCON] };
    const markup = html(React.createElement(DataRoomChatAnswer, { answer: several, ...open }));
    expect(openButtons(markup)).toEqual(["Summit Dental Group", "Northview Family Dentistry"]);
    // Falcon isn't in the list: its heading is exactly as before.
    expect(markup).toContain('<p class="text-[12px] font-semibold text-on-surface mb-1">Falcon Market</p>');
    expect(markup).toContain('<p class="text-[12px] font-semibold text-on-surface mb-1"><button type="button" aria-label="Open Summit Dental Group"');
  });

  it("table: the name in the Company cell is a button; its tags stay plain; an unknown id is plain text", () => {
    const answer: ChatAnswer = { intro: "3 companies match.", layout: "table", items: [row(1), row(2), row(3)] };
    const markup = html(React.createElement(DataRoomChatAnswer, { answer, ...open }));
    expect(openButtons(markup)).toEqual([row(1).companyName, row(2).companyName]);
    expect(markup).toContain(`<div class="text-[12px] font-medium text-on-surface leading-snug">${row(3).companyName}</div>`);
    // The tags are outside the button.
    expect(markup).not.toMatch(/<button[^>]*>[^<]*<span/);
    expect(markup).toContain(">In territory</span>");
  });

  it("compare: each column header is a button; the sticky label column, widths and scrolling are unchanged", () => {
    const items = [SUMMIT, NORTHVIEW, FALCON];
    const withOpen = html(React.createElement(CompareTable, { items, ...open }));
    const plain = html(React.createElement(CompareTable, { items }));
    expect(openButtons(withOpen)).toEqual(["Summit Dental Group", "Northview Family Dentistry"]);
    // Only the openable columns change (2026-11-07: their cells also get a pointer and a
    // colour fade): the same markup once the buttons are unwrapped and those classes dropped.
    expect(
      withOpen
        .replace(/<button[^>]*>([^<]*)<\/button>/g, "$1")
        .replace(/ cursor-pointer transition-colors duration-150 motion-reduce:transition-none/g, "")
    ).toBe(plain);
    expect(withOpen).toContain("sticky left-0 z-20");
    expect(withOpen).toContain("overflow-x-auto");
    expect(withOpen).toContain("width:145px;min-width:145px");
  });

  it("compare: every cell of an openable column is clickable (pointer, colour fade); Falcon's column is exactly as before", () => {
    const items = [SUMMIT, FALCON];
    const markup = html(React.createElement(CompareTable, { items, ...open }));
    // Summit: header + one cell per row (6 rows), all with the pointer.
    expect(markup.match(/cursor-pointer transition-colors duration-150/g)).toHaveLength(1 + 6);
    // Falcon (not in the list): its cells keep today's classes (no pointer).
    expect(markup).toContain('<td class="py-1.5 px-3 text-on-surface bg-white align-top  ">Retail</td>');
  });

  it("table: an openable row is clickable as a whole (its hover kept) and its name underlines with the row; other rows as before", () => {
    const answer: ChatAnswer = { intro: "2 companies match.", layout: "table", items: [row(1), row(3)] };
    const markup = html(React.createElement(DataRoomChatAnswer, { answer, ...open }));
    // 2026-11-08: the same light blue hover as a text block and a compare column (was hover:bg-surface/60).
    expect(markup).toContain('<tr class="hover:bg-secondary-fixed/40 transition-colors motion-reduce:transition-none group cursor-pointer">');
    expect(markup).toContain('<tr class="hover:bg-surface/60 transition-colors motion-reduce:transition-none">');
    expect(markup).toContain("group-hover:text-primary group-hover:underline");
  });

  it("list: an openable company's whole block lights up on hover and is clickable; others are the plain block", () => {
    const answer: ChatAnswer = { intro: "", items: [SUMMIT, FALCON] };
    const markup = html(React.createElement(DataRoomChatAnswer, { answer, ...open }));
    expect(markup).toContain(
      '<div class="group -mx-2 px-2 py-1 rounded-lg cursor-pointer hover:bg-secondary-fixed/40 transition-colors duration-150 motion-reduce:transition-none"><p class="text-[12px] font-semibold text-on-surface mb-1"><button'
    );
    expect(markup).toContain('<div><p class="text-[12px] font-semibold text-on-surface mb-1">Falcon Market</p>');
  });

  it("no prop (any other use of the answer body) → no buttons, exactly today's markup", () => {
    for (const answer of [
      { intro: "x", items: [SUMMIT, NORTHVIEW] },
      { intro: "2 companies match.", layout: "table", items: [row(1), row(2)] },
      { intro: "", layout: "compare", items: [SUMMIT, NORTHVIEW] },
    ] satisfies ChatAnswer[]) {
      const markup = html(React.createElement(DataRoomChatAnswer, { answer }));
      expect(markup).not.toContain("<button");
      // The ids alone, or the opener alone, change nothing either.
      expect(html(React.createElement(DataRoomChatAnswer, { answer, openableCompanyIds: open.openableCompanyIds }))).toBe(markup);
      expect(html(React.createElement(DataRoomChatAnswer, { answer, onOpenCompany: open.onOpenCompany }))).toBe(markup);
    }
  });

  it("an old saved reply (companies no longer in the list), an error and a reply with no companies render exactly as before", () => {
    const old: ChatAnswer = {
      intro: "Here's what's on record.",
      items: [{ companyId: "gone-1", companyName: "Old Company", text: "In territory.\nNo online booking." }],
    };
    const error: ChatAnswer = { intro: "Sorry, I couldn't respond right now.", items: [], isError: true };
    const none: ChatAnswer = { intro: "I can only help with researching these companies.", items: [] };
    for (const answer of [old, error, none]) {
      expect(html(React.createElement(DataRoomChatAnswer, { answer, ...open })), answer.intro).toBe(
        html(React.createElement(DataRoomChatAnswer, { answer }))
      );
    }
  });
});
