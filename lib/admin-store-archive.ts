export const STORE_ARCHIVE_UPDATE = {
  status: "SUSPENDED",
  isActive: false,
} as const;

export function isStoreAlreadyDeactivated(status: string, isActive: boolean) {
  return status === STORE_ARCHIVE_UPDATE.status && !isActive;
}
