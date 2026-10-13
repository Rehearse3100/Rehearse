/**
 * ProspectingDataRoom.tsx
 * Prospecting research step (Data Room): three panes on one screen — the company
 * list (search the in_data_room roster), the open company's page with a single
 * shortlist action, and the AI Research Assistant. Below 1360px wide the assistant
 * becomes a right slide-over (same motion as the Reference Library drawer).
 * Shortlisting still goes through ProspectingShortlistForm and the crm-leads routes.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProspectingDataRoomChat } from "@/components/tempo/stages/ProspectingDataRoomChat";
import { ProspectingShortlistForm } from "@/components/tempo/stages/ProspectingShortlistForm";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import type { DataRoomCompany } from "@/app/api/student/data-room/route";
import type { CrmLead } from "@/types";

/** Shortlist size the research step requires (matches the wizard's research gate). */
const SHORTLIST_SIZE = 3;

const CARD_CLASS = "bg-white border border-outline-variant rounded-xl p-5 shadow-sm";

function formatVerticalLabel(vertical: string | null): string | null {
  if (!vertical?.trim()) {
    return null;
  }
  return vertical
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "Industry · N locations · Metro" (sizeLabel when locations is unknown). */
function companyDetailLine(company: DataRoomCompany): string {
  const size =
    company.locations !== null
      ? `${company.locations} location${company.locations === 1 ? "" : "s"}`
      : company.sizeLabel;
  return [company.industry, size, company.metro ?? ""]
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
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  const [formCompany, setFormCompany] = useState<DataRoomCompany | null>(null);
  const [removingLeadId, setRemovingLeadId] = useState<string | null>(null);
  // Slide-over state; only used below 1360px (the assistant is docked above that).
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);

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
    <div className="relative flex h-full min-h-0 overflow-hidden bg-surface">
      {/* ── a) Company list ─── */}
      <section className="w-[260px] shrink-0 flex flex-col min-h-0 bg-surface-container-lowest border-r border-outline-variant">
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

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <p className="text-body-md text-on-surface-variant py-4 text-center">Loading…</p>
          ) : error ? (
            <p className="text-sm text-error py-4 text-center">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-body-md text-on-surface-variant py-4 text-center">No matches.</p>
          ) : (
            filtered.map((company) => {
              const isOpen = selectedCompanyId === company.id;
              const isShortlisted = shortlistedIds.has(company.id);
              return (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => onSelectCompany(company.id)}
                  aria-current={isOpen ? "true" : undefined}
                  className={`w-full min-h-[52px] flex items-center justify-between gap-2 py-2 pr-3 text-left border-b border-surface-container transition-colors ${
                    isOpen ? "border-l-[3px] border-l-primary-container pl-[9px]" : "pl-3"
                  } ${
                    isShortlisted
                      ? "bg-secondary-fixed"
                      : isOpen
                        ? "bg-surface-container-low"
                        : "bg-surface-container-lowest hover:bg-surface-container-low"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold leading-snug text-on-surface">
                      {company.name}
                    </span>
                    <span className="block truncate text-[12px] leading-tight text-on-surface-variant">
                      {companyDetailLine(company)}
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
            <div className={`${CARD_CLASS} flex flex-wrap items-start justify-between gap-3`}>
              <div className="min-w-0">
                <h3 className="font-headline-md text-headline-md text-on-surface">
                  {selected.name}
                </h3>
                <p className="mt-1 text-body-md text-on-surface-variant">
                  {companyDetailLine(selected)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <div className="flex items-center gap-2">
                  {assistantButton}
                  {selectedEntry ? (
                    <button
                      type="button"
                      disabled={removingLeadId === selectedEntry.leadId}
                      onClick={() => void handleRemoveShortlist(selectedEntry)}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-outline-variant bg-white text-label-md font-bold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50"
                    >
                      <MaterialIcon name="remove" className="text-[16px]" />
                      Remove from shortlist
                    </button>
                  ) : (
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
                  )}
                </div>
                {shortlistFull && !selectedEntry ? (
                  <p className="text-label-sm text-on-surface-variant">
                    Shortlist full. Remove one to add another.
                  </p>
                ) : null}
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
                <ul className="space-y-md">
                  {selected.contacts.map((contact) => (
                    <li
                      key={`${contact.name}-${contact.title}`}
                      className="border border-outline-variant/60 rounded-lg p-md"
                    >
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
        className={`absolute inset-y-0 right-0 z-30 w-[340px] max-w-full flex flex-col min-h-0 bg-surface-container-lowest border-l border-outline-variant shadow-[-8px_0_24px_rgba(0,0,0,0.08)] motion-reduce:transition-none ${
          isAssistantOpen
            ? "visible translate-x-0 transition-transform duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
            : "invisible translate-x-full transition-[transform,visibility] duration-[180ms] ease-in"
        } min-[1360px]:static min-[1360px]:z-auto min-[1360px]:shrink-0 min-[1360px]:visible min-[1360px]:translate-x-0 min-[1360px]:shadow-none min-[1360px]:transition-none`}
      >
        <ProspectingDataRoomChat
          attemptId={attemptId}
          companies={companies}
          openCompanyId={selected?.id ?? null}
          onClose={() => setIsAssistantOpen(false)}
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
