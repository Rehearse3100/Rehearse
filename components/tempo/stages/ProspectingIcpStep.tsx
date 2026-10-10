/**
 * ProspectingIcpStep.tsx
 * ICP step — target verticals, size range, operational signals, and disqualifiers.
 */

"use client";

import {
  ICP_MIN_DECISION_MAKER_ROLE_CHARS,
  ICP_MIN_DISQUALIFIER_CHARS,
  ICP_MIN_OPERATIONAL_SIGNALS_CHARS,
  ICP_MIN_TARGET_VERTICALS_CHARS,
  parseIcpLocationCount,
  type ProspectingWizardState,
} from "@/lib/tempo-prospecting";

const FIELD_MAX_LENGTH = 500;
const DISQUALIFIER_MAX_LENGTH = 120;

type FieldCounterProps = {
  value: string;
  maxLength: number;
  minChars?: number;
};

/** Character count with optional short min-length nudge when typing below advance threshold. */
function FieldCounter({
  value,
  maxLength,
  minChars,
}: FieldCounterProps): React.ReactElement {
  const trimmedLength = value.trim().length;
  const belowMin =
    minChars !== undefined && trimmedLength > 0 && trimmedLength < minChars;

  return (
    <div className="flex flex-nowrap items-center gap-sm shrink-0 whitespace-nowrap text-[11px] text-on-surface-variant font-medium">
      {belowMin ? <span>Min {minChars}</span> : null}
      {belowMin ? <span aria-hidden="true">·</span> : null}
      <span>
        {value.length} / {maxLength}
      </span>
    </div>
  );
}

type ProspectingIcpStepProps = {
  attemptId: string;
  state: ProspectingWizardState;
  onFieldChange: <K extends keyof ProspectingWizardState>(
    key: K,
    value: ProspectingWizardState[K]
  ) => void;
};

/**
 * Four-group ICP form persisted on the wizard draft.
 */
