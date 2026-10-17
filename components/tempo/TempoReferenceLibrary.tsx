/**
 * TempoReferenceLibrary.tsx
 * The one Reference Library body every Tempo stage renders inside
 * ReferenceLibraryDrawer. Collapsible stage sections (the current stage's opens
 * first): Prospecting (the student's ICP and the reading list), the Discovery and
 * Objection Handling calls (meta row, AI call notes and the full transcript with
 * search; a locked "Upcoming" row until the call is saved) and, from the
 * Negotiation stage on, Negotiation (tradeable levers and pricing). Data comes from
 * the server page as ReferenceLibraryData (lib/tempo-reference-library.ts); the
 * only fetch is the Call notes card (POST /api/student/call-notes), once per call
 * when its section first opens. The transcript never depends on the notes.
 */

"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { parseCallNotes, type CallNotes } from "@/lib/tempo-call-notes";
import { NEGOTIATION_DEAL_MATH, NEGOTIATION_DEAL_MATH_NOTE, TRADEABLE_LEVERS } from "@/lib/tempo-negotiation";
import { PROSPECTING_READING_LIST } from "@/lib/tempo-prospecting";
import {
  callPillLabel,
  defaultOpenReferenceSection,
  filterTranscript,
  highlightParts,
  visibleReferenceSections,
  type ReferenceCall,
  type ReferenceCallStage,
  type ReferenceIcpRow,
  type ReferenceLibraryData,
  type ReferenceSectionId,
  type ReferenceTranscriptMessage,
} from "@/lib/tempo-reference-library";

type TempoReferenceLibraryProps = {
  attemptId: string;
  data: ReferenceLibraryData;
};

/** Small uppercase label above a card or list. */
function GroupLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold text-on-surface-variant">
      {children}
    </span>
  );
}

// ── Section shell ───

