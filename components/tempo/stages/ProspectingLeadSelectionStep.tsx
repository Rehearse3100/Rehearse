/**
 * ProspectingLeadSelectionStep.tsx
 * Prospecting wizard step — pick the target CRM Lead.
 * Validation + manager-note feedback run when the student clicks Next.
 */

"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { ConvertFailureModal } from "@/components/crm/ConvertFailureModal";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import type { CrmLead } from "@/types";

export type ProspectingLeadSelectionHandle = {
  /**
   * Validates the picked lead via the select API.
   * Returns true when Next may advance; false when a manager note or error blocks.
   */
  confirmSelection: () => Promise<boolean>;
};

type ProspectingLeadSelectionStepProps = {
  attemptId: string;
  selectedLeadId: string | null;
  onPickedChange: (leadId: string | null) => void;
  onSelected: (leadId: string) => Promise<void>;
};

/**
 * The student's leads (at most 3, from the Data Room shortlist) as selectable rows,
 * loaded once when the step opens.
 */
export const ProspectingLeadSelectionStep = forwardRef<
  ProspectingLeadSelectionHandle,
  ProspectingLeadSelectionStepProps
>(function ProspectingLeadSelectionStep(
  { attemptId, selectedLeadId, onPickedChange, onSelected },
  ref
): React.ReactElement {
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pickedId, setPickedId] = useState<string | null>(selectedLeadId);
  const [isSelecting, setIsSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managerNote, setManagerNote] = useState<string | null>(null);

  const loadLeads = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/student/crm-leads?attemptId=${encodeURIComponent(attemptId)}`
      );
      if (!res.ok) {
        setError("Could not load leads.");
        return;
      }
      const body = (await res.json()) as { leads?: CrmLead[] };
      setLeads(body.leads ?? []);
    } catch {
      setError("Could not load leads.");
    } finally {
      setIsLoading(false);
    }
  }, [attemptId]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    setPickedId(selectedLeadId);
  }, [selectedLeadId]);

  const handlePick = (leadId: string): void => {
    setPickedId(leadId);
    onPickedChange(leadId);
    setError(null);
  };

  /**
   * Validates and marks the picked Lead as the Prospecting target (called from Next).
   */
  const confirmSelection = useCallback(async (): Promise<boolean> => {
    if (!pickedId || isSelecting) {
      return false;
    }
    setIsSelecting(true);
    setError(null);
    setManagerNote(null);
    try {
      const res = await fetch(
        `/api/student/crm-leads/${encodeURIComponent(pickedId)}/select`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        managerNote?: string;
        error?: string;
      } | null;

      if (!res.ok || !body?.success) {
        if (typeof body?.managerNote === "string" && body.managerNote.trim()) {
          setManagerNote(body.managerNote);
          return false;
        }
        setError(body?.error ?? "Could not select this lead.");
        return false;
      }

      await onSelected(pickedId);
      return true;
    } catch {
      setError("Could not select this lead.");
      return false;
    } finally {
      setIsSelecting(false);
    }
  }, [isSelecting, onSelected, pickedId]);

  useImperativeHandle(ref, () => ({ confirmSelection }), [confirmSelection]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {managerNote ? (
        <ConvertFailureModal
          managerNote={managerNote}
          onDismiss={() => setManagerNote(null)}
        />
      ) : null}

      <div>
        <div className="flex items-center gap-sm mb-md">
          <MaterialIcon name="person_search" className="text-secondary" />
          <h3 className="font-headline-md text-headline-md">Select Your Target Lead</h3>
        </div>
        <p className="text-body-md text-on-surface-variant mb-lg">
          Choose the lead you will pursue. Your selection is checked against what your manager is
          prioritizing when you continue.
        </p>
      </div>

      {/* At most 3 leads (the Data Room shortlist), so no box or scroll area: just the rows. */}
      {isLoading ? (
        <p className="text-body-md text-on-surface-variant">Loading leads…</p>
      ) : leads.length === 0 ? (
        <p className="text-body-md text-on-surface">
          You haven&apos;t added any leads yet. Open your CRM and add at least one before continuing.
        </p>
      ) : (
        <ul className="space-y-3">
          {leads.map((lead) => {
            const isPicked = pickedId === lead.id;
            const company = lead.company_name.trim() || "Untitled lead";
            const contact = lead.contact_name.trim() || "No contact";
            return (
              <li key={lead.id}>
                <button
                  type="button"
                  onClick={() => handlePick(lead.id)}
                  disabled={isSelecting}
                  className={`w-full text-left px-lg py-md rounded-xl border flex items-center justify-between gap-4 transition-colors disabled:opacity-60 ${
                    isPicked
                      ? "border-primary-container bg-secondary-fixed/40"
                      : "border-outline-variant bg-white hover:bg-surface-container-low"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-label-md text-on-surface font-bold truncate">{company}</p>
                    <p className="text-label-sm text-on-surface-variant truncate">{contact}</p>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      isPicked ? "border-primary-container bg-primary-container" : "border-outline-variant"
                    }`}
                  >
                    {isPicked ? <MaterialIcon name="check" className="text-white text-[14px]" /> : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error ? <p className="text-sm text-error">{error}</p> : null}
    </div>
  );
});
