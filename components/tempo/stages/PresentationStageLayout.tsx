/**
 * PresentationStageLayout.tsx
 * Presentational shell for Tempo Stage 3 Presentation — a simple slide-deck
 * builder. The Submit bar (save status left; slides counter and Submit right)
 * sits under the app top bar. Below it: a rail of six slide thumbnails (a
 * horizontal strip on mobile) and the active slide on a grey canvas, with one
 * line of direction above it and Previous / Next below. Each slide's text area
 * is bound to one PresentationForm field (PRESENTATION_SLIDES in
 * lib/tempo-presentation.ts) through the same onUpdateField handler, so autosave,
 * the "Auto-saved" status, Submit and grading are unchanged.
 * The discovery reference lives in the Reference Library drawer (PresentationStage).
 */

"use client";

import { useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TempoStageForwardNav } from "@/components/tempo/TempoStageForwardNav";
import {
  countCompletedPresentationSections,
  isPresentationSectionComplete,
  PRESENTATION_SECTIONS,
  PRESENTATION_SLIDES,
  type PresentationForm,
  type PresentationSlide,
} from "@/lib/tempo-presentation";

type PresentationStageLayoutProps = {
  form: PresentationForm;
  canSubmit: boolean;
  isSaving: boolean;
  isSubmitting: boolean;
  onUpdateField: <K extends keyof PresentationForm>(key: K, value: PresentationForm[K]) => void;
  onSubmit: () => void;
  /** Extra top padding when TEST MODE banner is visible (matches Prospecting). */
  testBypass?: boolean;
};

/** The first slide that isn't complete yet, or the first slide. */
function firstIncompleteSlideIndex(form: PresentationForm): number {
  const index = PRESENTATION_SLIDES.findIndex((slide) => !isPresentationSectionComplete(slide.number, form));
  return index === -1 ? 0 : index;
}

