/**
 * CrmOverlay.tsx
 * In-place Rehearse CRM overlay — leads, opportunities, accounts, and contacts.
 * Exports CrmAccess which gates the floating CRM button until after mount
 * (simulation page is a Server Component with no loading flag of its own),
 * and TempoCrmGateProvider context for HandoffModal hard-gate wiring.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AccountRecordView } from "@/components/crm/AccountRecordView";
import { ContactRecordView } from "@/components/crm/ContactRecordView";
import { CrmHelperWidget } from "@/components/crm/CrmHelperWidget";
import { CrmHomeView } from "@/components/crm/CrmHomeView";
import { GoToCrmButton } from "@/components/crm/GoToCrmButton";
import { LeadDetailForm } from "@/components/crm/LeadDetailForm";
import { LeadsListView } from "@/components/crm/LeadsListView";
import { OpportunityRecordView } from "@/components/crm/OpportunityRecordView";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { CrmOpportunityCompletionGauge } from "@/components/crm/CrmOpportunityCompletionGauge";
import {
  accountNameFromLogs,
  availableContactKeysToAdd,
  contactHasRecord,
  opportunityCompletionPercent,
  opportunityTitleFromLogs,
  previewText,
  primaryContactFromLogs,
  type ContactNotesSnapshot,
} from "@/components/crm/crm-display";
import {
  accountHasProfile,
  canSaveAccountFields,
  type CrmAccountRecord,
} from "@/lib/tempo-crm-account";
import {
  CRM_CONTACT_SLOTS,
  contactDisplayName,
  contactRecordComplete,
  emptyContactFields,
  type CrmContactKey,
} from "@/lib/tempo-crm-contact";
import { findStageNeedingCrmLog } from "@/lib/tempo-crm-fields";
import type { CrmLead, CrmLogEntry, SimulationStage } from "@/types";

const SLIDE_OUT_MS = 250;

type CrmView =
  | "home"
  | "leads-list"
  | "lead-record"
  | "list"
  | "record"
  | "accounts-list"
  | "account-record"
  | "contacts-list"
  | "contact-record";

type SidebarNavId = "home" | "leads" | "opportunities" | "accounts" | "contacts";

type CrmRecordStageId =
  | "discovery"
  | "presentation"
  | "objections"
  | "close";

type CrmOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  simulationId: string;
  classId: string;
  attemptId: string;
  currentStage: SimulationStage;
  displayName: string;
  /** When set with isOpen, skip list and open Opportunity record on this stage tab. */
  deepLinkStage?: SimulationStage | null;
  /** When set with isOpen, skip list and open the requested CRM record view. */
  deepLinkView?: "account" | null;
  /** When true with isOpen, open the Leads list (e.g. Discovery convert gate). */
  deepLinkLeads?: boolean;
  /** Notifies parent when log entries change (for handoff gate / button blink). */
  onLogEntriesChange?: (entries: CrmLogEntry[]) => void;
  /** Notifies parent when conversion / lead list changes. */
  onLeadsChange?: (leads: CrmLead[]) => void;
};

type CrmAccessProps = {
  simulationId: string;
  classId: string;
  attemptId: string;
  currentStage: SimulationStage;
  displayName: string;
  /** Stages that already have a stage_scores row (completed Tempo work). */
  completedStages: string[];
  /** CRM stages already logged (from server), used until client refresh. */
  initialLoggedStages?: string[];
  /** Server-reported TEMPO_TEST_BYPASS_GATES — never from client env. */
  gateBypassEnabled?: boolean;
  children: React.ReactNode;
};

type TempoCrmGateContextValue = {
  loggedStages: ReadonlySet<string>;
  needsLoggingStage: string | null;
  openCrmForStage: (stage: string) => void;
  openCrmLeads: () => void;
  openCrmHome: () => void;
  hasConvertedLead: boolean;
  /** True when Account + primary Contact have every required field filled (Stage 2 gate). */
  prospectingCrmComplete: boolean;
  /** Server-reported test bypass — short-circuits CRM profile gate in HandoffModal. */
  gateBypassEnabled: boolean;
  refreshCrmLogs: () => Promise<void>;
  /** Registers a stage as completed for gate/blink (e.g. right after submit, before page reload). */
  noteCompletedStage: (stage: string) => void;
};

const TempoCrmGateContext = createContext<TempoCrmGateContextValue>({
  loggedStages: new Set(),
  needsLoggingStage: null,
  openCrmForStage: () => undefined,
  openCrmLeads: () => undefined,
  openCrmHome: () => undefined,
  hasConvertedLead: false,
  prospectingCrmComplete: false,
  gateBypassEnabled: false,
  refreshCrmLogs: async () => undefined,
  noteCompletedStage: () => undefined,
});

/**
 * HandoffModal / consumers read CRM gate state without prop-drilling through stages.
 */
export function useTempoCrmGate(): TempoCrmGateContextValue {
  return useContext(TempoCrmGateContext);
}

