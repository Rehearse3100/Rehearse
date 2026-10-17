/**
 * PitchSlide.tsx
 * Reusable, simulation-neutral 16:9 pitch slide with one layout for every slide:
 * the title (the section name), the student's text, and a footer over a hairline
 * ("{product} · Prepared for {customer}" and the slide number). The student's
 * text is ONE area bound to the slide's field: a clearly
 * visible text box when onChange is given, plain text otherwise (thumbnails,
 * read-only). Behind the content sits the same background design on every slide
 * (a left bar, thin arcs top right, a soft circle bottom right) and a short accent
 * line under the title, kept clear of the title, the text and the footer. Sizes
 * are in container units of the slide's width, so a thumbnail looks exactly like
 * the big slide. Every colour comes from the deck's theme (lib/pitch-deck.ts);
 * greys and tints are mixed from it. No images, icons or emoji. Hook-free by design.
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

/** `percent` of `color` over `base`, for greys and soft tints derived from the theme. */
const mix = (color: string, percent: number, base: string): string =>
  `color-mix(in srgb, ${color} ${percent}%, ${base})`;

// Body text and footer, sized to read at about 18px and 14px on the builder's full-size slide.
const BODY_SIZE = cq(2.2);
const FOOTER_SIZE = cq(1.7);

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
  const boxColors = {
    "--pitch-box-border": mix(theme.muted, 35, theme.background),
    "--pitch-box-bg": mix(theme.muted, 5, theme.background),
    "--pitch-box-focus": theme.primary,
    "--pitch-box-ring": mix(theme.accent, 30, "transparent"),
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
  theme,
}: {
  deck: PitchDeck;
  slideNumber: number;
  theme: PitchDeckTheme;
}): React.ReactElement {
  return (
    <div
      className="flex items-center justify-between shrink-0"
      style={{
        borderTop: `max(1px, ${cq(0.08)}) solid ${mix(theme.muted, 25, theme.background)}`,
        paddingTop: cq(1.4),
        marginTop: cq(2),
        gap: cq(2),
        fontSize: FOOTER_SIZE,
        lineHeight: 1.4,
        color: theme.muted,
      }}
    >
      <p className="min-w-0">
        {deck.productName} · Prepared for {deck.customerName}
      </p>
      <span className="shrink-0">{formatPitchSlideNumber(slideNumber)}</span>
    </div>
  );
}

// ── Background design ───
// Positions in cqw (the slide is 100 wide and 56.25 tall). The text starts about
// 12.8 down (padding, title, accent line) and spans 5 to 95 across, so the arcs
// stay above and right of it and the big circle shows only in the bottom-right corner.

/** Thin arcs centred just off the top-right corner; the largest reaches about 10.5 down at the text's right edge. */
const ARC_CENTER = { x: 101, y: -1 };
const ARC_RADII = [5, 9, 13];

/** One large circle centred off the bottom-right corner; only its top-left edge shows. */
const SOFT_CIRCLE = { x: 104, y: 62, radius: 22 };

/** A circle by centre and radius, in cqw. */
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

/** The shapes behind the content: identical on every slide, coloured by the theme. */
function SlideDecoration({ theme }: { theme: PitchDeckTheme }): React.ReactElement {
  return (
    <div aria-hidden data-pitch-decoration className="absolute inset-0 pointer-events-none">
      <div className="absolute left-0 top-0 bottom-0" style={{ width: cq(0.72), background: theme.primary }} />
      {ARC_RADII.map((radius) => (
        <div
          key={radius}
          style={{
            ...circleBox(ARC_CENTER.x, ARC_CENTER.y, radius),
            border: `max(1px, ${cq(0.12)}) solid ${mix(theme.accent, 20, "transparent")}`,
          }}
        />
      ))}
      <div
        style={{
          ...circleBox(SOFT_CIRCLE.x, SOFT_CIRCLE.y, SOFT_CIRCLE.radius),
          background: mix(theme.primary, 5, "transparent"),
        }}
      />
    </div>
  );
}

// ── Slide ───

/**
 * One pitch slide: the background design, the slide's title with an accent line
 * under it, the student's text bound to slide.field (a text box while editing,
 * plain text when read-only) and the footer, all in the deck's colours.
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
  return (
    // The wrapper is the size container: everything inside scales with the slide's width.
    <div className="w-full" style={{ containerType: "inline-size" }}>
      <div
        className="relative w-full aspect-video overflow-hidden"
        style={{
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
          background: theme.background,
          borderRadius: cq(1.1),
          boxShadow: bare ? "none" : `0 ${cq(0.4)} ${cq(2.4)} ${mix(theme.text, 10, "transparent")}`,
        }}
      >
        <SlideDecoration theme={theme} />
        {/* Content paints above the decoration (later in the DOM, same stacking level). */}
        <div className="absolute inset-0 flex flex-col" style={{ padding: `${cq(4.5)} ${cq(5)} ${cq(3)}` }}>
          <h3
            className="font-bold shrink-0"
            style={{ fontSize: cq(4.2), lineHeight: 1.15, letterSpacing: "-0.01em", color: theme.primary }}
          >
            {slide.title}
          </h3>
          {/* About 48 × 3px on the full-size slide. */}
          <div
            aria-hidden
            className="shrink-0"
            style={{ width: cq(5.8), height: cq(0.36), background: theme.accent, marginTop: cq(1.1), marginBottom: cq(2) }}
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
          <SlideFooter deck={deck} slideNumber={slideNumber} theme={theme} />
        </div>
      </div>
    </div>
  );
}
