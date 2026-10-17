/**
 * PitchSlide.tsx
 * Reusable, simulation-neutral 16:9 pitch slide: the title (the section name)
 * with an accent line under it, the student's text, and a footer over a hairline
 * ("{product} · Prepared for {customer}" and the slide number). The student's
 * text is ONE area bound to the slide's field: a clearly visible text box when
 * onChange is given, plain text otherwise (thumbnails, read-only). Each slide
 * number has its own background design (banner, right panel, left panel, bottom
 * band, circles, diagonal; then they repeat), the same for every simulation, with
 * the content padded so the title, text and footer never sit on a shape. Sizes
 * are in container units of the slide's width, so a thumbnail looks exactly like
 * the big slide. Every colour comes from the deck's theme (lib/pitch-deck.ts);
 * tints are mixed from it. No images, icons or emoji. Hook-free by design.
 */

import {
  formatPitchSlideNumber,
  resolvePitchTheme,
  type PitchDeck,
  type PitchDeckTheme,
  type PitchSlideConfig,
} from "@/lib/pitch-deck";

type PitchSlideProps<F extends string> = {
  /** The simulation's deck: footer product and customer, and the colour theme. */
  deck: PitchDeck;
  slide: PitchSlideConfig<F>;
  /** 1-based; also picks the slide's background design. */
  slideNumber: number;
  /** The student's text for this slide's field. */
  value: string;
  /** Called with the slide's field on every edit; omit for a read-only slide (thumbnails). */
  onChange?: (field: F, value: string) => void;
  placeholder?: string;
  /** No shadow (when the caller frames the slide, e.g. a thumbnail). */
  bare?: boolean;
};

/** Container-relative size: a share of the slide's width. */
const cq = (percent: number): string => `${percent}cqw`;

/** `percent` of `color` over `base`, for tints derived from the theme. */
const mix = (color: string, percent: number, base: string): string =>
  `color-mix(in srgb, ${color} ${percent}%, ${base})`;

/** `percent` of `color`, see-through. */
const fade = (color: string, percent: number): string => mix(color, percent, "transparent");

// Body text and footer, sized to read at about 18px and 14px on the builder's full-size slide.
const BODY_SIZE = cq(2.2);
const FOOTER_SIZE = cq(1.7);

// ── Background designs ───
// Positions in cqw: the slide is 100 wide and SLIDE_HEIGHT tall. With the default
// spacing the text runs from about 12.8 down to 47.5 and the footer from 49.5 to
// 53.3; each design moves the padding and gaps so all of it stays off its shapes.

const SLIDE_HEIGHT = 56.25;

type SlideDesign = {
  /** Content padding: top, right, bottom, left. */
  padding: readonly [number, number, number, number];
  /** Space between the accent line and the text. */
  bodyGap: number;
  /** Space between the text and the footer. */
  footerGap: number;
  /** The title and its accent line sit on a primary band. */
  isTitleOnPrimary: boolean;
  /** The footer sits on a primary band. */
  isFooterOnPrimary: boolean;
  /** A light accent wash instead of the plain background. */
  hasWash: boolean;
  shapes: (theme: PitchDeckTheme) => React.CSSProperties[];
};

function rect(x: number, y: number, width: number, height: number, background: string): React.CSSProperties {
  return { position: "absolute", left: cq(x), top: cq(y), width: cq(width), height: cq(height), background };
}

/** A circle by centre and radius. */
function circleBox(x: number, y: number, radius: number): React.CSSProperties {
  return {
    position: "absolute",
    left: cq(x - radius),
    top: cq(y - radius),
    width: cq(radius * 2),
    height: cq(radius * 2),
    borderRadius: "50%",
  };
}

function disc(x: number, y: number, radius: number, background: string): React.CSSProperties {
  return { ...circleBox(x, y, radius), background };
}

function ring(x: number, y: number, radius: number, color: string, thickness = 0.3): React.CSSProperties {
  return { ...circleBox(x, y, radius), border: `max(1px, ${cq(thickness)}) solid ${color}` };
}

/** A bar with a rounded right end. */
function bar(x: number, y: number, width: number, background: string): React.CSSProperties {
  return { ...rect(x, y, width, 1.8, background), borderRadius: `0 ${cq(0.9)} ${cq(0.9)} 0` };
}

const DEFAULT_SPACING = {
  padding: [4.5, 5, 3, 5],
  bodyGap: 2,
  footerGap: 2,
  isTitleOnPrimary: false,
  isFooterOnPrimary: false,
  hasWash: false,
} as const;