const CRM_STAGE_LABELS: Partial<Record<SimulationStage, string>> = {
  lead_gen: "Prospecting",
  prospecting: "Prospecting",
  discovery: "Discovery",
  presentation: "Presentation",
  objections: "Objection Handling",
  close: "Negotiation",
  results: "Negotiation",
};

const SIDEBAR_ITEMS: { id: SidebarNavId; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "leads", label: "Leads", icon: "person_search" },
  { id: "opportunities", label: "Opportunities", icon: "query_stats" },
  { id: "accounts", label: "Accounts", icon: "business" },
  { id: "contacts", label: "Contacts", icon: "group" },
];

/**
 * Maps attempt.current_stage to the CRM opportunity stage badge label.
 */
function crmStageLabel(stage: SimulationStage): string {
  return CRM_STAGE_LABELS[stage] ?? "Prospecting";
}

/**
 * Resolves which sidebar item should appear active for the current view.
 */
function activeNavForView(view: CrmView): SidebarNavId {
  if (view === "leads-list" || view === "lead-record") {
    return "leads";
  }
  if (view === "accounts-list" || view === "account-record") {
    return "accounts";
  }
  if (view === "contacts-list" || view === "contact-record") {
    return "contacts";
  }
  if (view === "list" || view === "record") {
    return "opportunities";
  }
  return "home";
}

const LEAD_STATUS_ORDER: Record<CrmLead["status"], number> = {
  selected: 0,
  converted: 0,
  shortlisted: 1,
  new: 2,
};

/**
 * Display order for leads — the selected/converted target lead floats to the
 * top of Home and the Leads tab; the rest keep creation order.
 */
function sortLeadsForDisplay(rows: CrmLead[]): CrmLead[] {
  return [...rows].sort(
    (a, b) =>
      (LEAD_STATUS_ORDER[a.status] ?? 1) - (LEAD_STATUS_ORDER[b.status] ?? 1) ||
      a.created_at.localeCompare(b.created_at)
  );
}

/**
 * Narrows a SimulationStage to an opportunity record tab id when valid.
 */
function asRecordStage(stage: SimulationStage | null | undefined): CrmRecordStageId | null {
  if (
    stage === "discovery" ||
    stage === "presentation" ||
    stage === "objections" ||
    stage === "close"
  ) {
    return stage;
  }
  return null;
}

/** In-CRM navigation snapshot so Back can restore record views correctly. */
type CrmNavSnapshot = {
  view: CrmView;
  contactKey: CrmContactKey;
  selectedLeadId: string | null;
  leadFormKey: string;
};

/**
 * Full-viewport CRM overlay — covers the stage without unmounting it.
 */
