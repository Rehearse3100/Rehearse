/**
 * TestShortcutsDropdown.tsx
 * Dev menu — jump to any Tempo stage, prefilled results, or all-badges preview.
 */

"use client";

import { useRouter } from "next/navigation";
import { clearAllDiscoveryPrepFromStorage } from "@/lib/tempo-discovery";
import { clearAllProspectingWizardFromStorage } from "@/lib/tempo-prospecting";
import { TEMPO_TEST_RESULTS_OUTCOMES } from "@/lib/tempo-results";

type TestShortcutsDropdownProps = {
  simulationId: string;
  classId: string;
  /** Compact trigger for header — keeps full menu, smaller footprint */
  compact?: boolean;
};

const TEST_STAGES = [
  { id: "prospecting", label: "Stage 1 — Prospecting" },
  { id: "discovery", label: "Stage 2 — Discovery" },
  { id: "presentation", label: "Stage 3 — Presentation" },
  { id: "objections", label: "Stage 4 — Objections" },
  { id: "negotiation", label: "Stage 5 — Negotiation" },
] as const;

/**
 * Single dropdown for all Tempo dev test shortcuts (stages + results).
 */
export function TestShortcutsDropdown({
  simulationId,
  classId,
  compact = false,
}: TestShortcutsDropdownProps): React.ReactElement {
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-sm leading-none select-none shadow-sm"
        aria-hidden
        title="Tester settings"
      >
        🧪
      </span>
      <select
      className={
        compact
          ? "h-10 min-w-[9.5rem] pl-3 pr-8 border border-outline-variant text-on-surface rounded-lg bg-surface-container-lowest hover:bg-surface-container transition-colors text-label-md font-label-md cursor-pointer outline-none focus:ring-2 focus:ring-secondary/20 appearance-none bg-[length:12px] bg-[right_0.65rem_center] bg-no-repeat"
          : "h-11 min-w-[11rem] pl-3 pr-8 border border-outline-variant text-on-surface font-bold rounded-lg bg-surface-container-lowest hover:bg-surface-container transition-colors text-label-md cursor-pointer outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary appearance-none bg-[length:12px] bg-[right_0.65rem_center] bg-no-repeat"
      }
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2347464c' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
      }}
      defaultValue=""
      title="Tester settings"
      onChange={(e) => {
        const value = e.target.value;
        if (!value) {
          return;
        }

        if (value.startsWith("stage:")) {
          const stage = value.replace("stage:", "");
          // Test jumps reuse the same attempt id — wipe Discovery prep so Stage 2
          // does not restore a prior "Plan Your Discovery Call" draft.
          if (stage === "prospecting") {
            clearAllProspectingWizardFromStorage();
          }
          if (stage === "discovery") {
            clearAllDiscoveryPrepFromStorage();
          }
          // Full navigation so stage React state remounts cleanly.
          window.location.assign(
            `/student/simulation/${simulationId}?classId=${classId}&teststage=${stage}`
          );
        } else if (value.startsWith("results:")) {
          const outcome = value.replace("results:", "");
          router.push(
            `/student/simulation/${simulationId}/complete?classId=${classId}&testresults=${outcome}`
          );
        } else if (value === "badges:all") {
          router.push(
            `/student/simulation/${simulationId}/complete?classId=${classId}&testbadges=all`
          );
        }

        e.target.value = "";
      }}
      aria-label="Tester settings"
    >
      <option value="" disabled>
        Tester settings
      </option>
      <optgroup label="Stages">
        {TEST_STAGES.map((stage) => (
          <option key={stage.id} value={`stage:${stage.id}`}>
            {stage.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Results">
        {TEMPO_TEST_RESULTS_OUTCOMES.map((item) => (
          <option key={item.id} value={`results:${item.id}`} title={item.label}>
            Results — {item.shortLabel}
          </option>
        ))}
        <option value="badges:all">Test → Badges — All Earned</option>
      </optgroup>
    </select>
    </div>
  );
}
