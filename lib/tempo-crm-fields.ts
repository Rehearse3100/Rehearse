/**
 * tempo-crm-fields.ts
 * Single source of truth for Tempo CRM opportunity log field schemas.
 * Gate logic uses stageRequiresCrmLog() — stages with no schema are never gated.
 * Prospecting fields live on Leads (convert gate), not on Opportunity logs.
 */

export type CrmStageFieldDef = {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
  prefix?: string;
};

export const CRM_STAGE_FIELD_SCHEMA: Record<
  "discovery" | "presentation" | "objections" | "close",
  CrmStageFieldDef[]
> = {
  discovery: [
    {
      key: "businessIssue",
      label: "Business Issue Identified",
      placeholder: "Type your answer",
    },
    {
      key: "quantifiedValue",
      label: "Quantified Value, if known",
      placeholder: "Type your answer",
      prefix: "$",
    },
    {
      key: "painPoints",
      label: "Key Pain Points",
      placeholder:
        "Describe the specific technical or operational hurdles the client is facing...",
      multiline: true,
    },
    {
      key: "stakeholders",
      label: "Other Stakeholders Involved",
      placeholder: "Type your answer",
    },
    {
      key: "nextStep",
      label: "Next Step",
      placeholder: "Type your answer",
    },
  ],
  presentation: [
    {
      key: "whatProposed",
      label: "What You Proposed",
      placeholder: "Type your answer",
      multiline: true,
    },
    {
      key: "stakeholderReaction",
      label: "Stakeholder Reaction",
      placeholder: "Type your answer",
      multiline: true,
    },
    {
      key: "anticipatedObjections",
      label: "Anticipated Objections",
      placeholder: "Type your answer",
      multiline: true,
    },
    {
      key: "nextStep",
      label: "Next Step",
      placeholder: "Type your answer",
    },
  ],
  objections: [
    {
      key: "objectionsRaised",
      label: "Objections Raised",
      placeholder: "Type your answer",
      multiline: true,
    },
    {
      key: "howResolved",
      label: "How You Resolved Them",
      placeholder: "Type your answer",
      multiline: true,
    },
    {
      key: "remainingConcerns",
      label: "Remaining Concerns",
      placeholder: "Type your answer",
      multiline: true,
    },
    {
      key: "nextStep",
      label: "Next Step",
      placeholder: "Type your answer",
    },
  ],
  close: [
    {
      key: "termsDiscussed",
      label: "Terms Discussed",
      placeholder: "Type your answer",
      multiline: true,
    },
    {
      key: "outcome",
      label: "Outcome",
      placeholder: "Type your answer",
    },
    {
      key: "closeNotes",
      label: "Close Notes",
      placeholder: "Type your answer",
      multiline: true,
    },
  ],
};

/** Field keys per stage — used by gate checks and badge/CRM consumers. */
export const CRM_STAGE_FIELDS: Record<string, string[]> = {
  discovery: CRM_STAGE_FIELD_SCHEMA.discovery.map((f) => f.key),
  presentation: CRM_STAGE_FIELD_SCHEMA.presentation.map((f) => f.key),
  objections: CRM_STAGE_FIELD_SCHEMA.objections.map((f) => f.key),
  close: CRM_STAGE_FIELD_SCHEMA.close.map((f) => f.key),
};

/**
 * Ordered Tempo stages for handoff “just completed” mapping (includes Prospecting
 * so stageNumber → completed-stage still resolves; Prospecting has no CRM log schema
 * and conversion is automatic on stage completion).
 */
export const CRM_TEMPO_STAGE_ORDER = [
  "prospecting",
  "discovery",
  "presentation",
  "objections",
  "close",
] as const;

/**
 * True when this stage has a non-empty CRM field schema (must be logged before advancing).
 */
export function stageRequiresCrmLog(stage: string): boolean {
  return stage in CRM_STAGE_FIELDS && CRM_STAGE_FIELDS[stage].length > 0;
}

/**
 * Maps HandoffModal “up next” stage number (1–5) to the just-completed stage that may need a CRM log.
 * Stage 1 (Prospecting intro) has no prior stage → null (no gate).
 */
export function justCompletedStageForHandoff(stageNumber: number): string | null {
  const idx = stageNumber - 2;
  if (idx < 0 || idx >= CRM_TEMPO_STAGE_ORDER.length) {
    return null;
  }
  return CRM_TEMPO_STAGE_ORDER[idx];
}

/**
 * Most recent completed schema stage that still lacks a CRM log row, or null.
 * Does not cover Lead conversion — conversion is automatic on Prospecting completion.
 */
export function findStageNeedingCrmLog(
  completedStages: readonly string[],
  loggedStages: ReadonlySet<string>
): string | null {
  let needing: string | null = null;
  for (const stage of CRM_TEMPO_STAGE_ORDER) {
    if (
      stage !== "prospecting" &&
      completedStages.includes(stage) &&
      stageRequiresCrmLog(stage) &&
      !loggedStages.has(stage)
    ) {
      needing = stage;
    }
  }
  return needing;
}
