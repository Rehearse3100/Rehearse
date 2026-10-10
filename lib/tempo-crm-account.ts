/**
 * tempo-crm-account.ts
 * Account profile field schema + helpers for CRM Account → Prospecting autofill.
 */

export type CrmAccountFieldDef = {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
  required?: boolean;
};

/** Fields stored on the CRM Account record. All are required before Stage 2. */
export const CRM_ACCOUNT_FIELD_SCHEMA: CrmAccountFieldDef[] = [
  {
    key: "accountName",
    label: "Account Name",
    placeholder: "Type your answer",
    required: true,
  },
  {
    key: "industry",
    label: "Industry",
    placeholder: "Type your answer",
    required: true,
  },
  {
    key: "locations",
    label: "Locations / Size",
    placeholder: "Type your answer",
    required: true,
  },
  {
    key: "region",
    label: "Region",
    placeholder: "Type your answer",
    required: true,
  },
  {
    key: "primaryContact",
    label: "Primary Contact",
    placeholder: "Type your answer",
    required: true,
  },
  {
    key: "whyFit",
    label: "Why This Account Is a Fit",
    placeholder: "Type your answer",
    multiline: true,
    required: true,
  },
  {
    key: "trigger",
    label: "Trigger Event",
    placeholder: "Type your answer",
    required: true,
  },
];

/** Prospecting log keys that can be filled from a selected Account. */
export const PROSPECTING_ACCOUNT_AUTOFILL_KEYS = [
  "accountName",
  "primaryContact",
  "whyFit",
  "trigger",
] as const;

export type CrmAccountRecord = {
  fields: Record<string, string>;
  notes: string;
  updated_at: string | null;
};

/**
 * Empty account field map.
 */
export function emptyAccountFields(): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of CRM_ACCOUNT_FIELD_SCHEMA) {
    next[field.key] = "";
  }
  return next;
}

/**
 * True when required account fields are filled.
 */
export function canSaveAccountFields(fields: Record<string, string>): boolean {
  return CRM_ACCOUNT_FIELD_SCHEMA.filter((f) => f.required).every(
    (f) => (fields[f.key] ?? "").trim().length > 0
  );
}

/**
 * True when this attempt has a real saved account (has a name).
 */
export function accountHasProfile(record: CrmAccountRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }
  return (record.fields.accountName ?? "").trim().length > 0;
}

/**
 * Builds prospecting field patches from an account — only non-empty account values.
 * Leaves keys the account lacks unset so the form keeps whatever the student already typed.
 */
export function prospectingAutofillFromAccount(
  accountFields: Record<string, string>
): Partial<Record<(typeof PROSPECTING_ACCOUNT_AUTOFILL_KEYS)[number], string>> {
  const patch: Partial<
    Record<(typeof PROSPECTING_ACCOUNT_AUTOFILL_KEYS)[number], string>
  > = {};
  for (const key of PROSPECTING_ACCOUNT_AUTOFILL_KEYS) {
    const value = (accountFields[key] ?? "").trim();
    if (value.length > 0) {
      patch[key] = value;
    }
  }
  return patch;
}
