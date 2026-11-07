/**
 * ProspectingDataRoom.tsx
 * Prospecting research step (Data Room): three panes on one screen — the company
 * list (search the in_data_room roster; shortlisted companies first, sliding into
 * place when the shortlist changes), the open company's page with a single
 * shortlist action, and the AI Research Assistant. Below 1360px wide the assistant
 * becomes a right slide-over (same motion as the Reference Library drawer).
 * The company list and the assistant can be resized by dragging their inner edge
 * (components/ui/ResizeHandle.tsx; ←/→ too, double-click resets): the list 220–400px,
 * the assistant 360–640px, and the company page between them keeps at least 420px
 * (clampDataRoomPanelWidths). Defaults are 260px and 436px; each width is
 * remembered per browser. A company name in an assistant reply opens that company
 * the same way a click in the list does (onSelectCompany). List clicks are counted
 * (listOpenCount), so the assistant knows a company was opened in the list since a
 * question even when it was the one already open.
 * Shortlisting still goes through ProspectingShortlistForm and the crm-leads routes.
 */

"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProspectingDataRoomChat } from "@/components/tempo/stages/ProspectingDataRoomChat";
import { ProspectingShortlistForm } from "@/components/tempo/stages/ProspectingShortlistForm";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { readStoredWidth, ResizeHandle, storeWidth } from "@/components/ui/ResizeHandle";
import type { DataRoomCompany } from "@/app/api/student/data-room/route";
import type { CrmLead } from "@/types";

/** Shortlist size the research step requires (matches the wizard's research gate). */
const SHORTLIST_SIZE = 3;

const CARD_CLASS = "bg-white border border-outline-variant rounded-xl p-5 shadow-sm";

// ── Panel widths ───

/** The company list's width: today's 260px by default, resizable within these limits. */
export const LIST_WIDTH = { default: 260, min: 220, max: 400 } as const;
/** The assistant's width: today's 436px by default, resizable within these limits. */
export const CHAT_WIDTH = { default: 436, min: 360, max: 640 } as const;
/** The company page between them never gets narrower than this because of a resize. */
export const MIDDLE_MIN_WIDTH = 420;
/** From this window width the assistant is docked beside the page (min-[1360px] below); narrower, it slides over. */
const CHAT_DOCKED_MEDIA_QUERY = "(min-width: 1360px)";

const LIST_WIDTH_STORAGE_KEY = "rehearse:data-room:list-width";
const CHAT_WIDTH_STORAGE_KEY = "rehearse:data-room:chat-width";

export type DataRoomPanelWidths = { list: number; chat: number };

/**
 * The widths to show. Each is kept within its limits (list 220–400px, assistant
 * 360–640px), rounded to whole pixels. Then the company page keeps at least 420px
 * of the measured container: the list and, when docked, the assistant give back
 * width until it fits — the panel being resized first (active), otherwise the
 * assistant first. A panel never gives back below its default (or below a narrower
 * width the student chose), so the default layout never changes. containerWidth null
 * (not measured yet): limits only.
 */
export function clampDataRoomPanelWidths(
  widths: DataRoomPanelWidths,
  layout: { containerWidth: number | null; isChatDocked: boolean; active?: "list" | "chat" }
): DataRoomPanelWidths {
  const within = (value: number, limits: { min: number; max: number }): number =>
    Math.round(Math.min(limits.max, Math.max(limits.min, Number.isFinite(value) ? value : limits.min)));
  const next = { list: within(widths.list, LIST_WIDTH), chat: within(widths.chat, CHAT_WIDTH) };
  if (layout.containerWidth === null) {
    return next;
  }
  let over = next.list + (layout.isChatDocked ? next.chat : 0) - (layout.containerWidth - MIDDLE_MIN_WIDTH);
  const order: Array<"list" | "chat"> = layout.active === "list" ? ["list", "chat"] : ["chat", "list"];
  for (const panel of order) {
    if (over <= 0) {
      break;
    }
    if (panel === "chat" && !layout.isChatDocked) {
      continue; // The slide-over covers the page; it takes nothing from it.
    }
    const limits = panel === "list" ? LIST_WIDTH : CHAT_WIDTH;
    const floor = Math.max(limits.min, Math.min(next[panel], limits.default));
    const cut = Math.min(over, next[panel] - floor);
    next[panel] -= cut;
    over -= cut;
  }
  return next;
}

