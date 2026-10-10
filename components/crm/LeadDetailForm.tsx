/**
 * LeadDetailForm.tsx
 * Create/edit a CRM Lead. Selected and converted leads are read-only.
 * Target selection + conversion happen in the Prospecting wizard, not here.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import type { CrmLead } from "@/types";

type LeadFormValues = {
  companyName: string;
  contactName: string;
  contactTitle: string;
  whyFit: string;
  trigger: string;
  nextStep: string;
};

type DirectoryContactOption = {
  name: string;
  title: string;
};

type DirectoryCompanyOption = {
  name: string;
  contacts: DirectoryContactOption[];
};

type LeadDetailFormProps = {
  attemptId: string;
  /** Null = create a new Lead. */
  lead: CrmLead | null;
  onBackToList: () => void;
  onSaved: (lead: CrmLead) => void;
};

const FIELD_DEFS: {
  key: keyof LeadFormValues;
  label: string;
  placeholder: string;
  multiline?: boolean;
}[] = [
  {
    key: "companyName",
    label: "Company Name",
    placeholder: "Type your answer",
  },
  {
    key: "contactName",
    label: "Contact Name",
    placeholder: "Type your answer",
  },
  {
    key: "contactTitle",
    label: "Contact Title",
    placeholder: "Type your answer",
  },
  {
    key: "whyFit",
    label: "Why This Account Is a Fit",
    placeholder: "Type your answer",
    multiline: true,
  },
  {
    key: "trigger",
    label: "Trigger Event",
    placeholder: "Type your answer",
  },
  {
    key: "nextStep",
    label: "Next Step",
    placeholder: "Type your answer",
  },
];

/**
 * Builds editable form values from an existing Lead or blanks.
 */
function valuesFromLead(lead: CrmLead | null): LeadFormValues {
  if (!lead) {
    return {
      companyName: "",
      contactName: "",
      contactTitle: "",
      whyFit: "",
      trigger: "",
      nextStep: "",
    };
  }
  return {
    companyName: lead.company_name,
    contactName: lead.contact_name,
    contactTitle: lead.contact_title,
    whyFit: lead.why_fit,
    trigger: lead.trigger_event,
    nextStep: lead.next_step,
  };
}

/**
 * Status label shown in the lead breadcrumb.
 */
function statusLabel(status: CrmLead["status"] | undefined): string | null {
  if (status === "converted") {
    return "Converted";
  }
  if (status === "selected") {
    return "Selected as Target";
  }
  return null;
}

/**
 * Lead create/edit form (no Convert action).
 */
