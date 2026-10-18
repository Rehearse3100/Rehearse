/**
 * useProspectingWizard.ts
 * State and persistence for the Tempo Stage 1 Prospecting wizard.
 * Research step uses company-directory scoped chats (per-company history).
 * ICP review: Next on the ICP step sends the ICP to /api/student/icp-check
 * (graded once) and the manager's note shows until Continue marks it seen; a seen
 * note means Next simply moves on. The note is loaded with the draft on resume.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IcpNoteView } from "@/lib/icp-grading";
import { completeStage } from "@/lib/attempt-actions";
import type { ProspectDirectoryCompany } from "@/lib/tempo-prospect-directory";
import {
  canAdvanceProspectingStep,
  canSubmitProspectingBrief,
  countWords,
  formatIcpTextForFeedback,
  DEFAULT_PROSPECTING_WIZARD_STATE,
  ICP_FORM_FIELD_KEYS,
  isIcpDefinitionComplete,
  loadProspectingWizardFromStorage,
  normalizeProspectingWizardState,
  prospectingStepIndex,
  saveProspectingWizardToStorage,
  sanitizeAiResearchReply,
  type ProspectingStepId,
  type ProspectingWizardState,
} from "@/lib/tempo-prospecting";
import { stripWizardTestAutofill } from "@/lib/tempo-test-bypass-client";
import type { ChatMessage } from "@/types";

type UseProspectingWizardOptions = {
  attemptId: string;
  /**
   * Server page prop from TEMPO_TEST_BYPASS_GATES — never read process.env here.
   * This boolean is the sole client-side source of truth for gate short-circuits.
   */
  testBypass?: boolean;
};

type UseProspectingWizardResult = {
  state: ProspectingWizardState;
  isLoading: boolean;
  isSaving: boolean;
  isSubmitting: boolean;
  isAILoading: boolean;
  chatInput: string;
  setChatInput: (value: string) => void;
  setCurrentStepId: (stepId: ProspectingStepId) => void;
  updateField: <K extends keyof ProspectingWizardState>(
    key: K,
    value: ProspectingWizardState[K]
  ) => void;
  selectDirectoryCompany: (companyId: string) => void;
  setDirectoryCompanies: (companies: ProspectDirectoryCompany[]) => void;
  /** Syncs Data Room shortlist company ids for step-advance gating. */
  setShortlistedCompanyIds: (companyIds: string[]) => void;
  toggleSelfCheck: (id: string, checked: boolean) => void;
  canProceed: boolean;
  canSubmit: boolean;
  wordCount: number;
  testBypass: boolean;
  handleStepAdvance: (nextStepId: ProspectingStepId) => Promise<void>;
  /** Marks a CRM lead as selected and advances to Opening Message. */
  completeLeadSelection: (leadId: string) => Promise<void>;
  handleSendMessage: () => Promise<void>;
  handleSubmit: () => Promise<void>;
  dismissProspectingHandoff: () => void;
  /** Called when the onboarding briefing video ends. */
  completeOnboarding: () => void;
  /** The manager's note on the ICP (note and state only); null until reviewed. */
  icpNote: IcpNoteView | null;
  isReviewingIcp: boolean;
  isContinuingIcp: boolean;
  /** Shown when the review request itself fails (the student can try again). */
  icpReviewError: string;
  /** Next on the ICP step: review it (once), continue past a shown note, or move on. */
  advanceFromIcp: () => Promise<void>;
  /** Continue to research: marks the note seen and moves to the research step. */
  continueFromIcpNote: () => Promise<void>;
};

const ICP_REVIEW_ERROR = "Could not review your ICP right now. Try again.";

/** Reads the note from the icp-check API (GET returns { icp }, POST the view itself). */
function readIcpNoteView(raw: unknown): IcpNoteView | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const { status, note, feedbackSeen } = raw as Record<string, unknown>;
  if ((status !== "graded" && status !== "ungraded") || typeof note !== "string") {
    return null;
  }
  return { status, note, feedbackSeen: feedbackSeen === true };
}

/**
 * Manages prospecting wizard state, scoped research chat, save, and submit flows.
 */
