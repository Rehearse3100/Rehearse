/**
 * useNegotiationStage.ts
 * State, GPT turn-taking, draft persistence, and submit for Tempo Stage 5 Negotiation.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { completeStage } from "@/lib/attempt-actions";
import { SCENARIO_A_SYSTEM_PROMPT, SCENARIO_B_SYSTEM_PROMPT } from "@/lib/constants";
import {
  canSubmitNegotiation,
  createInitialNegotiationData,
  loadNegotiationFromStorage,
  parseNegotiationOutcome,
  saveNegotiationToStorage,
  wordCount,
  type NegotiationScenario,
  type NegotiationScenarioData,
  type NegotiationStageData,
  type NegotiationTurn,
  type ScenarioState,
} from "@/lib/tempo-negotiation";
import {
  applyNegotiationAutofill,
  TEST_BYPASS_PREFIX,
} from "@/lib/tempo-test-bypass-client";
import type { ChatMessage } from "@/types";

type UseNegotiationStageOptions = {
  attemptId: string;
  simulationId: string;
  classId: string;
  /** Server page boolean from TEMPO_TEST_BYPASS_GATES — never from client env. */
  testBypass?: boolean;
};

type UseNegotiationStageResult = {
  data: NegotiationStageData;
  currentResponse: string;
  setCurrentResponse: (value: string) => void;
  isLoading: boolean;
  isSaving: boolean;
  isLoadingTurn: boolean;
  isSubmitting: boolean;
  aiWorkOpen: boolean;
  setAiWorkOpen: (open: boolean) => void;
  rightTab: number;
  setRightTab: (tab: number) => void;
  activeScenario: NegotiationScenario;
  scenarioAState: ScenarioState;
  scenarioBState: ScenarioState;
  scenarioAData: NegotiationScenarioData;
  scenarioBData: NegotiationScenarioData;
  currentTurnIndex: number;
  canSubmit: boolean;
  setActiveScenario: (scenario: NegotiationScenario) => void;
  setAiWork: (field: "prompts" | "corrections", value: string) => void;
  handleSendTurn: () => Promise<void>;
  handleContinueToScenarioB: () => void;
  handleSaveDraft: () => void;
  handleSubmit: () => Promise<void>;
};

function getScenarioData(data: NegotiationStageData, scenario: NegotiationScenario): NegotiationScenarioData {
  return scenario === "A" ? data.scenarioA : data.scenarioB;
}

function buildChatHistory(turns: NegotiationTurn[], turnIndex: number): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (let i = 0; i < turnIndex; i += 1) {
    if (turns[i]?.kimMessage.trim()) {
      messages.push({ role: "assistant", content: turns[i].kimMessage.trim() });
    }
    if (turns[i]?.studentResponse.trim()) {
      messages.push({ role: "user", content: turns[i].studentResponse.trim() });
    }
  }

  const currentKim = turns[turnIndex]?.kimMessage.trim();
  if (currentKim) {
    messages.push({ role: "assistant", content: currentKim });
  }

  return messages;
}

/**
 * Manages negotiation scenarios, GPT exchanges, AI work, and stage submission.
 */
