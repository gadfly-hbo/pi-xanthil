/**
 * Importer error taxonomy.
 *
 * Contract (T0014 brief, workcanger-absorption-contract.md WCA-03/WCA-08):
 * - Import always fails closed with structured, safe errors.
 * - Error messages must never contain Evidence content, absolute paths,
 *   storage_ref values, SQL fragments, tokens, or raw error fragments.
 *   Only fixed codes, categories, and safe counts are allowed.
 */

export const IMPORT_ERROR_CATEGORIES = [
  "source_schema",
  "source_integrity",
  "target_schema",
  "workspace",
  "conflict",
  "blob",
  "transaction",
  "verification",
  "recovery",
  "options",
] as const;

export type ImportErrorCategory = (typeof IMPORT_ERROR_CATEGORIES)[number];

export const IMPORT_ERROR_CODES = [
  // options
  "invalid_options",
  // source schema
  "source_root_invalid",
  "source_db_open_failed",
  "source_schema_unknown",
  "source_schema_drift",
  "source_unknown_table",
  "source_unknown_column",
  // source integrity
  "source_integrity_fk",
  "source_integrity_structure",
  "source_unknown_enum",
  "source_unknown_safety_class",
  // target schema
  "target_root_invalid",
  "target_not_initialized",
  "target_schema_drift",
  "target_integrity_fk",
  "target_busy",
  "target_import_locked",
  // workspace
  "workspace_not_found",
  "workspace_check_unavailable",
  // conflicts
  "conflict_actor_identity",
  "conflict_durable_id",
  "conflict_unique_key",
  "conflict_partial_state",
  // blobs
  "blob_ref_invalid",
  "blob_missing",
  "blob_size_mismatch",
  "blob_hash_mismatch",
  "blob_publish_failed",
  // transaction / verification / recovery
  "tx_failed",
  "commit_failed",
  "verify_failed",
  "recovery_partial_state",
  "recovery_journal_corrupt",
  "recovery_cleanup_failed",
  "recovery_foreign_journal",
  "rollback_incomplete",
] as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/**
 * Importer error with a fixed safe message. The message may embed only
 * non-sensitive scalars such as counts, table names, schema versions, or
 * error categories - never row content, IDs of failed rows, paths, or refs.
 */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly category: ImportErrorCategory;
  constructor(code: ImportErrorCode, category: ImportErrorCategory, safeMessage: string) {
    super(safeMessage);
    this.name = "ImportError";
    this.code = code;
    this.category = category;
  }
}

/** Safe serializable view of an ImportError. */
export interface SafeImportError {
  readonly code: ImportErrorCode;
  readonly category: ImportErrorCategory;
  readonly message: string;
}

export function toSafeImportError(err: unknown): SafeImportError {
  if (err instanceof ImportError) {
    return { code: err.code, category: err.category, message: err.message };
  }
  // Unknown internal error: collapse to a fixed safe message. The raw error
  // must not leak into importer outputs (may contain paths/SQL/fragments).
  return {
    code: "tx_failed",
    category: "transaction",
    message: "Import failed with an internal error; no details are exposed by design.",
  };
}
