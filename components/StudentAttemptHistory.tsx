/**
 * StudentAttemptHistory.tsx
 * Lists completed simulation attempts with scores. Shows no persona name, which can
 * give away the right contact (in Tempo, the persona is the answer).
 */

"use client";

import Link from "next/link";
import { StudentEmptyState } from "@/components/student/StudentEmptyState";
import { scoreToGrade } from "@/lib/grades";
import { totalScoreTone, toneTextClass } from "@/lib/score-display";

export type StudentAttemptRow = {
  id: string;
  total_score: number;
  completed_at: string | null;
  simulations: { id: string; title: string } | null;
};

type StudentAttemptHistoryProps = {
  attempts: StudentAttemptRow[];
};

/**
 * Renders past completed simulations with links to full results.
 */
export function StudentAttemptHistory({
  attempts,
}: StudentAttemptHistoryProps): React.ReactElement {
  if (attempts.length === 0) {
    return (
      <StudentEmptyState
        icon="model_training"
        heading="No completed simulations yet"
        description="Finish a scenario to see your scores here."
      />
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-outline-variant bg-surface-container-low">
            <th className="py-3 px-4 font-label-sm text-label-sm text-on-surface-variant">
              Simulation
            </th>
            <th className="py-3 px-4 font-label-sm text-label-sm text-on-surface-variant">
              Score
            </th>
            <th className="py-3 px-4 font-label-sm text-label-sm text-on-surface-variant">
              Completion Date
            </th>
            <th className="py-3 px-4 font-label-sm text-label-sm text-on-surface-variant">
              Grade
            </th>
            <th className="py-3 px-4 font-label-sm text-label-sm text-on-surface-variant text-right">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {attempts.map((row) => {
            const sim = row.simulations;
            const completedLabel = row.completed_at
              ? new Date(row.completed_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—";
            const tone = totalScoreTone(row.total_score);
            return (
              <tr
                key={row.id}
                className="hover:bg-surface-container-lowest/50 transition-colors"
              >
                <td className="py-3 px-4 font-body-md text-body-md text-on-surface font-medium">
                  <p>{sim?.title ?? "Simulation"}</p>
                </td>
                <td className="py-3 px-4 font-code-md text-code-md text-on-surface">
                  {row.total_score}/600
                </td>
                <td className="py-3 px-4 font-body-md text-body-md text-on-surface-variant">
                  {completedLabel}
                </td>
                <td
                  className={`py-3 px-4 font-label-md text-label-md font-semibold ${toneTextClass(tone)}`}
                >
                  {scoreToGrade(row.total_score)}
                </td>
                <td className="py-3 px-4 text-right">
                  {sim && (
                    <Link
                      href={`/student/simulation/${sim.id}/complete?attempt=${row.id}`}
                      className="inline-block font-label-md text-label-md text-secondary hover:bg-secondary/10 px-2 py-1 rounded-xl transition-all duration-300"
                    >
                      View Results
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