type SectionProps = {
  title: string;
  pill: string;
  dotClass: string;
  isMuted?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

/** A white section card: a header row (dot, name, pill, chevron) and its body when open. */
function LibrarySection({
  title,
  pill,
  dotClass,
  isMuted = false,
  isOpen,
  onToggle,
  children,
}: SectionProps): React.ReactElement {
  const bodyId = useId();
  return (
    <section className="bg-white rounded-xl shadow-sm border border-[#e2e8f0] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-surface-container-low transition-colors"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} aria-hidden />
          <span
            className={`text-[16px] font-semibold truncate ${isMuted ? "text-on-surface-variant" : "text-primary-container"}`}
          >
            {title}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-full whitespace-nowrap">
            {pill}
          </span>
          <MaterialIcon
            name="expand_more"
            className={`text-on-surface-variant text-[20px] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {isOpen ? (
        <div id={bodyId} className="px-5 pb-5 pt-1 space-y-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

// ── Prospecting ───

function IcpCard({ rows }: { rows: readonly ReferenceIcpRow[] }): React.ReactElement {
  return (
    <div className="rounded-xl bg-[#f8fafc] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <GroupLabel>Your ICP</GroupLabel>
        <MaterialIcon name="target" className="text-tertiary-container text-[18px]" />
      </div>
      {rows.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">Not filled in yet.</p>
      ) : (
        <dl className="space-y-2.5">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-3">
              <dt className="w-32 shrink-0 font-label-sm text-label-sm text-on-surface-variant pt-0.5">{row.label}</dt>
              <dd className="flex-1 min-w-0 font-label-md text-label-md text-on-surface whitespace-pre-wrap break-words">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ReadingList(): React.ReactElement {
  return (
    <div className="space-y-2.5">
      <GroupLabel>Reading list</GroupLabel>
      <ul className="space-y-2">
        {PROSPECTING_READING_LIST.map((item) => {
          const content = (
            <>
              <span className="w-7 h-7 rounded bg-white flex items-center justify-center text-primary-container shrink-0 shadow-sm">
                <MaterialIcon name="description" className="text-[17px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-label-md text-label-md text-on-surface font-semibold truncate">
                  {item.title}
                </span>
                <span className="block font-body-md text-body-md text-on-surface-variant truncate">
                  {item.href ? "Opens in a new tab" : "Coming soon"}
                </span>
              </span>
              {item.href ? <MaterialIcon name="open_in_new" className="text-on-surface-variant text-[18px]" /> : null}
            </>
          );
          return (
            <li key={item.title}>
              {item.href ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-lg bg-[#f8fafc] hover:bg-surface-container-low transition-colors"
                >
                  {content}
                </a>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[#f8fafc] opacity-60">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Calls ───

function TranscriptMessage({
  message,
  query,
}: {
  message: ReferenceTranscriptMessage;
  query: string;
}): React.ReactElement {
  const isStudent = message.speaker === "student";
  return (
    <div
      className={`p-3 rounded-lg space-y-1 border ${
        isStudent ? "bg-secondary/5 border-secondary/20" : "bg-white border-[#e2e8f0]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`font-label-sm text-label-sm font-semibold ${isStudent ? "text-secondary" : "text-on-surface"}`}>
          {message.name}
        </span>
        {message.timestamp ? (
          <span className="font-code-md text-[12px] text-on-surface-variant">{message.timestamp}</span>
        ) : null}
      </div>
      <p className="font-body-md text-body-md text-on-surface whitespace-pre-wrap break-words">
        {highlightParts(message.content, query).map((part, index) =>
          part.isMatch ? (
            <mark key={index} className="bg-[#FFF4CC] text-on-surface rounded-sm px-0.5">
              {part.text}
            </mark>
          ) : (
            <span key={index}>{part.text}</span>
          )
        )}
      </p>
    </div>
  );
}

/** The collapsed "View full transcript" row; open, it has a search box above the scrolling messages. */
function TranscriptPanel({ messages }: { messages: readonly ReferenceTranscriptMessage[] }): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const bodyId = useId();
  const shown = filterTranscript(messages, query);

  return (
    <div className="rounded-lg border border-[#e2e8f0] overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className="w-full px-4 py-3 flex items-center justify-between text-on-surface hover:bg-surface-container-low transition-colors"
      >
        <span className="flex items-center gap-2">
          <MaterialIcon name="subject" className="text-[18px] text-on-surface-variant" />
          <span className="font-label-md text-label-md font-semibold">View full transcript</span>
        </span>
        <MaterialIcon
          name="expand_more"
          className={`text-on-surface-variant text-[20px] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen ? (
        <div id={bodyId} className="px-4 pb-4 pt-1 space-y-3">
          {messages.length === 0 ? (
            <p className="text-body-md text-on-surface-variant">No transcript was saved for this call.</p>
          ) : (
            <>
              <label className="relative block">
                <span className="sr-only">Search transcript</span>
                <MaterialIcon
                  name="search"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search transcript"
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-outline-variant bg-white text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary/30"
                />
              </label>
              <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {shown.length === 0 ? (
                  <p className="text-body-md text-on-surface-variant">No messages match your search.</p>
                ) : (
                  shown.map((message, index) => (
                    <TranscriptMessage key={`${message.timestamp}-${index}`} message={message} query={query} />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Call notes ───

/** Notes fetched this session, and requests in flight, so each call is fetched once (also across reopens). */
const callNotesCache = new Map<string, CallNotes>();
const callNotesRequests = new Map<string, Promise<CallNotes>>();

/** POST /api/student/call-notes, shared by every card for the same call; rejects on any failure. */
function requestCallNotes(attemptId: string, stage: ReferenceCallStage): Promise<CallNotes> {
  const key = `${attemptId}:${stage}`;
  const cached = callNotesCache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = callNotesRequests.get(key);
  if (pending) {
    return pending;
  }
  const request = fetch("/api/student/call-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId, stage }),
  })
    .then(async (res) => {
      const body: unknown = await res.json().catch(() => null);
      const notes = res.ok && body && typeof body === "object" ? parseCallNotes((body as { notes?: unknown }).notes) : null;
      if (!notes) {
        throw new Error("call notes unavailable");
      }
      callNotesCache.set(key, notes);
      return notes;
    })
    .finally(() => {
      callNotesRequests.delete(key);
    });
  callNotesRequests.set(key, request);
  return request;
}

const NOTE_GROUPS = [
  { key: "told_you", label: "What they told you", labelClass: "text-on-surface-variant", dotClass: "bg-on-surface-variant" },
  { key: "concerns", label: "Concerns raised", labelClass: "text-error", dotClass: "bg-error" },
  { key: "committed", label: "What you committed to", labelClass: "text-secondary", dotClass: "bg-secondary" },
] as const;

/** The AI call notes for a saved call: fetched when its section first opens. */
function CallNotesCard({ attemptId, stage }: { attemptId: string; stage: ReferenceCallStage }): React.ReactElement {
  const [notes, setNotes] = useState<CallNotes | null>(() => callNotesCache.get(`${attemptId}:${stage}`) ?? null);
  const [hasError, setHasError] = useState(false);

  const load = useCallback((): (() => void) => {
    let isActive = true;
    setHasError(false);
    requestCallNotes(attemptId, stage)
      .then((result) => {
        if (isActive) {
          setNotes(result);
        }
      })
      .catch(() => {
        if (isActive) {
          setHasError(true);
        }
      });
    return () => {
      isActive = false;
    };
  }, [attemptId, stage]);

  // Fetch when the card first shows (its section opened); "Try again" calls load() itself.
  useEffect(() => {
    if (notes) {
      return undefined;
    }
    return load();
  }, [load, notes]);

  return (
    <div className="p-4 rounded-xl bg-[#f8fafc] space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MaterialIcon name="auto_awesome" className="text-primary-container text-[18px]" />
          <span className="text-[15px] font-semibold text-primary-container">Call notes</span>
        </div>
        <span className="bg-secondary/10 text-secondary font-label-sm text-label-sm px-2.5 py-0.5 rounded-full font-semibold">
          AI notes
        </span>
      </div>

      {notes ? (
        <>
          <p className="p-3 bg-white rounded-lg font-body-md text-body-md text-on-surface leading-relaxed shadow-sm">
            {notes.summary}
          </p>
          {NOTE_GROUPS.filter((group) => notes[group.key].length > 0).map((group) => (
            <div key={group.key} className="space-y-1.5">
              <span className={`block font-label-sm text-label-sm uppercase tracking-wider font-semibold ${group.labelClass}`}>
                {group.label}
              </span>
              <ul className="space-y-1.5">
                {notes[group.key].map((item) => (
                  <li key={item} className="flex items-start gap-2 font-body-md text-body-md text-on-surface">
                    <span className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${group.dotClass}`} aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : hasError ? (
        <div className="flex items-center justify-between gap-3">
          <p className="font-body-md text-body-md text-on-surface-variant">Couldn&apos;t write call notes right now.</p>
          <button
            type="button"
            onClick={() => load()}
            className="shrink-0 h-8 px-3 rounded-lg border border-outline-variant bg-white font-label-md text-label-md text-on-surface hover:bg-surface-container-low transition-colors"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-2" role="status">
          <div className="h-3 rounded bg-surface-container-high animate-pulse" />
          <div className="h-3 w-5/6 rounded bg-surface-container-high animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-surface-container-high animate-pulse" />
          <p className="pt-1 font-label-sm text-label-sm text-on-surface-variant">Writing your call notes…</p>
        </div>
      )}
    </div>
  );
}