/** Company cards slide to their new place in the list after a shortlist change. */
const REORDER_ANIMATION_MS = 220;
const REORDER_EASING = "cubic-bezier(0.2, 0, 0, 1)";

function formatVerticalLabel(vertical: string | null): string | null {
  if (!vertical?.trim()) {
    return null;
  }
  return vertical
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * "Industry · N locations · Metro" (sizeLabel when locations is unknown).
 * The company list leaves the metro out to keep cards short.
 */
function companyDetailLine(company: DataRoomCompany, includeMetro = true): string {
  const size =
    company.locations !== null
      ? `${company.locations} location${company.locations === 1 ? "" : "s"}`
      : company.sizeLabel;
  return [company.industry, size, includeMetro ? company.metro ?? "" : ""]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" · ");
}

type ShortlistEntry = {
  leadId: string;
  companyId: string;
  companyName: string;
};

type ProspectingDataRoomProps = {
  attemptId: string;
  selectedCompanyId: string | null;
  onSelectCompany: (companyId: string) => void;
  /** Syncs shortlisted company ids into wizard advance logic. */
  onShortlistChange: (companyIds: string[]) => void;
};

/**
 * Company list + company page + AI Research Assistant.
 */
export function ProspectingDataRoom({
  attemptId,
  selectedCompanyId,
  onSelectCompany,
  onShortlistChange,
}: ProspectingDataRoomProps): React.ReactElement {
  const [companies, setCompanies] = useState<DataRoomCompany[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Every company opened from the list, the open one again included (the assistant's follow-up rule).
  const [listOpenCount, setListOpenCount] = useState(0);
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  const [formCompany, setFormCompany] = useState<DataRoomCompany | null>(null);
  const [removingLeadId, setRemovingLeadId] = useState<string | null>(null);
  // Slide-over state; only used below 1360px (the assistant is docked above that).
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  // The widths the student set (defaults until a drag, or until remembered ones load);
  // what shows is these clamped to the measured space (clampDataRoomPanelWidths).
  const [panelWidths, setPanelWidths] = useState<DataRoomPanelWidths>({
    list: LIST_WIDTH.default,
    chat: CHAT_WIDTH.default,
  });
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [isChatDocked, setIsChatDocked] = useState(false);
  // Bumped when a resize ends, so the widths are remembered after they've updated.
  const [widthSaveCount, setWidthSaveCount] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Remembered widths (browser storage is client-only, so after mount).
  useEffect(() => {
    setPanelWidths({
      list: readStoredWidth(LIST_WIDTH_STORAGE_KEY, LIST_WIDTH.default),
      chat: readStoredWidth(CHAT_WIDTH_STORAGE_KEY, CHAT_WIDTH.default),
    });
  }, []);

  useEffect(() => {
    if (widthSaveCount === 0) {
      return;
    }
    // A default width is forgotten rather than stored, so it follows future defaults.
    storeWidth(LIST_WIDTH_STORAGE_KEY, panelWidths.list === LIST_WIDTH.default ? null : panelWidths.list);
    storeWidth(CHAT_WIDTH_STORAGE_KEY, panelWidths.chat === CHAT_WIDTH.default ? null : panelWidths.chat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthSaveCount]);

  // The space the three panes share, and whether the assistant is docked beside them.
  useEffect(() => {
    const root = rootRef.current;
    const docked = window.matchMedia(CHAT_DOCKED_MEDIA_QUERY);
    const updateDocked = (): void => setIsChatDocked(docked.matches);
    updateDocked();
    docked.addEventListener("change", updateDocked);
    if (!root || typeof ResizeObserver === "undefined") {
      return () => docked.removeEventListener("change", updateDocked);
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") {
        setContainerWidth(width);
      }
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      docked.removeEventListener("change", updateDocked);
    };
  }, []);

  const shownWidths = clampDataRoomPanelWidths(panelWidths, { containerWidth, isChatDocked });

  /** A new width for one panel while resizing: clamped with that panel giving way first. */
  const resizePanel = (panel: "list" | "chat", width: number): void => {
    const clamped = clampDataRoomPanelWidths(
      { ...shownWidths, [panel]: width },
      { containerWidth, isChatDocked, active: panel }
    );
    setPanelWidths((previous) => ({ ...previous, [panel]: clamped[panel] }));
  };

  const resetPanel = (panel: "list" | "chat"): void => {
    setPanelWidths((previous) => ({
      ...previous,
      [panel]: panel === "list" ? LIST_WIDTH.default : CHAT_WIDTH.default,
    }));
  };

  const rememberPanelWidths = (): void => setWidthSaveCount((count) => count + 1);

  const syncShortlistFromLeads = useCallback(
    (leads: CrmLead[], roster: DataRoomCompany[]): ShortlistEntry[] => {
      const byName = new Map(roster.map((c) => [c.name.trim().toLowerCase(), c]));
      const entries: ShortlistEntry[] = [];
      for (const lead of leads) {
        if (lead.status !== "shortlisted") {
          continue;
        }
        const company = byName.get(lead.company_name.trim().toLowerCase());
        if (!company) {
          continue;
        }
        entries.push({
          leadId: lead.id,
          companyId: company.id,
          companyName: company.name,
        });
      }
      return entries;
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const [roomRes, leadsRes] = await Promise.all([
          fetch(`/api/student/data-room?attemptId=${encodeURIComponent(attemptId)}`),
          fetch(`/api/student/crm-leads?attemptId=${encodeURIComponent(attemptId)}`),
        ]);

        if (!roomRes.ok) {
          if (!cancelled) {
            setError("Could not load Data Room.");
          }
          return;
        }

        const roomBody = (await roomRes.json()) as { companies?: DataRoomCompany[] };
        const nextCompanies = roomBody.companies ?? [];

        let nextShortlist: ShortlistEntry[] = [];
        if (leadsRes.ok) {
          const leadsBody = (await leadsRes.json()) as { leads?: CrmLead[] };
          nextShortlist = syncShortlistFromLeads(leadsBody.leads ?? [], nextCompanies);
        }

        if (!cancelled) {
          setCompanies(nextCompanies);
          setShortlist(nextShortlist);
          onShortlistChange(nextShortlist.map((e) => e.companyId));
        }
      } catch {
        if (!cancelled) {
          setError("Could not load Data Room.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  // Escape closes the assistant slide-over (narrow screens).
  useEffect(() => {
    if (!isAssistantOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsAssistantOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAssistantOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return companies;
    }
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.industry.toLowerCase().includes(q) ||
        (c.metro ?? "").toLowerCase().includes(q)
    );
  }, [companies, search]);

  const selected =
    selectedCompanyId === null
      ? null
      : companies.find((c) => c.id === selectedCompanyId) ?? null;

  const shortlistedIds = useMemo(
    () => new Set(shortlist.map((e) => e.companyId)),
    [shortlist]
  );
  const shortlistFull = shortlist.length >= SHORTLIST_SIZE;
  const selectedEntry = selected
    ? shortlist.find((entry) => entry.companyId === selected.id) ?? null
    : null;

  // Shortlisted companies first; each group keeps its usual order.
  const orderedCompanies = useMemo(
    () => [
      ...filtered.filter((company) => shortlistedIds.has(company.id)),
      ...filtered.filter((company) => !shortlistedIds.has(company.id)),
    ],
    [filtered, shortlistedIds]
  );

  // ── List reorder animation (FLIP) ───
  // After the student adds or removes a shortlisted company, each card that moved
  // slides from its old spot to its new one. The first shortlist load and search
  // filtering don't animate; reduced-motion users get no animation.
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousTopsRef = useRef(new Map<string, number>());
  const animateNextReorderRef = useRef(false);
  const orderKey = orderedCompanies.map((company) => company.id).join(",");
  const shortlistKey = shortlist.map((entry) => entry.companyId).join(",");

  useLayoutEffect(() => {
    const tops = new Map<string, number>();
    cardRefs.current.forEach((card, id) => tops.set(id, card.offsetTop));
    const shouldAnimate =
      animateNextReorderRef.current &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    animateNextReorderRef.current = false;
    if (shouldAnimate) {
      tops.forEach((top, id) => {
        const previousTop = previousTopsRef.current.get(id);
        const card = cardRefs.current.get(id);
        if (previousTop !== undefined && previousTop !== top && typeof card?.animate === "function") {
          card.animate(
            [{ transform: `translateY(${previousTop - top}px)` }, { transform: "translateY(0)" }],
            { duration: REORDER_ANIMATION_MS, easing: REORDER_EASING }
          );
        }
      });
    }
    previousTopsRef.current = tops;
  }, [orderKey, shortlistKey]);

  const handleShortlistSaved = (lead: CrmLead): void => {
    if (!formCompany) {
      return;
    }
    const next = [
      ...shortlist.filter((e) => e.companyId !== formCompany.id),
      {
        leadId: lead.id,
        companyId: formCompany.id,
        companyName: formCompany.name,
      },
    ];
    animateNextReorderRef.current = true;
    setShortlist(next);
    onShortlistChange(next.map((e) => e.companyId));
    setFormCompany(null);
  };

  const handleRemoveShortlist = async (entry: ShortlistEntry): Promise<void> => {
    if (removingLeadId) {
      return;
    }
    setRemovingLeadId(entry.leadId);
    try {
      const res = await fetch(`/api/student/crm-leads/${encodeURIComponent(entry.leadId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        return;
      }
      const next = shortlist.filter((e) => e.leadId !== entry.leadId);
      animateNextReorderRef.current = true;
      setShortlist(next);
      onShortlistChange(next.map((e) => e.companyId));
    } finally {
      setRemovingLeadId(null);
    }
  };

  const assistantButton = (
    <button
      type="button"
      onClick={() => setIsAssistantOpen(true)}
      className="min-[1360px]:hidden inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-outline-variant bg-white text-label-sm font-bold text-on-surface hover:bg-surface-container transition-colors shrink-0"
    >
      <MaterialIcon name="smart_toy" className="text-[18px]" />
      AI Assistant
    </button>
  );

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 overflow-hidden bg-surface">
      {/* ── a) Company list ─── */}
      <section
        className="relative shrink-0 flex flex-col min-h-0 bg-surface-container-lowest border-r border-outline-variant"
        style={{ width: shownWidths.list }}
      >
        {/* Drag the right edge to resize (over the border; invisible until hovered). */}
        <ResizeHandle
          label="Resize company list"
          value={shownWidths.list}
          min={LIST_WIDTH.min}
          max={LIST_WIDTH.max}
          growsTo="right"
          onResize={(width) => resizePanel("list", width)}
          onResizeEnd={rememberPanelWidths}
          onReset={() => resetPanel("list")}
          className="-right-1"
        />
        <div className="p-3 border-b border-surface-container shrink-0">
          <div className="relative">
            <MaterialIcon
              name="search"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px] pointer-events-none"
            />
            <input
              className="w-full h-8 pl-8 pr-2.5 bg-surface-container-low border border-surface-container rounded-md text-[12px] text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:border-secondary focus:bg-white transition-all"
              placeholder="Search name, industry or city…"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <p className="mt-2 px-0.5 text-[12px] text-on-surface-variant">
            {search.trim()
              ? `${filtered.length} of ${companies.length}`
              : `${companies.length} companies`}
          </p>
        </div>

        {/* Each company is its own bordered card on a light gray list background. */}
        <div className="relative flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-surface-container-low p-2 space-y-1">
          {isLoading ? (
            <p className="text-body-md text-on-surface-variant py-4 text-center">Loading…</p>
          ) : error ? (
            <p className="text-sm text-error py-4 text-center">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-body-md text-on-surface-variant py-4 text-center">No matches.</p>
          ) : (
            orderedCompanies.map((company) => {
              const isOpen = selectedCompanyId === company.id;
              const isShortlisted = shortlistedIds.has(company.id);
              return (
                <button
                  key={company.id}
                  ref={(card) => {
                    if (card) {
                      cardRefs.current.set(company.id, card);
                    } else {
                      cardRefs.current.delete(company.id);
                    }
                  }}
                  type="button"
                  onClick={() => {
                    setListOpenCount((count) => count + 1);
                    onSelectCompany(company.id);
                  }}
                  aria-current={isOpen ? "true" : undefined}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left rounded-lg border transition-[box-shadow,border-color,background-color] duration-150 ${
                    isOpen
                      ? "border-secondary ring-1 ring-secondary shadow-sm"
                      : "border-outline-variant hover:border-outline hover:shadow-sm"
                  } ${isShortlisted ? "bg-secondary-fixed" : "bg-white"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold leading-snug text-on-surface">
                      {company.name}
                    </span>
                    <span className="block truncate text-[12px] leading-tight text-on-surface-variant">
                      {companyDetailLine(company, false)}
                    </span>
                  </span>
                  {isShortlisted ? (
                    <>
                      <MaterialIcon name="check" className="text-[18px] text-secondary shrink-0" />
                      <span className="sr-only">Shortlisted</span>
                    </>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* ── b) Company page ─── */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto custom-scrollbar bg-surface-container-low p-6">
        {selected ? (
          <div className="space-y-4">
            {/* No wrap: the name column shrinks (and wraps itself), so the shortlist
                button always stays on the top row at the right. */}
            <div className={`${CARD_CLASS} flex items-start justify-between gap-3`}>
              <div className="min-w-0 flex-1">
                <h3 className="font-headline-md text-headline-md text-on-surface break-words">
                  {selected.name}
                </h3>
                <p className="mt-1 text-body-md text-on-surface-variant">
                  {companyDetailLine(selected)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <div className="flex items-start gap-2">
                  {assistantButton}
                  {selectedEntry ? (
                    <button
                      type="button"
                      disabled={removingLeadId === selectedEntry.leadId}
                      onClick={() => void handleRemoveShortlist(selectedEntry)}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-error text-white text-label-md font-bold hover:bg-error/90 shadow-sm transition-colors disabled:opacity-50"
                    >
                      <MaterialIcon name="remove" className="text-[16px]" />
                      Remove from shortlist
                    </button>
                  ) : (
                    // Grid sized by the button: the note starts at the button's left edge and wraps to its width.
                    <div className="inline-grid gap-1.5">
                      <button
                        type="button"
                        disabled={shortlistFull}
                        onClick={() => setFormCompany(selected)}
                        className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-label-md font-bold transition-colors ${
                          shortlistFull
                            ? "bg-surface-container-highest text-on-surface-variant/40 cursor-not-allowed"
                            : "bg-secondary text-white hover:bg-secondary/90 shadow-sm"
                        }`}
                      >
                        <MaterialIcon name="add" className="text-[16px]" />
                        Add to shortlist
                      </button>
                      {shortlistFull ? (
                        <p className="w-0 min-w-full text-label-sm text-on-surface-variant">
                          Shortlist full. Remove one to add another.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {selected.blurb ? (
              <section className={CARD_CLASS}>
                <h4 className="font-headline-md text-headline-md text-on-surface mb-2">
                  Overview
                </h4>
                <p className="text-body-md text-on-surface leading-relaxed">{selected.blurb}</p>
              </section>
            ) : null}

            <section className={CARD_CLASS}>
              <h4 className="font-headline-md text-headline-md text-on-surface mb-3">
                Firmographics
              </h4>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-md text-body-md">
                {formatVerticalLabel(selected.vertical) ? (
                  <div>
                    <dt className="text-label-sm text-on-surface-variant uppercase">Industry</dt>
                    <dd className="text-on-surface">{formatVerticalLabel(selected.vertical)}</dd>
                  </div>
                ) : null}
                {selected.locations !== null ? (
                  <div>
                    <dt className="text-label-sm text-on-surface-variant uppercase">Locations</dt>
                    <dd className="text-on-surface">{selected.locations}</dd>
                  </div>
                ) : null}
                {selected.metro ? (
                  <div>
                    <dt className="text-label-sm text-on-surface-variant uppercase">Metro</dt>
                    <dd className="text-on-surface">{selected.metro}</dd>
                  </div>
                ) : null}
                {selected.inTerritory !== null ? (
                  <div>
                    <dt className="text-label-sm text-on-surface-variant uppercase">Territory</dt>
                    <dd className="text-on-surface">
                      {selected.inTerritory ? "In territory" : "Out of territory"}
                    </dd>
                  </div>
                ) : null}
                {selected.onlineBooking !== null ? (
                  <div>
                    <dt className="text-label-sm text-on-surface-variant uppercase">
                      Online booking
                    </dt>
                    <dd className="text-on-surface">{selected.onlineBooking ? "Yes" : "No"}</dd>
                  </div>
                ) : null}
                {selected.sizeNote ? (
                  <div className="sm:col-span-2">
                    <dt className="text-label-sm text-on-surface-variant uppercase">Size note</dt>
                    <dd className="text-on-surface">{selected.sizeNote}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            {selected.publicSignals.length > 0 ? (
              <section className={CARD_CLASS}>
                <h4 className="font-headline-md text-headline-md text-on-surface mb-3">
                  Public signals
                </h4>
                <ul className="space-y-sm">
                  {selected.publicSignals.map((signal) => (
                    <li key={signal} className="flex items-start gap-sm text-body-md text-on-surface">
                      <MaterialIcon
                        name="radio_button_checked"
                        className="text-secondary text-[14px] mt-1 shrink-0"
                      />
                      <span>{signal}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {selected.contacts.length > 0 ? (
              <section className={CARD_CLASS}>
                <h4 className="font-headline-md text-headline-md text-on-surface mb-3">Contacts</h4>
                {/* Plain text, no boxes (boxed rows read as buttons). */}
                <ul className="space-y-3">
                  {selected.contacts.map((contact) => (
                    <li key={`${contact.name}-${contact.title}`}>
                      <p className="font-label-md text-label-md text-on-surface">{contact.name}</p>
                      <p className="text-body-md text-on-surface-variant">
                        {contact.title}
                        {contact.department ? ` · ${contact.department}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="flex justify-end">{assistantButton}</div>
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-24 h-24 bg-surface rounded-2xl border border-outline-variant shadow-lg flex items-center justify-center mx-auto mb-lg">
                <MaterialIcon name="folder_open" className="text-[48px] text-outline" />
              </div>
              <h3 className="font-display text-display text-primary mb-md">Open the Data Room</h3>
              <p className="text-body-lg text-on-surface-variant leading-relaxed max-w-md">
                Select a company on the left to read its profile.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── c) AI Research Assistant: docked at ≥1360px, slide-over below ─── */}
      <button
        type="button"
        aria-label="Close AI Assistant"
        tabIndex={-1}
        onClick={() => setIsAssistantOpen(false)}
        className={`min-[1360px]:hidden absolute inset-0 z-20 bg-black/35 border-0 cursor-default transition-opacity motion-reduce:transition-none ${
          isAssistantOpen
            ? "opacity-100 duration-200 ease-out"
            : "opacity-0 pointer-events-none duration-[180ms] ease-in"
        }`}
      />
      <aside
        aria-label="AI Research Assistant"
        // Width from the resize handle (436px by default); the slide uses translate-x-full,
        // its own width, so it opens and closes the same at any width.
        style={{ width: shownWidths.chat }}
        className={`absolute inset-y-0 right-0 z-30 max-w-full flex flex-col min-h-0 bg-surface-container-lowest border-l border-outline-variant shadow-[-8px_0_24px_rgba(0,0,0,0.08)] motion-reduce:transition-none ${
          isAssistantOpen
            ? "visible translate-x-0 transition-transform duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
            : "invisible translate-x-full transition-[transform,visibility] duration-[180ms] ease-in"
        } min-[1360px]:relative min-[1360px]:z-auto min-[1360px]:shrink-0 min-[1360px]:visible min-[1360px]:translate-x-0 min-[1360px]:shadow-none min-[1360px]:transition-none`}
      >
        {/* Drag the left edge to resize; it moves with the slide-over. */}
        <ResizeHandle
          label="Resize chat"
          value={shownWidths.chat}
          min={CHAT_WIDTH.min}
          max={CHAT_WIDTH.max}
          growsTo="left"
          onResize={(width) => resizePanel("chat", width)}
          onResizeEnd={rememberPanelWidths}
          onReset={() => resetPanel("chat")}
          className="-left-1"
        />
        <ProspectingDataRoomChat
          attemptId={attemptId}
          companies={companies}
          openCompanyId={selected?.id ?? null}
          onClose={() => setIsAssistantOpen(false)}
          onOpenCompany={onSelectCompany}
          listOpenCount={listOpenCount}
        />
      </aside>

      {formCompany ? (
        <ProspectingShortlistForm
          attemptId={attemptId}
          company={formCompany}
          onCancel={() => setFormCompany(null)}
          onSaved={handleShortlistSaved}
        />
      ) : null}
    </div>
  );
}
