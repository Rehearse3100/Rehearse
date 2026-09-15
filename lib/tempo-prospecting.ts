/**
 * tempo-prospecting.ts
 * Constants and helpers for the Tempo Stage 1 Prospecting wizard
 * (Rehearse Essentials default class only).
 */

import type { ChatMessage } from "@/types";
import { parseProspectingIcpState } from "@/lib/tempo-icp-criteria";

export type ProspectingStepId =
  | "onboarding"
  | "icp"
  | "research"
  | "agent"
  | "select_lead"
  | "opening";

/** Latest prospectingStepVersion — bump when PROSPECTING_STEPS layout changes. */
export const PROSPECTING_STEP_VERSION = 5;

/** Keys on ProspectingWizardState that belong to the ICP form (step 1). */
export const ICP_FORM_FIELD_KEYS = [
  "icpTargetVerticals",
  "icpSizeMinLocations",
  "icpSizeMaxLocations",
  "icpOperationalSignals",
  "icpDisqualifier1",
  "icpDisqualifier2",
  "icpDisqualifier3",
] as const satisfies readonly (keyof ProspectingWizardState)[];

export type ProspectingStepDefinition = {
  id: ProspectingStepId;
  label: string;
  description: string;
};

export const PROSPECTING_STEPS: readonly ProspectingStepDefinition[] = [
  {
    id: "onboarding",
    label: "Welcome Briefing",
    description: "Watch and review before you start",
  },
  { id: "icp", label: "Define Your ICP", description: "Who is Tempo for?" },
  {
    id: "research",
    label: "Data Room",
    description: "Review documents and shortlist three accounts",
  },
  {
    id: "agent",
    label: "Build Your Agent",
    description: "Design an AI system to do what you just did by hand",
  },
  {
    id: "select_lead",
    label: "Select Target Lead",
    description: "Choose your best lead",
  },
  { id: "opening", label: "Opening Message", description: "Write your outreach" },
] as const;

export const TEMPO_HANDOFF_MESSAGES = {
  prospecting: `Time to build your pipeline. I have loaded a directory of appointment-based businesses into your research workspace. One of those accounts is showing real buying signals right now, and only one person there truly owns this decision. Research the candidates, verify what the AI tells you before you trust it, work up your leads in the CRM, and pick your target. Then draft a crisp opening message. No pitching yet. Just sharp research and a strong first touch. Good luck.`,

  discovery: `Your outreach landed. Dana Reyes has agreed to a 15-minute discovery call next Tuesday. You are not pitching yet. You are here to understand their world and find out whether there is a business issue worth solving. Be curious. Ask good questions. Listen more than you talk. Good luck.`,

  presentation: `Nice work. Dana wants you back to present to her and Dr. Kim next week. Here is what the team knows about Summit Dental: 8 dental practices, just opened their 8th, straining a manual phone-based scheduling setup. Front desk is overloaded, no-shows run about 1 in 6, they capture no after-hours demand, and Dana is under pressure from Dr. Kim to get operations right as they scale. Build them a pitch that connects to that business issue.`,

  objections: `You sent the proposal, and Dr. Kim wants a call before he signs off. He has got concerns. Dana will be on, but Kim is the one to win over: he built this from one chair to eight locations and he is careful with money. Do not expect an easy yes, and do not fold the moment he pushes on price.`,

  negotiation: `You earned it. Kim is ready to talk terms. Dana will work the details with you. They want Pro across all 8 locations, Kim wants confidence it will deliver before committing, and price is on the table. Now build the mutual plan and close it.`,
} as const;

export type TempoHandoffStageKey = keyof typeof TEMPO_HANDOFF_MESSAGES;

export const TEMPO_HANDOFF_STAGE_META: Record<
  TempoHandoffStageKey,
  { stageNumber: number; stageName: string; stageIcon: string; hasAIRestriction: boolean }
