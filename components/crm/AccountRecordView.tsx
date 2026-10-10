/**
 * AccountRecordView.tsx
 * Account create/edit form — name + profile fields + strategy notes.
 * Students create the account here; Prospecting selects it from a dropdown.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import {
  CRM_ACCOUNT_FIELD_SCHEMA,
  canSaveAccountFields,
  emptyAccountFields,
  type CrmAccountRecord,
} from "@/lib/tempo-crm-account";

type AccountRecordViewProps = {
  attemptId: string;
  onBackToList: () => void;
  onSaved?: (record: CrmAccountRecord) => void;
  /** When false, Account is not created yet (Lead not converted). */
  isUnlocked?: boolean;
  onGoToLeads?: () => void;
};

/**
 * Formats an ISO timestamp for “Last updated”.
 */
function formatUpdatedAt(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Account record canvas (shell provided by CrmOverlay).
 */
export function AccountRecordView({
  attemptId,
  onBackToList,
  onSaved,
  isUnlocked = true,
  onGoToLeads,
}: AccountRecordViewProps): React.ReactElement {
  const [fields, setFields] = useState<Record<string, string>>(emptyAccountFields);
  const [notes, setNotes] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = (fields.accountName ?? "").trim() || "New account";
  const canSave = useMemo(
    () => isUnlocked && canSaveAccountFields(fields) && !isSaving && !isLoading,
    [isUnlocked, fields, isSaving, isLoading]
  );

  useEffect(() => {
    if (!isUnlocked) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/student/crm-account?attemptId=${encodeURIComponent(attemptId)}`
        );
        if (!res.ok) {
          return;
        }
        const body = (await res.json()) as {
          notes?: string;
          fields?: Record<string, string>;
          updated_at?: string | null;
        };
        if (!cancelled) {
          setFields({ ...emptyAccountFields(), ...(body.fields ?? {}) });
          setNotes(body.notes ?? "");
          setUpdatedAt(body.updated_at ?? null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [attemptId, isUnlocked]);

  /**
   * Saves account profile + strategy notes via POST.
   */
  const handleSave = async (): Promise<void> => {
    if (!canSave) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/student/crm-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, notes, fields }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save account.");
        return;
      }
      const body = (await res.json()) as {
        notes: string;
        fields: Record<string, string>;
        updated_at: string;
      };
      setFields({ ...emptyAccountFields(), ...body.fields });
      setNotes(body.notes);
      setUpdatedAt(body.updated_at);
      onSaved?.({
        fields: body.fields,
        notes: body.notes,
        updated_at: body.updated_at,
      });
    } catch {
      setError("Could not save account.");
    } finally {
      setIsSaving(false);
    }
  };

  const updatedLabel = formatUpdatedAt(updatedAt);

  if (!isUnlocked) {
    return (
      <div className="p-6 flex-grow overflow-auto">
        <div className="max-w-[1200px] mx-auto w-full space-y-6">
          <nav className="flex items-center gap-2 text-[#404848] text-[12px] font-medium tracking-wide">
            <button type="button" onClick={onBackToList} className="hover:text-[#0f4c4c] transition-colors">
              Accounts
            </button>
            <MaterialIcon name="chevron_right" className="text-[16px]" />
            <span className="text-[#161d1b]">Account</span>
          </nav>
          <div className="bg-white border border-[#bfc8c8] rounded-lg px-6 py-12 text-center space-y-4">
            <p className="text-sm text-[#707978]">
              No account yet — convert a Lead when you&apos;re ready to open the deal.
            </p>
            {onGoToLeads ? (
              <button
                type="button"
                onClick={onGoToLeads}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0f4c4c] text-white text-[12px] font-medium tracking-wide hover:brightness-110"
              >
                <MaterialIcon name="hub" className="text-[16px]" />
                Go to Leads
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex-grow overflow-auto">
      <div className="max-w-[1200px] mx-auto w-full space-y-6">
        <nav className="flex items-center gap-2 text-[#404848] text-[12px] font-medium tracking-wide">
          <button type="button" onClick={onBackToList} className="hover:text-[#0f4c4c] transition-colors">
            Accounts
          </button>
          <MaterialIcon name="chevron_right" className="text-[16px]" />
          <span className="text-[#161d1b]">{title}</span>
        </nav>

        <div className="bg-white rounded-lg border border-[#bfc8c8] shadow-sm overflow-hidden">
          <div className="p-6 border-b border-[#bfc8c8] bg-[#eef5f2]/20">
            <h3 className="text-lg font-semibold text-[#003434]">Account Details</h3>
            <p className="text-sm text-[#404848] mt-1">
              Key fields autofill when you select your target Lead. Complete the remaining
              required fields before Stage 2.
            </p>
          </div>
          <div className="p-6">
            {isLoading ? (
              <p className="text-sm text-[#404848]">Loading account…</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {CRM_ACCOUNT_FIELD_SCHEMA.map((field) => {
                  const value = fields[field.key] ?? "";
                  return (
                    <div
                      key={field.key}
                      className={`space-y-2 ${field.multiline ? "md:col-span-2" : ""}`}
                    >
                      <label className="text-[12px] font-medium tracking-wide text-[#404848] flex items-center gap-1">
                        {field.label}
                        {field.required ? <span className="text-[#ba1a1a]">*</span> : null}
                      </label>
                      {field.multiline ? (
                        <textarea
                          className="w-full bg-[#eef5f2] border border-[#bfc8c8] rounded-md px-4 py-2 text-sm focus:ring-2 focus:ring-[#0f4c4c] focus:border-[#0f4c4c] outline-none transition-all placeholder:text-[#bfc8c8] resize-none"
                          placeholder={field.placeholder}
                          rows={3}
                          value={value}
                          onChange={(e) =>
                            setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                        />
                      ) : (
                        <input
                          className="w-full bg-[#eef5f2] border border-[#bfc8c8] rounded-md px-4 py-2 text-sm focus:ring-2 focus:ring-[#0f4c4c] focus:border-[#0f4c4c] outline-none transition-all placeholder:text-[#bfc8c8]"
                          placeholder={field.placeholder}
                          type="text"
                          value={value}
                          onChange={(e) =>
                            setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-[#bfc8c8] shadow-sm overflow-hidden">
          <div className="p-6 border-b border-[#bfc8c8] bg-[#eef5f2]/20">
            <h3 className="text-lg font-semibold text-[#003434]">Account Strategy</h3>
            <p className="text-sm text-[#404848] mt-1">
              Optional freeform notes — not copied into opportunity stage logs.
            </p>
          </div>
          <div className="p-6 space-y-3">
            {isLoading ? (
              <p className="text-sm text-[#404848]">Loading notes…</p>
            ) : (
              <textarea
                className="w-full min-h-[140px] bg-[#eef5f2] border border-[#bfc8c8] rounded-md px-4 py-3 text-sm focus:ring-2 focus:ring-[#0f4c4c] focus:border-[#0f4c4c] outline-none transition-all placeholder:text-[#bfc8c8] resize-y"
                placeholder="Type your answer"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
            {updatedLabel ? (
              <p className="text-[12px] text-[#404848]">Last updated {updatedLabel}</p>
            ) : !isLoading ? (
              <p className="text-[12px] text-[#707978]">Not saved yet.</p>
            ) : null}
            {error ? <p className="text-sm text-[#ba1a1a]">{error}</p> : null}
          </div>
          <div className="p-6 bg-[#eef5f2] border-t border-[#bfc8c8] flex justify-end">
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void handleSave()}
              className="px-6 py-2 bg-[#0f4c4c] text-white text-[12px] font-medium tracking-wide rounded-lg hover:bg-[#0f4c4c]/90 shadow-md flex items-center gap-2 transition-all active:scale-95 disabled:opacity-40"
            >
              <MaterialIcon name="save" className="text-[18px]" />
              {isSaving ? "Saving…" : "Save Account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