/** "N / 6 slides completed" with a thin progress bar underneath. */
function SlidesCounter({ completed }: { completed: number }): React.ReactElement {
  const total = PRESENTATION_SECTIONS.length;
  return (
    <div className="flex flex-col items-end gap-1" aria-live="polite">
      <span className="text-label-sm text-on-surface-variant whitespace-nowrap">
        {completed} / {total} slides completed
      </span>
      <div className="w-28 h-1 rounded-full bg-surface-container-high overflow-hidden" aria-hidden>
        <div
          className="h-full rounded-full bg-[#1a1a2e] transition-[width] duration-300"
          style={{ width: `${(completed / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

/** One rail thumbnail: a tiny preview, a check when complete, the number and title underneath. */
function SlideThumbnail({
  slide,
  value,
  isActive,
  isComplete,
  onSelect,
}: {
  slide: PresentationSlide;
  value: string;
  isActive: boolean;
  isComplete: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const hasText = value.trim().length > 0;
  const frameClass = isActive
    ? "border-2 border-[#1a1a2e]"
    : hasText
      ? "border border-outline-variant"
      : "border border-dashed border-outline-variant";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isActive ? "step" : undefined}
      aria-label={`Slide ${slide.number}: ${slide.title}${isComplete ? " (complete)" : ""}`}
      className="w-full text-left"
    >
      <div className={`relative aspect-video rounded-md bg-white overflow-hidden ${frameClass}`}>
        <div className="p-2 space-y-1.5">
          <div className="h-1.5 w-1/2 rounded-full bg-[#1a1a2e]/70" />
          {hasText ? (
            <>
              <div className="h-1 w-5/6 rounded-full bg-outline-variant/70" />
              <div className="h-1 w-2/3 rounded-full bg-outline-variant/50" />
            </>
          ) : null}
        </div>
        {isComplete ? (
          <MaterialIcon name="check_circle" filled className="absolute top-1 right-1 text-[14px] text-green-600" />
        ) : null}
      </div>
      <p className={`mt-1 text-[11px] leading-tight ${isActive ? "text-on-surface font-semibold" : "text-on-surface-variant"}`}>
        <span className="font-semibold">{slide.number}</span> {slide.title}
      </p>
    </button>
  );
}

/** The active slide: navy band, eyebrow, title, the student's text area and the slide number. */
function SlideCanvas({
  slide,
  value,
  onChange,
}: {
  slide: PresentationSlide;
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <div className="aspect-video w-full bg-white rounded-xl border border-outline-variant shadow-md overflow-hidden flex flex-col">
      <div className="h-8 shrink-0 bg-[#1a1a2e] px-6 flex items-center justify-between">
        <span className="text-white text-[11px] font-bold uppercase tracking-[0.2em]">Tempo</span>
        <span className="text-white/60 text-[11px] font-medium">
          Section {String(slide.number).padStart(2, "0")}
        </span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col px-6 sm:px-10 pt-5 sm:pt-7 pb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-[#c9a84c] shrink-0" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#94762b]">{slide.label}</span>
        </div>
        <h2 className="text-[24px] font-bold text-[#1a1a2e] leading-tight mb-3">{slide.title}</h2>
        <textarea
          aria-label={slide.title}
          className="flex-1 min-h-0 w-full resize-none border-0 bg-transparent p-0 text-[16px] leading-relaxed text-on-surface placeholder:text-outline focus:outline-none focus:ring-0"
          placeholder="Type here…"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="mt-2 pt-2 border-t border-outline-variant/60 flex justify-end text-[11px] text-on-surface-variant">
          {slide.number}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the Presentation stage: the Submit bar, the slide rail and the active slide.
 * Starts on the first incomplete slide.
 */
export function PresentationStageLayout({
  form,
  canSubmit,
  isSaving,
  isSubmitting,
  onUpdateField,
  onSubmit,
  testBypass = false,
}: PresentationStageLayoutProps): React.ReactElement {
  const [activeIndex, setActiveIndex] = useState(() => firstIncompleteSlideIndex(form));
  const slide = PRESENTATION_SLIDES[activeIndex] ?? PRESENTATION_SLIDES[0];
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === PRESENTATION_SLIDES.length - 1;

  return (
    <div
      className={`fixed inset-0 z-[45] flex flex-col overflow-hidden bg-surface ${
        testBypass ? "pt-28" : "pt-16"
      }`}
    >
      <main className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {/* ── Submit bar ─── */}
        <div className="h-12 bg-surface-container-low border-b border-outline-variant shrink-0 flex items-center justify-between px-4 lg:px-xl gap-4">
          <div className="flex items-center gap-sm text-on-surface-variant min-w-0 shrink-0">
            <MaterialIcon name="cloud_done" className="text-green-500" />
            <span className="text-label-sm">{isSaving ? "Saving..." : "Auto-saved"}</span>
          </div>

          <TempoStageForwardNav
            forwardLabel="Submit"
            forwardDisabled={!canSubmit || isSubmitting}
            isForwardLoading={isSubmitting}
            onForward={onSubmit}
            forwardHint={canSubmit ? null : "Finish all sections to submit."}
            actions={<SlidesCounter completed={countCompletedPresentationSections(form)} />}
          />
        </div>

        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
          {/* ── Slide rail (a horizontal strip on mobile) ─── */}
          <nav
            aria-label="Slides"
            className="shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-outline-variant lg:w-[190px] overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto custom-scrollbar"
          >
            <ol className="flex lg:flex-col gap-3 p-3">
              {PRESENTATION_SLIDES.map((item, index) => (
                <li key={item.field} className="w-28 lg:w-auto shrink-0">
                  <SlideThumbnail
                    slide={item}
                    value={form[item.field]}
                    isActive={index === activeIndex}
                    isComplete={isPresentationSectionComplete(item.number, form)}
                    onSelect={() => setActiveIndex(index)}
                  />
                </li>
              ))}
            </ol>
          </nav>

          {/* ── Canvas: direction, the slide, Previous / Next ─── */}
          <section className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-surface-container-low custom-scrollbar">
            <div className="max-w-4xl mx-auto px-4 lg:px-xl py-6 lg:py-8 space-y-4">
              <div>
                <p className="text-body-md text-on-surface-variant">{slide.direction}</p>
                {slide.directionNote ? (
                  <p className="mt-1 font-code-md text-[12px] text-on-surface-variant/80">{slide.directionNote}</p>
                ) : null}
              </div>

              <SlideCanvas
                slide={slide}
                value={form[slide.field]}
                onChange={(value) => onUpdateField(slide.field, value)}
              />

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
                  disabled={isFirst}
                  className="h-10 px-4 rounded-lg border border-outline-variant bg-white text-label-md font-semibold text-on-surface hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  onClick={() => setActiveIndex((index) => Math.min(PRESENTATION_SLIDES.length - 1, index + 1))}
                  disabled={isLast}
                  className="h-10 px-4 rounded-lg bg-[#1a1a2e] text-white text-label-md font-semibold hover:bg-[#252545] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next slide →
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
