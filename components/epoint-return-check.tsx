"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function EpointReturnCheck({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("Ödəniş bankdan yoxlanılır");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/epoint/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) })
      .then((response) => response.json())
      .then((data: { message?: string }) => { if (!cancelled) { setMessage(data.message || "Ödəniş statusu yeniləndi"); router.refresh(); } })
      .catch(() => { if (!cancelled) setMessage("Ödəniş statusu yenilənmədi. Səhifəni yenidən açın."); });
    return () => { cancelled = true; };
  }, [orderId, router]);
  return <p className="mt-3 text-sm text-muted">{message}</p>;
}
