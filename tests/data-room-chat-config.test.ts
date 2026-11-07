/**
 * data-room-chat-config.test.ts
 * The per-simulation Data Room chat config (lib/data-room-chat-config.ts): every
 * string built from it is pinned to the exact text it had before the move — the
 * All-companies fixed and answer-key replies, both greetings, the switch's hint line,
 * the router's topic list — and the full prompts and the result/compare table
 * markup are pinned by SHA-256, so the refactor is byte-for-byte. Also the storage
 * prefix (saved chats keep loading) and the config lookup.
 */

import { createHash } from "node:crypto";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareTable, ResultTable } from "@/components/tempo/stages/DataRoomChatAnswer";
import { ScopeHint } from "@/components/tempo/stages/ProspectingDataRoomChat";
import { TEMPO_SIMULATION_ID } from "@/lib/constants";
import {
  DATA_ROOM_CHAT_STORAGE_PREFIX,
  filterFieldsPhrase,
  getDataRoomChatConfig,
  joinList,
  type DataRoomChatConfig,
} from "@/lib/data-room-chat-config";
import { ALL_MODE_REPLY, allModeReply, META_ALL_MODE_REPLY, metaAllModeReply } from "@/lib/data-room-chat-filter";
import { OPENING_SYSTEM_PROMPT, SELECTION_SYSTEM_PROMPT } from "@/lib/data-room-chat-render";
import { buildRouterSystemPrompt, ROUTER_SYSTEM_PROMPT } from "@/lib/data-room-chat-router";
import {
  GREETING_REPLY_ALL,
  GREETING_REPLY_COMPANIES,
  greetingReply,
  greetingReplyAll,
  type ScopedAnswerItem,
} from "@/lib/data-room-chat-scope";
import { clearDataRoomChatFromStorage } from "@/lib/tempo-prospecting";

(globalThis as { React?: typeof React }).React = React;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const ITEMS: ScopedAnswerItem[] = [
  {
    companyId: "a",
    companyName: "Alpha Clinics",
    text: "Dental · 8 locations · Front Range, CO",
    card: { industry: "Dental", locations: 8, metro: "Front Range, CO", inTerritory: true, onlineBooking: false },
    signals: ["Opened 8th location three months ago"],
  },
  {
    companyId: "b",
    companyName: "Bravo Health",
    text: "Retail · 1 location · Boise, ID",
    card: { industry: "Retail", locations: null, metro: null, inTerritory: false, onlineBooking: true },
    signals: [],
  },
];

describe("strings built from the config are exactly today's", () => {
  it("the All-companies fixed reply and the answer-key reply", () => {
    expect(ALL_MODE_REPLY).toBe(
      "In All companies mode I can filter by industry, city or state, number of locations, territory and online booking. Switch to Selected and ask about a company to research it in depth."
    );
    expect(META_ALL_MODE_REPLY).toBe(
      "I can't share hidden or internal information. In All companies mode I can filter every company by industry, city or state, number of locations, territory and online booking."
    );
  });

  it("both greetings", () => {
    expect(GREETING_REPLY_ALL).toBe(
      "Hi! I'm your research assistant. Here I can filter every company by industry, city or state, number of locations, territory and online booking. Open a company to research it in depth."
    );
    expect(GREETING_REPLY_COMPANIES).toBe(
      "Hi! I'm your research assistant. Ask me about the open company: its locations, software, hiring, budget or risks. To search across every company, switch to All companies."
    );
  });

  it("the switch's hint line in All companies mode", () => {
    expect(renderToStaticMarkup(React.createElement(ScopeHint, { isAll: true, preview: { kind: "all" }, total: 64 }))).toBe(
      '<p class="px-1 text-[12px] leading-tight text-on-surface-variant">Filtering all 64 companies by industry, city or state, locations, territory or online booking.</p>'
    );
  });

  it("the router's topic list", () => {
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      "topic (set it for specific_research; otherwise null): one of current_tools (software, systems, vendors, contracts, recent rollouts), budget (spending, budget, cost pressure, freezes), staffing (hiring, cuts, turnover, team changes, front-desk staffing), operations (processes, hours, scheduling, phones, wait times, capacity), growth (new locations, expansion, acquisitions), ownership (owner, franchise, corporate structure, who decides), customer_feedback (reviews, complaints, sentiment), amenities (parking, décor, facilities, events, community activities), risks (risks, concerns, red flags, challenges), fit (whether or why they would be a good or bad prospect), recent_changes (what changed recently)."
    );
  });

  it("the full prompts and the table markup, byte for byte", () => {
    expect({
      router: sha256(ROUTER_SYSTEM_PROMPT),
      selection: sha256(SELECTION_SYSTEM_PROMPT),
      opening: sha256(OPENING_SYSTEM_PROMPT),
      table: sha256(renderToStaticMarkup(React.createElement(ResultTable, { items: ITEMS }))),
      compare: sha256(renderToStaticMarkup(React.createElement(CompareTable, { items: ITEMS }))),
      compareLimited: sha256(renderToStaticMarkup(React.createElement(CompareTable, { items: ITEMS, rows: ["territory", "online_booking"] }))),
    }).toEqual({
      // Taken from the code before the config existed (2026-11-06); the router's changed
      // since on purpose (who-decides → ownership, traps as meta).
      router: "9d86681edaa09a8bee5bafa3d5daacec66e7b840d659f313db908c4d1511fd04",
      selection: "4e5c06733259b8fa3605e09253fc60b2ee05c2511812abca19824a3399030b5d",
      opening: "a41a805ae91ecd7886ef4d027f503b573b1aad81069d646675a260097a8bdd68",
      table: "65a0fd3d40e9e2b4e25dfaa4046a65534a48af836aa22dc830f3b254ff98aaac",
      compare: "540868c8e26fef34bf5d9dbf4537d4eeadb0e5be6806cf8add51670fdae5bb29",
      compareLimited: "e0192c729677f7fc6ca5a0d12bffad0d64bbeb420731f72d29377cb34380840c",
    });
  });
});