> = {
  prospecting: {
    stageNumber: 1,
    stageName: "Prospecting",
    stageIcon: "search",
    hasAIRestriction: false,
  },
  discovery: {
    stageNumber: 2,
    stageName: "Discovery",
    stageIcon: "record_voice_over",
    hasAIRestriction: true,
  },
  presentation: {
    stageNumber: 3,
    stageName: "Presentation",
    stageIcon: "present_to_all",
    hasAIRestriction: false,
  },
  objections: {
    stageNumber: 4,
    stageName: "Objection Handling",
    stageIcon: "shield",
    hasAIRestriction: true,
  },
  negotiation: {
    stageNumber: 5,
    stageName: "Negotiation",
    stageIcon: "handshake",
    hasAIRestriction: false,
  },
};

export const TEMPO_RESEARCH_SYSTEM_PROMPT = `You are an AI research assistant helping a sales student research Summit Dental Group for a Tempo sales simulation. You have access to the following context:

ABOUT TEMPO: Scheduling software for appointment-based businesses. Key value: cut no-shows, free the front desk, capture after-hours demand, drive repeat visits. Pricing: Starter $99/location/month, Pro $179/location/month. Proof points: 35% drop in no-shows in 90 days, 6 hours/week saved per location, 20% of bookings happen outside hours.

ABOUT SUMMIT DENTAL: 8 dental practices in Colorado Front Range. Founded by Dr. Saul Kim. Just opened 8th location 3 months ago. Scheduling by phone. Director of Operations is Dana Reyes who reports to Dr. Kim.

Answer the student's questions about Summit Dental and the dental scheduling market. If you don't have verified information, say so clearly. Flag uncertainty rather than fabricate. Keep responses concise and useful for sales research.

IMPORTANT: Write in plain English only. Do not use LaTeX, TeX, math delimiters ($ or $$), or markdown code blocks. Use normal punctuation for numbers and percentages (e.g. 15-20%, not $15\\text{-}20\\%$).`;

export const AUTO_RESEARCH_CARDS = [
  {
    id: "industry",
    icon: "factory",
    title: "Industry Context",
    content:
      "Dental practices average 15-20% no-show rates. Front desk staff spend 40-60% of time on phone scheduling. ~20% of appointment demand occurs outside business hours.",
  },
  {
    id: "account",
    icon: "account_balance",
    title: "Account Profile",
    content:
      "Summit Dental Group: 8 practices across Colorado Front Range. Founded by Dr. Saul Kim. Scheduling by phone via shared calendar. Opened 8th location 3 months ago.",
  },
  {
    id: "dm",
    icon: "person_search",
    title: "Decision Maker",
    content:
      "Dana Reyes, Director of Operations. Reports to Dr. Kim. Responsible for scheduling, staffing, and operational tools. 2 years in role, hired to get operations under control.",
  },
  {
    id: "competitors",
    icon: "swords",
    title: "Competitors",
    content:
      "SlotEasy (~$59/location, reminders only), status quo (phone/paper), BookSuite Enterprise (too complex). Tempo differentiation: rebooking engine + multi-location fit.",
  },
] as const;

export const SELF_CHECK_ITEMS = [
  { id: "wordCount", label: "Under 120 words" },
  { id: "trigger", label: "Mentioned specific trigger event" },
  { id: "businessIssue", label: "Led with their business issue, not product" },
  { id: "cta", label: "Clear and soft call to action" },
  { id: "professional", label: "Professional and specific tone" },
] as const;

/** Opening Message tips shown beside the draft (non-interactive). */
export const OPENING_MESSAGE_TIPS = SELF_CHECK_ITEMS.map((item) => item.label);

