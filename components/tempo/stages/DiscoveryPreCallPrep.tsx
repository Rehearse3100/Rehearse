/**
 * DiscoveryPreCallPrep.tsx
 * Required Open / Probe / Confirm planning step before the Discovery lobby/call.
 * Renders in the center column of DiscoveryStageLayout (left/right rails stay).
 * Visual/content matches the Stitch "Plan Your Discovery Call" reference.
 */

"use client";

import type { DiscoveryPreCallPrep } from "@/lib/tempo-discovery";
import { canBeginDiscoveryCall } from "@/lib/tempo-discovery";

type DiscoveryPreCallPrepProps = {
  form: DiscoveryPreCallPrep;
  onChange: (next: DiscoveryPreCallPrep) => void;
  onBegin: () => void;
};

const FIELD_INPUT =
  "w-full h-[40px] px-md py-sm bg-surface-container-lowest border border-outline-variant rounded focus:outline-none focus:ring-2 focus:ring-secondary focus:border-secondary transition-shadow text-body-md font-body-md text-on-surface placeholder:text-outline-variant";

const FIELD_TEXTAREA =
  "w-full mt-xs px-md py-sm bg-surface-container-lowest border border-outline-variant rounded focus:outline-none focus:ring-2 focus:ring-secondary focus:border-secondary transition-shadow text-body-md font-body-md text-on-surface placeholder:text-outline-variant resize-y min-h-[80px]";

/**
 * Center-column prep card — gates Begin Discovery Call until OPC fields are filled.
 */
export function DiscoveryPreCallPrep({
  form,
  onChange,
  onBegin,
}: DiscoveryPreCallPrepProps): React.ReactElement {
  const canBegin = canBeginDiscoveryCall(form);

  const updateOpenQuestion = (index: 0 | 1 | 2, value: string): void => {
    const openQuestions: [string, string, string] = [
      form.openQuestions[0],
      form.openQuestions[1],
      form.openQuestions[2],
    ];
    openQuestions[index] = value;
    onChange({ ...form, openQuestions });
  };

  return (
    <section className="flex-1 bg-surface p-4 lg:p-xl flex flex-col items-center justify-start relative overflow-y-auto min-w-0 custom-scrollbar">
      <main className="w-full max-w-[800px] bg-surface-container-lowest border border-outline-variant rounded-lg shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] flex flex-col my-auto">
        <header className="p-xl border-b border-surface-container border-solid">
          <h1 className="text-headline-md font-headline-md text-on-surface mb-sm">
            Plan Your Discovery Call
          </h1>
          <p className="text-body-md font-body-md text-on-surface-variant max-w-[700px]">
            You&apos;re about to speak with Dana Reyes. Sketch your approach below, but stay ready
            to actually listen and adapt once she&apos;s talking. A real conversation won&apos;t
            follow your plan exactly, and that&apos;s the point.
          </p>
        </header>

        <div className="p-xl flex flex-col gap-xl">
          {/* Field 1: Open */}
          <div className="flex flex-col gap-sm">
            <div>
              <label className="text-label-md font-label-md text-on-surface block mb-xs">
                What will you ask to get her talking?
              </label>
              <p className="text-body-md font-body-md text-outline">
                2-3 open-ended questions that can&apos;t be answered with yes/no: questions that
                invite her to describe her world.
              </p>
            </div>
            <div className="flex flex-col gap-sm mt-xs">
              <input
                type="text"
                className={FIELD_INPUT}
                placeholder="Walk me through how scheduling works across your locations today."
                value={form.openQuestions[0]}
                onChange={(e) => updateOpenQuestion(0, e.target.value)}
              />
              <input
                type="text"
                className={FIELD_INPUT}
                placeholder=""
                value={form.openQuestions[1]}
                onChange={(e) => updateOpenQuestion(1, e.target.value)}
              />
              <input
                type="text"
                className={FIELD_INPUT}
                placeholder=""
                value={form.openQuestions[2]}
                onChange={(e) => updateOpenQuestion(2, e.target.value)}
              />
            </div>
          </div>

          {/* Field 2: Probe */}
          <div className="flex flex-col gap-sm border-t border-surface-container pt-xl">
            <div>
              <label className="text-label-md font-label-md text-on-surface block mb-xs">
                If she mentions a pain point, how might you dig deeper?
              </label>
              <p className="text-body-md font-body-md text-outline">
                You can&apos;t know exactly what she&apos;ll say, but sketch one likely follow-up
                you&apos;d ask to understand more.
              </p>
            </div>
            <textarea
              className={FIELD_TEXTAREA}
              rows={3}
              placeholder="When the front desk is tied up on the phone, what happens to the patients waiting in the lobby?"
              value={form.anticipatedProbe}
              onChange={(e) => onChange({ ...form, anticipatedProbe: e.target.value })}
            />
          </div>

          {/* Field 3: Confirm */}
          <div className="flex flex-col gap-sm border-t border-surface-container pt-xl">
            <div>
              <label className="text-label-md font-label-md text-on-surface block mb-xs">
                How will you check you understood her correctly?
              </label>
              <p className="text-body-md font-body-md text-outline">
                Sketch how you might play back what you expect to hear, to show you were listening.
              </p>
            </div>
            <textarea
              className={FIELD_TEXTAREA}
              rows={3}
              placeholder="So if I'm hearing you right, the hold times got noticeably worse after the 8th location opened?"
              value={form.anticipatedConfirm}
              onChange={(e) => onChange({ ...form, anticipatedConfirm: e.target.value })}
            />
          </div>
        </div>

        <footer className="p-xl bg-surface-container-low border-t border-outline-variant rounded-b-lg flex flex-col sm:flex-row items-center justify-between gap-md">
          <p className="text-label-sm font-label-sm text-on-surface-variant max-w-[480px]">
            This plan is required before you can begin the call, but treat it as a starting point,
            not a script.
          </p>
          <div
            className={
              canBegin
                ? "w-full sm:w-auto shrink-0"
                : "w-full sm:w-auto shrink-0 rounded border border-outline-variant/70 p-1.5 bg-surface-container-lowest"
            }
          >
            <button
              type="button"
              disabled={!canBegin}
              onClick={onBegin}
              className={
                canBegin
                  ? "h-[40px] px-md inline-flex items-center justify-center rounded bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-colors w-full"
                  : "h-[40px] px-md inline-flex items-center justify-center rounded bg-surface-variant text-outline font-label-md text-label-md cursor-not-allowed select-none w-full"
              }
            >
              Begin Discovery Call
            </button>
          </div>
        </footer>
      </main>
    </section>
  );
}
