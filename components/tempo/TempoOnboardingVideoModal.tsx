/**
 * TempoOnboardingVideoModal.tsx
 * Onboarding welcome video for Tempo simulation entry — inline player (fresh start) and modal trigger (in progress).
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TEMPO_ONBOARDING_VIDEO_URL, TEMPO_ONBOARDING_CAPTIONS_URL } from "@/lib/tempo-onboarding-video";
import { parseVtt, type VttCue } from "@/lib/parse-vtt";

const CENTER_CONTROL_HIDE_MS = 900;

/**
 * Formats seconds as m:ss for the video timeline display.
 */
function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

type OnboardingVideoPlayerProps = {
  autoPlay?: boolean;
  className?: string;
};

/**
 * Custom onboarding player — center play/pause overlay plus seek, volume, and captions controls.
 */
function OnboardingVideoPlayer({
  autoPlay = false,
  className,
}: OnboardingVideoPlayerProps): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideOverlayTimerRef = useRef<number | null>(null);
  const isSeekingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionCues, setCaptionCues] = useState<VttCue[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!TEMPO_ONBOARDING_CAPTIONS_URL) {
      return;
    }

    let cancelled = false;

    void fetch(TEMPO_ONBOARDING_CAPTIONS_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Captions fetch failed (${response.status})`);
        }
        return response.text();
      })
      .then((vttContent) => {
        if (!cancelled) {
          setCaptionCues(parseVtt(vttContent));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCaptionCues([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const clearHideTimer = useCallback((): void => {
    if (hideOverlayTimerRef.current !== null) {
      window.clearTimeout(hideOverlayTimerRef.current);
      hideOverlayTimerRef.current = null;
    }
  }, []);

  const scheduleHideChrome = useCallback((): void => {
    clearHideTimer();
    hideOverlayTimerRef.current = window.setTimeout(() => {
      setShowChrome(false);
    }, CENTER_CONTROL_HIDE_MS);
  }, [clearHideTimer]);

  const revealChrome = useCallback((): void => {
    clearHideTimer();
    setShowChrome(true);
  }, [clearHideTimer]);

  const togglePlay = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      await video.play();
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback((): void => {
    setIsMuted((muted) => !muted);
  }, []);

  const handleVolumeChange = useCallback((nextVolume: number): void => {
    const clamped = Math.min(1, Math.max(0, nextVolume));
    setVolume(clamped);
    if (clamped > 0) {
      setIsMuted(false);
    }
  }, []);

  const handleSeek = useCallback((nextTime: number): void => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(nextTime)) {
      return;
    }
    const clamped = Math.min(Math.max(0, nextTime), duration || video.duration || 0);
    video.currentTime = clamped;
    setCurrentTime(clamped);
  }, [duration]);

  const toggleCaptions = useCallback((): void => {
    setCaptionsOn((on) => !on);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.volume = volume;
    video.muted = isMuted;
  }, [volume, isMuted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const onPlay = (): void => {
      setIsPlaying(true);
      scheduleHideChrome();
    };
    const onPause = (): void => {
      setIsPlaying(false);
      clearHideTimer();
      setShowChrome(true);
    };
    const onEnded = (): void => {
      setIsPlaying(false);
      clearHideTimer();
      setShowChrome(true);
    };
    const onTimeUpdate = (): void => {
      if (!isSeekingRef.current) {
        setCurrentTime(video.currentTime);
      }
    };
    const onLoadedMetadata = (): void => {
      setDuration(video.duration);
    };
    const onDurationChange = (): void => {
      if (Number.isFinite(video.duration)) {
        setDuration(video.duration);
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("durationchange", onDurationChange);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("durationchange", onDurationChange);
      clearHideTimer();
    };
  }, [clearHideTimer, scheduleHideChrome]);

  useEffect(() => {
    if (!autoPlay || !videoRef.current) {
      return;
    }
    void videoRef.current.play().catch(() => {
      setShowChrome(true);
    });
  }, [autoPlay]);

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const displayVolume = isMuted ? 0 : volume;
  const activeCaption =
    captionsOn && captionCues.length > 0
      ? captionCues.find((cue) => currentTime >= cue.start && currentTime < cue.end)?.text ?? null
      : null;
  const captionsAvailable = captionCues.length > 0;

  return (
    <div
      className={`relative h-full w-full group ${className ?? ""}`}
      onMouseEnter={revealChrome}
      onMouseLeave={() => {
        if (isPlaying) {
          scheduleHideChrome();
        }
      }}
      onMouseMove={revealChrome}
    >
      <video
        ref={videoRef}
        src={TEMPO_ONBOARDING_VIDEO_URL}
        crossOrigin="anonymous"
        playsInline
        preload="metadata"
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        className="h-full w-full object-contain cursor-pointer bg-white"
        onClick={() => {
          void togglePlay();
        }}
      />

      {activeCaption ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-14 z-[15] flex justify-center px-4"
          aria-live="polite"
        >
          <p className="max-w-[90%] rounded-md bg-black/80 px-3 py-1.5 text-center text-sm font-medium leading-snug text-white">
            {activeCaption}
          </p>
        </div>
      ) : null}

      <button
        type="button"
        aria-label={isPlaying ? "Pause video" : "Play video"}
        onClick={(event) => {
          event.stopPropagation();
          void togglePlay();
        }}
        className={`absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300 ${
          showChrome ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-black/55 backdrop-blur-sm shadow-lg">
          <MaterialIcon
            name={isPlaying ? "pause" : "play_arrow"}
            className="text-[36px] text-white"
          />
        </span>
      </button>

      <div
        className={`absolute inset-x-0 bottom-0 z-20 px-4 pb-3 pt-10 bg-gradient-to-t from-black/85 via-black/50 to-transparent transition-opacity duration-300 ${
          showChrome ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:block font-code-md text-[11px] text-white/70 tabular-nums w-9 text-right shrink-0">
            {formatVideoTime(currentTime)}
          </span>

          <input
            type="range"
            min={0}
            max={safeDuration || 1}
            step={0.1}
            value={Math.min(currentTime, safeDuration || currentTime)}
            onPointerDown={() => {
              isSeekingRef.current = true;
              revealChrome();
            }}
            onPointerUp={() => {
              isSeekingRef.current = false;
            }}
            onPointerLeave={() => {
              isSeekingRef.current = false;
            }}
            onChange={(event) => handleSeek(Number(event.target.value))}
            aria-label="Seek video"
            className="h-1 min-w-0 flex-1 cursor-pointer accent-white"
          />

          <span className="hidden sm:block font-code-md text-[11px] text-white/70 tabular-nums w-9 shrink-0">
            {formatVideoTime(safeDuration)}
          </span>

          <div className="relative flex shrink-0 items-center group/volume">
            <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 rounded-lg border border-white/10 bg-black/90 px-2 py-3 opacity-0 transition-opacity duration-150 group-hover/volume:opacity-100 group-focus-within/volume:opacity-100 group-hover/volume:pointer-events-auto group-focus-within/volume:pointer-events-auto">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={displayVolume}
                onChange={(event) => handleVolumeChange(Number(event.target.value))}
                aria-label="Video volume"
                className="h-20 w-1 cursor-pointer accent-white [direction:rtl] [writing-mode:vertical-lr]"
              />
            </div>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted || volume === 0 ? "Unmute video" : "Mute video"}
              className="text-white/90 hover:text-white transition-colors p-1"
            >
              <MaterialIcon
                name={
                  isMuted || volume === 0
                    ? "volume_off"
                    : volume < 0.5
                      ? "volume_down"
                      : "volume_up"
                }
                className="text-[22px]"
              />
            </button>
          </div>

          <button
            type="button"
            onClick={toggleCaptions}
            disabled={!captionsAvailable}
            aria-label={captionsOn ? "Hide captions" : "Show captions"}
            aria-pressed={captionsOn}
            className={`shrink-0 p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              captionsOn ? "text-white" : "text-white/60 hover:text-white/90"
            }`}
          >
            <MaterialIcon name="closed_caption" className="text-[22px]" />
          </button>
        </div>
      </div>
    </div>
  );
}

type TempoOnboardingVideoModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Full-screen modal with custom video player, Skip, and Close controls.
 */
export function TempoOnboardingVideoModal({
  isOpen,
  onClose,
}: TempoOnboardingVideoModalProps): React.ReactElement | null {
  const [isMounted, setIsMounted] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const requestClose = useCallback((): void => {
    setIsClosing(true);
    window.setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 150);
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, requestClose]);

  if (!isMounted || !isOpen) {
    return null;
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-8 ${
        isClosing ? "animate-overlay-out" : "animate-overlay-in"
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tempo-onboarding-video-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        className={`w-full max-w-4xl rounded-xl bg-primary-container border border-white/10 shadow-2xl overflow-hidden ${
          isClosing ? "animate-modal-out" : "animate-modal-in"
        }`}
      >
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-white/10">
          <h2
            id="tempo-onboarding-video-title"
            className="font-display text-headline-md text-white"
          >
            Welcome to Tempo
          </h2>
          <button
            type="button"
            onClick={requestClose}
            className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors"
            aria-label="Close onboarding video"
          >
            <MaterialIcon name="close" className="text-[20px]" />
            Close
          </button>
        </div>

        <div className="aspect-video bg-white">
          <OnboardingVideoPlayer autoPlay />
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/10">
          <button
            type="button"
            onClick={requestClose}
            className="px-5 py-2.5 rounded-full text-sm font-semibold text-white/80 hover:text-white border border-white/20 hover:border-white/40 transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Inline hero player — embedded below the fresh-start briefing, no modal.
 */
export function TempoOnboardingVideoInline(): React.ReactElement {
  return (
    <div className="w-full">
      <div className="text-on-surface-variant text-[12px] font-bold tracking-widest uppercase mb-4">
        Onboarding Briefing
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-white">
        <OnboardingVideoPlayer />
      </div>
    </div>
  );
}

/**
 * Entry-page trigger button that opens the onboarding video modal: an outlined
 * secondary button for a light card (the in-progress page's Assignment Objective).
 */
export function TempoOnboardingVideoTrigger(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg border border-secondary text-secondary font-semibold text-body-md hover:bg-secondary/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/40"
      >
        <MaterialIcon name="play_circle" className="text-[20px]" />
        Watch onboarding video
      </button>
      <TempoOnboardingVideoModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
