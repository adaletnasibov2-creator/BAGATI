"use client";

import { useEffect } from "react";
import { authSyncKeys, shouldReloadForAuthBroadcast } from "@/lib/auth-client";

export function AuthSessionSync() {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === authSyncKeys.storage) window.location.reload();
    };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(authSyncKeys.channel) : null;
    const onMessage = (event: MessageEvent) => {
      if (shouldReloadForAuthBroadcast(event.data)) window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    channel?.addEventListener("message", onMessage);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, []);
  return null;
}
