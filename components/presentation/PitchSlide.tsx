/**
 * PitchSlide.tsx
 * Reusable, simulation-neutral 16:9 pitch slide. One shared master (section label
 * with a dot, title, generous margins, footer "{product} · Prepared for {customer}"
 * and the slide number over a hairline) and six layouts chosen per slide in config
 * (quote, split-stat, text-rail, before-after, people, timeline); missing or
 * partial layout data falls back to the plain master. The student's text is always
 * ONE area, bound to the slide's field: editable when onChange is given, read-only
 * otherwise (thumbnails). Every size is in container units of the slide's width,
 * so a thumbnail looks exactly like the big slide. No images, icons or emoji;
 * colors come from the theme (lib/pitch-deck.ts). Hook-free by design.
 */

import {
  DEFAULT_PITCH_ACCENT,
  DEFAULT_PITCH_PRIMARY,
  formatPitchSlideNumber,
  pitchInitials,
  resolvePitchLayout,
  type PitchDeckTheme,
  type PitchPerson,
  type PitchSlideConfig,
  type PitchStat,
} from "@/lib/pitch-deck";

type PitchSlideProps<F extends string> = {
  theme: PitchDeckTheme;
  slide: PitchSlideConfig<F>;
  slideNumber: number;
  /** The student's text for this slide's field. */
  value: string;
  /** Called with the slide's field on every edit; omit for a read-only slide (thumbnails). */
  onChange?: (field: F, value: string) => void;
  placeholder?: string;
  /** No outer border or shadow (when the caller frames the slide, e.g. a thumbnail). */
  bare?: boolean;
};

type Palette = { primary: string; accent: string; accentText: string };

// Greys (Tailwind slate) — the slide stays mostly white and grey.
const INK = "#1e293b";
const BODY = "#475569";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const HAIRLINE = "#e2e8f0";
const WASH = "#f8fafc";

/** Container-relative size: a share of the slide's width. */
const cq = (percent: number): string => `${percent}cqw`;

const LABEL_STYLE = { fontSize: cq(1.15), letterSpacing: "0.18em" } as const;

// ── Master pieces ───

function SectionLabel({ label, palette }: { label: string; palette: Palette }): React.ReactElement {
  return (
    <div className="flex items-center" style={{ gap: cq(0.8), marginBottom: cq(1.3) }}>
      <span className="rounded-full shrink-0" style={{ width: cq(0.75), height: cq(0.75), background: palette.accent }} />
      <span className="font-bold uppercase" style={{ ...LABEL_STYLE, color: palette.accentText }}>
        {label}
      </span>
    </div>
  );
}

function SlideTitle({ title, palette }: { title: string; palette: Palette }): React.ReactElement {
  return (
    <h2
      className="font-bold"
      style={{ fontSize: cq(3.4), lineHeight: 1.15, letterSpacing: "-0.01em", color: palette.primary, marginBottom: cq(2.2) }}
    >
      {title}
    </h2>
  );
}

function SlideFooter({ theme, slideNumber }: { theme: PitchDeckTheme; slideNumber: number }): React.ReactElement {
  return (
    <div
      className="flex items-center justify-between shrink-0"
      style={{
        borderTop: `max(1px, ${cq(0.08)}) solid ${HAIRLINE}`,
        paddingTop: cq(1.2),
        marginTop: cq(1.6),
        fontSize: cq(1.05),
        color: FAINT,
        letterSpacing: "0.04em",
      }}
    >
      <span>
        {theme.productName} · Prepared for {theme.customerName}
      </span>
      <span className="font-semibold" style={{ color: MUTED }}>
        {formatPitchSlideNumber(slideNumber)}
      </span>
    </div>
  );
}

