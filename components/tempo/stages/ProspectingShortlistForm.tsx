/**
 * ProspectingShortlistForm.tsx
 * Modal form to capture a Data Room shortlist lead (status: shortlisted).
 */

"use client";

import { useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import type { DataRoomCompany } from "@/app/api/student/data-room/route";
import type { CrmLead } from "@/types";

type ProspectingShortlistFormProps = {
  attemptId: string;
  company: DataRoomCompany;
  onCancel: () => void;
  onSaved: (lead: CrmLead) => void;
};

type FormValues = {
  contactName: string;
  contactTitle: string;
  decisionMakerRationale: string;
  whyFit: string;
  trigger: string;
  nextStep: string;
};

/**
 * Shortlist capture modal — company is fixed; contact comes from roster.
 */
export function ProspectingShortlistForm({
  attemptId,
  company,
  onCancel,
  onSaved,
}: ProspectingShortlistFormProps): React.ReactElement {
  const [values, setValues] = useState<FormValues>({
    contactName: "",
    contactTitle: "",
    decisionMakerRationale: "",
    whyFit: "",
    trigger: "",
    nextStep: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = useMemo(() => {
    return (
      Boolean(values.contactName.trim()) &&
      Boolean(values.decisionMakerRationale.trim()) &&
      Boolean(values.whyFit.trim()) &&
      Boolean(values.trigger.trim()) &&
      Boolean(values.nextStep.trim()) &&
      !isSaving
    );
  }, [isSaving, values]);

  const handleContactChange = (contactName: string): void => {
    const match = company.contacts.find((c) => c.name === contactName);
    setValues((prev) => ({
      ...prev,
      contactName,
      contactTitle: match?.title ?? "",
    }));
  };

  const handleSave = async (): Promise<void> => {
    if (!canSave) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/student/crm-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId,
          companyName: company.name,
          contactName: values.contactName.trim(),
          contactTitle: values.contactTitle.trim(),
          decisionMakerRationale: values.decisionMakerRationale.trim(),
          whyFit: values.whyFit.trim(),
          trigger: values.trigger.trim(),
          nextStep: values.nextStep.trim(),
          status: "shortlisted",
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        lead?: CrmLead;
        error?: string;
      } | null;
      if (!res.ok || !body?.lead) {
        setError(body?.error ?? "Could not save shortlist lead.");
        return;
      }
      onSaved(body.lead);
    } catch {
      setError("Could not save shortlist lead.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 modal-overlay animate-overlay-in">
      <div
        className="absolute inset-0"
        onClick={onCancel}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onCancel();
          }
        }}
        role="presentation"
      />
      <div className="relative z-10 w-full max-w-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-xl overflow-hidden animate-modal-in">
        <div className="px-6 py-4 border-b border-outline-variant flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-on-surface-variant font-bold mb-1">
              Shortlist Lead
            </p>
            <h3 className="font-headline-md text-headline-md text-primary">{company.name}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors"
            aria-label="Close"
          >
            <MaterialIcon name="close" className="text-[20px]" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <label className="block space-y-1.5">
            <span className="text-label-md font-bold text-on-surface">Company</span>
            <input
              type="text"
              value={company.name}
              readOnly
              className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-surface-container-low text-on-surface text-sm"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-label-md font-bold text-on-surface">Contact</span>
            <select
              value={values.contactName}
              onChange={(e) => handleContactChange(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-white text-on-surface text-sm outline-none focus:ring-2 focus:ring-secondary/40"
            >
              <option value="">Select a contact…</option>
              {company.contacts.map((contact) => (
                <option key={contact.name} value={contact.name}>
                  {contact.name}
                  {contact.title ? ` — ${contact.title}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-label-md font-bold text-on-surface">
              Why This Is the Right Decision Maker
            </span>
            <textarea
              value={values.decisionMakerRationale}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, decisionMakerRationale: e.target.value }))
              }
              rows={3}
              placeholder="Type your answer"
              className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-white text-on-surface text-sm resize-none outline-none focus:ring-2 focus:ring-secondary/40"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-label-md font-bold text-on-surface">
              Why This Account Is a Fit
            </span>
            <textarea
              value={values.whyFit}
              onChange={(e) => setValues((prev) => ({ ...prev, whyFit: e.target.value }))}
              rows={3}
              placeholder="Type your answer"
              className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-white text-on-surface text-sm resize-none outline-none focus:ring-2 focus:ring-secondary/40"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-label-md font-bold text-on-surface">Trigger Event</span>
            <input
              type="text"
              value={values.trigger}
              onChange={(e) => setValues((prev) => ({ ...prev, trigger: e.target.value }))}
              placeholder="Type your answer"
              className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-white text-on-surface text-sm outline-none focus:ring-2 focus:ring-secondary/40"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-label-md font-bold text-on-surface">Next Step</span>
            <input
              type="text"
              value={values.nextStep}
              onChange={(e) => setValues((prev) => ({ ...prev, nextStep: e.target.value }))}
              placeholder="Type your answer"
              className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-white text-on-surface text-sm outline-none focus:ring-2 focus:ring-secondary/40"
            />
          </label>

          {error ? <p className="text-sm text-error">{error}</p> : null}
        </div>

        <div className="px-6 py-4 border-t border-outline-variant bg-surface/50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-lg border border-outline-variant text-on-surface font-bold text-label-md hover:bg-surface-container transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void handleSave()}
            className={`h-10 px-5 rounded-lg font-bold text-label-md transition-colors ${
              canSave
                ? "bg-primary-container text-on-primary hover:bg-primary"
                : "bg-surface-container-highest text-on-surface-variant/40 cursor-not-allowed"
            }`}
          >
            {isSaving ? "Saving…" : "Save to Shortlist"}
          </button>
        </div>
      </div>
    </div>
  );
}
