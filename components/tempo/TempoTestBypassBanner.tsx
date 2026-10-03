/**
 * TempoTestBypassBanner.tsx
 * Persistent amber banner when TEMPO_TEST_BYPASS_GATES is on.
 * Driven only by a server-passed boolean prop — never reads process.env.
 */

type TempoTestBypassBannerProps = {
  /** Server page boolean from TEMPO_TEST_BYPASS_GATES. */
  testBypass: boolean;
};

/**
 * Renders nothing when bypass is off; otherwise a fixed, hard-to-miss banner.
 */
export function TempoTestBypassBanner({
  testBypass,
}: TempoTestBypassBannerProps): React.ReactElement | null {
  if (!testBypass) {
    return null;
  }

  return (
    <div
      className="fixed top-16 inset-x-0 z-[60] bg-amber-500 text-black px-4 py-2 text-center font-headline-md text-sm tracking-wide shadow-md"
      role="status"
    >
      TEST MODE: gates bypassed — do not treat this run as real student work
    </div>
  );
}
