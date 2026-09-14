// UI primitives ported from the reference design (user-provided sample).
import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from "react";
import { X, Check, LoaderCircle } from "lucide-react";
import { RichMarkdown } from "./lib/richmarkdown";

// Reactive CSS media query. Drives the shell's responsive behavior — the
// navigation drawer exists below 1100px, the chat/inspector pane switch
// below 821px.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

// Overlay behavior shared by every dialog-sized surface: focus the first
// control on open, trap Tab inside while open, close on Escape, and restore
// focus to the element that launched the overlay on close.
export function useDialogA11y(ref: React.RefObject<HTMLElement | null>, onClose: () => void, autoFocus = true) {
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const timer = autoFocus
      ? setTimeout(() => {
          ref.current?.querySelector<HTMLElement>("[autofocus], input, textarea, select, button")?.focus();
        }, 30)
      : undefined;
    return () => {
      if (timer) clearTimeout(timer);
      previouslyFocused?.focus();
    };
    // mount/unmount only: restore must capture the launcher exactly once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select, [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref, onClose]);
}

export function ZLogo({ size = 25, className = "" }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true"><path d="M5 5h19l-4 5H1l4-5Zm5 8h10l-8 10H2l8-10Zm9 0h8l-4 5h-8l4-5Z" fill="currentColor" /></svg>;
}

export function IconButton({ label, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} {...props}>{children}</button>;
}

export function Dialog({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose);
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className={`dialog ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}><header className="dialog-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="Close dialog" onClick={onClose}><X size={18} /></IconButton></header>{children}</div></div>;
}

// ZWUI-015: fail-closed markdown — sanitized, plain-text fallback; fenced
// code renders as rich React blocks (header/copy/line numbers).
export function Markdown({ text, issueResolver }: { text: string; issueResolver?: () => import("./lib/issueRefs").RepoBinding | null }) {
  return <RichMarkdown text={text} issueResolver={issueResolver} />;
}

export function CheckMark({ className = "" }: { className?: string }) {
  return <span className={`check-mark ${className}`}><Check size={10} strokeWidth={2.5} /></span>;
}

export function relativeTime(ms: number) {
  const minutes = Math.max(1, Math.floor((Date.now() - ms) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

export function BusyButton({ busy, children, className = "primary-button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button type="button" className={className} disabled={busy || props.disabled} {...props}>{busy && <LoaderCircle size={14} className="spin" />}{children}</button>;
}
