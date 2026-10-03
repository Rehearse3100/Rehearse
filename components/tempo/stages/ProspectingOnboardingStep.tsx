/**
 * ProspectingOnboardingStep.tsx
 * Wizard step 0 — onboarding briefing video and reading list.
 * Next unlocks when the video fires `ended` (scrubbing to the end counts).
 */

"use client";

import { useEffect, useRef } from "react";
import { TempoOnboardingVideoInline } from "@/components/tempo/TempoOnboardingVideoModal";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

type ReadingListItem = {
  title: string;
  href: string | null;
};

const READING_LIST: ReadingListItem[] = [
  { title: "Tempo Sell Sheet", href: null },
  { title: "Territory Brief", href: null },
  { title: "How We Prospect", href: null },
];

type ProspectingOnboardingStepProps = {
  attemptId: string;
  onboardingComplete: boolean;
  onOnboardingComplete: () => void;
  /** Server page boolean — when true, marks onboarding complete without waiting for video end. */
  testBypass?: boolean;
};

/**
 * Welcome briefing panel with inline onboarding video and reference reading list.
 */
export function ProspectingOnboardingStep({
  attemptId: _attemptId,
  onboardingComplete,
  onOnboardingComplete,
  testBypass = false,
}: ProspectingOnboardingStepProps): React.ReactElement {
  const videoHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (onboardingComplete) {
      return;
    }

    // testBypass short-circuit: write the same onboardingComplete record a normal run writes.
    if (testBypass) {
      onOnboardingComplete();
      return;
    }

    const video = videoHostRef.current?.querySelector("video");
    if (!video) {
      return;
    }

    const handleEnded = (): void => {
      onOnboardingComplete();
    };

    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("ended", handleEnded);
    };
  }, [onboardingComplete, onOnboardingComplete, testBypass]);

  return (
    <div className="bg-surface text-on-surface font-body-md min-h-full flex items-center justify-center px-md pt-lg pb-md">
      <main className="w-full max-w-[800px] mx-auto space-y-lg">
        <header className="flex flex-col gap-sm">
          <h1 className="font-headline-lg text-headline-lg text-primary">Welcome Briefing</h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-prose">
            Watch the briefing below, then review the reading list before you start prospecting.
          </p>
        </header>

        <div ref={videoHostRef}>
          <TempoOnboardingVideoInline />
        </div>

        <section className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
          <header className="px-gutter pt-gutter pb-md border-b border-outline-variant/30">
            <h2 className="font-headline-md text-headline-md text-on-surface">Reading List</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
              Review these materials before you move on.
            </p>
          </header>
          <ul className="divide-y divide-outline-variant/30">
            {READING_LIST.map((item) => (
              <li key={item.title}>
                {item.href ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-md px-gutter py-md hover:bg-surface-container-low transition-colors"
                  >
                    <span className="font-label-md text-label-md text-on-surface">{item.title}</span>
                    <MaterialIcon name="open_in_new" className="text-on-surface-variant text-[20px]" />
                  </a>
                ) : (
                  <div className="flex items-center justify-between gap-md px-gutter py-md opacity-60">
                    <span className="font-label-md text-label-md text-on-surface">{item.title}</span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Coming soon</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
