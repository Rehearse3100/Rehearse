/**
 * data-room-chat-pane.test.ts
 * The Data Room chat pane's behaviour, driven through its own handlers: React's hooks
 * are replaced by a minimal synchronous stand-in so one call of the component is one
 * render (state kept between calls, effects never run, no browser storage), and fetch
 * is mocked (no network). Covers: the "Selected | All companies" switch (click and
 * keyboard) and the scope each side sends; All companies mode (no name suggestions or
 * highlighting, questions go out as typed with scope all and never leave the mode);
 * the placeholder by mode; "Search all companies" (only under the latest reply that
 * offers it; asks the same question in All companies mode, then is gone); 2026-11-07:
 * a reply's line sources and note are kept for the reply body (malformed ones are
 * dropped, so the reply shows as text), and history sent back stays text only; a
 * company name in a reply opens that company (onOpenCompany), for companies in the
 * current list only, without touching the draft or the transcript.
 */

import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataRoomCompany } from "@/app/api/student/data-room/route";
import { DataRoomChatAnswer, SearchAllCompaniesButton } from "@/components/tempo/stages/DataRoomChatAnswer";
import {
  ProspectingDataRoomChat,
  ScopeHint,
  ScopeSwitch,
} from "@/components/tempo/stages/ProspectingDataRoomChat";

// ── A one-component stand-in for React's hooks ───

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const slot = hooks.index++;
      if (!(slot in hooks.values)) {
        hooks.values[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      const set = (update: unknown): void => {
        hooks.values[slot] = typeof update === "function" ? (update as (prev: unknown) => unknown)(hooks.values[slot]) : update;
      };
      return [hooks.values[slot], set];
    },
    useMemo: (factory: () => unknown) => factory(),
    useEffect: () => undefined,
    useRef: (current: unknown) => ({ current }),
    useId: () => "chat",
  };
});

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement calls.
(globalThis as { React?: typeof React }).React = React;

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function company(id: string, name: string, industry: string, metro: string): DataRoomCompany {
  return {
    id,
    name,
    industry,
    sizeLabel: "",
    signalHint: "",
    vertical: null,
    locations: 3,
    metro,
    inTerritory: true,
    sizeNote: null,
    onlineBooking: false,
    blurb: null,
    publicSignals: [],
    contacts: [],
    documents: [],
  };
}

const COMPANIES: DataRoomCompany[] = [
  company("summit", "Summit Dental Group", "Dental", "Front Range, CO"),
  company("falcon", "Falcon Market", "Retail", "Denver, CO"),
  company("maple", "Maple Family Dentistry", "Dental", "Boulder, CO"),
];

type Element = React.ReactElement<Record<string, unknown>>;

/** Renders the pane once (a fresh hook order, the same state). */
function render(): Element {
  hooks.index = 0;
  return ProspectingDataRoomChat({ attemptId: "attempt-1", companies: COMPANIES, openCompanyId: "summit" }) as Element;
}

/** Every element in the tree that passes the test (components are not called, only found). */
function findAll(node: unknown, test: (element: Element) => boolean): Element[] {
  const found: Element[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object" && "props" in value) {
      const element = value as Element;
      if (test(element)) {
        found.push(element);
      }
      visit(element.props.children);
    }
  };
  visit(node);
  return found;
}

function find(node: unknown, test: (element: Element) => boolean): Element {
  const [element] = findAll(node, test);
  if (!element) {
    throw new Error("element not found");
  }
  return element;
}

const theInput = (tree: Element): Element => find(tree, (element) => element.type === "input");
const theSwitch = (tree: Element): Element => find(tree, (element) => element.type === ScopeSwitch);
const theHint = (tree: Element): Element => find(tree, (element) => element.type === ScopeHint);
const options = (tree: Element): Element[] => findAll(tree, (element) => element.props.role === "option");
const highlightedNames = (tree: Element): Element[] =>
  findAll(tree, (element) => element.props.className === "rounded-sm bg-secondary-fixed text-secondary");
const searchAllButtons = (tree: Element): Element[] => findAll(tree, (element) => element.type === SearchAllCompaniesButton);

