"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { buttonClass } from "@/components/admin-ui/styles";

export type ConfirmOptions = {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive action: the confirm button is red. */
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

/**
 * Accessible replacement for window.confirm, on the native <dialog> (modal: focus stays inside, Esc cancels, the
 * page behind is inert). Focus starts on "Ləğv et" (the safe choice) and returns to the element that opened it.
 *
 *   const { confirm, dialog } = useConfirmDialog();
 *   if (!(await confirm({ message: "..." }))) return;
 *   return <>{...}{dialog}</>;
 */
export function useConfirmDialog(): { confirm: (options: ConfirmOptions | string) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback((options: ConfirmOptions | string) => new Promise<boolean>((resolve) => {
    setPending({ ...(typeof options === "string" ? { message: options } : options), resolve });
  }), []);
  const close = useCallback((value: boolean) => {
    setPending((current) => { current?.resolve(value); return null; });
  }, []);
  return { confirm, dialog: pending ? <ConfirmDialog options={pending} onClose={close} /> : null };
}

export function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (value: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    }
    cancelRef.current?.focus();
    return () => { opener?.focus?.(); };
  }, []);
  return <dialog
    ref={ref}
    aria-labelledby="admin-confirm-title"
    aria-describedby="admin-confirm-message"
    onCancel={(event) => { event.preventDefault(); onClose(false); }}
    className="w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-[#e7e3d9] bg-white p-0 text-[#0d1b2a] shadow-xl backdrop:bg-black/40"
  >
    <div className="p-5">
      <h2 id="admin-confirm-title" className="text-lg font-semibold">{options.title ?? "Təsdiq edin"}</h2>
      <p id="admin-confirm-message" className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{options.message}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={() => onClose(false)} className={buttonClass("secondary")}>{options.cancelLabel ?? "Ləğv et"}</button>
        <button type="button" onClick={() => onClose(true)} className={options.danger ? buttonClass("primary", "bg-red-700 hover:bg-red-800") : buttonClass("primary")}>{options.confirmLabel ?? "Təsdiqlə"}</button>
      </div>
    </div>
  </dialog>;
}
