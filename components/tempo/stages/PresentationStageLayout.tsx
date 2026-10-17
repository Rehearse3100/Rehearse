/**
 * PresentationStageLayout.tsx
 * Presentational shell for Tempo Stage 3 Presentation — the stage's navy mission
 * sidebar on the left (as on every stage), and a simple slide-deck builder in the
 * center column: the Submit bar (save status left; slides counter and Submit
 * right) on top, then a rail of six slide thumbnails (a horizontal strip on
 * mobile) and the active slide on a grey canvas, with the section name as a large
 * heading and its direction above it, and Previous / Next below. The slides are
 * the reusable PitchSlide (components/presentation/PitchSlide.tsx) with Tempo's
 * deck and configs (TEMPO_PITCH_DECK, TEMPO_PITCH_SLIDES in lib/tempo-presentation.ts);
 * thumbnails are read-only. Slide N binds section N's PresentationForm field through the
 * same onUpdateField handler, so autosave, the "Auto-saved" status, Submit and
 * grading are unchanged.
 * The discovery reference lives in the Reference Library drawer (PresentationStage).
 */

"use client";

import { useState } from "react";
import { PitchSlide } from "@/components/presentation/PitchSlide";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TempoStageForwardNav } from "@/components/tempo/TempoStageForwardNav";
import { resolvePitchTheme, type PitchSlideConfig } from "@/lib/pitch-deck";
import {
  countCompletedPresentationSections,
  isPresentationSectionComplete,
  PRESENTATION_SECTIONS,
  TEMPO_PITCH_DECK,
  TEMPO_PITCH_SLIDES,
  type PresentationForm,
} from "@/lib/tempo-presentation";

type TempoSlide = PitchSlideConfig<keyof PresentationForm>;

/** Tempo's deck colours (the heading above the slide uses its primary). */
const DECK_THEME = resolvePitchTheme(TEMPO_PITCH_DECK);

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

/** The first slide that isn't complete yet, or the first slide (slide N is section N). */
function firstIncompleteSlideIndex(form: PresentationForm): number {
  const index = TEMPO_PITCH_SLIDES.findIndex((_, i) => !isPresentationSectionComplete(i + 1, form));
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

/**
 * One rail thumbnail: the slide number on top, then the read-only slide itself
 * (same template, scaled down) with a check when complete. Active: 2px navy
 * frame; empty and not active: dashed.
 */
function SlideThumbnail({
  slide,
  slideNumber,
  value,
  isActive,
  isComplete,
  onSelect,
}: {
  slide: TempoSlide;
  slideNumber: number;
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
      aria-label={`Slide ${slideNumber}: ${slide.title}${isComplete ? " (complete)" : ""}`}
      className="w-full text-left"
    >
      <p className={`mb-1 text-[11px] font-semibold leading-tight ${isActive ? "text-on-surface" : "text-on-surface-variant"}`}>
        {slideNumber}
      </p>
      <div className={`relative rounded-md bg-white overflow-hidden ${frameClass}`}>
        <div className="pointer-events-none" aria-hidden>
          <PitchSlide deck={TEMPO_PITCH_DECK} slide={slide} slideNumber={slideNumber} value={value} bare />
        </div>
        {isComplete ? (
          <MaterialIcon name="check_circle" filled className="absolute top-1 right-1 text-[14px] text-green-600" />
        ) : null}
      </div>
    </button>
  );
}

/**
 * Renders the Presentation stage: the mission sidebar, then the Submit bar, the
 * slide rail and the active slide. Starts on the first incomplete slide.
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
  const slide = TEMPO_PITCH_SLIDES[activeIndex] ?? TEMPO_PITCH_SLIDES[0];
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === TEMPO_PITCH_SLIDES.length - 1;

  return (
    <div
      className={`fixed inset-0 z-[45] flex flex-col overflow-hidden bg-surface ${
        testBypass ? "pt-28" : "pt-16"
      }`}
    >
      <main className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left column: mission ─── */}
        <aside className="w-[280px] bg-[#1a1a2e] text-white flex flex-col p-6 overflow-y-auto border-r border-outline-variant shrink-0 hidden lg:flex">
          <div className="mb-8">
            <span className="text-[11px] font-mono-label text-blue-300 uppercase tracking-[0.2em]">
              Current Phase
            </span>
            <h2 className="font-title-lg text-white mt-1">Stage 3: Presentation</h2>
          </div>

          <div className="space-y-8">
            <div>
              <h3 className="font-mono-label text-[12px] text-blue-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                <MaterialIcon name="target" className="text-[16px]" />
                Your Mission
              </h3>
              <p className="text-body-md text-slate-300 leading-relaxed">
                Present the value of Tempo to{" "}
                <span className="text-white font-semibold">Dana Reyes</span> and{" "}
                <span className="text-white font-semibold">Dr. Saul Kim</span>. Your goal is to
                secure a pilot agreement.
              </p>
            </div>

            <div>
              <h3 className="font-mono-label text-[12px] text-blue-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                <MaterialIcon name="groups" className="text-[16px]" />
                Your Audience
              </h3>
              <div className="space-y-3">
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-sm font-bold text-white">Dana Reyes</p>
                  <p className="text-[12px] text-slate-400">Operations / Clinic Staff</p>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-sm font-bold text-white">Dr. Saul Kim</p>
                  <p className="text-[12px] text-slate-400">Owner / Revenue & ROI</p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Center column: Submit bar, then the slide rail and the active slide ─── */}
        <section className="flex-1 flex flex-col min-w-0 min-h-0">
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
              {TEMPO_PITCH_SLIDES.map((item, index) => (
                <li key={item.id} className="w-36 lg:w-auto shrink-0">
                  <SlideThumbnail
                    slide={item}
                    slideNumber={index + 1}
                    value={form[item.field]}
                    isActive={index === activeIndex}
                    isComplete={isPresentationSectionComplete(index + 1, form)}
                    onSelect={() => setActiveIndex(index)}
                  />
                </li>
              ))}
            </ol>
          </nav>

          {/* ── Canvas: section heading and direction, the slide, Previous / Next ─── */}
          <section className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-surface-container-low custom-scrollbar">
            <div className="max-w-4xl mx-auto px-4 lg:px-xl py-6 lg:py-8 space-y-4">
              <div>
                <h2 className="text-[30px] leading-tight font-bold" style={{ color: DECK_THEME.primary }}>
                  {slide.title}
                </h2>
                <p className="mt-1 text-[16px] leading-relaxed text-on-surface-variant">{slide.direction}</p>
                {slide.directionNote ? (
                  <p className="mt-1 font-code-md text-[14px] text-on-surface-variant/80">{slide.directionNote}</p>
                ) : null}
              </div>

              <PitchSlide
                deck={TEMPO_PITCH_DECK}
                slide={slide}
                slideNumber={activeIndex + 1}
                value={form[slide.field]}
                onChange={(field, value) => onUpdateField(field, value)}
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
                  onClick={() => setActiveIndex((index) => Math.min(TEMPO_PITCH_SLIDES.length - 1, index + 1))}
                  disabled={isLast}
                  className="h-10 px-4 rounded-lg bg-[#1a1a2e] text-white text-label-md font-semibold hover:bg-[#252545] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next slide →
                </button>
              </div>
            </div>
          </section>
        </div>
        </section>
      </main>
    </div>
  );
}
