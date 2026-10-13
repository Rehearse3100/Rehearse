/**
 * FieldCounter.tsx
 * Shared min-length nudge and character counter for Tempo form fields.
 * Used by the Prospecting ICP step (with a max length) and the Presentation
 * pitch form (min length only). Display only; validation lives in lib/.
 */

const COUNTER_CLASS =
  "flex flex-nowrap items-center gap-sm shrink-0 whitespace-nowrap text-[11px] text-on-surface-variant font-medium";

type FieldCounterProps = {
  value: string;
  /** When set, shows "count / max". When omitted, only the min nudge can show. */
  maxLength?: number;
  minChars?: number;
};

/**
 * Character count with optional short min-length nudge when typing below advance threshold.
 * With maxLength: "Min n · count / max" (the nudge only while below the minimum).
 * Without maxLength: "Min n" while the field has text but is below the minimum, else nothing.
 */
export function FieldCounter({
  value,
  maxLength,
  minChars,
}: FieldCounterProps): React.ReactElement | null {
  const trimmedLength = value.trim().length;
  const belowMin =
    minChars !== undefined && trimmedLength > 0 && trimmedLength < minChars;

  if (maxLength === undefined) {
    return belowMin ? (
      <div className={COUNTER_CLASS}>
        <span>Min {minChars}</span>
      </div>
    ) : null;
  }

  return (
    <div className={COUNTER_CLASS}>
      {belowMin ? <span>Min {minChars}</span> : null}
      {belowMin ? <span aria-hidden="true">·</span> : null}
      <span>
        {value.length} / {maxLength}
      </span>
    </div>
  );
}
