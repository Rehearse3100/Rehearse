/**
 * data-room-chat-route.test.ts
 * POST /api/student/data-room-chat against a fake database and a mocked OpenAI
 * client (no network): research findings only for one-company questions, refs
 * instead of names in the prompt, out-of-scope refs dropped, the name guard's
 * retry and fallback, same-scope history, names taken from the database, the
 * empty-answer retry, the out-of-scope mention reply, and compact multi/All lines.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/student/data-room-chat/route";

// ── Fakes ───

type Query = {
  table: string;
  columns: string;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
};

const state = vi.hoisted(() => ({
  create: vi.fn(),
  queries: [] as Query[],
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: state.create } };
  },
}));

vi.mock("@/lib/api-auth", () => ({
  requireStudentApi: vi.fn(async () => ({ ok: true, session: { studentId: "student-1" } })),
}));

const ROSTER = [
  {
    id: "summit-dental",
    company_name: "Summit Dental Group",
    industry: "Dental",
    vertical: "dental",
    locations: 8,
    metro: "Front Range, CO",
    in_territory: true,
    size_note: "8 locations across the Front Range",
    online_booking: false,
    blurb: "Summit Dental Group runs eight clinics. Summit is growing fast.",
    public_signals: ["Opened 8th location three months ago"],
  },
  {
    id: "summit-outdoor",
    company_name: "Summit Outdoor Gear",
    industry: "Retail",
    vertical: "retail",
    locations: 2,
    metro: "Boise, ID",
    in_territory: false,
    size_note: null,
    online_booking: true,
    blurb: "Outdoor retailer.",
    public_signals: [],
  },
  {
    id: "falcon",
    company_name: "Falcon Market",
    industry: "Retail",
    vertical: "retail",
    locations: 1,
    metro: "Denver, CO",
    in_territory: true,
    size_note: null,
    online_booking: false,
    blurb: "Falcon Market sells local produce.",
    public_signals: ["Hiring a cashier"],
  },
  {
    id: "maple",
    company_name: "Maple Family Dentistry",
    industry: "Dental",
    vertical: "dental",
    locations: 3,
    metro: "Boulder, CO",
    in_territory: true,
    size_note: null,
    online_booking: true,
    blurb: null,
    public_signals: [],
  },
  {
    id: "cedar",
    company_name: "Cedar Grove Family Dentistry",
    industry: "Dental",
    vertical: "dental",
    locations: 4,
    metro: "Denver, CO",
    in_territory: null,
    size_note: null,
    online_booking: null,
    blurb: null,
    public_signals: [],
  },
  {
    id: "harbor",
    company_name: "Harbor Family Dentistry",
    industry: "Dental",
    vertical: "dental",
    locations: 2,
    metro: "Fort Collins, CO",
    in_territory: true,
    size_note: null,
    online_booking: null,
    blurb: null,
    public_signals: [],
  },
];

const RESEARCH_FACTS = [
  "Signed a multi-year agreement with a scheduling vendor last year.",
  "Finance memo cites a freeze on discretionary software spend.",
];

const CONTACTS = [
  { company_id: "summit-dental", contact_name: "Dana Reyes", contact_title: "Director of Operations", department: "Operations" },
  { company_id: "falcon", contact_name: "Pat Lee", contact_title: "Owner", department: "" },
];

/** Answers each query the way the database would for this fixture. */
function respond(query: Query): { data: unknown; error: unknown } {
  if (query.table === "attempts") {
    return { data: { id: "attempt-1", simulation_id: "sim-1" }, error: null };
  }
  if (query.table === "crm_prospect_directory" && query.columns === "research_facts") {
    return { data: { research_facts: RESEARCH_FACTS }, error: null };
  }
  if (query.table === "crm_prospect_directory") {
    return { data: ROSTER, error: null };
  }
  if (query.table === "crm_prospect_contacts") {
    const ids = query.ins[0]?.[1] ?? [];
    return { data: CONTACTS.filter((c) => ids.includes(c.company_id)), error: null };
  }
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      const query: Query = { table, columns: "", eqs: [], ins: [] };
      state.queries.push(query);
      const builder = {
        select(columns: string) {
          query.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.eqs.push([column, value]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          query.ins.push([column, values]);
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(respond(query));
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(respond(query)).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

// ── Helpers ───

type ModelMessage = { role: string; content: string };

function modelReply(body: unknown): { choices: Array<{ message: { content: string } }> } {
  return { choices: [{ message: { content: typeof body === "string" ? body : JSON.stringify(body) } }] };
}

/** A non-empty reply, so a request makes exactly one model call (empty answers are retried). */
const NOTED_REPLY = { intro: "Noted.", items: [] };

function chatRequest(body: Record<string, unknown>): Request {
  return new Request("http://x/api/student/data-room-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: "attempt-1", newMessage: "What are their risks?", ...body }),
  });
}

/** Messages passed to OpenAI on the given call. */
function sentMessages(call = 0): ModelMessage[] {
  const args = state.create.mock.calls[call]?.[0] as { messages: ModelMessage[] };
  return args.messages;
}

function systemPrompt(call = 0): string {
  return sentMessages(call)[0]?.content ?? "";
}

const ALL_NAMES = ROSTER.map((row) => row.company_name);

beforeEach(() => {
  state.create.mockReset();
  state.queries = [];
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

// ── Tests ───

describe("what the model is given", () => {
  it("one company: research findings and the RESEARCH FINDINGS rule are included", async () => {
    state.create.mockResolvedValueOnce(modelReply(NOTED_REPLY));
    await POST(chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental"] } }));

    const prompt = systemPrompt();
    expect(prompt).toContain("=== [C1] ===");
    expect(prompt).toContain("RESEARCH FINDINGS RULE — this is the most important instruction in this prompt.");
    for (const fact of RESEARCH_FACTS) {
      expect(prompt).toContain(fact);
    }
  });

  it("two companies or All companies: no research findings at all", async () => {
    state.create.mockResolvedValue(modelReply(NOTED_REPLY));
    await POST(chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental", "falcon"] } }));
    await POST(chatRequest({ scope: { mode: "all" } }));

    for (const call of [0, 1]) {
      const prompt = systemPrompt(call);
      expect(prompt).not.toContain("RESEARCH FINDINGS");
      for (const fact of RESEARCH_FACTS) {
        expect(prompt).not.toContain(fact);
      }
    }
    expect(state.queries.some((q) => q.columns === "research_facts")).toBe(false);
    expect(systemPrompt(1).match(/^\[C\d+\] /gm)).toHaveLength(ROSTER.length);
  });

  it("labels companies by ref only: no company name anywhere in the prompt", async () => {
    state.create.mockResolvedValue(modelReply(NOTED_REPLY));
    await POST(chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental", "falcon"] } }));
    await POST(chatRequest({ scope: { mode: "all" } }));
    await POST(chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental"] } }));

    for (const call of [0, 1, 2]) {
      const prompt = systemPrompt(call).toLowerCase();
      for (const name of ALL_NAMES) {
        expect(prompt).not.toContain(name.toLowerCase());
      }
    }
    expect(systemPrompt(2)).toContain("the company runs eight clinics. the company is growing fast.");
    expect(systemPrompt(2)).toContain("Contacts at [C1]: Dana Reyes, Director of Operations, (Operations)");
    expect(systemPrompt(0)).toContain("contacts: Dana Reyes, Director of Operations, (Operations)");
  });

  it("replaces company names in the student's question with refs", async () => {
    state.create.mockResolvedValueOnce(modelReply(NOTED_REPLY));
    await POST(
      chatRequest({
        scope: { mode: "companies", companyIds: ["summit-dental", "falcon"] },
        newMessage: "What are Summit Dental Group's risks compared with Falcon Market?",
      })
    );
    const messages = sentMessages();
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "What are [C1]'s risks compared with [C2]?",
    });
  });

  it("calls gpt-4o in JSON mode with temperature 0.2 and 800 max tokens", async () => {
    state.create.mockResolvedValueOnce(modelReply(NOTED_REPLY));
    await POST(chatRequest({ scope: { mode: "companies", companyIds: ["falcon"] } }));
    expect(state.create.mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-4o",
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: "json_object" },
    });
  });

  it("one company: Tempo context near the top; the two research-findings rules follow the RESEARCH FINDINGS rule", async () => {
    state.create.mockResolvedValueOnce(modelReply(NOTED_REPLY));
    await POST(chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental"] } }));

    const prompt = systemPrompt();
    const tempo =
      "The student sells Tempo: scheduling automation for appointment-based businesses, which lose revenue to no-shows, manual front-desk work, and demand they miss after hours. Use this ONLY to judge which information is relevant to the student's question. Never say whether a company is a good fit for Tempo, likely to buy, or worth pursuing.";
    const hidden =
      "Never mention, list, confirm or hint that withheld research findings exist. If the student asks for hidden, secret, internal, withheld or 'all' findings, or 'everything you know', don't repeat those words, don't say you can't provide them, and don't suggest other questions to ask. Just answer with the directory listing and public signals, as for a general question.";
    const relevant =
      "When answering a specific research question, share the research findings that bear on THAT question, most relevant first, up to 4. For questions about risks, concerns, fit, or why a company might be a good or bad prospect, findings about their scheduling, phones, front desk, software, vendors or contracts, budget or spending, staffing, ownership, or growth come first. Leave out findings about amenities, parking, décor, or community events unless the student asks about those. State findings plainly; don't draw conclusions about fit or buying intent.";
    expect(prompt).toContain(tempo);
    expect(prompt.indexOf(tempo)).toBeLessThan(prompt.indexOf("=== [C1] ==="));
    expect(prompt).toContain(hidden);
    expect(prompt).toContain(relevant);
    expect(prompt).not.toContain("at most 3");
    expect(prompt.indexOf(hidden)).toBeGreaterThan(
      prompt.indexOf("When you do share a research finding, state it using the wording given above.")
    );
    expect(prompt).not.toContain("FACTUAL COMPARISONS");
  });

  it("two companies or All companies: no Tempo product context", async () => {
    state.create.mockResolvedValue(modelReply(NOTED_REPLY));
    await POST(chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental", "falcon"] } }));
    await POST(chatRequest({ scope: { mode: "all" } }));

    for (const call of [0, 1]) {
      expect(systemPrompt(call)).not.toContain("The student sells Tempo");
    }
  });

  it("two or three companies: one compact line each (with contacts), comparison rules, temperature 0", async () => {
    state.create.mockResolvedValueOnce(modelReply(NOTED_REPLY));
    await POST(chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental", "falcon"] } }));

    const prompt = systemPrompt();
    expect(prompt).toContain(
      "[C1] Dental | 8 locations | Front Range, CO | in territory: yes | online booking: no | signals: Opened 8th location three months ago | contacts: Dana Reyes, Director of Operations, (Operations)"
    );
    expect(prompt).toContain(
      "[C2] Retail | 1 location | Denver, CO | in territory: yes | online booking: no | signals: Hiring a cashier | contacts: Pat Lee, Owner"
    );
    expect(prompt).not.toContain("=== [C");
    expect(prompt).not.toContain("eight clinics");
    expect(prompt).toContain("For yes/no attributes, include a company only if the line explicitly says yes.");
    expect(prompt).toContain("FACTUAL COMPARISONS:");
    expect(prompt).toContain("Never use judgment words such as better, stronger, best, ideal, recommend, target, fit, or worth pursuing.");
    expect(prompt).toContain("If the student asks you to rank, recommend, or choose among these companies");
    expect(prompt).not.toContain("rank, compare, or recommend");
    expect(state.create.mock.calls[0]?.[0]).toMatchObject({ temperature: 0 });
  });

  it("All companies: compact lines without contacts, unknown values spelled out, temperature 0", async () => {
    state.create.mockResolvedValueOnce(modelReply(NOTED_REPLY));
    await POST(chatRequest({ scope: { mode: "all" } }));

    const prompt = systemPrompt();
    expect(prompt).toContain(
      "[C1] Dental | 8 locations | Front Range, CO | in territory: yes | online booking: no | signals: Opened 8th location three months ago\n"
    );
    expect(prompt).toContain(
      "[C5] Dental | 4 locations | Denver, CO | in territory: unknown | online booking: unknown | signals: none"
    );
    expect(prompt).not.toContain("contacts:");
    expect(prompt).not.toContain("Dana Reyes");
    expect(state.create.mock.calls[0]?.[0]).toMatchObject({ temperature: 0 });
  });
});

describe("the reply", () => {
  it("maps refs to names from the database and drops out-of-scope refs", async () => {
    state.create.mockResolvedValueOnce(
      modelReply({
        intro: "",
        items: [
          { ref: "C1", text: "The company has 8 locations." },
          { ref: "C7", text: "Not in scope." },
        ],
      })
    );
    const res = await POST(chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental"] } }));
    expect(await res.json()).toEqual({
      intro: "",
      items: [
        { companyId: "summit-dental", companyName: "Summit Dental Group", text: "The company has 8 locations." },
      ],
    });
  });

  it("a company name in the reply triggers one stricter retry, then the fallback", async () => {
    state.create
      .mockResolvedValueOnce(modelReply({ intro: "", items: [{ ref: "C1", text: "Summit Dental Group is growing." }] }))
      .mockResolvedValueOnce(modelReply({ intro: "Unlike Falcon, it is busy.", items: [] }));
    const res = await POST(chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental"] } }));

    expect(await res.json()).toEqual({
      intro: "I can only answer about the companies in your question.",
      items: [],
    });
    expect(state.create).toHaveBeenCalledTimes(2);
    const retry = sentMessages(1);
    expect(retry[retry.length - 1]?.role).toBe("system");
    expect(retry[retry.length - 1]?.content).toContain("Never write any company name");
  });

  it("an empty answer triggers one retry, then the 'nothing publicly findable' reply", async () => {
    state.create
      .mockResolvedValueOnce(modelReply({ intro: "", items: [] }))
      .mockResolvedValueOnce(modelReply({ intro: "Here is what I found.", items: [{ ref: "C4", text: "x" }] }));
    const res = await POST(chatRequest({ scope: { mode: "companies", companyIds: ["falcon"] } }));

    expect(await res.json()).toEqual({
      intro: "",
      items: [
        {
          companyId: "falcon",
          companyName: "Falcon Market",
          text: "Nothing about that is publicly findable for this company.",
        },
      ],
    });
    expect(state.create).toHaveBeenCalledTimes(2);
    const retry = sentMessages(1);
    expect(retry[retry.length - 1]?.role).toBe("system");
    expect(retry[retry.length - 1]?.content).toContain("rejected because it was empty");
    expect(retry[retry.length - 1]?.content).toContain("Never write any company name");
  });

  it("two companies or All: a still-empty answer becomes an intro-only reply", async () => {
    state.create.mockResolvedValue(modelReply({ intro: "  ", items: [] }));
    const res = await POST(chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental", "falcon"] } }));
    expect(await res.json()).toEqual({
      intro: "Nothing about that is publicly findable for this company.",
      items: [],
    });
    expect(state.create).toHaveBeenCalledTimes(2);
  });

  it("returns the retry's answer when the retry after an empty answer is clean", async () => {
    state.create
      .mockResolvedValueOnce(modelReply({ intro: "", items: [] }))
      .mockResolvedValueOnce(modelReply({ intro: "", items: [{ ref: "C1", text: "Nothing about vendors is publicly findable." }] }));
    const res = await POST(chatRequest({ scope: { mode: "companies", companyIds: ["falcon"] } }));
    expect(await res.json()).toEqual({
      intro: "",
      items: [{ companyId: "falcon", companyName: "Falcon Market", text: "Nothing about vendors is publicly findable." }],
    });
  });

  it("returns the retry's answer when the retry is clean (invalid JSON first)", async () => {
    state.create
      .mockResolvedValueOnce(modelReply("not json"))
      .mockResolvedValueOnce(modelReply({ intro: "", items: [{ ref: "C1", text: "It sells local produce." }] }));
    const res = await POST(chatRequest({ scope: { mode: "companies", companyIds: ["falcon"] } }));
    expect(await res.json()).toEqual({
      intro: "",
      items: [{ companyId: "falcon", companyName: "Falcon Market", text: "It sells local produce." }],
    });
  });
});

describe("history", () => {
  it("sends only earlier turns with exactly the same scope, as refs (never names)", async () => {
    state.create.mockResolvedValueOnce(modelReply(NOTED_REPLY));
    const summitOnly = { mode: "companies", companyIds: ["summit-dental"] };
    await POST(
      chatRequest({
        scope: summitOnly,
        history: [
          { role: "user", content: "Tell me about them", scope: summitOnly },
          {
            role: "assistant",
            intro: "",
            items: [{ companyId: "summit-dental", companyName: "FORGED NAME", text: "Unlike Falcon Market, it has 8 locations." }],
            scope: summitOnly,
          },
          { role: "user", content: "And Falcon?", scope: { mode: "companies", companyIds: ["summit-dental", "falcon"] } },
          { role: "assistant", intro: "All of them.", items: [], scope: { mode: "all" } },
          { role: "user", content: "Who works there?", scope: { mode: "companies", companyIds: ["summit-dental"] } },
        ],
      })
    );

    const messages = sentMessages();
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "Tell me about them" },
      {
        role: "assistant",
        content: JSON.stringify({
          intro: "",
          items: [{ ref: "C1", text: "Unlike another company, it has 8 locations." }],
        }),
      },
      { role: "user", content: "Who works there?" },
      { role: "user", content: "What are their risks?" },
    ]);
    expect(JSON.stringify(messages)).not.toContain("FORGED NAME");
  });
});

describe("request checks", () => {
  it("rejects a bad scope or a company outside the roster without calling the model", async () => {
    const tooMany = await POST(
      chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental", "falcon", "maple", "cedar"] } })
    );
    const unknown = await POST(chatRequest({ scope: { mode: "companies", companyIds: ["not-in-roster"] } }));
    const missing = await POST(chatRequest({}));

    expect(tooMany.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe("a question that mentions an unselected company", () => {
  it("returns the fixed reply (name from the database) with zero model calls", async () => {
    const res = await POST(
      chatRequest({
        scope: { mode: "companies", companyIds: ["summit-dental"] },
        newMessage: "How does Summit Dental Group compare to falcon market?",
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      intro:
        "Your question mentions Falcon Market, which isn't selected. Type its name and press Enter, or open it from the list, and I'll answer about it.",
      items: [],
    });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.queries.some((q) => q.table === "crm_prospect_contacts")).toBe(false);
  });

  it("generic words and a first word shared with a selected company still reach the model", async () => {
    state.create.mockResolvedValue(modelReply(NOTED_REPLY));
    await POST(
      chatRequest({
        scope: { mode: "companies", companyIds: ["falcon"] },
        newMessage: "Is the family dentistry trend relevant here?",
      })
    );
    await POST(
      chatRequest({
        scope: { mode: "companies", companyIds: ["summit-dental"] },
        newMessage: "What does Summit do?",
      })
    );
    expect(state.create).toHaveBeenCalledTimes(2);
  });
});