export type ProspectingWizardState = {
  currentStep: number;
  icpTargetVerticals: string;
  icpSizeMinLocations: string;
  icpSizeMaxLocations: string;
  icpOperationalSignals: string;
  icpDisqualifier1: string;
  icpDisqualifier2: string;
  icpDisqualifier3: string;
  /** @deprecated Prefer companyChats; kept as flatten of active chat for older drafts. */
  chatMessages: ChatMessage[];
  /** Per-company research transcripts keyed by directory company id. */
  companyChats: Record<string, ChatMessage[]>;
  /** Currently selected directory company — null until the student clicks one. */
  selectedCompanyId: string | null;
  /** Cached directory / Data Room order for this attempt. */
  directoryCompanyIds: string[];
  /** Data Room shortlist — directory company ids with status=shortlisted leads. */
  shortlistedCompanyIds: string[];
  openingMessage: string;
  selfCheck: Record<string, boolean>;
  stretchOpen: boolean;
  agentDesign: string;
  agentCorrections: string;
  prospectingHandoffSeen: boolean;
  /** CRM lead id marked as the Prospecting target (status selected). */
  selectedLeadId: string | null;
  /**
   * Bumped when PROSPECTING_STEPS layout changes (see PROSPECTING_STEP_VERSION).
   * normalizeProspectingWizardState migrates older versions forward.
   */
  prospectingStepVersion?: number;
  /** True after the onboarding briefing video has ended (step 0 gate). */
  onboardingComplete: boolean;
  /**
   * True after ICP pre-gate Continue. ICP payload itself lives at stage_data.icp
   * (sibling key), not inside the wizard draft fields.
   */
  icpGateComplete: boolean;
};

export const DEFAULT_PROSPECTING_WIZARD_STATE: ProspectingWizardState = {
  currentStep: 0,
  icpTargetVerticals: "",
  icpSizeMinLocations: "",
  icpSizeMaxLocations: "",
  icpOperationalSignals: "",
  icpDisqualifier1: "",
  icpDisqualifier2: "",
  icpDisqualifier3: "",
  chatMessages: [],
  companyChats: {},
  selectedCompanyId: null,
  directoryCompanyIds: [],
  shortlistedCompanyIds: [],
  openingMessage: "",
  selfCheck: {},
  stretchOpen: false,
  agentDesign: "",
  agentCorrections: "",
  prospectingHandoffSeen: false,
  selectedLeadId: null,
  onboardingComplete: false,
  icpGateComplete: false,
};

/**
 * Parses a location-count input for the ICP size range (positive integer).
 */
export function parseIcpLocationCount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

/**
 * Reads ICP form fields from persisted draft data, with legacy field fallbacks.
 */
export function readIcpFormFields(
  raw: Record<string, unknown>
): Pick<
  ProspectingWizardState,
  | "icpTargetVerticals"
  | "icpSizeMinLocations"
  | "icpSizeMaxLocations"
  | "icpOperationalSignals"
  | "icpDisqualifier1"
  | "icpDisqualifier2"
  | "icpDisqualifier3"
> {
  const str = (key: string): string => (typeof raw[key] === "string" ? raw[key] : "");

  let icpTargetVerticals = str("icpTargetVerticals");
  let icpOperationalSignals = str("icpOperationalSignals");

  if (!icpTargetVerticals && typeof raw.icpField1 === "string") {
    icpTargetVerticals = raw.icpField1;
  }
  if (!icpOperationalSignals && typeof raw.icpField2 === "string") {
    icpOperationalSignals = raw.icpField2;
  }

  return {
    icpTargetVerticals,
    icpSizeMinLocations: str("icpSizeMinLocations"),
    icpSizeMaxLocations: str("icpSizeMaxLocations"),
    icpOperationalSignals,
    icpDisqualifier1: str("icpDisqualifier1"),
    icpDisqualifier2: str("icpDisqualifier2"),
    icpDisqualifier3: str("icpDisqualifier3"),
  };
}

/**
 * Normalizes persisted wizard drafts (including pre-lead-selection 2-step saves).
 */
