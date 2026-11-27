"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readDismissed, writeDismissed, type Notice } from "@/lib/notices";

export function useChartNotices(symbol: string) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDismissed([...readDismissed(symbol, localStorage)]);
    setOpen(false);
  }, [symbol]);

  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);

  const dismiss = useCallback((texts: string[]) => {
    setDismissed((prev) => {
      const next = [...new Set([...prev, ...texts])];
      writeDismissed(symbol, next, localStorage);
      return next;
    });
  }, [symbol]);

  const restore = useCallback((texts: string[]) => {
    const drop = new Set(texts);
    setDismissed((prev) => {
      const next = prev.filter((text) => !drop.has(text));
      writeDismissed(symbol, next, localStorage);
      return next;
    });
  }, [symbol]);

  return { dismissed: dismissedSet, open, setOpen, dismiss, restore };
}

export function NotesChip(props: { count: number; open: boolean; onToggle: () => void }) {
  if (props.count === 0) return null;
  const label = props.count === 1 ? "1 note" : `${props.count} notes`;
  return (
    <button
      type="button"
      className={`notes-chip ${props.open ? "on" : ""}`}
      aria-expanded={props.open}
      aria-controls="chart-notes"
      title={props.open ? "Collapse notes" : "Show notes"}
      onClick={props.onToggle}
    >
      ⓘ {label}
    </button>
  );
}

export function NotesPanel(props: {
  notices: Notice[];
  dismissed: Set<string>;
  open: boolean;
  onOpen: () => void;
  onDismiss: (text: string) => void;
  onRestore: (text: string) => void;
  onDismissAll: () => void;
}) {
  const visible = props.notices.filter((note) => !props.dismissed.has(note.text));
  if (!props.notices.length) return null;

  if (!props.open) {
    if (!visible.length) return null;
    const summary = visible.map((note) => note.text).join(" · ");
    const warn = visible.some((note) => note.tone === "warn");
    return (
      <div className={`notice-summary ${warn ? "has-warn" : ""}`} id="chart-notes">
        <button type="button" className="notice-text" onClick={props.onOpen} title={summary}>
          {summary}
        </button>
        <button type="button" className="notice-clear" onClick={props.onDismissAll}>Clear all</button>
      </div>
    );
  }

  return (
    <div className="banners" id="chart-notes">
      <div className="notice-actions">
        <span>{visible.length === 0 ? "Cleared" : `${visible.length} showing`}{props.notices.length !== visible.length ? ` · ${props.notices.length - visible.length} cleared` : ""}</span>
        {visible.length > 0 && (
          <button type="button" onClick={props.onDismissAll}>Clear all</button>
        )}
      </div>
      {props.notices.map((note) => {
        const cleared = props.dismissed.has(note.text);
        return (
          <div key={note.text} className={`banner ${note.tone === "warn" ? "warn" : ""} ${cleared ? "cleared" : ""}`}>
            <p>{note.text}</p>
            {cleared ? (
              <button type="button" className="notice-x" aria-label="Restore note" title="Restore note" onClick={() => props.onRestore(note.text)}>↩</button>
            ) : (
              <button type="button" className="notice-x" aria-label="Dismiss note" title="Dismiss note" onClick={() => props.onDismiss(note.text)}>×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