export function ProspectingIcpStep({
  attemptId: _attemptId,
  state,
  onFieldChange,
}: ProspectingIcpStepProps): React.ReactElement {
  const minLoc = parseIcpLocationCount(state.icpSizeMinLocations);
  const maxLoc = parseIcpLocationCount(state.icpSizeMaxLocations);
  const sizeRangeInvalid =
    state.icpSizeMinLocations.trim() !== "" &&
    state.icpSizeMaxLocations.trim() !== "" &&
    (minLoc === null || maxLoc === null || maxLoc < minLoc);

  return (
    <div className="bg-surface text-on-surface font-body-md min-h-full flex items-start justify-center px-md pt-lg pb-md">
      <main className="w-full max-w-[800px] mx-auto space-y-xl">
        <h1 className="font-headline-lg text-headline-lg text-primary">Ideal Customer Profile</h1>

        <section className="space-y-sm">
          <div className="flex justify-between items-center">
            <label className="font-bold text-label-md text-on-surface" htmlFor="icp-target-verticals">
              Target industry
            </label>
            <FieldCounter
              value={state.icpTargetVerticals}
              maxLength={FIELD_MAX_LENGTH}
              minChars={ICP_MIN_TARGET_VERTICALS_CHARS}
            />
          </div>
          <p className="font-label-sm text-on-surface-variant">
            The type of business you believe is the best fit for Tempo.
          </p>
          <textarea
            id="icp-target-verticals"
            rows={3}
            maxLength={FIELD_MAX_LENGTH}
            className="w-full p-md bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary-container focus:border-secondary focus:outline-none font-body-md resize-y"
            placeholder="Type your answer"
            value={state.icpTargetVerticals}
            onChange={(e) => onFieldChange("icpTargetVerticals", e.target.value)}
          />
        </section>

        <section className="space-y-sm">
          <div className="flex justify-between items-center">
            <label
              className="font-bold text-label-md text-on-surface"
              htmlFor="icp-decision-maker-role"
            >
              Decision-maker role
            </label>
            <FieldCounter
              value={state.icpDecisionMakerRole}
              maxLength={FIELD_MAX_LENGTH}
              minChars={ICP_MIN_DECISION_MAKER_ROLE_CHARS}
            />
          </div>
          <p className="font-label-sm text-on-surface-variant">
            Who at the company do you expect to own this purchase decision? Describe their role.
          </p>
          <textarea
            id="icp-decision-maker-role"
            rows={3}
            maxLength={FIELD_MAX_LENGTH}
            className="w-full p-md bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary-container focus:border-secondary focus:outline-none font-body-md resize-y"
            placeholder="Type your answer"
            value={state.icpDecisionMakerRole}
            onChange={(e) => onFieldChange("icpDecisionMakerRole", e.target.value)}
          />
        </section>

        <section className="space-y-sm">
          <h2 className="font-bold text-label-md text-on-surface">Size range</h2>
          <p className="font-label-sm text-on-surface-variant">
            How many locations should your ideal account operate?
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
            <div>
              <label className="font-label-sm text-outline mb-1 block" htmlFor="icp-size-min">
                Min locations
              </label>
              <input
                id="icp-size-min"
                type="number"
                min={1}
                inputMode="numeric"
                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary p-md font-body-md"
                placeholder="Type your answer"
                value={state.icpSizeMinLocations}
                onChange={(e) => onFieldChange("icpSizeMinLocations", e.target.value)}
              />
            </div>
            <div>
              <label className="font-label-sm text-outline mb-1 block" htmlFor="icp-size-max">
                Max locations
              </label>
              <input
                id="icp-size-max"
                type="number"
                min={1}
                inputMode="numeric"
                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary p-md font-body-md"
                placeholder="Type your answer"
                value={state.icpSizeMaxLocations}
                onChange={(e) => onFieldChange("icpSizeMaxLocations", e.target.value)}
              />
            </div>
          </div>
          {sizeRangeInvalid ? (
            <p className="font-label-sm text-error">
              Enter valid location counts with max greater than or equal to min.
            </p>
          ) : null}
        </section>

        <section className="space-y-sm">
          <label
            className="font-bold text-label-md text-on-surface block"
            htmlFor="icp-operational-signals"
          >
            Operational signals that predict fit
          </label>
          <div className="flex justify-between items-center gap-md">
            <p className="font-label-sm text-on-surface-variant min-w-0">
              List observable signals you can verify during research, not generic intent.
            </p>
            <FieldCounter
              value={state.icpOperationalSignals}
              maxLength={FIELD_MAX_LENGTH}
              minChars={ICP_MIN_OPERATIONAL_SIGNALS_CHARS}
            />
          </div>
          <textarea
            id="icp-operational-signals"
            rows={5}
            maxLength={FIELD_MAX_LENGTH}
            className="w-full p-md bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary-container focus:border-secondary focus:outline-none font-body-md resize-y"
            placeholder="Type your answer"
            value={state.icpOperationalSignals}
            onChange={(e) => onFieldChange("icpOperationalSignals", e.target.value)}
          />
        </section>

        <section className="space-y-md">
          <div>
            <h2 className="font-bold text-label-md text-on-surface">Disqualifiers</h2>
            <p className="font-label-sm text-on-surface-variant mt-xs">
              Name 2-3 hard rules that mean you walk away, even if the account looks interesting.
            </p>
          </div>
          <div className="space-y-md">
            {(
              [
                {
                  id: "icp-disqualifier-1",
                  key: "icpDisqualifier1" as const,
                  label: "Disqualifier 1",
                  required: true,
                },
                {
                  id: "icp-disqualifier-2",
                  key: "icpDisqualifier2" as const,
                  label: "Disqualifier 2",
                  required: true,
                },
                {
                  id: "icp-disqualifier-3",
                  key: "icpDisqualifier3" as const,
                  label: "Disqualifier 3",
                  required: false,
                },
              ] as const
            ).map((field) => (
              <div key={field.id} className="space-y-xs">
                <div className="flex justify-between items-center">
                  <label className="font-label-sm text-outline" htmlFor={field.id}>
                    {field.label}
                    {!field.required ? " (optional)" : ""}
                  </label>
                  {field.required || state[field.key].trim().length > 0 ? (
                    <FieldCounter
                      value={state[field.key]}
                      maxLength={DISQUALIFIER_MAX_LENGTH}
                      minChars={ICP_MIN_DISQUALIFIER_CHARS}
                    />
                  ) : (
                    <span className="text-[11px] text-on-surface-variant font-medium">
                      {state[field.key].length} / {DISQUALIFIER_MAX_LENGTH}
                    </span>
                  )}
                </div>
                <input
                  id={field.id}
                  type="text"
                  maxLength={DISQUALIFIER_MAX_LENGTH}
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary p-md font-body-md"
                  placeholder="Type your answer"
                  value={state[field.key]}
                  onChange={(e) => onFieldChange(field.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
