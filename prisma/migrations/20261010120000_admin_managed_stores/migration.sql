ALTER TABLE "Store"
  ADD COLUMN "adminManaged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "managedByAdminId" TEXT,
  ADD COLUMN "managementReason" TEXT;

ALTER TABLE "Store"
  ADD CONSTRAINT "Store_managedByAdminId_fkey"
  FOREIGN KEY ("managedByAdminId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Store_adminManaged_managedByAdminId_idx"
  ON "Store"("adminManaged", "managedByAdminId");
