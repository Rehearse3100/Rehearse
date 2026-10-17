/**
 * pitch-deck.ts
 * Simulation-neutral types and pure helpers for the reusable pitch-slide template
 * (components/presentation/PitchSlide.tsx). A simulation passes its own theme
 * (product, customer, colors) and one config per slide: the saved field the
 * slide's single editable area binds to, its section label, title, direction and
 * layout, with optional layout data. Nothing here names a simulation, product,
 * customer or person; each simulation keeps its content in its own config.
 */

// ── Theme ───

/** Rehearse navy and gold, used when a theme gives no colors. */
export const DEFAULT_PITCH_PRIMARY = "#1a1a2e";
export const DEFAULT_PITCH_ACCENT = "#c9a84c";

export type PitchDeckTheme = {
  productName: string;
  customerName: string;
  primaryColor?: string;
  accentColor?: string;
};

// ── Slides ───

export type PitchStat = { value: string; label: string };

export type PitchPerson = { name: string; title: string; role?: string };

/** The optional data each layout reads (from config, never from the student). */
export type PitchLayoutData = {
  plain: undefined;
  quote: { attribution: string };
  "split-stat": { value: string; label: string; caption?: string };
  "text-rail": { items: readonly string[] };
  "before-after": { before: PitchStat; after: PitchStat };
  people: { people: readonly PitchPerson[] };
  timeline: { steps: readonly string[] };
};

export type PitchSlideLayout = keyof PitchLayoutData;

type PitchSlideBase<F extends string> = {
  id: string;
  /** The saved field this slide's one editable area reads and writes. */
  field: F;
  /** Small uppercase label above the title. */
  sectionLabel: string;
  title: string;
  /** Direction shown to the student next to the slide (not on it). */
  direction: string;
  /** A second, smaller direction line. */
  directionNote?: string;
};

/** One slide's config; `data` is optional and the slide falls back to plain without it. */
export type PitchSlideConfig<F extends string = string> = {
  [L in PitchSlideLayout]: PitchSlideBase<F> & { layout: L; data?: PitchLayoutData[L] };
}[PitchSlideLayout];

/** The layout a slide actually renders, with its data checked and trimmed to fit. */
export type ResolvedPitchLayout = {
  [L in PitchSlideLayout]: L extends "plain" ? { layout: L } : { layout: L; data: NonNullable<PitchLayoutData[L]> };
}[PitchSlideLayout];

/** Most items a rail, people column or timeline shows. */
export const MAX_PITCH_ITEMS = 3;

const isFilled = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const isFilledStat = (stat: unknown): stat is PitchStat =>
  Boolean(stat) && isFilled((stat as PitchStat).value) && isFilled((stat as PitchStat).label);

/**
 * The layout to render: the configured one when its data is complete (lists cut
 * to MAX_PITCH_ITEMS), otherwise "plain" — so a slide with missing or partial data
 * never breaks. Rails need 1+ items, people 1+ named people, timelines 2+ steps.
 */
export function resolvePitchLayout(slide: PitchSlideConfig): ResolvedPitchLayout {
  const plain: ResolvedPitchLayout = { layout: "plain" };
  switch (slide.layout) {
    case "quote":
      return slide.data && isFilled(slide.data.attribution)
        ? { layout: "quote", data: slide.data }
        : plain;
    case "split-stat":
      return slide.data && isFilled(slide.data.value) && isFilled(slide.data.label)
        ? { layout: "split-stat", data: slide.data }
        : plain;
    case "text-rail": {
      const items = (slide.data?.items ?? []).filter(isFilled).slice(0, MAX_PITCH_ITEMS);
      return items.length > 0 ? { layout: "text-rail", data: { items } } : plain;
    }
    case "before-after":
      return slide.data && isFilledStat(slide.data.before) && isFilledStat(slide.data.after)
        ? { layout: "before-after", data: slide.data }
        : plain;
    case "people": {
      const people = (slide.data?.people ?? []).filter((person) => isFilled(person?.name)).slice(0, MAX_PITCH_ITEMS);
      return people.length > 0 ? { layout: "people", data: { people } } : plain;
    }
    case "timeline": {
      const steps = (slide.data?.steps ?? []).filter(isFilled).slice(0, MAX_PITCH_ITEMS);
      return steps.length >= 2 ? { layout: "timeline", data: { steps } } : plain;
    }
    default:
      return plain;
  }
}

/** Initials for a person circle: first and last name words, skipping honorifics such as "Dr.". */
export function pitchInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((word) => word.length > 0 && !word.endsWith("."));
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return picked.map((word) => (word ?? "").charAt(0).toUpperCase()).join("");
}

/** The slide number as shown in the footer ("01"). */
export function formatPitchSlideNumber(slideNumber: number): string {
  return String(slideNumber).padStart(2, "0");
}