export function useProspectingWizard({
  attemptId,
  testBypass = false,
}: UseProspectingWizardOptions): UseProspectingWizardResult {
  const [state, setState] = useState<ProspectingWizardState>(DEFAULT_PROSPECTING_WIZARD_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAILoading, setIsAILoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [icpNote, setIcpNote] = useState<IcpNoteView | null>(null);
  const [isReviewingIcp, setIsReviewingIcp] = useState(false);
  const [isContinuingIcp, setIsContinuingIcp] = useState(false);
  const [icpReviewError, setIcpReviewError] = useState("");
  const directoryRef = useRef<ProspectDirectoryCompany[]>([]);

  const persistState = useCallback(
    async (next: ProspectingWizardState): Promise<void> => {
      saveProspectingWizardToStorage(attemptId, next);
      setIsSaving(true);
      try {
        await fetch("/api/student/prospecting-wizard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId, state: next }),
        });
      } catch {
        /* localStorage fallback remains */
      } finally {
        setIsSaving(false);
      }
    },
    [attemptId]
  );

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const local = loadProspectingWizardFromStorage(attemptId);
      try {
        // The saved ICP note loads with the draft, so Next on the ICP step never
        // reviews an ICP that already has one. Its failure just means no note yet.
        const [wizardRes, icpView] = await Promise.all([
          fetch(`/api/student/prospecting-wizard?attemptId=${encodeURIComponent(attemptId)}`),
          fetch(`/api/student/icp-check?attemptId=${encodeURIComponent(attemptId)}`)
            .then(async (res) => (res.ok ? readIcpNoteView(((await res.json()) as { icp?: unknown }).icp) : null))
            .catch(() => null),
        ]);
        if (!cancelled) {
          setIcpNote(icpView);
        }

        let nextState = local ? normalizeProspectingWizardState(local) : DEFAULT_PROSPECTING_WIZARD_STATE;
        if (wizardRes.ok) {
          const body = (await wizardRes.json()) as {
            state: ProspectingWizardState;
          };
          nextState = normalizeProspectingWizardState(body.state);
          // testBypass comes only from the server page prop — never from this API body.
        }

        // Bypass off: strip [TEST] leftovers from API/local draft before they reach the UI.
        let strippedTestAutofill = false;
        if (!testBypass) {
          const stripped = stripWizardTestAutofill(nextState);
          strippedTestAutofill = JSON.stringify(stripped) !== JSON.stringify(nextState);
          nextState = stripped;
        }

        const icpFieldsDone = isIcpDefinitionComplete(nextState);
        // Keep Welcome first until onboarding is marked complete (video end or Next under
        // testBypass). Autofill must not skip onboarding; canAdvance still unlocks Next.
        const pastIcp =
          nextState.currentStepId !== "onboarding" && nextState.currentStepId !== "icp";
        nextState = {
          ...nextState,
          icpGateComplete: icpFieldsDone,
          currentStepId: !nextState.onboardingComplete
            ? "onboarding"
            : !icpFieldsDone && pastIcp
              ? "icp"
              : nextState.currentStepId,
        };
        saveProspectingWizardToStorage(attemptId, nextState);
        if (strippedTestAutofill) {
          void persistState(nextState);
        }

        if (!cancelled) {
          setState(nextState);
        }
      } catch {
        if (local && !cancelled) {
          const fallback = testBypass
            ? normalizeProspectingWizardState(local)
            : stripWizardTestAutofill(normalizeProspectingWizardState(local));
          setState(fallback);
          saveProspectingWizardToStorage(attemptId, fallback);
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
  }, [attemptId, persistState, testBypass]);

  const updateField = useCallback(
    <K extends keyof ProspectingWizardState>(key: K, value: ProspectingWizardState[K]): void => {
      setState((prev) => {
        const next = { ...prev, [key]: value };
        if ((ICP_FORM_FIELD_KEYS as readonly string[]).includes(key)) {
          next.icpGateComplete = isIcpDefinitionComplete(next);
        }
        void persistState(next);
        return next;
      });
    },
    [persistState]
  );

  const completeOnboarding = useCallback((): void => {
    setState((prev) => {
      if (prev.onboardingComplete) {
        return prev;
      }
      const next = { ...prev, onboardingComplete: true };
      void persistState(next);
      return next;
    });
  }, [persistState]);

  const setCurrentStepId = useCallback(
    (stepId: ProspectingStepId): void => {
      const targetIndex = prospectingStepIndex(stepId);
      if (targetIndex < 0) {
        return;
      }
      if (!testBypass && targetIndex > 0 && !state.onboardingComplete) {
        return;
      }
      if (!testBypass && targetIndex > 1 && !isIcpDefinitionComplete(state)) {
        return;
      }
      updateField("currentStepId", stepId);
    },
    [testBypass, state, updateField]
  );

  /**
   * Stores the public directory list locally and caches id order on the attempt draft.
   */
  const setDirectoryCompanies = useCallback(
    (companies: ProspectDirectoryCompany[]): void => {
      directoryRef.current = companies;
      const ids = companies.map((c) => c.id);
      setState((prev) => {
        if (
          prev.directoryCompanyIds.length === ids.length &&
          prev.directoryCompanyIds.every((id, i) => id === ids[i])
        ) {
          return prev;
        }
        const next = { ...prev, directoryCompanyIds: ids };
        void persistState(next);
        return next;
      });
    },
    [persistState]
  );

  /**
   * Syncs Data Room shortlist company ids used by canAdvanceProspectingStep.
   */
  const setShortlistedCompanyIds = useCallback(
    (companyIds: string[]): void => {
      setState((prev) => {
        if (
          prev.shortlistedCompanyIds.length === companyIds.length &&
          prev.shortlistedCompanyIds.every((id, i) => id === companyIds[i])
        ) {
          return prev;
        }
        const next = { ...prev, shortlistedCompanyIds: companyIds };
        void persistState(next);
        return next;
      });
    },
    [persistState]
  );

  /**
   * Selects a directory company for scoped chat. Does not clear other companies' histories.
   */
  const selectDirectoryCompany = useCallback(
    (companyId: string): void => {
      setChatInput("");
      setState((prev) => {
        const messages = prev.companyChats[companyId] ?? [];
        const next = {
          ...prev,
          selectedCompanyId: companyId,
          chatMessages: messages,
        };
        void persistState(next);
        return next;
      });
    },
    [persistState]
  );

  const toggleSelfCheck = useCallback(
    (id: string, checked: boolean): void => {
      setState((prev) => {
        const next = {
          ...prev,
          selfCheck: { ...prev.selfCheck, [id]: checked },
        };
        if (id === "wordCount") {
          next.selfCheck.wordCount = countWords(prev.openingMessage) <= 120;
        }
        void persistState(next);
        return next;
      });
    },
    [persistState]
  );

  const handleStepAdvance = useCallback(
    async (nextStepId: ProspectingStepId): Promise<void> => {
      // Leaving Welcome Briefing counts as onboarding complete (video end OR Next
      // under testBypass, which unlocks Next without waiting for ended).
      const next = {
        ...state,
        currentStepId: nextStepId,
        onboardingComplete:
          state.currentStepId === "onboarding" && nextStepId !== "onboarding"
            ? true
            : state.onboardingComplete,
      };
      setState(next);
      await persistState(next);
    },
    [persistState, state]
  );

  const continueFromIcpNote = useCallback(async (): Promise<void> => {
    setIsContinuingIcp(true);
    try {
      await fetch("/api/student/icp-check", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, feedbackSeen: true }),
      });
    } catch {
      /* the local continue still moves on; the note shows again on resume */
    }
    setIcpNote((prev) => (prev ? { ...prev, feedbackSeen: true } : prev));
    try {
      await handleStepAdvance("research");
    } finally {
      setIsContinuingIcp(false);
    }
  }, [attemptId, handleStepAdvance]);

  const advanceFromIcp = useCallback(async (): Promise<void> => {
    if (isReviewingIcp || isContinuingIcp) {
      return;
    }
    // Seen: move on as before. Showing: Next works like Continue. Never re-graded.
    if (icpNote?.feedbackSeen) {
      await handleStepAdvance("research");
      return;
    }
    if (icpNote) {
      await continueFromIcpNote();
      return;
    }
    if (!isIcpDefinitionComplete(state)) {
      // Test bypass moves on without a complete ICP, as before (nothing to review).
      if (testBypass) {
        await handleStepAdvance("research");
      }
      return;
    }

    setIsReviewingIcp(true);
    setIcpReviewError("");
    try {
      const res = await fetch("/api/student/icp-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId,
          icpText: formatIcpTextForFeedback(state),
          fields: Object.fromEntries(ICP_FORM_FIELD_KEYS.map((key) => [key, state[key]])),
        }),
      });
      const view = res.ok ? readIcpNoteView(await res.json()) : null;
      if (!view) {
        throw new Error("ICP review failed");
      }
      setIcpNote(view);
      if (view.feedbackSeen) {
        await handleStepAdvance("research");
      }
    } catch {
      setIcpReviewError(ICP_REVIEW_ERROR);
    } finally {
      setIsReviewingIcp(false);
    }
  }, [
    attemptId,
    continueFromIcpNote,
    handleStepAdvance,
    icpNote,
    isContinuingIcp,
    isReviewingIcp,
    state,
    testBypass,
  ]);

  /**
   * Persists the validated target lead. Does not advance the step — Next uses the gate.
   */
  const completeLeadSelection = useCallback(
    async (leadId: string): Promise<void> => {
      setState((prev) => {
        const next = {
          ...prev,
          selectedLeadId: leadId,
        };
        void persistState(next);
        return next;
      });
    },
    [persistState]
  );

  const handleSendMessage = useCallback(async (): Promise<void> => {
    const trimmed = chatInput.trim();
    const companyId = state.selectedCompanyId;
    if (!trimmed || isAILoading || !companyId) {
      return;
    }

    const company =
      directoryRef.current.find((c) => c.id === companyId) ?? null;
    if (!company) {
      return;
    }

    const prior = state.companyChats[companyId] ?? [];
    const userMessage: ChatMessage = { role: "user", content: trimmed };
    const nextMessages = [...prior, userMessage];
    setChatInput("");
    setState((prev) => ({
      ...prev,
      companyChats: { ...prev.companyChats, [companyId]: nextMessages },
      chatMessages: nextMessages,
    }));
    setIsAILoading(true);

    try {
      const res = await fetch("/api/student/prospect-research-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId,
          companyId,
          messages: nextMessages.slice(0, -1),
          newMessage: trimmed,
        }),
      });

      if (!res.ok) {
        throw new Error("AI request failed");
      }

      const body = (await res.json()) as { reply: string };
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: sanitizeAiResearchReply(body.reply),
      };
      setState((prev) => {
        const withReply = [...nextMessages, assistantMessage];
        const next = {
          ...prev,
          companyChats: { ...prev.companyChats, [companyId]: withReply },
          chatMessages: withReply,
        };
        void persistState(next);
        return next;
      });
    } catch {
      setState((prev) => {
        const withError: ChatMessage[] = [
          ...nextMessages,
          {
            role: "assistant",
            content: "Sorry, I couldn't respond right now. Try again in a moment.",
          },
        ];
        return {
          ...prev,
          companyChats: { ...prev.companyChats, [companyId]: withError },
          chatMessages: withError,
        };
      });
    } finally {
      setIsAILoading(false);
    }
  }, [
    attemptId,
    chatInput,
    isAILoading,
    persistState,
    state.companyChats,
    state.selectedCompanyId,
  ]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!canSubmitProspectingBrief(state, testBypass)) {
      return;
    }

    setIsSubmitting(true);
    try {
      const transcript = JSON.stringify({
        icpTargetVerticals: state.icpTargetVerticals,
        icpDecisionMakerRole: state.icpDecisionMakerRole,
        icpSizeMinLocations: state.icpSizeMinLocations,
        icpSizeMaxLocations: state.icpSizeMaxLocations,
        icpOperationalSignals: state.icpOperationalSignals,
        icpDisqualifier1: state.icpDisqualifier1,
        icpDisqualifier2: state.icpDisqualifier2,
        icpDisqualifier3: state.icpDisqualifier3,
        icpTextForFeedback: formatIcpTextForFeedback(state),
        companyChats: state.companyChats,
        selectedCompanyId: state.selectedCompanyId,
        chatMessages: state.chatMessages,
        openingMessage: state.openingMessage,
        selfCheck: state.selfCheck,
        agentDesign: state.agentDesign,
      });

      await completeStage(
        attemptId,
        "prospecting",
        0,
        "Submitted. Scoring coming soon",
        transcript
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [attemptId, testBypass, state]);

  const dismissProspectingHandoff = useCallback((): void => {
    setState((prev) => {
      const next = {
        ...prev,
        prospectingHandoffSeen: true,
        onboardingComplete: false,
        currentStepId: "onboarding" as const,
      };
      void persistState(next);
      return next;
    });
  }, [persistState]);

  const wordCount = countWords(state.openingMessage);
  const canProceed = canAdvanceProspectingStep(state.currentStepId, state, testBypass);
  const canSubmit = canSubmitProspectingBrief(state, testBypass);

  return {
    state,
    isLoading,
    isSaving,
    isSubmitting,
    isAILoading,
    chatInput,
    setChatInput,
    setCurrentStepId,
    updateField,
    selectDirectoryCompany,
    setDirectoryCompanies,
    setShortlistedCompanyIds,
    toggleSelfCheck,
    canProceed,
    canSubmit,
    wordCount,
    testBypass,
    handleStepAdvance,
    completeLeadSelection,
    handleSendMessage,
    handleSubmit,
    dismissProspectingHandoff,
    completeOnboarding,
    icpNote,
    isReviewingIcp,
    isContinuingIcp,
    icpReviewError,
    advanceFromIcp,
    continueFromIcpNote,
  };
}
