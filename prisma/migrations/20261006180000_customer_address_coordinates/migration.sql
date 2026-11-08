-- Persist customer-selected delivery coordinates with their saved address.
ALTER TABLE "Address"
ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;
