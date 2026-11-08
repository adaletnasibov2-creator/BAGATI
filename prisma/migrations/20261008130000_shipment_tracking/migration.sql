CREATE TYPE "ShipmentStatus" AS ENUM (
  'PREPARING',
  'READY_FOR_SHIPMENT',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETURNED'
);

ALTER TABLE "StoreOrder"
  ADD COLUMN "shipmentStatus" "ShipmentStatus",
  ADD COLUMN "trackingUrl" TEXT,
  ADD COLUMN "shippedAt" TIMESTAMP(3),
  ADD COLUMN "outForDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3);
