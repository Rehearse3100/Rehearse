/**
 * pitch-deck.ts
 * Simulation-neutral types and pure helpers for the reusable pitch-slide template
 * (components/presentation/PitchSlide.tsx). A simulation passes one deck object
 * (product and customer for the footer, and its colour theme) and one config per
 * slide: the saved field the slide's text box binds to, its title and the
 * direction shown above it. Every slide uses the same layout.
 * Nothing here names a simulation, product, customer or person; each simulation
 * keeps its content in its own config.
 */

// ── Deck ───

/** The slide's colours; PitchSlide derives its greys (borders, box, hairline) from these. */
export type PitchDeckTheme = {
  primary: string;
  accent: string;
  text: string;
  muted: string;
  background: string;
};

/** Plain greys on white, used when a simulation sets no theme. */
export const NEUTRAL_PITCH_THEME: PitchDeckTheme = {
  primary: "#111827",
  accent: "#6b7280",
  text: "#1f2937",
  muted: "#6b7280",
  background: "#ffffff",
};

/** One simulation's deck: who it is for (the footer) and its colours. */
export type PitchDeck = {
  productName: string;
  customerName: string;
  theme?: PitchDeckTheme;
};

/** The deck's theme, or the neutral one when it sets none. */
export function resolvePitchTheme(deck: PitchDeck): PitchDeckTheme {
  return deck.theme ?? NEUTRAL_PITCH_THEME;
}

// ── Slides ───

export type PitchSlideConfig<F extends string = string> = {
  id: string;
  /** The saved field this slide's text box reads and writes. */
  field: F;
  /** The section name: the slide's title and the heading above it. */
  title: string;
  /** Direction shown to the student above the slide (not on it). */
  direction: string;
  /** A second direction line. */
  directionNote?: string;
};

/** The slide number as shown in the footer ("01"). */
export function formatPitchSlideNumber(slideNumber: number): string {
  return String(slideNumber).padStart(2, "0");
}
