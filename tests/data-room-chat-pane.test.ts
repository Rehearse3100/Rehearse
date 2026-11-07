/**
 * data-room-chat-pane.test.ts
 * The Data Room chat pane's behaviour, driven through its own handlers: React's hooks
 * are replaced by a minimal synchronous stand-in so one call of the component is one
 * render (state kept between calls, effects never run, no browser storage), and fetch
 * is mocked (no network). Covers: the "Selected | All companies" switch (click and
 * keyboard) and the scope each side sends; All companies mode (no name suggestions or
 * highlighting, questions go out as typed with scope all and never leave the mode);
 * the placeholder by mode; "Search all companies" (only under the latest reply that
 * offers it; asks the same question in All companies mode, then is gone).
 */

import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataRoomCompany } from "@/app/api/student/data-room/route";
import { SearchAllCompaniesButton } from "@/components/tempo/stages/DataRoomChatAnswer";
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
