/**
 * StudentOngoingSimulations.tsx
 * Lists in-progress attempts the student has actually started. Shows no persona
 * name or role, which can give away the right contact (in Tempo, the persona is
 * the answer).
 */

import Link from "next/link";
import { StudentEmptyState } from "@/components/student/StudentEmptyState";
import { TOTAL_STAGES_COUNT } from "@/lib/constants";

export type StudentOngoingRow = {
  attemptId: string;
  simulationId: string;
  title: string;
  className: string | null;
  stagesCompleted: number;
  continueHref: string;
};

type StudentOngoingSimulationsProps = {
  attempts: StudentOngoingRow[];
};

/**
 * Ongoing simulations section — Continue CTAs for started attempts.
 */
export function StudentOngoingSimulations({
  attempts,
}: StudentOngoingSimulationsProps): React.ReactElement {
  if (attempts.length === 0) {
    return (
      <StudentEmptyState
        icon="play_circle"
        heading="No ongoing simulations"
        description="Start a simulation from one of your classes to see it here."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {attempts.map((row) => {
        const progressPercent = Math.min(
          100,
          Math.round((row.stagesCompleted / TOTAL_STAGES_COUNT) * 100)
        );

        return (
          <article
            key={row.attemptId}
            className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm border-l-[6px] border-l-primary flex flex-col overflow-hidden"
          >
            <div className="p-4 lg:p-5 flex-1 flex flex-col gap-3">
              <div className="flex justify-between items-start gap-3">
                <div>
                  {row.className && (
                    <p className="font-label-sm text-label-sm text-on-surface-variant mb-1">
                      {row.className}
                    </p>
                  )}
                  <h3 className="font-headline-md text-headline-md text-primary">{row.title}</h3>
                </div>
                <span
                  className="material-symbols-outlined text-secondary bg-secondary-container/20 p-2 rounded-full shrink-0"
                  aria-hidden
                >
                  play_arrow
                </span>
              </div>

              <div className="mt-auto space-y-2 pt-2">
                <div className="flex justify-between items-center font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">Progress</span>
                  <span className="font-code-md text-code-md text-primary">
                    {row.stagesCompleted}/{TOTAL_STAGES_COUNT} stages
                  </span>
                </div>
                <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-outline-variant bg-surface/50 flex justify-end">
              <Link
                href={row.continueHref}
                className="h-10 px-6 bg-primary-container text-on-primary rounded-lg font-label-md text-label-md hover:bg-primary transition-colors flex items-center gap-2"
              >
                Continue
                <span className="material-symbols-outlined text-[18px]" aria-hidden>
                  arrow_forward
                </span>
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
