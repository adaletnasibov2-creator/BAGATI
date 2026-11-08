export const DEFAULT_IMPORT_JOB_CHUNK_SIZE = 50;
export const MIN_IMPORT_JOB_CHUNK_SIZE = 10;
export const MAX_IMPORT_JOB_CHUNK_SIZE = 50;
export const MAX_IMPORT_ROW_BYTES = 8 * 1024;
export const MAX_IMPORT_ROWS_PER_UPLOAD = 50;
export const MAX_IMPORT_JOB_ROWS = 100_000;

export type CatalogImportJobStatus =
  | "UPLOADING"
  | "QUEUED"
  | "PROCESSING"
  | "PAUSED"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "FAILED"
  | "CANCELLED";

export type CatalogImportRowStatus = "PENDING" | "CREATED" | "UPDATED" | "SKIPPED" | "FAILED";
export type CatalogImportMode = "create" | "update" | "mixed" | "skip";

export type ImportJobAccess = {
  role: string;
  storeId: string;
  jobStoreId: string;
};

export type ImportJobCounters = {
  totalRows: number;
  processedRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  failedRows: number;
};

export function normalizeImportJobChunkSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_IMPORT_JOB_CHUNK_SIZE;
  if (!Number.isInteger(value) || value < MIN_IMPORT_JOB_CHUNK_SIZE || value > MAX_IMPORT_JOB_CHUNK_SIZE) {
    throw new Error("INVALID_IMPORT_CHUNK_SIZE");
  }
  return value;
}

export function canAccessImportJob(access: ImportJobAccess): boolean {
  return access.role === "VENDOR" && access.storeId === access.jobStoreId;
}

export function canAppendImportRows(status: CatalogImportJobStatus): boolean {
  return status === "UPLOADING";
}

export function canProcessImportJob(status: CatalogImportJobStatus): boolean {
  return status === "QUEUED" || status === "PROCESSING";
}

export function isTerminalImportJob(status: CatalogImportJobStatus): boolean {
  return status === "COMPLETED" || status === "COMPLETED_WITH_ERRORS" || status === "FAILED" || status === "CANCELLED";
}

export function shouldSkipExistingImportProduct(mode: CatalogImportMode, action: "create" | "update"): boolean {
  return mode === "skip" && action === "update";
}

export function planImportRowAppend(input: {
  currentTotal: number;
  rowNumbers: number[];
}): { newRowNumbers: number[]; nextTotal: number } {
  if (!Number.isSafeInteger(input.currentTotal) || input.currentTotal < 0 || !input.rowNumbers.length) {
    throw new Error("INVALID_IMPORT_ROW_RANGE");
  }
  const sorted = [...input.rowNumbers].sort((a, b) => a - b);
  if (sorted.some((number, index) =>
    !Number.isSafeInteger(number)
    || number < 1
    || (index > 0 && number !== sorted[index - 1] + 1)
  )) {
    throw new Error("INVALID_IMPORT_ROW_RANGE");
  }

  const first = sorted[0];
  if (first > input.currentTotal + 1) throw new Error("IMPORT_ROW_GAP");
  const newRowNumbers = sorted.filter((number) => number > input.currentTotal);
  if (newRowNumbers.length && newRowNumbers[0] !== input.currentTotal + 1) {
    throw new Error("IMPORT_ROW_GAP");
  }
  const nextTotal = input.currentTotal + newRowNumbers.length;
  if (nextTotal > MAX_IMPORT_JOB_ROWS) throw new Error("IMPORT_JOB_ROW_LIMIT");
  return { newRowNumbers, nextTotal };
}

export function normalizeImportSku(value: unknown): string | null {
  return normalizeSku(value);
}

export function duplicateImportRowNumbers(
  rows: readonly { rowNumber: number; normalizedSku: string | null }[],
  firstRowsBySku: ReadonlyMap<string, number>,
): Set<number> {
  const seen = new Map(firstRowsBySku);
  const duplicates = new Set<number>();
  for (const row of rows) {
    if (!row.normalizedSku) continue;
    const first = seen.get(row.normalizedSku);
    if (first === undefined) seen.set(row.normalizedSku, row.rowNumber);
    else if (first !== row.rowNumber) duplicates.add(row.rowNumber);
  }
  return duplicates;
}

export function applyImportOutcomes(
  counters: ImportJobCounters,
  outcomes: readonly CatalogImportRowStatus[],
): ImportJobCounters {
  const next = { ...counters };
  for (const outcome of outcomes) {
    if (outcome === "PENDING") throw new Error("INVALID_IMPORT_OUTCOME");
    next.processedRows++;
    if (outcome === "CREATED") next.createdRows++;
    else if (outcome === "UPDATED") next.updatedRows++;
    else if (outcome === "SKIPPED") next.skippedRows++;
    else next.failedRows++;
  }
  if (next.processedRows > next.totalRows) throw new Error("IMPORT_PROGRESS_OVERFLOW");
  return next;
}

export function retryImportFailures(counters: ImportJobCounters, failedCount: number): ImportJobCounters {
  if (!Number.isSafeInteger(failedCount) || failedCount < 0 || failedCount > counters.failedRows) {
    throw new Error("INVALID_IMPORT_RETRY_COUNT");
  }
  return {
    ...counters,
    processedRows: counters.processedRows - failedCount,
    failedRows: counters.failedRows - failedCount,
  };
}

export function finalImportJobStatus(counters: ImportJobCounters): CatalogImportJobStatus {
  if (counters.processedRows < counters.totalRows) return "PROCESSING";
  return counters.failedRows ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
}
import { normalizeSku } from "@/lib/sku-normalization";
