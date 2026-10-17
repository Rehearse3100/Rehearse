/**
 * TempoStageMenu.tsx
 * Hamburger menu in the Tempo top bar (TempoStageTopBar): Exit Simulation,
 * Handoff Note, CRM (testing purposes; tester mode only), and Restart. Exit,
 * Handoff Note, and Restart behave exactly as the old standalone controls; CRM
 * opens the CRM home and shows only when the server's TEMPO_TEST_BYPASS_GATES flag
 * reaches it as testBypass (through CrmAccess's context — never process.env).
 * The panel is portaled into document.body (fixed, z-[70]) so it sits above the
 * TEST MODE banner (z-[60]) and the Reference Library drawer (z-[48]), and below
 * ConfirmModal (z-[100]). It stays mounted while closed (invisible), because
 * RestartSimulationButton holds its confirm popup's state. Opening fades and
 * drops it into place; reduced-motion users get no animation.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTempoCrmGate } from "@/components/crm/CrmOverlay";
import { RestartSimulationButton } from "@/components/simulation/RestartSimulationButton";
import { useExitSimulation } from "@/components/tempo/TempoExitSimulation";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

/** Gap between the trigger's bottom edge and the panel. */
const PANEL_OFFSET_PX = 8;

const MENU_ITEM =
  "w-full flex items-center gap-2 px-3 py-2 text-left font-label-sm text-label-sm text-on-surface hover:bg-surface-container focus:outline-none focus-visible:bg-surface-container transition-colors";

// Open: fade in and drop 4px into place (150ms ease-out). Visibility is not
// transitioned on open, so it turns visible at once and focus can move in.
const PANEL_OPEN =
  "visible opacity-100 translate-y-0 scale-100 transition-[opacity,transform] duration-150 ease-out";
// Close: the reverse (100ms ease-in). Visibility is transitioned, so the panel stays
// visible until the fade ends, then hides (out of the Tab order, as `hidden` was).
const PANEL_CLOSED =
  "invisible opacity-0 -translate-y-1 scale-[0.98] pointer-events-none transition-[opacity,transform,visibility] duration-100 ease-in";

type TempoStageMenuProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  onOpenHandoff: () => void;
  /** Shared top-bar button classes (BAR_BUTTON in TempoStageTopBar). */
  buttonBaseClass: string;
};

type PanelPosition = {
  top: number;
  right: number;
};

/** Buttons inside the panel, in order (the Restart row's own button included). */
function getMenuItemButtons(panel: HTMLDivElement | null): HTMLButtonElement[] {
  return Array.from(panel?.querySelectorAll<HTMLButtonElement>("button") ?? []);
}

/**
 * Menu trigger plus a portaled panel, right-aligned under the trigger.
 */
export function TempoStageMenu({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  onOpenHandoff,
  buttonBaseClass,
}: TempoStageMenuProps): React.ReactElement {
  const handleExit = useExitSimulation();
  // The menu renders inside CrmAccess (via the stage top bar), which provides
  // openCrmHome and the server's testBypass flag (false outside CrmAccess).
  const { openCrmHome, testBypass } = useTempoCrmGate();
  const [isOpen, setIsOpen] = useState(false);
  // Portal needs document.body, so the panel renders only after mount.
  const [isMounted, setIsMounted] = useState(false);
  const [position, setPosition] = useState<PanelPosition>({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const closeMenu = (): void => {
    setIsOpen(false);
  };

  const toggleMenu = (): void => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Right-align the panel with the trigger (clientWidth excludes any scrollbar).
      setPosition({
        top: rect.bottom + PANEL_OFFSET_PX,
        right: document.documentElement.clientWidth - rect.right,
      });
    }
    setIsOpen(true);
  };

  // While open: move focus into the panel, and close on outside click, Escape,
  // Tab, resize, or scroll. Arrow keys move between items.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    getMenuItemButtons(panelRef.current)[0]?.focus();

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        // Back on the trigger, the browser's Tab then moves on from there as usual.
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = getMenuItemButtons(panelRef.current);
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        items[(current + step + items.length) % items.length]?.focus();
      }
    };

    const handleViewportChange = (): void => {
      setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    // Capture so scrolling any inner container also closes the menu.
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen]);

  const panel = (
    <div
      ref={panelRef}
      role="menu"
      aria-label="Simulation menu"
      style={{ top: position.top, right: position.right }}
      className={`fixed z-[70] w-[200px] py-1 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg origin-top-right motion-reduce:transition-none ${
        isOpen ? PANEL_OPEN : PANEL_CLOSED
      }`}
    >
      <button
        type="button"
        role="menuitem"
        className={MENU_ITEM}
        onClick={() => {
          closeMenu();
          handleExit();
        }}
      >
        <MaterialIcon name="logout" className="text-[16px]" />
        Exit Simulation
      </button>
      <button
        type="button"
        role="menuitem"
        className={MENU_ITEM}
        onClick={() => {
          closeMenu();
          onOpenHandoff();
        }}
      >
        <MaterialIcon name="mail" className="text-[16px]" />
        Handoff Note
      </button>
      {testBypass ? (
        <button
          type="button"
          role="menuitem"
          className={MENU_ITEM}
          onClick={() => {
            closeMenu();
            openCrmHome();
          }}
        >
          <MaterialIcon name="hub" className="text-[16px]" />
          CRM (testing purposes)
        </button>
      ) : null}
      {/* RestartSimulationButton renders its own button and confirm popup; the
          click bubbles here to close the menu while the popup opens. */}
      <div role="menuitem" onClick={closeMenu}>
        <RestartSimulationButton
          attemptId={attemptId}
          simulationId={simulationId}
          classId={classId}
          simulationTitle={simulationTitle}
          variant="tempoMenuItem"
        />
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleMenu}
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`${buttonBaseClass} transition-colors motion-reduce:transition-none ${
          isOpen
            ? "text-on-surface bg-surface-container border border-outline"
            : "text-on-surface-variant border border-outline-variant hover:bg-surface-container"
        }`}
      >
        <MaterialIcon name="menu" className="text-[16px]" />
      </button>
      {isMounted ? createPortal(panel, document.body) : null}
    </>
  );
}