export function useNegotiationStage({
  attemptId,
  simulationId,
  classId: _classId,
  testBypass = false,
}: UseNegotiationStageOptions): UseNegotiationStageResult {
  const router = useRouter();
  const [data, setData] = useState<NegotiationStageData>(createInitialNegotiationData);
  const [currentResponse, setCurrentResponse] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingTurn, setIsLoadingTurn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiWorkOpen, setAiWorkOpen] = useState(false);
  const [rightTab, setRightTab] = useState(0);

  const persistData = useCallback(
    (next: NegotiationStageData): void => {
      saveNegotiationToStorage(attemptId, next);
      setIsSaving(true);
      window.setTimeout(() => setIsSaving(false), 400);
    },
    [attemptId]
  );

  useEffect(() => {
    const stored = loadNegotiationFromStorage(attemptId);
    const base = stored ?? createInitialNegotiationData();
    const next = testBypass ? applyNegotiationAutofill(base) : base;
    setData(next);
    if (testBypass) {
      persistData(next);
    }
    setIsLoading(false);
  }, [attemptId, persistData, testBypass]);

  useEffect(() => {
    if (
      data.scenarioAState === "complete" &&
      data.scenarioBState === "complete" &&
      !aiWorkOpen
    ) {
      setAiWorkOpen(true);
    }
  }, [data.scenarioAState, data.scenarioBState, aiWorkOpen]);

  const setActiveScenario = useCallback(
    (scenario: NegotiationScenario): void => {
      setData((prev) => {
        const next = { ...prev, activeScenario: scenario };
        persistData(next);
        return next;
      });
      setCurrentResponse("");
    },
    [persistData]
  );

  const setAiWork = useCallback(
    (field: "prompts" | "corrections", value: string): void => {
      setData((prev) => {
        const next = {
          ...prev,
          aiWork: { ...prev.aiWork, [field]: value },
        };
        persistData(next);
        return next;
      });
    },
    [persistData]
  );

  const handleContinueToScenarioB = useCallback((): void => {
    setData((prev) => {
      const next: NegotiationStageData = {
        ...prev,
        activeScenario: "B",
        scenarioBState: "active",
        scenarioB: {
          ...prev.scenarioB,
          turns: prev.scenarioB.turns.map((turn, index) =>
            index === 0 ? { ...turn, state: "active" } : turn
          ) as NegotiationScenarioData["turns"],
        },
      };
      persistData(next);
      return next;
    });
    setCurrentResponse("");
  }, [persistData]);

  const handleSaveDraft = useCallback((): void => {
    persistData(data);
  }, [data, persistData]);

  const handleSendTurn = useCallback(async (): Promise<void> => {
    const responseText = currentResponse.trim()
      ? currentResponse.trim()
      : testBypass
        ? `${TEST_BYPASS_PREFIX} Holding price and reframing ROI against the cheaper alternative.`
        : "";

    if (isLoadingTurn || (!testBypass && wordCount(responseText) < 40)) {
      return;
    }

    const scenario = data.activeScenario;
    const scenarioData = getScenarioData(data, scenario);
    const turnIndex = scenarioData.turns.findIndex((turn) => turn.state === "active");
    if (turnIndex < 0) {
      return;
    }

    setIsLoadingTurn(true);
    try {
      const systemPrompt = scenario === "A" ? SCENARIO_A_SYSTEM_PROMPT : SCENARIO_B_SYSTEM_PROMPT;
      const messages = buildChatHistory(scenarioData.turns, turnIndex);
      const isLastTurn = turnIndex === 2;

      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          newMessage: responseText,
          systemPrompt,
        }),
      });

      if (!chatRes.ok) {
        const errBody = (await chatRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Chat failed (${chatRes.status})`);
      }

      const { reply } = (await chatRes.json()) as { reply: string };
      const updatedTurns = [...scenarioData.turns] as NegotiationScenarioData["turns"];
      updatedTurns[turnIndex] = {
        ...updatedTurns[turnIndex],
        studentResponse: responseText,
        state: "submitted",
      };

      let outcome = scenarioData.outcome;

      if (isLastTurn) {
        const parsed = parseNegotiationOutcome(reply);
        outcome = parsed.outcome ?? {
          status: "partial_close",
          message: parsed.kimTail || reply.trim(),
        };
      } else {
        updatedTurns[turnIndex + 1] = {
          ...updatedTurns[turnIndex + 1],
          kimMessage: reply.trim(),
          state: "active",
        };
      }

      const nextScenarioData: NegotiationScenarioData = {
        turns: updatedTurns,
        outcome: isLastTurn ? outcome : scenarioData.outcome,
      };

      setData((prev) => {
        const nextScenarioAState =
          scenario === "A" && isLastTurn ? "complete" : prev.scenarioAState;
        const nextScenarioBState =
          scenario === "B" && isLastTurn ? "complete" : prev.scenarioBState;

        const next: NegotiationStageData = {
          ...prev,
          scenarioAState: nextScenarioAState,
          scenarioBState: nextScenarioBState,
          scenarioA: scenario === "A" ? nextScenarioData : prev.scenarioA,
          scenarioB: scenario === "B" ? nextScenarioData : prev.scenarioB,
        };
        persistData(next);
        return next;
      });
      setCurrentResponse("");
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingTurn(false);
    }
  }, [currentResponse, data, isLoadingTurn, persistData, testBypass]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    let submitData = data;
    if (testBypass) {
      submitData = applyNegotiationAutofill(data);
      setData(submitData);
      persistData(submitData);
    }
    if (!canSubmitNegotiation(submitData, testBypass) || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = JSON.stringify({
        scenarioA: submitData.scenarioA,
        scenarioB: submitData.scenarioB,
        aiWork: submitData.aiWork,
        submittedAt: new Date().toISOString(),
      });

      await completeStage(attemptId, "close", 0, "Submitted — scoring coming soon", payload);
      router.push(`/student/simulation/${simulationId}/complete?attempt=${attemptId}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [attemptId, data, isSubmitting, persistData, router, simulationId, testBypass]);

  const scenarioAData = data.scenarioA;
  const scenarioBData = data.scenarioB;
  const activeScenarioData = getScenarioData(data, data.activeScenario);
  const currentTurnIndex = activeScenarioData.turns.findIndex((turn) => turn.state === "active");

  return {
    data,
    currentResponse,
    setCurrentResponse,
    isLoading,
    isSaving,
    isLoadingTurn,
    isSubmitting,
    aiWorkOpen,
    setAiWorkOpen,
    rightTab,
    setRightTab,
    activeScenario: data.activeScenario,
    scenarioAState: data.scenarioAState,
    scenarioBState: data.scenarioBState,
    scenarioAData,
    scenarioBData,
    currentTurnIndex,
    canSubmit: canSubmitNegotiation(data, testBypass),
    setActiveScenario,
    setAiWork,
    handleSendTurn,
    handleContinueToScenarioB,
    handleSaveDraft,
    handleSubmit,
  };
}
