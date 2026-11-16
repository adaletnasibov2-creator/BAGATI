/** HTTP mapping for OrderCancellationError, shared by the customer and seller cancellation routes. */
import { NextResponse } from "next/server";
import { OrderCancellationError } from "@/lib/order-cancellation-service";
import { OrderFulfillmentError } from "@/lib/order-fulfillment";
import { logSecurityOperationFailure } from "@/lib/security-logging";

const MESSAGES: Record<OrderCancellationError["code"], [number, string]> = {
  NOT_FOUND: [404, "Sifariş tapılmadı"],
  NOT_ALLOWED: [409, "Sifarişin cari vəziyyətində bu əməliyyat mümkün deyil. Səhifəni yeniləyin."],
  REQUEST_OPEN: [409, "Bu sifariş üçün artıq açıq ləğv müraciəti var."],
  REQUEST_NOT_OPEN: [409, "Bu ləğv müraciəti artıq bağlanıb. Səhifəni yeniləyin."],
  INVALID: [422, "Məlumatları yoxlayın"],
};

export function cancellationErrorResponse(error: unknown, operation: string) {
  if (error instanceof OrderCancellationError) {
    const [status, message] = MESSAGES[error.code];
    return NextResponse.json({ error: message, code: error.code }, { status });
  }
  if (error instanceof OrderFulfillmentError) {
    return NextResponse.json({ error: "Sifariş bu vaxt dəyişdirilib. Səhifəni yeniləyin.", code: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 409 });
  }
  // Two concurrent requests for the same store order: the partial unique index lets only one in.
  if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "P2002") {
    return NextResponse.json({ error: MESSAGES.REQUEST_OPEN[1], code: "REQUEST_OPEN" }, { status: 409 });
  }
  logSecurityOperationFailure(operation, error);
  return NextResponse.json({ error: "Əməliyyat tamamlana bilmədi. Bir az sonra yenidən cəhd edin." }, { status: 503 });
}