/** One design per slide number, in order; slide 7 starts over at the first. */
const SLIDE_DESIGNS: readonly SlideDesign[] = [
  // 1 · Banner: a primary band across the top holding the title, an accent stripe
  // under it and rings in its corner; the text starts below the band (19 down).
  {
    ...DEFAULT_SPACING,
    padding: [4.2, 5, 3, 5],
    bodyGap: 8.5,
    isTitleOnPrimary: true,
    shapes: (t) => [
      rect(0, 0, 100, 15.5, t.primary),
      rect(0, 15.5, 100, 0.6, t.accent),
      ring(93, 1, 7, fade(t.accent, 75)),
      ring(93, 1, 11.5, fade(t.accent, 40)),
    ],
  },
  // 2 · Right panel: a primary panel down the right (from 69.4), an accent quarter
  // disc and a ring inside it; the content ends at 65.
  {
    ...DEFAULT_SPACING,
    padding: [4.5, 35, 3, 5],
    shapes: (t) => [
      rect(70, 0, 30, SLIDE_HEIGHT, t.primary),
      rect(69.4, 0, 0.6, SLIDE_HEIGHT, t.accent),
      disc(100, SLIDE_HEIGHT, 15, t.accent),
      ring(84, 15, 7, t.accent, 0.35),
    ],
  },
  // 3 · Left panel: a primary panel down the left (to 23.6) with a ring and three
  // rising accent bars, on an accent wash; the content starts at 29.
  {
    ...DEFAULT_SPACING,
    padding: [4.5, 5, 3, 29],
    hasWash: true,
    shapes: (t) => [
      rect(0, 0, 23, SLIDE_HEIGHT, t.primary),
      rect(23, 0, 0.6, SLIDE_HEIGHT, t.accent),
      ring(11.5, 13, 6, fade(t.accent, 75), 0.35),
      bar(4, 38, 6, t.accent),
      bar(4, 41.6, 10, t.accent),
      bar(4, 45.2, 14, t.accent),
    ],
  },
  // 4 · Bottom band: a primary band along the bottom (from 43.9) holding the
  // footer, rings off the top-right corner (above 11.2 where the text is); the
  // text ends at 42.
  {
    ...DEFAULT_SPACING,
    footerGap: 7.5,
    isFooterOnPrimary: true,
    shapes: (t) => [
      rect(0, 44.5, 100, SLIDE_HEIGHT - 44.5, t.primary),
      rect(0, 43.9, 100, 0.6, t.accent),
      ring(101, -1, 5.5, t.accent, 0.35),
      ring(101, -1, 9.5, fade(t.accent, 70), 0.35),
      ring(101, -1, 13.5, fade(t.accent, 45), 0.35),
    ],
  },
  // 5 · Circles: overlapping primary and accent discs and a primary ring down the
  // right (from 70.5); the content ends at 69.
  {
    ...DEFAULT_SPACING,
    padding: [4.5, 31, 3, 5],
    shapes: (t) => [disc(88, 21, 12, t.primary), disc(79, 38, 8.5, t.accent), ring(93, 47, 6.5, t.primary, 0.35)],
  },
  // 6 · Diagonal: a primary wedge down the right whose edge runs from 72 across at
  // the top to the bottom-right corner, a parallel accent stripe 2 to its left
  // (75 across where the text starts) and a ring inside the wedge, on an accent
  // wash; the content ends at 70.
  {
    ...DEFAULT_SPACING,
    padding: [4.5, 30, 3, 5],
    hasWash: true,
    shapes: (t) => [
      { position: "absolute", inset: 0, background: t.primary, clipPath: "polygon(72% 0, 100% 0, 100% 100%)" },
      { position: "absolute", inset: 0, background: t.accent, clipPath: "polygon(68.5% 0, 70% 0, 98% 100%, 96.5% 100%)" },
      ring(91, 12, 5, t.accent, 0.35),
    ],
  },
];

/** The design for a 1-based slide number. */
function designFor(slideNumber: number): SlideDesign {
  const count = SLIDE_DESIGNS.length;
  return SLIDE_DESIGNS[(((slideNumber - 1) % count) + count) % count] ?? SLIDE_DESIGNS[0]!;
}

/** The design's shapes, behind the content; they take no clicks and hold no text. */
function SlideDecoration({ design, theme }: { design: SlideDesign; theme: PitchDeckTheme }): React.ReactElement {
  return (
    <div aria-hidden data-pitch-decoration className="absolute inset-0 pointer-events-none">
      {design.shapes(theme).map((style, index) => (
        <div key={index} style={style} />
      ))}
    </div>
  );
}

// ── Parts ───