describe("the config itself", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Tempo's config by id, and the same one by default (the only simulation for now)", () => {
    const tempo = getDataRoomChatConfig(TEMPO_SIMULATION_ID);
    expect(getDataRoomChatConfig()).toBe(tempo);
    expect(getDataRoomChatConfig(null)).toBe(tempo);
    expect(getDataRoomChatConfig("another-simulation")).toBe(tempo);
  });

  it("lists read 'a, b and c' / 'a, b or c'; the field phrases are the replies' and the hint's", () => {
    expect(joinList([], "and")).toBe("");
    expect(joinList(["a"], "or")).toBe("a");
    expect(joinList(["a", "b"], "and")).toBe("a and b");
    expect(joinList(["a", "b", "c"], "or")).toBe("a, b or c");
    const tempo = getDataRoomChatConfig();
    expect(filterFieldsPhrase(tempo, "reply")).toBe("industry, city or state, number of locations, territory and online booking");
    expect(filterFieldsPhrase(tempo, "hint")).toBe("industry, city or state, locations, territory or online booking");
  });

  it("the transcript key keeps its value, so saved chats keep loading, and Restart still clears it", () => {
    expect(DATA_ROOM_CHAT_STORAGE_PREFIX).toBe("tempo-data-room-chat-v2-");
    const removed: string[] = [];
    const storage = { removeItem: (key: string) => void removed.push(key) };
    vi.stubGlobal("window", { localStorage: storage, sessionStorage: storage });
    clearDataRoomChatFromStorage("attempt-1");
    expect(removed).toEqual(["tempo-data-room-chat-v2-attempt-1", "tempo-data-room-chat-v2-attempt-1"]);
  });

  it("another simulation's config changes only the wording it holds (the code is generic)", () => {
    const tempo = getDataRoomChatConfig();
    const other: DataRoomChatConfig = {
      ...tempo,
      filterFields: [
        { label: "sector", shortLabel: "sector" },
        { label: "region", shortLabel: "region" },
      ],
      greetingTopics: ["budget", "suppliers"],
      tableHeaders: { company: "Firm", industry: "Sector", locations: "Sites", city: "Region" },
      compareRowLabels: { ...tempo.compareRowLabels, locations: "Sites" },
      cardLabels: { inTerritory: "Covered", outOfTerritory: "Not covered", onlineBooking: "Ordering online", noOnlineBooking: "No ordering online" },
      topicDescriptions: { ...tempo.topicDescriptions, current_tools: "suppliers and systems" },
    };
    expect(allModeReply(other)).toBe(
      "In All companies mode I can filter by sector and region. Switch to Selected and ask about a company to research it in depth."
    );
    expect(metaAllModeReply(other)).toContain("filter every company by sector and region.");
    expect(greetingReplyAll(other)).toContain("Here I can filter every company by sector and region.");
    expect(greetingReply("greeting", { mode: "companies", companyIds: ["a"] }, other).intro).toContain("its budget or suppliers.");
    expect(renderToStaticMarkup(React.createElement(ScopeHint, { isAll: true, preview: { kind: "all" }, total: 9, config: other }))).toContain(
      "Filtering all 9 companies by sector or region."
    );
    const table = renderToStaticMarkup(React.createElement(ResultTable, { items: ITEMS, config: other }));
    for (const label of [">Firm<", ">Sector<", ">Sites<", ">Region<", ">Covered<", ">No ordering online<"]) {
      expect(table, label).toContain(label);
    }
    const compare = renderToStaticMarkup(React.createElement(CompareTable, { items: ITEMS, config: other }));
    expect(compare).toContain(">Sites<");
    expect(compare).toContain(">Not covered<");
    expect(buildRouterSystemPrompt(other)).toContain("current_tools (suppliers and systems)");
    // Tempo's own strings are untouched.
    expect(buildRouterSystemPrompt(tempo)).toBe(ROUTER_SYSTEM_PROMPT);
    expect(allModeReply(tempo)).toBe(ALL_MODE_REPLY);
  });
});
