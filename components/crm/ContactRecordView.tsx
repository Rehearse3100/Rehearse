/**
 * ContactRecordView.tsx
 * Contact create/edit form — name, position, buying role, and relationship notes.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import {
  CRM_CONTACT_BUYING_ROLES,
  CRM_CONTACT_FIELD_SCHEMA,
  canSaveContactFields,
  emptyContactFields,
  type CrmContactKey,
  type CrmContactRecord,
} from "@/lib/tempo-crm-contact";

export type { CrmContactKey };

type ContactRecordViewProps = {
  attemptId: string;
  contactKey: CrmContactKey;
  /** Linked account label; empty shows an em dash. */
  accountLabel?: string;
  onBackToList: () => void;
  onSaved?: (record: CrmContactRecord) => void;
  /** Dana is locked until Lead conversion; Kim is always unlocked. */
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
 * Contact record canvas (shell provided by CrmOverlay).
 */
export function ContactRecordView({
  attemptId,
  contactKey,
  accountLabel = "",
  onBackToList,
  onSaved,
  isUnlocked = true,
  onGoToLeads,
}: ContactRecordViewProps): React.ReactElement {
  const [fields, setFields] = useState<Record<string, string>>(emptyContactFields);
  const [role, setRole] = useState("");
  const [notes, setNotes] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = (fields.name ?? "").trim() || "New contact";
  const accountSuffix = accountLabel.trim() || "—";
  const canSave = useMemo(
    () =>
      isUnlocked &&
      canSaveContactFields(fields) &&
      role.trim().length > 0 &&
      !isSaving &&
      !isLoading,
    [isUnlocked, fields, role, isSaving, isLoading]
  );

  useEffect(() => {
    if (!isUnlocked) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/student/crm-contact?attemptId=${encodeURIComponent(attemptId)}&contactKey=${encodeURIComponent(contactKey)}`
        );
        if (!res.ok) {
          return;
        }
        const body = (await res.json()) as {
          role?: string;
          notes?: string;
          fields?: Record<string, string>;
          updated_at?: string | null;
        };
        if (!cancelled) {
          setFields({ ...emptyContactFields(), ...(body.fields ?? {}) });
          setRole(body.role ?? "");
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
  }, [attemptId, contactKey, isUnlocked]);

  /**
   * Saves contact profile + relationship notes via POST.
   */
  const handleSave = async (): Promise<void> => {
    if (!canSave) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/student/crm-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, contactKey, role, notes, fields }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save contact.");
        return;
      }
      const body = (await res.json()) as {
        role: string;
        notes: string;
        fields: Record<string, string>;
        updated_at: string;
      };
      setFields({ ...emptyContactFields(), ...body.fields });
      setRole(body.role);
      setNotes(body.notes);
      setUpdatedAt(body.updated_at);
      onSaved?.({
        contactKey,
        fields: body.fields,
        role: body.role,
        notes: body.notes,
        updated_at: body.updated_at,
      });
    } catch {
      setError("Could not save contact.");
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
              Contacts
            </button>
            <MaterialIcon name="chevron_right" className="text-[16px]" />
            <span className="text-[#161d1b]">Contact</span>
          </nav>
          <div className="bg-white border border-[#bfc8c8] rounded-lg px-6 py-12 text-center space-y-4">
            <p className="text-sm text-[#707978]">
              This contact isn&apos;t available yet — convert a Lead to unlock the primary contact.
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
            Contacts
          </button>
          <MaterialIcon name="chevron_right" className="text-[16px]" />
          <span className="text-[#161d1b]">{title}</span>
        </nav>

        <div className="bg-white rounded-lg border border-[#bfc8c8] shadow-sm overflow-hidden">
          <div className="p-6 border-b border-[#bfc8c8] bg-[#eef5f2]/20">
            <h3 className="text-lg font-semibold text-[#003434]">Contact Details</h3>
            <p className="text-sm text-[#404848] mt-1">
              Add who this person is and how they fit the deal. Account: {accountSuffix}
            </p>
          </div>
          <div className="p-6">
            {isLoading ? (
              <p className="text-sm text-[#404848]">Loading contact…</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {CRM_CONTACT_FIELD_SCHEMA.map((field) => {
                  const value = fields[field.key] ?? "";
                  return (
                    <div key={field.key} className="space-y-2">
                      <label className="text-[12px] font-medium tracking-wide text-[#404848] flex items-center gap-1">
                        {field.label}
                        {field.required ? <span className="text-[#ba1a1a]">*</span> : null}
                      </label>
                      <input
                        className="w-full bg-[#eef5f2] border border-[#bfc8c8] rounded-md px-4 py-2 text-sm focus:ring-2 focus:ring-[#0f4c4c] focus:border-[#0f4c4c] outline-none transition-all placeholder:text-[#bfc8c8]"
                        placeholder={field.placeholder}
                        type="text"
                        value={value}
                        onChange={(e) =>
                          setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-[#bfc8c8] shadow-sm overflow-hidden">
          <div className="p-6 border-b border-[#bfc8c8] bg-[#eef5f2]/20">
            <h3 className="text-lg font-semibold text-[#003434]">Relationship Profile</h3>
            <p className="text-sm text-[#404848] mt-1">
              Buying role is required; relationship notes are optional and not tied to
              opportunity stage logs.
            </p>
          </div>
          <div className="p-6 space-y-6">
            <div className="space-y-2 max-w-md">
              <label className="text-[12px] font-medium tracking-wide text-[#404848] flex items-center gap-1">
                Role in Decision
                <span className="text-[#ba1a1a]">*</span>
              </label>
              <select
                className="w-full bg-[#eef5f2] border border-[#bfc8c8] rounded-md px-4 py-2 text-sm focus:ring-2 focus:ring-[#0f4c4c] focus:border-[#0f4c4c] outline-none transition-all disabled:opacity-50"
                value={role}
                disabled={isLoading}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="">Select a role…</option>
                {CRM_CONTACT_BUYING_ROLES.filter((opt) => opt !== "").map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[12px] font-medium tracking-wide text-[#404848]">
                Relationship Notes
              </label>
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
            </div>

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
              {isSaving ? "Saving…" : "Save Contact"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