/** A saved call: who and how long, the AI call notes (when there is a transcript), then the transcript. */
function CallDetails({ attemptId, call }: { attemptId: string; call: ReferenceCall }): React.ReactElement {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 font-label-sm text-label-sm text-on-surface-variant">
        <MaterialIcon name="account_circle" className="text-[16px]" />
        <span className="text-on-surface font-medium">{call.personaName}</span>
        <span aria-hidden>·</span>
        <span>{call.personaRole}</span>
        {call.durationMinutes !== null ? (
          <>
            <span aria-hidden>·</span>
            <span className="flex items-center gap-1">
              <MaterialIcon name="schedule" className="text-[15px]" />
              {call.durationMinutes} min
            </span>
          </>
        ) : null}
      </div>
      {call.messages.length > 0 ? <CallNotesCard attemptId={attemptId} stage={call.stage} /> : null}
      <TranscriptPanel messages={call.messages} />
    </>
  );
}

function UpcomingCall(): React.ReactElement {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-container-low text-on-surface-variant">
      <MaterialIcon name="lock" className="text-[18px]" />
      <span className="font-label-md text-label-md">Available after the call.</span>
    </div>
  );
}

// ── Negotiation ───

function NegotiationReference(): React.ReactElement {
  return (
    <>
      <div className="space-y-2.5">
        <GroupLabel>Tradeable levers</GroupLabel>
        <div className="overflow-hidden rounded-lg border border-[#e2e8f0]">
          <table className="w-full text-label-sm">
            <thead className="bg-[#f8fafc] text-on-surface-variant">
              <tr>
                <th className="text-left font-semibold p-3">Lever</th>
                <th className="text-left font-semibold p-3">Give</th>
                <th className="text-left font-semibold p-3">Get</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8f0]">
              {TRADEABLE_LEVERS.map((row) => (
                <tr key={row.lever}>
                  <td className="p-3 font-medium text-on-surface">{row.lever}</td>
                  <td className="p-3 text-error">{row.give}</td>
                  <td className="p-3 text-green-700">{row.get}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-xl bg-[#f8fafc] p-4 space-y-2.5">
        <GroupLabel>Pricing</GroupLabel>
        {NEGOTIATION_DEAL_MATH.map((row) => (
          <div key={row.label} className="flex justify-between gap-3 font-label-md text-label-md">
            <span className="text-on-surface-variant">{row.label}</span>
            <span className="font-semibold text-on-surface">{row.value}</span>
          </div>
        ))}
        <p className="pt-2 border-t border-[#e2e8f0] font-label-sm text-label-sm font-semibold text-on-surface">
          {NEGOTIATION_DEAL_MATH_NOTE}
        </p>
      </div>
    </>
  );
}

// ── Library ───

/**
 * The Reference Library sections for the student's current stage. Each header
 * toggles its section; the current stage's section starts open.
 */
export function TempoReferenceLibrary({ attemptId, data }: TempoReferenceLibraryProps): React.ReactElement {
  const [openSections, setOpenSections] = useState<ReadonlySet<ReferenceSectionId>>(
    () => new Set([defaultOpenReferenceSection(data.currentStage)])
  );

  const toggle = (id: ReferenceSectionId): void => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const callSection = (id: "discovery" | "objections", title: string, doneDotClass: string): React.ReactElement => {
    const call = data[id];
    return (
      <LibrarySection
        key={id}
        title={title}
        pill={callPillLabel(call)}
        dotClass={call ? doneDotClass : "bg-outline-variant"}
        isMuted={!call}
        isOpen={openSections.has(id)}
        onToggle={() => toggle(id)}
      >
        {call ? <CallDetails attemptId={attemptId} call={call} /> : <UpcomingCall />}
      </LibrarySection>
    );
  };

  return (
    <div className="space-y-4">
      {visibleReferenceSections(data.currentStage).map((id) => {
        switch (id) {
          case "prospecting":
            return (
              <LibrarySection
                key={id}
                title="Prospecting"
                pill="2 items"
                dotClass="bg-tertiary-container"
                isOpen={openSections.has(id)}
                onToggle={() => toggle(id)}
              >
                <IcpCard rows={data.icpRows} />
                <ReadingList />
              </LibrarySection>
            );
          case "discovery":
            return callSection(id, "Discovery Call", "bg-secondary");
          case "objections":
            return callSection(id, "Objection Handling Call", "bg-primary-container");
          default:
            return (
              <LibrarySection
                key={id}
                title="Negotiation"
                pill="Pricing & levers"
                dotClass="bg-green-600"
                isOpen={openSections.has(id)}
                onToggle={() => toggle(id)}
              >
                <NegotiationReference />
              </LibrarySection>
            );
        }
      })}
    </div>
  );
}