/** The student's one text area: editable when onChange is given, plain text otherwise. */
function StudentText<F extends string>({
  field,
  title,
  value,
  onChange,
  placeholder,
  variant = "body",
}: {
  field: F;
  title: string;
  value: string;
  onChange?: (field: F, value: string) => void;
  placeholder: string;
  variant?: "body" | "quote";
}): React.ReactElement {
  const style: React.CSSProperties =
    variant === "quote"
      ? { fontSize: cq(2.35), lineHeight: 1.45, color: INK, fontWeight: 500 }
      : { fontSize: cq(1.75), lineHeight: 1.65, color: BODY };
  if (!onChange) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden whitespace-pre-wrap break-words" style={style}>
        {value}
      </div>
    );
  }
  return (
    <textarea
      aria-label={title}
      className="flex-1 min-h-0 w-full resize-none border-0 bg-transparent p-0 outline-none focus:outline-none focus:ring-0 placeholder:text-slate-300"
      style={style}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(field, event.target.value)}
    />
  );
}

/** Label, title, the body (children) and the footer, inside the slide's margins. */
function MasterColumn({
  theme,
  slideNumber,
  label,
  title,
  palette,
  children,
}: {
  theme: PitchDeckTheme;
  slideNumber: number;
  label: string;
  title: string;
  palette: Palette;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex-1 min-w-0 flex flex-col" style={{ padding: `${cq(5)} ${cq(6)} ${cq(3.2)}` }}>
      <SectionLabel label={label} palette={palette} />
      <SlideTitle title={title} palette={palette} />
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      <SlideFooter theme={theme} slideNumber={slideNumber} />
    </div>
  );
}

// ── Layout pieces (all content from config) ───

function QuoteMark({ palette }: { palette: Palette }): React.ReactElement {
  return (
    <span
      aria-hidden
      className="block font-bold select-none"
      style={{ fontSize: cq(8), lineHeight: 0.8, height: cq(4.2), color: palette.accent, fontFamily: "Georgia, serif" }}
    >
      “
    </span>
  );
}

function Attribution({ text, palette }: { text: string; palette: Palette }): React.ReactElement {
  return (
    <div className="flex items-center shrink-0" style={{ gap: cq(1), marginTop: cq(1.4) }}>
      <span style={{ width: cq(2.6), height: `max(1px, ${cq(0.15)})`, background: palette.accent }} />
      <span style={{ fontSize: cq(1.2), color: MUTED }}>{text}</span>
    </div>
  );
}