export function CrmOverlay({
  isOpen,
  onClose,
  attemptId,
  currentStage,
  displayName,
  deepLinkStage = null,
  deepLinkView = null,
  deepLinkLeads = false,
  onLogEntriesChange,
  onLeadsChange,
}: CrmOverlayProps): React.ReactElement | null {
  const [closing, setClosing] = useState(false);
  const [view, setViewState] = useState<CrmView>("home");
  const [contactKey, setContactKey] = useState<CrmContactKey>("dana_reyes");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadFormKey, setLeadFormKey] = useState("new-lead");
  const viewHistoryRef = useRef<CrmNavSnapshot[]>([]);
  const [canGoBack, setCanGoBack] = useState(false);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [logEntries, setLogEntries] = useState<CrmLogEntry[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [accountRecord, setAccountRecord] = useState<CrmAccountRecord | null>(null);
  const [hasAccountRow, setHasAccountRow] = useState(false);
  const [contactSnapshots, setContactSnapshots] = useState<ContactNotesSnapshot[]>([]);
  const [activeDeepLink, setActiveDeepLink] = useState<CrmRecordStageId | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wraps the raw view setter so every in-CRM navigation records where the
  // student came from; the header Back button pops this history.
  const setView = (next: CrmView): void => {
    if (next !== view) {
      viewHistoryRef.current.push({ view, contactKey, selectedLeadId, leadFormKey });
      setCanGoBack(true);
    }
    setViewState(next);
  };

  const handleCrmBack = (): void => {
    const prev = viewHistoryRef.current.pop();
    setCanGoBack(viewHistoryRef.current.length > 0);
    if (!prev) {
      return;
    }
    setContactKey(prev.contactKey);
    setSelectedLeadId(prev.selectedLeadId);
    setLeadFormKey(prev.leadFormKey);
    setViewState(prev.view);
  };

  useEffect(() => {
    if (isOpen) {
      setClosing(false);
      viewHistoryRef.current = [];
      setCanGoBack(false);
      if (deepLinkLeads) {
        setActiveDeepLink(null);
        setSelectedLeadId(null);
        setViewState("leads-list");
        setContactKey("dana_reyes");
        return;
      }
      if (deepLinkView === "account") {
        setActiveDeepLink(null);
        setSelectedLeadId(null);
        setViewState("account-record");
        setContactKey("dana_reyes");
        return;
      }
      const link = asRecordStage(deepLinkStage);
      setActiveDeepLink(link);
      setViewState(link ? "record" : "home");
      setContactKey("dana_reyes");
    }
  }, [isOpen, deepLinkStage, deepLinkView, deepLinkLeads]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const loadLogs = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/student/crm-log?attemptId=${encodeURIComponent(attemptId)}`
      );
      if (!res.ok) {
        return;
      }
      const body = (await res.json()) as { entries?: CrmLogEntry[] };
      const next = body.entries ?? [];
      setLogEntries(next);
      setLogsLoaded(true);
      onLogEntriesChange?.(next);
    } catch {
      /* keep prior entries */
    }
  }, [attemptId, onLogEntriesChange]);

  const loadLeads = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/student/crm-leads?attemptId=${encodeURIComponent(attemptId)}`
      );
      if (!res.ok) {
        return;
      }
      const body = (await res.json()) as { leads?: CrmLead[] };
      const next = sortLeadsForDisplay(body.leads ?? []);
      setLeads(next);
      onLeadsChange?.(next);
    } catch {
      /* keep prior */
    }
  }, [attemptId, onLeadsChange]);

  const loadAccountAndContacts = useCallback(async (): Promise<void> => {
    try {
      const [accountRes, ...contactResList] = await Promise.all([
        fetch(`/api/student/crm-account?attemptId=${encodeURIComponent(attemptId)}`),
        ...CRM_CONTACT_SLOTS.map((key) =>
          fetch(
            `/api/student/crm-contact?attemptId=${encodeURIComponent(attemptId)}&contactKey=${encodeURIComponent(key)}`
          )
        ),
      ]);

      if (accountRes.ok) {
        const body = (await accountRes.json()) as {
          notes?: string;
          fields?: Record<string, string>;
          updated_at?: string | null;
        };
        const record: CrmAccountRecord = {
          fields: body.fields ?? {},
          notes: body.notes ?? "",
          updated_at: body.updated_at ?? null,
        };
        setAccountRecord(record);
        setHasAccountRow(Boolean(body.updated_at) || accountHasProfile(record));
      }

      const snapshots: ContactNotesSnapshot[] = [];
      for (let i = 0; i < CRM_CONTACT_SLOTS.length; i += 1) {
        const slotKey = CRM_CONTACT_SLOTS[i];
        const res = contactResList[i];
        if (!res?.ok) {
          snapshots.push({
            contactKey: slotKey,
            fields: emptyContactFields(),
            role: "",
            notes: "",
            updated_at: null,
          });
          continue;
        }
        const body = (await res.json()) as {
          role?: string;
          notes?: string;
          fields?: Record<string, string>;
          updated_at?: string | null;
        };
        snapshots.push({
          contactKey: slotKey,
          fields: { ...emptyContactFields(), ...(body.fields ?? {}) },
          role: body.role ?? "",
          notes: body.notes ?? "",
          updated_at: body.updated_at ?? null,
        });
      }
      setContactSnapshots(snapshots);
    } catch {
      /* keep prior */
    }
  }, [attemptId]);

  useEffect(() => {
    if (!isOpen) {
      setLogsLoaded(false);
      setLogEntries([]);
      setAccountRecord(null);
      setHasAccountRow(false);
      setContactSnapshots([]);
      setLeads([]);
      return;
    }
    void loadLogs();
    void loadLeads();
    void loadAccountAndContacts();
  }, [isOpen, loadLogs, loadLeads, loadAccountAndContacts]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (
      view === "home" ||
      view === "list" ||
      view === "accounts-list" ||
      view === "contacts-list" ||
      view === "leads-list"
    ) {
      void loadAccountAndContacts();
      void loadLogs();
      void loadLeads();
    }
  }, [view, isOpen, loadAccountAndContacts, loadLogs, loadLeads]);

  const loggedStageSet = useMemo(
    () => new Set(logEntries.map((e) => e.stage)),
    [logEntries]
  );

  if (!isOpen) {
    return null;
  }

  const stageLabel = crmStageLabel(currentStage);
  const activeNav = activeNavForView(view);
  const hasConverted =
    hasAccountRow || leads.some((lead) => lead.status === "converted");
  const hasOpportunity = hasConverted;
  const hasAccount = hasConverted && accountHasProfile(accountRecord);
  const savedContacts = contactSnapshots.filter((snap) => {
    if (!contactHasRecord(snap)) {
      return false;
    }
    if (snap.contactKey === "dana_reyes" && !hasConverted) {
      return false;
    }
    return true;
  });
  const accountDisplayName =
    (accountRecord?.fields.accountName ?? "").trim() ||
    accountNameFromLogs(logEntries) ||
    (hasAccount ? "Untitled account" : "");
  const accountNotes = accountRecord?.notes ?? "";
  const oppTitle =
    accountDisplayName ||
    opportunityTitleFromLogs(logEntries) ||
    "Untitled opportunity";
  const opportunityPercent = opportunityCompletionPercent(logEntries);
  const nonProspectingLogs = logEntries.filter((e) => e.stage !== "prospecting");
  const lastActivityLabel =
    nonProspectingLogs.length > 0
      ? `Logged ${nonProspectingLogs.length} stage${
          nonProspectingLogs.length === 1 ? "" : "s"
        }`
      : hasConverted
        ? "Ready to log"
        : "Not yet created";

  const addableContactKeys = availableContactKeysToAdd(contactSnapshots).filter((key) => {
    if (key === "dana_reyes") {
      return hasConverted;
    }
    return true;
  });

  const selectedLead =
    selectedLeadId === null
      ? null
      : leads.find((lead) => lead.id === selectedLeadId) ?? null;

  const hasKimContact = contactSnapshots.some(
    (snap) => snap.contactKey === "dr_kim" && contactHasRecord(snap)
  );

  const handleBackToSimulation = (): void => {
    if (closing) {
      return;
    }
    setClosing(true);
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, SLIDE_OUT_MS);
  };

  const handleLogSaved = (entry: CrmLogEntry): void => {
    setLogEntries((prev) => {
      const without = prev.filter((row) => row.stage !== entry.stage);
      const next = [...without, entry];
      onLogEntriesChange?.(next);
      return next;
    });
  };

  const openOpportunityRecord = (): void => {
    if (!hasConverted) {
      setView("leads-list");
      return;
    }
    setActiveDeepLink(null);
    setView("record");
    if (!logsLoaded) {
      void loadLogs();
    }
  };

  const openLeadsList = (): void => {
    setSelectedLeadId(null);
    setView("leads-list");
  };

  const handleSidebarNav = (id: SidebarNavId): void => {
    setActiveDeepLink(null);
    if (id === "home") {
      setView("home");
      return;
    }
    if (id === "leads") {
      openLeadsList();
      return;
    }
    if (id === "opportunities") {
      setView("list");
      return;
    }
    if (id === "accounts") {
      setView("accounts-list");
      return;
    }
    setView("contacts-list");
  };

  const handleLeadSaved = (lead: CrmLead): void => {
    setLeads((prev) => {
      const without = prev.filter((row) => row.id !== lead.id);
      const next = sortLeadsForDisplay([...without, lead]);
      onLeadsChange?.(next);
      return next;
    });
    setSelectedLeadId(null);
    setView("leads-list");
  };

  return (
    <div
      className={`fixed inset-0 z-[110] flex min-h-screen text-[#161d1b] bg-[#f4fbf7] ${
        closing ? "animate-slide-out-right" : "animate-slide-in-right"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Rehearse CRM"
    >
      <aside className="fixed left-0 top-0 h-full z-40 flex flex-col pt-8 w-[240px] text-[#dde4e1] bg-[#2d3142]">
        <div className="px-4 mb-8">
          <h1 className="text-lg font-bold text-white leading-6">Rehearse CRM</h1>
          <p className="text-[12px] font-medium tracking-wide text-[#606376] opacity-80 uppercase mt-0.5">
            Sales Intelligence
          </p>
        </div>
        <nav className="flex-grow">
          {SIDEBAR_ITEMS.map((item) => {
            const isActive = item.id === activeNav;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSidebarNav(item.id)}
                className={`mx-2 my-1 px-4 py-2 flex items-center gap-4 rounded-lg w-[calc(100%-1rem)] text-left transition-colors ${
                  isActive
                    ? "bg-[#0f4c4c] text-[#85bbbb]"
                    : "text-[#606376] hover:bg-white/5 hover:text-[#dde4e1]"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <MaterialIcon name={item.icon} className="text-[22px]" />
                <span className="text-[12px] font-medium tracking-wide uppercase">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-[#171b2b]">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full border border-[#bfc8c8] bg-[#0f4c4c] flex items-center justify-center text-white text-sm font-bold shrink-0">
              {displayName.trim().charAt(0).toUpperCase() || "S"}
            </div>
            <div className="overflow-hidden">
              <p className="text-[12px] font-medium text-white truncate">{displayName}</p>
              <p className="text-[10px] text-[#606376] uppercase tracking-wider">Sales Trainee</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="ml-[240px] flex-grow flex flex-col h-screen min-w-0">
        <header className="w-full px-6 py-2.5 bg-[#f4fbf7] border-b border-[#bfc8c8] shadow-sm sticky top-0 z-30 flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={handleBackToSimulation}
            disabled={closing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gold px-3 py-2 text-sm font-semibold text-[#241a00] shadow-md shadow-black/20 hover:brightness-105 active:scale-95 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a84c]/50 disabled:opacity-60"
            aria-label="Go to Simulation"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pitchlab-logo-new.png" alt="" className="h-[18px] w-auto shrink-0" />
            Go to Simulation
          </button>
          <button
            type="button"
            onClick={handleCrmBack}
            disabled={closing || !canGoBack}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#003434] hover:text-[#0f4c4c] transition-colors disabled:opacity-40"
          >
            <MaterialIcon name="arrow_back" className="text-[18px]" />
            Back
          </button>
        </header>

        <CrmHelperWidget
          leads={leads}
          hasConvertedLead={hasConverted}
          currentStage={currentStage}
          loggedStages={loggedStageSet}
          hasKimContact={hasKimContact}
        />

        {view === "home" ? (
          <CrmHomeView
            leads={leads.map((lead) => ({
              id: lead.id,
              companyName: lead.company_name,
              contactName: lead.contact_name,
              status: lead.status,
            }))}
            account={{
              hasRecord: hasAccount,
              name: accountDisplayName || "Account",
              notesPreview: previewText(accountNotes),
            }}
            contacts={savedContacts.map((c) => ({
              key: c.contactKey,
              name: contactDisplayName(c.fields),
              title: (c.fields.position ?? "").trim(),
              role: c.role,
            }))}
            opportunity={{
              hasRecord: hasOpportunity,
              title: oppTitle,
              stageLabel,
              activityLabel: lastActivityLabel,
              completionPercent: opportunityPercent,
            }}
            availableContactKeys={addableContactKeys}
            onOpenLead={(leadId) => {
              setSelectedLeadId(leadId);
              setLeadFormKey(leadId);
              setView("lead-record");
            }}
            onAddLead={() => {
              setSelectedLeadId(null);
              setLeadFormKey(`new-${Date.now()}`);
              setView("lead-record");
            }}
            onBrowseLeads={openLeadsList}
            onOpenAccount={() =>
              hasConverted ? setView("account-record") : openLeadsList()
            }
            onOpenContact={(key) => {
              setContactKey(key);
              setView("contact-record");
            }}
            onAddContact={(key) => {
              setContactKey(key);
              setView("contact-record");
            }}
            onOpenOpportunity={openOpportunityRecord}
            onBrowseAccounts={() => setView("accounts-list")}
            onBrowseContacts={() => setView("contacts-list")}
            onBrowseOpportunities={() => setView("list")}
          />
        ) : null}

        {view === "leads-list" ? (
          <LeadsListView
            leads={leads}
            onAddLead={() => {
              setSelectedLeadId(null);
              setLeadFormKey(`new-${Date.now()}`);
              setView("lead-record");
            }}
            onOpenLead={(leadId) => {
              setSelectedLeadId(leadId);
              setLeadFormKey(leadId);
              setView("lead-record");
            }}
          />
        ) : null}

        {view === "lead-record" ? (
          <LeadDetailForm
            key={leadFormKey}
            attemptId={attemptId}
            lead={selectedLead}
            onBackToList={openLeadsList}
            onSaved={handleLeadSaved}
          />
        ) : null}

        {view === "record" ? (
          hasConverted ? (
            <OpportunityRecordView
              key={activeDeepLink ? `deep-${activeDeepLink}` : "record-default"}
              attemptId={attemptId}
              currentStage={currentStage}
              logEntries={logEntries}
              onLogSaved={handleLogSaved}
              onBackToList={() => {
                setActiveDeepLink(null);
                setView("list");
              }}
              initialTab={activeDeepLink}
              opportunityTitle={oppTitle}
              primaryContactLabel={
                (accountRecord?.fields.primaryContact ?? "").trim() ||
                primaryContactFromLogs(logEntries)
              }
              accountRecord={accountRecord}
              contactRecords={savedContacts}
              completionPercent={opportunityPercent}
            />
          ) : (
            <div className="p-6 flex-grow overflow-auto">
              <div className="max-w-7xl mx-auto">
                <div className="bg-white border border-[#bfc8c8] rounded-lg px-6 py-12 text-center space-y-4">
                  <p className="text-sm text-[#707978]">
                    No opportunity yet — convert a Lead to get started
                  </p>
                  <button
                    type="button"
                    onClick={openLeadsList}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0f4c4c] text-white text-[12px] font-medium tracking-wide hover:brightness-110"
                  >
                    Go to Leads
                  </button>
                </div>
              </div>
            </div>
          )
        ) : null}

        {view === "account-record" ? (
          <AccountRecordView
            attemptId={attemptId}
            isUnlocked={hasConverted}
            onGoToLeads={openLeadsList}
            onBackToList={() => setView("accounts-list")}
            onSaved={(record) => {
              setAccountRecord(record);
              setHasAccountRow(true);
              setView("accounts-list");
            }}
          />
        ) : null}

        {view === "contact-record" ? (
          <ContactRecordView
            key={contactKey}
            attemptId={attemptId}
            contactKey={contactKey}
            accountLabel={accountDisplayName || "—"}
            isUnlocked={contactKey === "dr_kim" || hasConverted}
            onGoToLeads={openLeadsList}
            onBackToList={() => setView("contacts-list")}
            onSaved={(record) => {
              setContactSnapshots((prev) => {
                const without = prev.filter((row) => row.contactKey !== contactKey);
                return [...without, record];
              });
              setView("contacts-list");
            }}
          />
        ) : null}

        {view === "accounts-list" ? (
          <div className="p-6 flex-grow overflow-auto">
            <div className="max-w-7xl mx-auto space-y-6">
              <div className="flex items-end justify-between gap-4">
                <h3 className="text-2xl font-semibold tracking-tight text-[#003434]">Accounts</h3>
              </div>
              <div className="bg-white border border-[#bfc8c8] rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
                {hasAccount ? (
                  <>
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#eef5f2]">
                        <tr>
                          <th className="px-6 py-4 text-[12px] font-medium tracking-wide text-[#404848] border-b border-[#bfc8c8]">
                            Account
                          </th>
                          <th className="px-6 py-4 text-[12px] font-medium tracking-wide text-[#404848] border-b border-[#bfc8c8]">
                            Industry
                          </th>
                          <th className="px-6 py-4 text-[12px] font-medium tracking-wide text-[#404848] border-b border-[#bfc8c8]">
                            Region
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          className="group hover:bg-[#eef5f2] transition-colors duration-150 cursor-pointer"
                          onClick={() => setView("account-record")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setView("account-record");
                            }
                          }}
                          tabIndex={0}
                          role="link"
                        >
                          <td className="px-6 py-6 border-b border-[#bfc8c8] text-sm font-medium">
                            {accountDisplayName || "Untitled account"}
                          </td>
                          <td className="px-6 py-6 border-b border-[#bfc8c8] text-sm text-[#404848]">
                            {(accountRecord?.fields.industry ?? "").trim() || "—"}
                          </td>
                          <td className="px-6 py-6 border-b border-[#bfc8c8] text-sm text-[#404848]">
                            {(accountRecord?.fields.region ?? "").trim() || "—"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="px-6 py-4 border-t border-[#bfc8c8] text-[12px] text-[#404848]">
                      1 of 1 account
                    </div>
                  </>
                ) : (
                  <div className="px-6 py-12 text-center space-y-4">
                    <p className="text-sm text-[#707978]">
                      No account yet — convert a Lead to get started
                    </p>
                    <button
                      type="button"
                      onClick={openLeadsList}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0f4c4c] text-white text-[12px] font-medium tracking-wide hover:brightness-110"
                    >
                      Go to Leads
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {view === "contacts-list" ? (
          <div className="p-6 flex-grow overflow-auto">
            <div className="max-w-7xl mx-auto space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <h3 className="text-2xl font-semibold tracking-tight text-[#003434]">Contacts</h3>
                {addableContactKeys.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = addableContactKeys[0];
                      if (!next) {
                        return;
                      }
                      setContactKey(next);
                      setView("contact-record");
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#0f4c4c] text-[#0f4c4c] text-[12px] font-medium hover:bg-[#eef5f2]"
                  >
                    <MaterialIcon name="person_add" className="text-[16px]" />
                    Add contact
                  </button>
                ) : null}
              </div>
              <div className="bg-white border border-[#bfc8c8] rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
                {savedContacts.length > 0 ? (
                  <>
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#eef5f2]">
                        <tr>
                          <th className="px-6 py-4 text-[12px] font-medium tracking-wide text-[#404848] border-b border-[#bfc8c8]">
                            Name
                          </th>
                          <th className="px-6 py-4 text-[12px] font-medium tracking-wide text-[#404848] border-b border-[#bfc8c8]">
                            Role
                          </th>
                          <th className="px-6 py-4 text-[12px] font-medium tracking-wide text-[#404848] border-b border-[#bfc8c8]">
                            Account
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {savedContacts.map((c) => (
                          <tr
                            key={c.contactKey}
                            className="group hover:bg-[#eef5f2] transition-colors duration-150 cursor-pointer"
                            onClick={() => {
                              setContactKey(c.contactKey);
                              setView("contact-record");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setContactKey(c.contactKey);
                                setView("contact-record");
                              }
                            }}
                            tabIndex={0}
                            role="link"
                          >
                            <td className="px-6 py-6 border-b border-[#bfc8c8] text-sm font-medium">
                              {contactDisplayName(c.fields)}
                            </td>
                            <td className="px-6 py-6 border-b border-[#bfc8c8] text-sm text-[#404848]">
                              {c.role || (c.fields.position ?? "").trim() || "—"}
                            </td>
                            <td className="px-6 py-6 border-b border-[#bfc8c8] text-sm text-[#404848]">
                              {accountDisplayName || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="px-6 py-4 border-t border-[#bfc8c8] text-[12px] text-[#404848]">
                      {savedContacts.length} of {savedContacts.length} contact
                      {savedContacts.length === 1 ? "" : "s"}
                    </div>
                  </>
                ) : (
                  <div className="px-6 py-12 text-center space-y-4">
                    <p className="text-sm text-[#707978]">
                      No contacts yet — select your target Lead to unlock the primary contact.
                    </p>
                    <button
                      type="button"
                      onClick={openLeadsList}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0f4c4c] text-white text-[12px] font-medium tracking-wide hover:brightness-110"
                    >
                      Go to Leads
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {view === "list" ? (
          <div className="p-6 flex-grow overflow-auto">
            <div className="max-w-7xl mx-auto space-y-6">
              <header className="flex flex-wrap items-end justify-between gap-4">
                <h3 className="text-2xl font-semibold tracking-tight text-[#003434]">
                  My Opportunities
                </h3>
              </header>

              <div className="bg-white border border-[#bfc8c8] rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
                {hasOpportunity ? (
                  <>
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#eef5f2]">
                        <tr>
                          <th className="px-6 py-4 text-[12px] font-medium tracking-wide text-[#404848] border-b border-[#bfc8c8]">
                            Opportunity
                          </th>
                          <th className="px-6 py-4 text-[12px] font-medium tracking-wide text-[#404848] border-b border-[#bfc8c8]">
                            Completion
                          </th>
                          <th className="px-6 py-4 text-[12px] font-medium tracking-wide text-[#404848] border-b border-[#bfc8c8]">
                            Stage
                          </th>
                          <th className="px-6 py-4 text-[12px] font-medium tracking-wide text-[#404848] border-b border-[#bfc8c8]">
                            Last Activity
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          className="group hover:bg-[#eef5f2] transition-colors duration-150 cursor-pointer"
                          onClick={openOpportunityRecord}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openOpportunityRecord();
                            }
                          }}
                          tabIndex={0}
                          role="link"
                          aria-label={`Open ${oppTitle}`}
                        >
                          <td className="px-6 py-6 border-b border-[#bfc8c8]">
                            <span className="text-sm text-[#161d1b] font-medium">{oppTitle}</span>
                          </td>
                          <td className="px-6 py-4 border-b border-[#bfc8c8]">
                            <CrmOpportunityCompletionGauge
                              percent={opportunityPercent}
                              size="sm"
                            />
                          </td>
                          <td className="px-6 py-6 border-b border-[#bfc8c8]">
                            <span className="inline-flex items-center px-2 py-1 rounded-full bg-[#0f4c4c] text-white text-[10px] font-bold uppercase tracking-widest">
                              {stageLabel}
                            </span>
                          </td>
                          <td className="px-6 py-6 border-b border-[#bfc8c8]">
                            <div className="flex items-center gap-1 text-[#404848] opacity-60">
                              <MaterialIcon name="history" className="text-[18px]" />
                              <span className="text-sm">{lastActivityLabel}</span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="px-6 py-4 bg-white border-t border-[#bfc8c8] text-[12px] text-[#404848]">
                      1 of 1 opportunity
                    </div>
                  </>
                ) : (
                  <div className="px-6 py-12 text-center space-y-4">
                    <p className="text-sm text-[#707978]">
                      No opportunity yet — convert a Lead to get started
                    </p>
                    <button
                      type="button"
                      onClick={openLeadsList}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0f4c4c] text-white text-[12px] font-medium tracking-wide hover:brightness-110"
                    >
                      Go to Leads
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

/**
 * Client bridge — wraps stage content and only shows Go to CRM after mount,
 * so the floating button does not appear before the stage UI hydrates.
 * Owns CRM open/deep-link state and provides gate context to HandoffModal.
 */
export function CrmAccess({
  simulationId,
  classId,
  attemptId,
  currentStage,
  displayName,
  completedStages,
  initialLoggedStages = [],
  gateBypassEnabled = false,
  children,
}: CrmAccessProps): React.ReactElement {
  const [isPageReady, setIsPageReady] = useState(false);
  const [isCrmOpen, setIsCrmOpen] = useState(false);
  const [deepLinkStage, setDeepLinkStage] = useState<SimulationStage | null>(null);
  const [deepLinkView, setDeepLinkView] = useState<"account" | null>(null);
  const [deepLinkLeads, setDeepLinkLeads] = useState(false);
  const [loggedStageIds, setLoggedStageIds] = useState<string[]>(initialLoggedStages);
  const [liveCompleted, setLiveCompleted] = useState<string[]>(completedStages);
  const [hasConvertedLead, setHasConvertedLead] = useState(false);
  const [prospectingCrmComplete, setProspectingCrmComplete] = useState(false);

  useEffect(() => {
    setIsPageReady(true);
  }, []);

  useEffect(() => {
    setLiveCompleted(completedStages);
  }, [completedStages]);

  useEffect(() => {
    setLoggedStageIds(initialLoggedStages);
  }, [initialLoggedStages]);

  const refreshCrmLogs = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/student/crm-log?attemptId=${encodeURIComponent(attemptId)}`
      );
      if (!res.ok) {
        return;
      }
      const body = (await res.json()) as { entries?: CrmLogEntry[] };
      setLoggedStageIds((body.entries ?? []).map((e) => e.stage));
    } catch {
      /* keep prior */
    }
  }, [attemptId]);

  const refreshLeads = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/student/crm-leads?attemptId=${encodeURIComponent(attemptId)}`
      );
      if (!res.ok) {
        return;
      }
      const body = (await res.json()) as { leads?: CrmLead[] };
      setHasConvertedLead((body.leads ?? []).some((lead) => lead.status === "converted"));
    } catch {
      /* keep prior */
    }
  }, [attemptId]);

  const refreshCrmProfile = useCallback(async (): Promise<void> => {
    try {
      const [accountRes, contactRes] = await Promise.all([
        fetch(`/api/student/crm-account?attemptId=${encodeURIComponent(attemptId)}`),
        fetch(
          `/api/student/crm-contact?attemptId=${encodeURIComponent(attemptId)}&contactKey=dana_reyes`
        ),
      ]);

      let accountComplete = false;
      if (accountRes.ok) {
        const body = (await accountRes.json()) as { fields?: Record<string, string> };
        accountComplete = canSaveAccountFields(body.fields ?? {});
      }

      let contactComplete = false;
      if (contactRes.ok) {
        const body = (await contactRes.json()) as {
          fields?: Record<string, string>;
          role?: string;
        };
        contactComplete = contactRecordComplete(body.fields ?? {}, body.role ?? "");
      }

      setProspectingCrmComplete(accountComplete && contactComplete);
    } catch {
      /* keep prior */
    }
  }, [attemptId]);

  useEffect(() => {
    if (!isPageReady) {
      return;
    }
    void refreshCrmLogs();
    void refreshLeads();
    void refreshCrmProfile();
  }, [isPageReady, refreshCrmLogs, refreshLeads, refreshCrmProfile]);

  const loggedStages = useMemo(() => new Set(loggedStageIds), [loggedStageIds]);

  const needsLoggingStage = useMemo(() => {
    return findStageNeedingCrmLog(liveCompleted, loggedStages);
  }, [liveCompleted, loggedStages]);

  const openCrmForStage = useCallback((stage: string): void => {
    if (stage === "prospecting") {
      setDeepLinkLeads(true);
      setDeepLinkStage(null);
      setDeepLinkView(null);
      setIsCrmOpen(true);
      return;
    }
    setDeepLinkLeads(false);
    setDeepLinkView(null);
    setDeepLinkStage(stage as SimulationStage);
    setIsCrmOpen(true);
  }, []);

  const openCrmLeads = useCallback((): void => {
    setDeepLinkLeads(true);
    setDeepLinkStage(null);
    setDeepLinkView(null);
    setIsCrmOpen(true);
  }, []);

  const openCrmHome = useCallback((): void => {
    setDeepLinkLeads(false);
    setDeepLinkStage(null);
    setDeepLinkView(null);
    setIsCrmOpen(true);
  }, []);

  const noteCompletedStage = useCallback((stage: string): void => {
    setLiveCompleted((prev) => (prev.includes(stage) ? prev : [...prev, stage]));
  }, []);

  const handleCloseCrm = useCallback((): void => {
    setIsCrmOpen(false);
    setDeepLinkStage(null);
    setDeepLinkView(null);
    setDeepLinkLeads(false);
    void refreshCrmLogs();
    void refreshLeads();
    void refreshCrmProfile();
  }, [refreshCrmLogs, refreshLeads, refreshCrmProfile]);

  const handleLogEntriesChange = useCallback((entries: CrmLogEntry[]): void => {
    setLoggedStageIds(entries.map((e) => e.stage));
  }, []);

  const handleLeadsChange = useCallback((nextLeads: CrmLead[]): void => {
    setHasConvertedLead(nextLeads.some((lead) => lead.status === "converted"));
  }, []);

  const gateValue = useMemo<TempoCrmGateContextValue>(
    () => ({
      loggedStages,
      needsLoggingStage,
      openCrmForStage,
      openCrmLeads,
      openCrmHome,
      hasConvertedLead,
      prospectingCrmComplete,
      gateBypassEnabled,
      refreshCrmLogs,
      noteCompletedStage,
    }),
    [
      loggedStages,
      needsLoggingStage,
      openCrmForStage,
      openCrmLeads,
      openCrmHome,
      hasConvertedLead,
      prospectingCrmComplete,
      gateBypassEnabled,
      refreshCrmLogs,
      noteCompletedStage,
    ]
  );

  return (
    <TempoCrmGateContext.Provider value={gateValue}>
      {children}
      {isPageReady ? (
        <>
          <GoToCrmButton
            needsLogging={needsLoggingStage !== null}
            onClick={() => {
              setDeepLinkLeads(false);
              setDeepLinkStage(null);
              setDeepLinkView(null);
              setIsCrmOpen(true);
            }}
          />
          <CrmOverlay
            isOpen={isCrmOpen}
            onClose={handleCloseCrm}
            simulationId={simulationId}
            classId={classId}
            attemptId={attemptId}
            currentStage={currentStage}
            displayName={displayName}
            deepLinkStage={deepLinkStage}
            deepLinkView={deepLinkView}
            deepLinkLeads={deepLinkLeads}
            onLogEntriesChange={handleLogEntriesChange}
            onLeadsChange={handleLeadsChange}
          />
        </>
      ) : null}
    </TempoCrmGateContext.Provider>
  );
}