/** Types text into the input, caret at the end. */
function type(text: string): void {
  (theInput(render()).props.onChange as (event: unknown) => void)({ target: { value: text, selectionStart: text.length } });
}

/** Clicks Send and lets the request and its reply finish. */
async function send(): Promise<void> {
  const button = find(render(), (element) => element.props["aria-label"] === "Send message");
  (button.props.onClick as () => void)();
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The body of fetch call i (the request the pane sent). */
const sent = (call: number): { scope: unknown; newMessage: string } =>
  JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body)) as { scope: unknown; newMessage: string };

function replyWith(body: Record<string, unknown>): void {
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status: 200 }));
}

beforeEach(() => {
  hooks.values = [];
  hooks.index = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ intro: "Here's what's on record.", items: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("the switch", () => {
  it("starts on Selected (the open company); clicking All companies changes the hint, the placeholder and the scope sent", async () => {
    let tree = render();
    expect(theSwitch(tree).props.isAll).toBe(false);
    expect(theInput(tree).props.placeholder).toBe("Ask about this company…");
    expect(theHint(tree).props).toMatchObject({ isAll: false, total: 3 });
    expect((theHint(tree).props.preview as { kind: string; companies: Array<{ name: string }> }).companies.map((c) => c.name)).toEqual([
      "Summit Dental Group",
    ]);

    type("What software do they use?");
    await send();
    expect(sent(0).scope).toEqual({ mode: "companies", companyIds: ["summit"] });

    (theSwitch(render()).props.onChange as (isAll: boolean) => void)(true);
    tree = render();
    expect(theSwitch(tree).props.isAll).toBe(true);
    expect(theInput(tree).props.placeholder).toBe("Filter all companies…");
    expect(theHint(tree).props).toMatchObject({ isAll: true, preview: { kind: "all" }, total: 3 });

    type("Which ones have online booking?");
    await send();
    expect(sent(1)).toMatchObject({ scope: { mode: "all" }, newMessage: "Which ones have online booking?" });

    // And back.
    (theSwitch(render()).props.onChange as (isAll: boolean) => void)(false);
    expect(theSwitch(render()).props.isAll).toBe(false);
    expect(theInput(render()).props.placeholder).toBe("Ask about this company…");
  });

  it("works from the keyboard: the arrow keys, Home and End choose a side; other keys do nothing", () => {
    const onChange = vi.fn();
    hooks.index = 0;
    const tree = ScopeSwitch({ isAll: false, onChange }) as Element;
    const radios = findAll(tree, (element) => element.props.role === "radio");
    expect(radios.map((radio) => radio.props["aria-checked"])).toEqual([true, false]);
    const press = (radio: Element, key: string): ReturnType<typeof vi.fn> => {
      const preventDefault = vi.fn();
      (radio.props.onKeyDown as (event: unknown) => void)({ key, preventDefault });
      return preventDefault;
    };
    expect(press(radios[0]!, "ArrowRight")).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(true);
    press(radios[1]!, "ArrowLeft");
    expect(onChange).toHaveBeenLastCalledWith(false);
    press(radios[0]!, "End");
    expect(onChange).toHaveBeenLastCalledWith(true);
    press(radios[1]!, "Home");
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(press(radios[0]!, "a")).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(4);
    // A click picks that side.
    (radios[1]!.props.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith(true);
  });
});

describe("All companies mode: company names are not picked", () => {
  it("Selected mode (unchanged): typing a name suggests it and colours it", () => {
    type("What about Falc");
    expect(options(render()).map((option) => option.key)).toEqual(["falcon"]);
    type("What about Falcon Market?");
    expect(highlightedNames(render())).toHaveLength(1);
  });

  it("typing a company name shows no suggestions and no colour, sends with scope all as typed, and stays in All companies", async () => {
    (theSwitch(render()).props.onChange as (isAll: boolean) => void)(true);
    type("What about Falc");
    let tree = render();
    expect(options(tree)).toHaveLength(0);
    expect(theInput(tree).props["aria-expanded"]).toBe(false);

    type("What about Falcon Market?");
    tree = render();
    expect(options(tree)).toHaveLength(0);
    expect(highlightedNames(tree)).toHaveLength(0);
    expect(theHint(tree).props.preview).toEqual({ kind: "all" });

    await send();
    expect(sent(0)).toMatchObject({ scope: { mode: "all" }, newMessage: "What about Falcon Market?" });
    expect(theSwitch(render()).props.isAll).toBe(true);
  });

  it("after a list, 'it' is sent about all companies too (it no longer leaves All companies mode)", async () => {
    (theSwitch(render()).props.onChange as (isAll: boolean) => void)(true);
    replyWith({
      intro: "1 company matches.",
      layout: "table",
      items: [{ companyId: "falcon", companyName: "Falcon Market", text: "Retail · 3 locations · Denver, CO" }],
    });
    type("Which are retail?");
    await send();
    type("What does it sell?");
    await send();
    expect(sent(1)).toMatchObject({ scope: { mode: "all" }, newMessage: "What does it sell?" });
    expect(theSwitch(render()).props.isAll).toBe(true);
  });
});

describe("Search all companies", () => {
  const ONE_COMPANY_FILTER_REPLY = {
    intro: "",
    items: [{ companyId: "summit", companyName: "Summit Dental Group", text: "No online booking." }],
    suggestAllCompanies: true,
  };

  it("shows under the latest reply that offers it; clicking asks the same question in All companies mode, then it's gone", async () => {
    replyWith(ONE_COMPANY_FILTER_REPLY);
    type("Which ones have online booking?");
    await send();
    expect(sent(0).scope).toEqual({ mode: "companies", companyIds: ["summit"] });
    let buttons = searchAllButtons(render());
    expect(buttons).toHaveLength(1);

    (buttons[0]!.props.onClick as () => void)();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(1)).toMatchObject({ scope: { mode: "all" }, newMessage: "Which ones have online booking?" });
    const tree = render();
    expect(theSwitch(tree).props.isAll).toBe(true);
    buttons = searchAllButtons(tree);
    expect(buttons).toHaveLength(0);
    // The question was asked again as a new message: two questions, two replies.
    const transcript = hooks.values[0] as Array<{ role: string; content?: string; isSearchAllUsed?: boolean }>;
    expect(transcript.filter((message) => message.role === "user").map((message) => message.content)).toEqual([
      "Which ones have online booking?",
      "Which ones have online booking?",
    ]);
    expect(transcript[1]?.isSearchAllUsed).toBe(true);
  });

  it("not on a reply without the flag, and not once a newer message follows", async () => {
    type("What software do they use?");
    await send();
    expect(searchAllButtons(render())).toHaveLength(0);

    replyWith(ONE_COMPANY_FILTER_REPLY);
    type("Which ones have online booking?");
    await send();
    expect(searchAllButtons(render())).toHaveLength(1);
    type("Who are the contacts?");
    await send();
    expect(searchAllButtons(render())).toHaveLength(0);
  });

  it("the reply keeps its table fields (layout and cards) for the pane", async () => {
    replyWith({
      intro: "1 company matches.",
      layout: "table",
      items: [
        {
          companyId: "falcon",
          companyName: "Falcon Market",
          text: "Retail · 3 locations · Denver, CO",
          card: { industry: "Retail", locations: 3, metro: "Denver, CO", inTerritory: true, onlineBooking: false },
        },
        { companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental", card: { industry: 7 } },
      ],
    });
    (theSwitch(render()).props.onChange as (isAll: boolean) => void)(true);
    type("Which are retail?");
    await send();
    const reply = (hooks.values[0] as Array<Record<string, unknown>>)[1] as {
      layout?: string;
      items: Array<{ card?: unknown }>;
    };
    expect(reply.layout).toBe("table");
    expect(reply.items[0]?.card).toEqual({ industry: "Retail", locations: 3, metro: "Denver, CO", inTerritory: true, onlineBooking: false });
    // A malformed card is dropped (that reply then shows as text).
    expect(reply.items[1]?.card).toBeUndefined();
  });
});

describe("after All-companies lists, back in Selected: the question goes where the hint says", () => {
  /** The company ids the hint line names (empty when it names none). */
  const hintIds = (tree: Element): string[] => {
    const preview = theHint(tree).props.preview as { kind: string; companies?: Array<{ id: string }> };
    return preview.kind === "companies" ? (preview.companies ?? []).map((c) => c.id) : [];
  };
  const switchTo = (isAll: boolean): void => (theSwitch(render()).props.onChange as (value: boolean) => void)(isAll);

  async function listThen(listIds: string[]): Promise<void> {
    switchTo(true);
    replyWith({
      intro: `${listIds.length} companies match.`,
      layout: "table",
      items: listIds.map((id) => ({ companyId: id, companyName: id, text: "Dental · 3 locations · Denver, CO" })),
    });
    type("which are in colorado");
    await send();
    switchTo(false);
  }

  it("the real case: 'which ones have online boookinh?' → the company the hint names (the open one), not a listed row", async () => {
    await listThen(["falcon", "maple"]);
    type("which ones have online boookinh?");
    const tree = render();
    expect(hintIds(tree)).toEqual(["summit"]);
    await send();
    expect(sent(1).scope).toEqual({ mode: "companies", companyIds: hintIds(tree) });
  });

  it("the same holds for the other rules: a named company, 'it' after a one-company list, and a plural 'which ones' after it", async () => {
    await listThen(["maple"]);
    for (const [text, expected] of [
      ["What does it sell?", ["maple"]],
      ["which ones have online booking?", ["summit"]],
      ["What about Falcon Market?", ["falcon"]],
    ] as const) {
      type(text);
      const tree = render();
      expect(hintIds(tree), text).toEqual(expected);
      const calls = fetchMock.mock.calls.length;
      await send();
      expect(sent(calls).scope, text).toEqual({ mode: "companies", companyIds: [...expected] });
      // Back to the list as the latest exchange for the next case.
      await listThen(["maple"]);
    }
  });
});

describe("line sources and the note (2026-11-07)", () => {
  it("the reply keeps each line's source and its note; malformed lines or a non-text note are dropped", async () => {
    replyWith({
      intro: "Here's what's publicly findable about budget.",
      items: [
        {
          companyId: "summit",
          companyName: "Summit Dental Group",
          text: "Finance memo cites a freeze.\nHiring two hygienists\n8 locations.",
          lines: [
            { text: "Finance memo cites a freeze.", source: "research" },
            { text: "Hiring two hygienists", source: "public" },
            { text: "8 locations.", source: "card" },
          ],
        },
        { companyId: "falcon", companyName: "Falcon Market", text: "Retail", lines: [{ text: "Retail", source: "secret" }] },
      ],
      note: "Ask about one company at a time to see its research findings.",
    });
    type("What about their budget?");
    await send();
    const reply = (hooks.values[0] as Array<Record<string, unknown>>)[1] as {
      note?: string;
      items: Array<{ lines?: unknown }>;
    };
    expect(reply.note).toBe("Ask about one company at a time to see its research findings.");
    expect(reply.items[0]?.lines).toEqual([
      { text: "Finance memo cites a freeze.", source: "research" },
      { text: "Hiring two hygienists", source: "public" },
      { text: "8 locations.", source: "card" },
    ]);
    // An unknown source: no lines (that block shows its text, as before).
    expect(reply.items[1]).not.toHaveProperty("lines");

    replyWith({ intro: "Here's what's on record.", items: [], note: 42 });
    type("Anything else?");
    await send();
    expect((hooks.values[0] as Array<Record<string, unknown>>)[3]).not.toHaveProperty("note");
    // History sent back is text only: no sources, no note.
    const history = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).history as Array<Record<string, unknown>>;
    expect(JSON.stringify(history)).not.toContain("source");
    expect(JSON.stringify(history)).not.toContain("note");
  });
});

describe("opening a company from its name in a reply (2026-11-07)", () => {
  const onOpenCompany = vi.fn<(companyId: string) => void>();

  /** Renders the pane with an opener, as the Data Room does. */
  function renderWithOpener(open: ((companyId: string) => void) | null = onOpenCompany): Element {
    hooks.index = 0;
    return ProspectingDataRoomChat({
      attemptId: "attempt-1",
      companies: COMPANIES,
      openCompanyId: "summit",
      onOpenCompany: open ?? undefined,
    }) as Element;
  }

  /** The tree with every function component called (the hooks stand-in serves their hooks). */
  function expand(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(expand);
    }
    if (node && typeof node === "object" && "props" in node) {
      const element = node as Element;
      if (typeof element.type === "function") {
        return expand((element.type as (props: unknown) => unknown)(element.props));
      }
      return { ...element, props: { ...element.props, children: expand(element.props.children) } };
    }
    return node;
  }

  /** The "Open …" buttons in the replies, as rendered. */
  const nameButtons = (tree: Element): Element[] =>
    findAll(
      findAll(tree, (element) => element.type === DataRoomChatAnswer).map(expand),
      (element) => element.type === "button" && String(element.props["aria-label"] ?? "").startsWith("Open ")
    );

  beforeEach(() => {
    onOpenCompany.mockReset();
  });

  it("list, table and compare replies: clicking a name opens that company; a company outside the list is plain text", async () => {
    replyWith({
      intro: "Here's the public overview of these companies.",
      items: [
        { companyId: "summit", companyName: "Summit Dental Group", text: "Dental" },
        { companyId: "gone", companyName: "Gone Clinic", text: "Dental" },
      ],
    });
    replyWith({
      intro: "2 companies match.",
      layout: "table",
      items: ["falcon", "maple"].map((companyId) => ({
        companyId,
        companyName: COMPANIES.find((company) => company.id === companyId)?.name ?? "",
        text: "x",
        card: { industry: "Retail", locations: 3, metro: "Denver, CO", inTerritory: true, onlineBooking: false },
      })),
    });
    replyWith({
      intro: "Which one to pursue is your call; the facts below can help you compare.",
      layout: "compare",
      items: ["maple", "summit"].map((companyId) => ({
        companyId,
        companyName: COMPANIES.find((company) => company.id === companyId)?.name ?? "",
        text: "x",
        card: { industry: "Dental", locations: 3, metro: "Boulder, CO", inTerritory: true, onlineBooking: false },
        signals: [],
      })),
    });
    for (const question of ["Tell me about them", "Which are retail?", "Compare them"]) {
      type(question);
      await send();
    }
    const buttons = nameButtons(renderWithOpener());
    expect(buttons.map((button) => button.props["aria-label"])).toEqual([
      "Open Summit Dental Group",
      "Open Falcon Market",
      "Open Maple Family Dentistry",
      "Open Maple Family Dentistry",
      "Open Summit Dental Group",
    ]);
    expect(buttons.every((button) => button.props.type === "button")).toBe(true);
    ["summit", "falcon", "maple", "maple", "summit"].forEach((id, i) => {
      (buttons[i]?.props.onClick as () => void)();
      expect(onOpenCompany).toHaveBeenLastCalledWith(id);
    });
    expect(onOpenCompany).toHaveBeenCalledTimes(5);
  });

  it("a click changes nothing in the chat: no request, the same transcript, the draft kept; the open company's own name is harmless", async () => {
    replyWith({ intro: "Here's the public overview of this company.", items: [{ companyId: "summit", companyName: "Summit Dental Group", text: "Dental" }] });
    type("Tell me about them");
    await send();
    type("What about their budget");
    const transcript = JSON.stringify(hooks.values[0]);
    const [button] = nameButtons(renderWithOpener());
    // Summit is the open company: the click just opens it again.
    (button?.props.onClick as () => void)();
    expect(onOpenCompany).toHaveBeenCalledWith("summit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(hooks.values[0])).toBe(transcript);
    expect(theInput(renderWithOpener()).props.value).toBe("What about their budget");
  });

  it("no opener passed → the names are plain text (no buttons)", async () => {
    replyWith({ intro: "x", items: [{ companyId: "summit", companyName: "Summit Dental Group", text: "Dental" }] });
    type("Tell me about them");
    await send();
    expect(nameButtons(renderWithOpener(null))).toEqual([]);
    expect(nameButtons(render())).toEqual([]);
  });
});
