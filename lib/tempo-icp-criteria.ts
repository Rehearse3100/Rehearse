/**
 * tempo-icp-criteria.ts
 * Config-only ICP grading criteria and manager-note copy for Tempo Prospecting.
 * Keep abstract — no Summit Dental / Dana Reyes / named accounts.
 */

export const TEMPO_ICP_CRITERIA = `
    A correct ICP for Tempo should identify:
    - Multi-location, appointment-based service businesses (dental,
      veterinary, physical therapy, optometry, med spa, chiropractic,
      or similar)
    - Enough scale that manual scheduling coordination genuinely breaks
      down (not a single-location shop where phone scheduling is still
      manageable)
    - Currently scheduling manually/by phone — NOT already using a
      competitor's tool with no complaints
    - Experiencing real, current operational strain or growth pressure —
      not steady-state, comfortable operations
    - A buyer with real authority over operations/tooling decisions —
      not just whoever happens to answer the phone
    - Decision-maker role names an operations-level role that owns
      scheduling and front-desk processes (not a generic "anyone" or
      pure clinical title with no ops ownership)

    Common WRONG patterns to catch:
    - Too generic ("any healthcare business") with no real filtering logic
    - Focused on company size/prestige rather than actual pain signals
    - Misses the "currently manual scheduling" requirement
    - Misses the "real trigger/strain happening now" requirement
  `;

export const TEMPO_ICP_CORRECTED_TEXT =
  "Here's a sharper way to frame this: look for multi-location, " +
  "appointment-based businesses — think dental, vet, physical " +
  "therapy, that kind of thing — where scheduling is still manual, " +
  "and where something recent is putting real strain on operations. " +
  "A company that's comfortable and stable isn't your target. A " +
  "company that's stretched right now is.";

export const TEMPO_ICP_AFFIRMED_TEXT =
  "That's a solid filter — you're thinking about the right signals. " +
  "Carry this forward as you start researching real accounts.";

export type IcpCheckResult = "affirmed" | "corrected";

/** Persisted under attempts.stage_data.icp */
export type ProspectingIcpState = {
  originalText: string;
  result: IcpCheckResult;
  displayText: string;
  activeIcpText: string;
  /** True after the student clicks Continue on the manager feedback card. */
  feedbackSeen: boolean;
};

/**
 * Narrows unknown stage_data.icp into ProspectingIcpState, or null.
 */
export function parseProspectingIcpState(raw: unknown): ProspectingIcpState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const result = obj.result === "affirmed" || obj.result === "corrected" ? obj.result : null;
  if (!result) {
    return null;
  }
  const originalText = typeof obj.originalText === "string" ? obj.originalText : "";
  const displayText = typeof obj.displayText === "string" ? obj.displayText : "";
  const activeIcpText = typeof obj.activeIcpText === "string" ? obj.activeIcpText : "";
  return {
    originalText,
    result,
    displayText,
    activeIcpText,
    feedbackSeen: obj.feedbackSeen === true,
  };
}
