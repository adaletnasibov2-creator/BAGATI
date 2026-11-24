"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { SELLER_ORDERS_TEXT } from "@/lib/vendor-order-view";

/** Opens the browser's print dialog; the order page's print CSS prints only the packing slip (SELLER-ORDERS-DESIGN-1). */
export function VendorOrderPrintButton() {
  return <button type="button" onClick={() => window.print()} className={buttonClass({ variant: "secondary", size: "sm" })}>
    <Printer aria-hidden="true" size={16} strokeWidth={2}/>{SELLER_ORDERS_TEXT.print}
  </button>;
}
