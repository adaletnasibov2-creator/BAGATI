"use client";

import { useEffect } from "react";

/**
 * SELLER-PANEL-3: while `dirty`, leaving or reloading the page asks the browser's own "leave page?" question (no text
 * of ours). In-app links are not intercepted; the form shows "Yadda saxlanmamış dəyişikliklər var" instead.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
