"use client";

import {
  addLPToShortlist,
  createShortlist,
  getUserShortlists,
} from "@/app/actions/shortlists";
import { useCallback, useEffect, useRef, useState } from "react";

export type ShortlistAddItem = {
  lpId: string;
  fitScore: number;
  lpName: string;
};

type AddToShortlistDropdownProps = {
  items: ShortlistAddItem[];
  buttonLabel?: string;
  className?: string;
  disabled?: boolean;
};

export function AddToShortlistDropdown({
  items,
  buttonLabel = "Add to shortlist",
  className,
  disabled = false,
}: AddToShortlistDropdownProps) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<
    Array<{ id: string; name: string; lp_count: number }>
  >([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const refreshLists = useCallback(async () => {
    setLoadingLists(true);
    try {
      const data = await getUserShortlists();
      setLists(data);
    } finally {
      setLoadingLists(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refreshLists();
  }, [open, refreshLists]);

  async function performAdd(shortlistId: string, shortlistName: string) {
    if (items.length === 0) return;
    if (items.length === 1) {
      const one = items[0]!;
      const res = await addLPToShortlist(
        shortlistId,
        one.lpId,
        one.fitScore,
      );
      if ("already_exists" in res) {
        setToast(`${one.lpName} is already in ${shortlistName}`);
      } else {
        setToast(`Added to ${shortlistName}`);
      }
      return;
    }

    let added = 0;
    let dupes = 0;
    for (const it of items) {
      const res = await addLPToShortlist(shortlistId, it.lpId, it.fitScore);
      if ("already_exists" in res) dupes += 1;
      else added += 1;
    }
    if (added > 0) {
      setToast(`Added ${added} LPs to ${shortlistName}`);
    } else if (dupes === items.length) {
      setToast(`All selected LPs are already in ${shortlistName}`);
    } else {
      setToast(`Added ${added} LPs to ${shortlistName}`);
    }
  }

  async function handlePickShortlist(
    shortlistId: string,
    shortlistName: string,
  ) {
    if (items.length === 0 || busy) return;
    setBusy(true);
    try {
      await performAdd(shortlistId, shortlistName);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  async function handleNewShortlist() {
    if (busy) return;
    setBusy(true);
    try {
      const when = new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      const name = `New Shortlist ${when}`;
      const { id } = await createShortlist(name);
      await refreshLists();
      await performAdd(id, name);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not create shortlist");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <div className="relative inline-block text-left" ref={rootRef}>
      {toast ? (
        <div
          className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setOpen((v) => !v)}
        className={
          className ??
          "shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-slate-50 disabled:opacity-50"
        }
      >
        {buttonLabel}
      </button>
      {open ? (
        <div
          className="absolute right-0 z-50 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          role="menu"
        >
          {loadingLists ? (
            <p className="px-3 py-2 text-xs text-gray-500">Loading…</p>
          ) : lists.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">No shortlists</p>
          ) : (
            lists.map((sl) => (
              <button
                key={sl.id}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => void handlePickShortlist(sl.id, sl.name)}
                className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-slate-50 disabled:opacity-50"
              >
                <span className="font-medium">{sl.name}</span>
                <span className="ml-1 text-xs text-gray-500">
                  (<span className="font-mono">{sl.lp_count}</span>)
                </span>
              </button>
            ))
          )}
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void handleNewShortlist()}
            className="block w-full px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            + New shortlist
          </button>
        </div>
      ) : null}
    </div>
  );
}