/** The student's one text area: a visible text box when onChange is given, plain text otherwise. */
function StudentText<F extends string>({
  field,
  title,
  value,
  onChange,
  placeholder,
  theme,
}: {
  field: F;
  title: string;
  value: string;
  onChange?: (field: F, value: string) => void;
  placeholder: string;
  theme: PitchDeckTheme;
}): React.ReactElement {
  const textStyle: React.CSSProperties = { fontSize: BODY_SIZE, lineHeight: 1.6, color: theme.text };
  if (!onChange) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden whitespace-pre-wrap break-words" style={textStyle}>
        {value}
      </div>
    );
  }
  // Colours go through CSS variables so the focus and placeholder classes can use them.
  // The box's background is solid (mixed over the theme background), never see-through.
  const boxColors = {
    "--pitch-box-border": mix(theme.accent, 60, theme.background),
    "--pitch-box-bg": mix(theme.accent, 4, theme.background),
    "--pitch-box-focus": theme.primary,
    "--pitch-box-ring": fade(theme.accent, 35),
    "--pitch-box-placeholder": mix(theme.muted, 70, theme.background),
  } as React.CSSProperties;
  return (
    <textarea
      aria-label={title}
      className="flex-1 min-h-0 w-full resize-none rounded-lg border p-3 outline-none transition-[border-color,box-shadow] border-[color:var(--pitch-box-border)] bg-[color:var(--pitch-box-bg)] placeholder:text-[color:var(--pitch-box-placeholder)] focus:border-[color:var(--pitch-box-focus)] focus:ring-[3px] focus:ring-[color:var(--pitch-box-ring)]"
      style={{ ...textStyle, ...boxColors }}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(field, event.target.value)}
    />
  );
}

function SlideFooter({
  deck,
  slideNumber,
  design,
  theme,
}: {
  deck: PitchDeck;
  slideNumber: number;
  design: SlideDesign;
  theme: PitchDeckTheme;
}): React.ReactElement {
  const onPrimary = design.isFooterOnPrimary;
  return (
    <div
      className="flex items-center justify-between shrink-0"
      style={{
        borderTop: `max(1px, ${cq(0.08)}) solid ${onPrimary ? "transparent" : mix(theme.accent, 50, theme.background)}`,
        paddingTop: cq(1.4),
        marginTop: cq(design.footerGap),
        gap: cq(2),
        fontSize: FOOTER_SIZE,
        lineHeight: 1.4,
        color: onPrimary ? mix(theme.background, 80, theme.primary) : mix(theme.primary, 80, theme.background),
      }}
    >
      <p className="min-w-0">
        {deck.productName} · Prepared for {deck.customerName}
      </p>
      <span className="shrink-0 font-bold" style={{ color: onPrimary ? theme.accent : theme.primary }}>
        {formatPitchSlideNumber(slideNumber)}
      </span>
    </div>
  );
}

// ── Slide ───

/**
 * One pitch slide: its number's background design, the slide's title with an
 * accent line under it, the student's text bound to slide.field (a text box while
 * editing, plain text when read-only) and the footer, all in the deck's colours.
 */
export function PitchSlide<F extends string>({
  deck,
  slide,
  slideNumber,
  value,
  onChange,
  placeholder = "Type here…",
  bare = false,
}: PitchSlideProps<F>): React.ReactElement {
  const theme = resolvePitchTheme(deck);
  const design = designFor(slideNumber);
  const [top, right, bottom, left] = design.padding;
  return (
    // The wrapper is the size container: everything inside scales with the slide's width.
    <div className="w-full" style={{ containerType: "inline-size" }}>
      <div
        className="relative w-full aspect-video overflow-hidden"
        style={{
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
          background: design.hasWash ? mix(theme.accent, 9, theme.background) : theme.background,
          borderRadius: cq(1.1),
          boxShadow: bare ? "none" : `0 ${cq(0.4)} ${cq(2.4)} ${fade(theme.text, 10)}`,
        }}
      >
        <SlideDecoration design={design} theme={theme} />
        {/* Content paints above the decoration (later in the DOM, same stacking level). */}
        <div
          className="absolute inset-0 flex flex-col"
          style={{ padding: `${cq(top)} ${cq(right)} ${cq(bottom)} ${cq(left)}` }}
        >
          <h3
            className="font-bold shrink-0"
            style={{
              fontSize: cq(4.2),
              lineHeight: 1.15,
              letterSpacing: "-0.01em",
              color: design.isTitleOnPrimary ? theme.background : theme.primary,
            }}
          >
            {slide.title}
          </h3>
          {/* About 48 × 3px on the full-size slide. */}
          <div
            aria-hidden
            className="shrink-0"
            style={{
              width: cq(5.8),
              height: cq(0.36),
              background: theme.accent,
              marginTop: cq(1.1),
              marginBottom: cq(design.bodyGap),
            }}
          />
          <div className="flex-1 min-h-0 flex flex-col">
            <StudentText
              field={slide.field}
              title={slide.title}
              value={value}
              onChange={onChange}
              placeholder={placeholder}
              theme={theme}
            />
          </div>
          <SlideFooter deck={deck} slideNumber={slideNumber} design={design} theme={theme} />
        </div>
      </div>
    </div>
  );
}