export function LeadDetailForm({
  attemptId,
  lead,
  onBackToList,
  onSaved,
}: LeadDetailFormProps): React.ReactElement {
  const isReadOnly = lead?.status === "converted" || lead?.status === "selected";
  const [values, setValues] = useState<LeadFormValues>(() => valuesFromLead(lead));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyOptions, setCompanyOptions] = useState<DirectoryCompanyOption[]>([]);
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const title = values.companyName.trim() || (lead ? "Lead" : "New lead");
  const badge = statusLabel(lead?.status);
  const canSave = useMemo(
    () => !isReadOnly && !isSaving,
    [isReadOnly, isSaving]
  );
  /** Contacts belong to the selected company; empty until one is chosen. */
  const contactOptions = useMemo(
    () =>
      companyOptions.find((option) => option.name === values.companyName)
        ?.contacts ?? [],
    [companyOptions, values.companyName]
  );

  useEffect(() => {
    let cancelled = false;

    const loadCompanyOptions = async (): Promise<void> => {
      setIsDirectoryLoading(true);
      setDirectoryError(null);
      try {
        const res = await fetch(
          `/api/student/prospect-directory?attemptId=${encodeURIComponent(attemptId)}`
        );
        if (!res.ok) {
          throw new Error("Directory request failed");
        }
        const body = (await res.json()) as {
          companies?: {
            name?: string;
            contacts?: { name?: string; title?: string }[];
          }[];
        };
        const options = (body.companies ?? [])
          .map((company) => ({
            name: company.name?.trim() ?? "",
            contacts: (company.contacts ?? [])
              .map((contact) => ({
                name: contact.name?.trim() ?? "",
                title: contact.title?.trim() ?? "",
              }))
              .filter((contact) => Boolean(contact.name)),
          }))
          .filter((option) => Boolean(option.name));
        if (!cancelled) {
          setCompanyOptions(options);
          if (!isReadOnly) {
            setValues((prev) =>
              !prev.companyName ||
              options.some((option) => option.name === prev.companyName)
                ? prev
                : { ...prev, companyName: "" }
            );
          }
        }
      } catch {
        if (!cancelled) {
          setDirectoryError("Could not load company options.");
        }
      } finally {
        if (!cancelled) {
          setIsDirectoryLoading(false);
        }
      }
    };

    void loadCompanyOptions();
    return () => {
      cancelled = true;
    };
  }, [attemptId, isReadOnly]);

  /**
   * Creates or patches the Lead via the CRM Leads API.
   */
  const handleSave = async (): Promise<void> => {
    if (isReadOnly) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (!lead) {
        const res = await fetch("/api/student/crm-leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId, ...values }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "Could not save lead.");
          return;
        }
        const body = (await res.json()) as { lead: CrmLead };
        onSaved(body.lead);
        return;
      }

      const res = await fetch(`/api/student/crm-leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save lead.");
        return;
      }
      const body = (await res.json()) as { lead: CrmLead };
      onSaved(body.lead);
    } catch {
      setError("Could not save lead.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-6 flex-grow overflow-auto">
      <div className="max-w-[1200px] mx-auto w-full space-y-6">
        <nav className="flex items-center gap-2 text-[#404848] text-[12px] font-medium tracking-wide">
          <button
            type="button"
            onClick={onBackToList}
            className="hover:text-[#0f4c4c] transition-colors"
          >
            Leads
          </button>
          <MaterialIcon name="chevron_right" className="text-[16px]" />
          <span className="text-[#161d1b]">{title}</span>
          {badge ? (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-[#0f4c4c] text-white text-[10px] font-bold uppercase tracking-widest">
              {badge}
            </span>
          ) : null}
        </nav>

        <div className="bg-white rounded-lg border border-[#bfc8c8] shadow-sm overflow-hidden">
          <div className="p-6 border-b border-[#bfc8c8] bg-[#eef5f2]/20">
            <h3 className="text-lg font-semibold text-[#003434]">Lead Details</h3>
            <p className="text-sm text-[#404848] mt-1">
              {isReadOnly
                ? lead?.status === "selected"
                  ? "This lead is your Prospecting target and is read-only."
                  : "This lead has been converted and is read-only."
                : "Fill in the company and contact you are researching. Select your target in the Prospecting simulation."}
            </p>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {FIELD_DEFS.map((field) => {
                const value = values[field.key];
                return (
                  <div
                    key={field.key}
                    className={`space-y-2 ${field.multiline ? "md:col-span-2" : ""}`}
                  >
                    <label className="text-[12px] font-medium tracking-wide text-[#404848]">
                      {field.label}
                    </label>
                    {isReadOnly ? (
                      <div className="w-full rounded-md px-4 py-2 text-sm text-[#161d1b] bg-[#eef5f2] border border-[#bfc8c8] whitespace-pre-wrap">
                        {value.trim() || "—"}
                      </div>
                    ) : field.key === "companyName" ? (
                      <>
                        <div className="relative">
                          <select
                            className="w-full appearance-none bg-[#eef5f2] border border-[#bfc8c8] rounded-md pl-4 pr-10 py-2 text-sm focus:ring-2 focus:ring-[#0f4c4c] focus:border-[#0f4c4c] outline-none transition-all disabled:opacity-60"
                            value={values.companyName}
                            disabled={isDirectoryLoading}
                            onChange={(e) => {
                              const nextCompany = e.target.value;
                              const nextContacts =
                                companyOptions.find(
                                  (option) => option.name === nextCompany
                                )?.contacts ?? [];
                              setValues((prev) => {
                                const keepContact = nextContacts.some(
                                  (contact) => contact.name === prev.contactName
                                );
                                return {
                                  ...prev,
                                  companyName: nextCompany,
                                  // Contacts are per-company; drop a stale pick.
                                  contactName: keepContact ? prev.contactName : "",
                                  contactTitle: keepContact ? prev.contactTitle : "",
                                };
                              });
                            }}
                          >
                            <option value="">
                              {isDirectoryLoading ? "Loading companies…" : "Select a company"}
                            </option>
                            {companyOptions.map((option) => (
                              <option key={option.name} value={option.name}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                          <MaterialIcon
                            name="keyboard_arrow_down"
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-[#404848]"
                          />
                        </div>
                        {directoryError ? (
                          <p className="text-[12px] text-[#ba1a1a]">{directoryError}</p>
                        ) : null}
                      </>
                    ) : field.key === "contactName" ? (
                      <div className="relative">
                        <select
                          className="w-full appearance-none bg-[#eef5f2] border border-[#bfc8c8] rounded-md pl-4 pr-10 py-2 text-sm focus:ring-2 focus:ring-[#0f4c4c] focus:border-[#0f4c4c] outline-none transition-all disabled:opacity-60"
                          value={values.contactName}
                          disabled={isDirectoryLoading || !values.companyName}
                          onChange={(e) => {
                            const nextName = e.target.value;
                            const picked = contactOptions.find(
                              (contact) => contact.name === nextName
                            );
                            setValues((prev) => ({
                              ...prev,
                              contactName: nextName,
                              // Autofill the role from the directory contact.
                              contactTitle: picked?.title ?? prev.contactTitle,
                            }));
                          }}
                        >
                          <option value="">
                            {isDirectoryLoading
                              ? "Loading contacts…"
                              : values.companyName
                                ? "Select a contact"
                                : "Select a company first"}
                          </option>
                          {contactOptions.map((contact) => (
                            <option key={contact.name} value={contact.name}>
                              {contact.name}
                            </option>
                          ))}
                        </select>
                        <MaterialIcon
                          name="keyboard_arrow_down"
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-[#404848]"
                        />
                      </div>
                    ) : field.multiline ? (
                      <textarea
                        className="w-full bg-[#eef5f2] border border-[#bfc8c8] rounded-md px-4 py-2 text-sm focus:ring-2 focus:ring-[#0f4c4c] focus:border-[#0f4c4c] outline-none transition-all placeholder:text-[#bfc8c8] resize-none"
                        placeholder={field.placeholder}
                        rows={3}
                        value={value}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                      />
                    ) : (
                      <input
                        className="w-full bg-[#eef5f2] border border-[#bfc8c8] rounded-md px-4 py-2 text-sm focus:ring-2 focus:ring-[#0f4c4c] focus:border-[#0f4c4c] outline-none transition-all placeholder:text-[#bfc8c8]"
                        placeholder={field.placeholder}
                        type="text"
                        value={value}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {error ? <p className="text-sm text-[#ba1a1a] mt-4">{error}</p> : null}
          </div>

          {!isReadOnly ? (
            <div className="p-6 bg-[#eef5f2] border-t border-[#bfc8c8] flex flex-wrap justify-end gap-3">
              <button
                type="button"
                disabled={!canSave}
                onClick={() => void handleSave()}
                className="px-6 py-2 bg-[#0f4c4c] text-white text-[12px] font-medium tracking-wide rounded-lg hover:bg-[#0f4c4c]/90 shadow-md flex items-center gap-2 transition-all active:scale-95 disabled:opacity-40"
              >
                <MaterialIcon name="save" className="text-[18px]" />
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