function StatPanel({ value, label, caption, palette }: { value: string; label: string; caption?: string; palette: Palette }): React.ReactElement {
  return (
    <div className="flex flex-col justify-center" style={{ width: "42%", background: palette.primary, padding: `${cq(5)} ${cq(4.2)}` }}>
      <div className="font-extrabold" style={{ fontSize: cq(5.4), lineHeight: 1, letterSpacing: "-0.02em", color: palette.accent }}>
        {value}
      </div>
      <div className="font-semibold" style={{ fontSize: cq(1.55), lineHeight: 1.35, color: "rgba(255,255,255,0.9)", marginTop: cq(1.2) }}>
        {label}
      </div>
      {caption ? (
        <div
          style={{
            fontSize: cq(1.05),
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.6)",
            marginTop: cq(2),
            paddingTop: cq(1.2),
            borderTop: `max(1px, ${cq(0.08)}) solid rgba(255,255,255,0.15)`,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}

/** Rail rows are this tall, so the joining line runs from the first dot's center to the last's. */
const RAIL_ROW = 2.4;

function Rail({ items, palette }: { items: readonly string[]; palette: Palette }): React.ReactElement {
  return (
    <div className="flex items-center shrink-0" style={{ width: "34%" }}>
      <div className="relative flex flex-col w-full" style={{ gap: cq(2.4) }}>
        {items.length > 1 ? (
          <span
            aria-hidden
            className="absolute"
            style={{
              left: cq(0.54),
              top: cq(RAIL_ROW / 2),
              bottom: cq(RAIL_ROW / 2),
              width: `max(1px, ${cq(0.12)})`,
              background: palette.accent,
              opacity: 0.6,
            }}
          />
        ) : null}
        {items.map((item) => (
          <div key={item} className="relative flex items-center" style={{ gap: cq(1.4), minHeight: cq(RAIL_ROW) }}>
            <span
              className="rounded-full shrink-0"
              style={{ width: cq(1.2), height: cq(1.2), background: "#fff", border: `${cq(0.22)} solid ${palette.accent}` }}
            />
            <span className="font-semibold" style={{ fontSize: cq(1.45), lineHeight: 1.3, color: INK }}>
              {item}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  heading,
  stat,
  isProduct,
  palette,
}: {
  heading: string;
  stat: PitchStat;
  isProduct: boolean;
  palette: Palette;
}): React.ReactElement {
  return (
    <div
      className="flex-1 min-w-0"
      style={{
        borderRadius: cq(1),
        padding: `${cq(1.8)} ${cq(2.2)}`,
        background: isProduct ? palette.primary : WASH,
        border: isProduct ? "none" : `max(1px, ${cq(0.08)}) solid ${HAIRLINE}`,
      }}
    >
      <div className="font-bold uppercase" style={{ ...LABEL_STYLE, color: isProduct ? "rgba(255,255,255,0.7)" : MUTED }}>
        {heading}
      </div>
      <div
        className="font-extrabold"
        style={{ fontSize: cq(3.6), lineHeight: 1.1, marginTop: cq(0.8), color: isProduct ? palette.accent : BODY }}
      >
        {stat.value}
      </div>
      <div style={{ fontSize: cq(1.3), lineHeight: 1.4, marginTop: cq(0.4), color: isProduct ? "rgba(255,255,255,0.85)" : MUTED }}>
        {stat.label}
      </div>
    </div>
  );
}

function Arrow(): React.ReactElement {
  return (
    <div aria-hidden className="flex items-center shrink-0" style={{ width: cq(4) }}>
      <span className="flex-1" style={{ height: `max(1px, ${cq(0.15)})`, background: FAINT }} />
      <span
        style={{
          width: 0,
          height: 0,
          borderTop: `${cq(0.6)} solid transparent`,
          borderBottom: `${cq(0.6)} solid transparent`,
          borderLeft: `${cq(0.9)} solid ${FAINT}`,
        }}
      />
    </div>
  );
}

function PeopleColumn({ people, palette }: { people: readonly PitchPerson[]; palette: Palette }): React.ReactElement {
  return (
    <div className="flex flex-col justify-center shrink-0" style={{ width: "36%", gap: cq(2.2) }}>
      {people.map((person) => (
        <div key={person.name} className="flex items-center" style={{ gap: cq(1.4) }}>
          <span
            className="rounded-full shrink-0 flex items-center justify-center font-bold"
            style={{ width: cq(5), height: cq(5), background: palette.primary, color: "#fff", fontSize: cq(1.55) }}
          >
            {pitchInitials(person.name)}
          </span>
          <div className="min-w-0">
            {person.role ? (
              <div className="font-bold uppercase" style={{ ...LABEL_STYLE, fontSize: cq(1), color: palette.accentText }}>
                {person.role}
              </div>
            ) : null}
            <div className="font-semibold" style={{ fontSize: cq(1.5), lineHeight: 1.25, color: INK }}>
              {person.name}
            </div>
            <div style={{ fontSize: cq(1.2), lineHeight: 1.3, color: MUTED }}>{person.title}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ steps, palette }: { steps: readonly string[]; palette: Palette }): React.ReactElement {
  return (
    <div className="relative shrink-0" style={{ marginBottom: cq(2.4) }}>
      {/* From the first node's center to the last's (each step is an equal-width column). */}
      <span
        aria-hidden
        className="absolute"
        style={{
          left: `${50 / steps.length}%`,
          right: `${50 / steps.length}%`,
          top: cq(0.9),
          height: `max(1px, ${cq(0.12)})`,
          background: HAIRLINE,
        }}
      />
      <ol className="relative flex justify-between">
        {steps.map((step, index) => (
          <li key={step} className="flex flex-col items-center text-center" style={{ width: `${100 / steps.length}%`, gap: cq(1) }}>
            <span
              className="rounded-full"
              style={{
                width: cq(1.8),
                height: cq(1.8),
                background: index === 0 ? palette.accent : "#fff",
                border: index === 0 ? "none" : `${cq(0.2)} solid ${FAINT}`,
              }}
            />
            <span
              className={index === 0 ? "font-bold" : "font-medium"}
              style={{ fontSize: cq(1.4), color: index === 0 ? palette.accentText : BODY }}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Slide ───

/**
 * One pitch slide for the given theme and config. The layout comes from
 * resolvePitchLayout (plain when its data is missing); the student's text is the
 * single StudentText bound to slide.field.
 */
export function PitchSlide<F extends string>({
  theme,
  slide,
  slideNumber,
  value,
  onChange,
  placeholder = "Type here…",
  bare = false,
}: PitchSlideProps<F>): React.ReactElement {
  const accent = theme.accentColor ?? DEFAULT_PITCH_ACCENT;
  const palette: Palette = {
    primary: theme.primaryColor ?? DEFAULT_PITCH_PRIMARY,
    accent,
    // The accent darkened for small text, so labels stay readable on white.
    accentText: `color-mix(in srgb, ${accent} 70%, #000)`,
  };
  const resolved = resolvePitchLayout(slide);
  const text = (variant: "body" | "quote" = "body"): React.ReactElement => (
    <StudentText
      field={slide.field}
      title={slide.title}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      variant={variant}
    />
  );
  const master = (body: React.ReactNode): React.ReactElement => (
    <MasterColumn theme={theme} slideNumber={slideNumber} label={slide.sectionLabel} title={slide.title} palette={palette}>
      {body}
    </MasterColumn>
  );

  let content: React.ReactElement;
  switch (resolved.layout) {
    case "quote":
      content = master(
        <>
          <QuoteMark palette={palette} />
          {text("quote")}
          <Attribution text={resolved.data.attribution} palette={palette} />
        </>
      );
      break;
    case "split-stat":
      content = (
        <>
          <div className="flex min-w-0" style={{ width: "58%" }}>
            {master(text())}
          </div>
          <StatPanel {...resolved.data} palette={palette} />
        </>
      );
      break;
    case "text-rail":
      content = master(
        <div className="flex-1 min-h-0 flex" style={{ gap: cq(4) }}>
          <div className="flex-1 min-w-0 flex flex-col">{text()}</div>
          <Rail items={resolved.data.items} palette={palette} />
        </div>
      );
      break;
    case "before-after":
      content = master(
        <>
          <div className="flex items-stretch shrink-0" style={{ gap: cq(1.6), marginBottom: cq(2.2) }}>
            <StatCard heading="Today" stat={resolved.data.before} isProduct={false} palette={palette} />
            <Arrow />
            <StatCard heading={`With ${theme.productName}`} stat={resolved.data.after} isProduct palette={palette} />
          </div>
          {text()}
        </>
      );
      break;
    case "people":
      content = master(
        <div className="flex-1 min-h-0 flex" style={{ gap: cq(4) }}>
          <div className="flex-1 min-w-0 flex flex-col">{text()}</div>
          <PeopleColumn people={resolved.data.people} palette={palette} />
        </div>
      );
      break;
    case "timeline":
      content = master(
        <>
          <Timeline steps={resolved.data.steps} palette={palette} />
          {text()}
        </>
      );
      break;
    default:
      content = master(text());
  }

  return (
    // The wrapper is the size container: everything inside scales with the slide's width.
    <div className="w-full" style={{ containerType: "inline-size" }}>
      <div
        className="relative w-full aspect-video overflow-hidden bg-white flex"
        data-pitch-layout={resolved.layout}
        style={{
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
          borderRadius: cq(1.1),
          border: bare ? "none" : `1px solid ${HAIRLINE}`,
          boxShadow: bare ? "none" : `0 ${cq(0.5)} ${cq(2)} rgba(15, 23, 42, 0.08)`,
        }}
      >
        {content}
      </div>
    </div>
  );
}
