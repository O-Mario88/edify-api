// Data classification registry (spec §2). The single machine-readable map of
// every Prisma model to its sensitivity level + the fields that are Restricted
// or Highly-Restricted (and therefore must be field-encrypted at rest and never
// logged/exported in the clear). Keep in sync with docs/security/
// data-classification-matrix.md.

export type Classification = 'public' | 'internal' | 'confidential' | 'restricted' | 'highly_restricted';

export interface ModelClassification {
  level: Classification;
  /** Fields that are more sensitive than the model's base level. */
  restrictedFields?: string[];
  /** Fields that must be encrypted at rest (field-crypto). */
  encryptAtRest?: string[];
}

export const DATA_CLASSIFICATION: Record<string, ModelClassification> = {
  // Highly Restricted — auth secrets, tokens, hashes.
  User: { level: 'restricted', restrictedFields: ['passwordHash', 'mfaSecret', 'passwordResetTokenHash'], encryptAtRest: ['mfaSecret', 'passwordResetTokenHash'] },
  AuditLog: { level: 'restricted' }, // integrity-critical; append-only + hash-chained

  // Restricted — evidence, payment, accountability, IDs.
  EvidenceRecord: { level: 'restricted' },
  PaymentRequest: { level: 'restricted', encryptAtRest: ['netsuiteExpenseId'] },
  PaymentDisbursement: { level: 'restricted' },
  PaymentActionLog: { level: 'restricted' },
  FundRequest: { level: 'restricted', encryptAtRest: ['accountabilityNetsuiteId'] },
  ActivityCompletionVerification: { level: 'restricted' }, // Salesforce IDs
  Report: { level: 'restricted' }, // donor-ready before approval

  // Confidential — directory, staff, partner, SSA, planning, debriefs.
  School: { level: 'confidential', restrictedFields: ['primaryContactName', 'primaryContactPhone', 'schoolPhone'] },
  StaffProfile: { level: 'confidential' },
  Partner: { level: 'confidential', restrictedFields: ['email', 'phone'] },
  SsaRecord: { level: 'confidential' },
  Activity: { level: 'confidential' },
  Cluster: { level: 'confidential' },
  DailyDebrief: { level: 'confidential' },
  Message: { level: 'confidential' },
  Notification: { level: 'confidential' },

  // Internal — aggregates, settings, geography.
  CostSetting: { level: 'internal' },
  Region: { level: 'internal' },
  District: { level: 'internal' },
  SubCounty: { level: 'internal' },
  Parish: { level: 'internal' },
  Target: { level: 'internal' },
};

export function classificationOf(model: string): ModelClassification {
  return DATA_CLASSIFICATION[model] ?? { level: 'confidential' }; // safe default
}

/** Fields across all models that should be encrypted at rest. */
export function fieldsToEncrypt(): { model: string; field: string }[] {
  return Object.entries(DATA_CLASSIFICATION).flatMap(([model, c]) => (c.encryptAtRest ?? []).map((field) => ({ model, field })));
}