export function normalizeProspectingWizardState(
  raw: Partial<ProspectingWizardState> | null | undefined
): ProspectingWizardState {
  const anyRaw = (raw ?? {}) as Record<string, unknown>;
  const isLegacy =
    "icpField1" in anyRaw ||
    "triggerEvent" in anyRaw ||
    "researchNotes" in anyRaw ||
    "fitJustification" in anyRaw ||
    (typeof anyRaw.currentStep === "number" && anyRaw.currentStep > 2);

  let step = typeof anyRaw.currentStep === "number" ? anyRaw.currentStep : 0;
  const hasSelectedLeadField = "selectedLeadId" in anyRaw;
  if (isLegacy) {
    step = step >= 4 ? 2 : 0;
  } else if (!hasSelectedLeadField && step === 1) {
    // Pre-select-lead 2-step drafts: Opening was index 1 → now index 2.
    step = 2;
  } else {
    step = Math.min(Math.max(0, step), PROSPECTING_STEPS.length - 1);
  }

  const selectedLeadId =
    typeof anyRaw.selectedLeadId === "string" && anyRaw.selectedLeadId.trim()
      ? anyRaw.selectedLeadId.trim()
      : null;

  const selectedCompanyId =
    typeof anyRaw.selectedCompanyId === "string" && anyRaw.selectedCompanyId.trim()
      ? anyRaw.selectedCompanyId.trim()
      : null;

  const directoryCompanyIds = Array.isArray(anyRaw.directoryCompanyIds)
    ? anyRaw.directoryCompanyIds.filter((id): id is string => typeof id === "string")
    : [];

  const shortlistedCompanyIds = Array.isArray(anyRaw.shortlistedCompanyIds)
    ? anyRaw.shortlistedCompanyIds.filter((id): id is string => typeof id === "string")
    : [];

  const companyChats: Record<string, ChatMessage[]> =
    anyRaw.companyChats && typeof anyRaw.companyChats === "object"
      ? (anyRaw.companyChats as Record<string, ChatMessage[]>)
      : {};

  const legacyMessages = Array.isArray(anyRaw.chatMessages)
    ? (anyRaw.chatMessages as ChatMessage[])
    : [];

  // Migrate pre-directory drafts that only stored a single chatMessages array.
  if (Object.keys(companyChats).length === 0 && legacyMessages.length > 0 && selectedCompanyId) {
    companyChats[selectedCompanyId] = legacyMessages;
  }

  const activeMessages =
    selectedCompanyId && companyChats[selectedCompanyId]
      ? companyChats[selectedCompanyId]
      : legacyMessages;

  const icpRecord = parseProspectingIcpState(anyRaw.icp);
  const icpDone = icpRecord?.feedbackSeen === true;

  const hasRealWizardProgress =
    (typeof anyRaw.currentStep === "number" && anyRaw.currentStep > 0) ||
    (typeof anyRaw.selectedLeadId === "string" && anyRaw.selectedLeadId.trim() !== "") ||
    (typeof anyRaw.icpTargetVerticals === "string" && anyRaw.icpTargetVerticals.trim() !== "") ||
    (typeof anyRaw.icpOperationalSignals === "string" &&
      anyRaw.icpOperationalSignals.trim() !== "") ||
    (typeof anyRaw.icpField1 === "string" && anyRaw.icpField1.trim() !== "") ||
    (typeof anyRaw.icpField2 === "string" && anyRaw.icpField2.trim() !== "") ||
    (typeof anyRaw.fitJustification === "string" && anyRaw.fitJustification.trim() !== "") ||
    (typeof anyRaw.triggerEvent === "string" && anyRaw.triggerEvent.trim() !== "") ||
    (typeof anyRaw.dmName === "string" && anyRaw.dmName.trim() !== "") ||
    shortlistedCompanyIds.length > 0 ||
    directoryCompanyIds.length > 0 ||
    Object.keys(companyChats).length > 0 ||
    legacyMessages.length > 0 ||
    (typeof anyRaw.openingMessage === "string" && anyRaw.openingMessage.trim() !== "") ||
    icpDone;

  const explicitVersion =
    typeof anyRaw.prospectingStepVersion === "number" ? anyRaw.prospectingStepVersion : null;

  const savedVersion =
    explicitVersion !== null
      ? explicitVersion
      : hasRealWizardProgress
        ? 1
        : PROSPECTING_STEP_VERSION;

  let resolvedStep = step;
  let onboardingComplete = Boolean(anyRaw.onboardingComplete);

  if (savedVersion < PROSPECTING_STEP_VERSION) {
    if (icpDone) {
      // v1 → v2: ICP row inserted at index 0 (unchanged behavior).
      if (savedVersion < 2) {
        resolvedStep = Math.min(resolvedStep + 1, PROSPECTING_STEPS.length - 1);
      }
      // v2 → v3: agent row inserted at index 2; steps 0–1 unchanged.
      if (savedVersion < 3 && resolvedStep >= 2) {
        resolvedStep = Math.min(resolvedStep + 1, PROSPECTING_STEPS.length - 1);
      }
    }
    // v3 → v4: onboarding row inserted at index 0; uniform +1 on all saved steps.
    if (savedVersion < 4) {
      resolvedStep = Math.min(resolvedStep + 1, PROSPECTING_STEPS.length - 1);
      onboardingComplete = true;
    }
    // v4 → v5: ICP field schema change only; step indices unchanged.
  }

  const icpFields = readIcpFormFields(anyRaw);

  if (!icpDone) {
    const draftForIcp: ProspectingWizardState = {
      ...DEFAULT_PROSPECTING_WIZARD_STATE,
      ...icpFields,
    };
    if (!isIcpDefinitionComplete(draftForIcp)) {
      resolvedStep = onboardingComplete ? 1 : 0;
    }
  }

  const icpStepComplete = isIcpDefinitionComplete({
    ...DEFAULT_PROSPECTING_WIZARD_STATE,
    ...icpFields,
  });

  return {
    ...DEFAULT_PROSPECTING_WIZARD_STATE,
    chatMessages: activeMessages,
    companyChats,
    selectedCompanyId,
    directoryCompanyIds,
    shortlistedCompanyIds,
    openingMessage: typeof anyRaw.openingMessage === "string" ? anyRaw.openingMessage : "",
    selfCheck:
      anyRaw.selfCheck && typeof anyRaw.selfCheck === "object"
        ? (anyRaw.selfCheck as Record<string, boolean>)
        : {},
    stretchOpen: Boolean(anyRaw.stretchOpen),
    agentDesign: typeof anyRaw.agentDesign === "string" ? anyRaw.agentDesign : "",
    agentCorrections: typeof anyRaw.agentCorrections === "string" ? anyRaw.agentCorrections : "",
    prospectingHandoffSeen: Boolean(anyRaw.prospectingHandoffSeen),
    selectedLeadId,
    ...icpFields,
    currentStep: resolvedStep,
    prospectingStepVersion:
      savedVersion < PROSPECTING_STEP_VERSION
        ? PROSPECTING_STEP_VERSION
        : typeof anyRaw.prospectingStepVersion === "number"
          ? anyRaw.prospectingStepVersion
          : undefined,
    onboardingComplete,
    icpGateComplete: icpStepComplete || icpDone,
  };
}

