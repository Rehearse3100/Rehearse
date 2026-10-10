/**
 * tempo-crm-contact.ts
 * Contact profile field schema + helpers for CRM Contacts.
 */

export type CrmContactKey = "dana_reyes" | "dr_kim";

/** Opaque contact slots per attempt — not shown to students; they enter name in the form. */
export const CRM_CONTACT_SLOTS: CrmContactKey[] = ["dana_reyes", "dr_kim"];

export type CrmContactFieldDef = {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
};

export const CRM_CONTACT_FIELD_SCHEMA: CrmContactFieldDef[] = [
  {
    key: "name",
    label: "Full Name",
    placeholder: "Type your answer",
    required: true,
  },
  {
    key: "position",
    label: "Position / Title",
    placeholder: "Type your answer",
    required: true,
  },
];

export const CRM_CONTACT_BUYING_ROLES = [
  "",
  "Economic Buyer",
  "Champion",
  "Influencer",
  "Technical Evaluator",
] as const;

export type CrmContactRecord = {
  contactKey: CrmContactKey;
  fields: Record<string, string>;
  role: string;
  notes: string;
  updated_at: string | null;
};

/**
 * Empty contact profile fields.
 */
export function emptyContactFields(): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of CRM_CONTACT_FIELD_SCHEMA) {
    next[field.key] = "";
  }
  return next;
}

/**
 * True when required contact fields are filled.
 */
export function canSaveContactFields(fields: Record<string, string>): boolean {
  return CRM_CONTACT_FIELD_SCHEMA.filter((f) => f.required).every(
    (f) => (fields[f.key] ?? "").trim().length > 0
  );
}

/**
 * True when a contact record is fully complete — all required profile fields
 * plus a buying role. Used by the Stage 2 handoff gate.
 */
export function contactRecordComplete(
  fields: Record<string, string>,
  role: string
): boolean {
  return canSaveContactFields(fields) && role.trim().length > 0;
}

/**
 * True when this contact slot has a saved profile (has a name).
 */
export function contactHasProfile(record: CrmContactRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }
  return (record.fields.name ?? "").trim().length > 0;
}

/**
 * Display name for lists and lookups.
 */
export function contactDisplayName(fields: Record<string, string>): string {
  return (fields.name ?? "").trim();
}

/**
 * Label for prospecting dropdown options (name + position when set).
 */
export function contactSelectLabel(fields: Record<string, string>): string {
  const name = contactDisplayName(fields);
  if (!name) {
    return "";
  }
  const position = (fields.position ?? "").trim();
  return position ? `${name}, ${position}` : name;
}

/**
 * Contact slots not yet saved for this attempt.
 */
export function availableContactSlots(records: CrmContactRecord[]): CrmContactKey[] {
  const saved = new Set(
    records.filter(contactHasProfile).map((r) => r.contactKey)
  );
  return CRM_CONTACT_SLOTS.filter((key) => !saved.has(key));
}