const STORAGE_PREFIX = "rehearse-prospecting-wizard-";

/**
 * Reads wizard draft state from browser localStorage (fallback when DB column absent).
 */
export function loadProspectingWizardFromStorage(
  attemptId: string
): ProspectingWizardState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${attemptId}`);
    if (!raw) {
      return null;
    }
    return normalizeProspectingWizardState(JSON.parse(raw) as ProspectingWizardState);
  } catch {
    return null;
  }
}

/**
 * Persists wizard draft state to browser localStorage.
 */
export function saveProspectingWizardToStorage(
  attemptId: string,
  state: ProspectingWizardState
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(`${STORAGE_PREFIX}${attemptId}`, JSON.stringify(state));
}

/**
 * Removes wizard draft state from browser localStorage (e.g. on simulation restart).
 */
export function clearProspectingWizardFromStorage(attemptId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(`${STORAGE_PREFIX}${attemptId}`);
}

/**
 * Clears all prospecting wizard drafts from localStorage (Test → Stage 1).
 */
export function clearAllProspectingWizardFromStorage(): void {
  if (typeof window === "undefined") {
    return;
  }
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    window.localStorage.removeItem(key);
  }
}

/**
 * Removes ICP pre-gate payload from persisted stage_data (Test → Stage 1).
 */
export function stripIcpFromStageData(
  stageData: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const next = { ...(stageData ?? {}) };
  delete next.icp;
  next.icpGateComplete = false;
  return next;
}

/**
 * Strips LaTeX/math markup from AI replies for readable plain-text display.
 */
export function sanitizeAiResearchReply(text: string): string {
  const cleanFragment = (fragment: string): string =>
    fragment
      .replace(/\\text\{([^}]*)\}/g, "$1")
      .replace(/\\textbf\{([^}]*)\}/g, "$1")
      .replace(/\\textit\{([^}]*)\}/g, "$1")
      .replace(/\\emph\{([^}]*)\}/g, "$1")
      .replace(/\\%/g, "%")
      .replace(/\\-/g, "-")
      .replace(/\\,/g, " ")
      .replace(/\\;/g, " ")
      .replace(/\\quad/g, " ")
      .replace(/\\[a-zA-Z]+/g, "")
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  return text
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, inner: string) => cleanFragment(inner))
    .replace(/\$([^$\n]+?)\$/g, (_, inner: string) => cleanFragment(inner))
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\textbf\{([^}]*)\}/g, "$1")
    .replace(/\\%/g, "%")
    .replace(/\\-/g, "-")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Counts words in the opening message draft.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

/**
 * Minimum trimmed character counts for ICP step advance (see isIcpDefinitionComplete).
 */
export const ICP_MIN_TARGET_VERTICALS_CHARS = 10;
export const ICP_MIN_OPERATIONAL_SIGNALS_CHARS = 20;
export const ICP_MIN_DISQUALIFIER_CHARS = 3;

/**
 * Returns whether the ICP form (step 1) meets advance requirements.
 */
export function isIcpDefinitionComplete(state: ProspectingWizardState): boolean {
  const minLoc = parseIcpLocationCount(state.icpSizeMinLocations);
  const maxLoc = parseIcpLocationCount(state.icpSizeMaxLocations);
  const filledDisqualifiers = [
    state.icpDisqualifier1,
    state.icpDisqualifier2,
    state.icpDisqualifier3,
  ].filter((value) => value.trim().length >= ICP_MIN_DISQUALIFIER_CHARS);

  return (
    state.icpTargetVerticals.trim().length >= ICP_MIN_TARGET_VERTICALS_CHARS &&
    minLoc !== null &&
    maxLoc !== null &&
    maxLoc >= minLoc &&
    state.icpOperationalSignals.trim().length >= ICP_MIN_OPERATIONAL_SIGNALS_CHARS &&
    filledDisqualifiers.length >= 2
  );
}

/**
 * Returns whether the student can advance from the current wizard step.
 * Indices: Onboarding (0) → ICP (1) → Data Room (2) → Agent (3) → Lead (4) → Opening (5).
 */
export function canAdvanceProspectingStep(
  stepIndex: number,
  state: ProspectingWizardState
): boolean {
  switch (stepIndex) {
    case 0:
      return state.onboardingComplete;
    case 1:
      return isIcpDefinitionComplete(state);
    case 2:
      return state.shortlistedCompanyIds.length === 3;
    case 3:
      return true;
    case 4:
      return Boolean(state.selectedLeadId);
    case 5:
      return canSubmitProspectingBrief(state);
    default:
      return false;
  }
}

/**
 * Returns whether Opening Message submit is enabled.
 */
export function canSubmitProspectingBrief(state: ProspectingWizardState): boolean {
  const words = countWords(state.openingMessage);
  return words >= 20 && words <= 120;
}
