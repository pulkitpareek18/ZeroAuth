import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

// ─── Button ───────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
  'transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]';

const buttonVariants: Record<ButtonVariant, string> = {
  // The brand is monochrome ink, so it flips with the theme: black in
  // light, near-white in dark. The text colour must flip too — use
  // --color-bg so the button is always the OPPOSITE of the page bg,
  // not a hard-coded white that goes invisible against a white brand.
  primary: 'bg-[var(--color-brand)] text-[var(--color-bg)] hover:bg-[var(--color-brand-dark)]',
  secondary: 'bg-[var(--color-bg-surface)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-bg-raised)]',
  ghost: 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-raised)]',
  danger: 'bg-[var(--color-danger)] text-[var(--color-bg)] hover:opacity-90',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...rest}
    >
      {loading ? <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-r-transparent" /> : null}
      {children}
    </button>
  );
});

// ─── Input + Label ────────────────────────────────────────────────

const inputBase =
  'h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 text-sm ' +
  'placeholder:text-[var(--color-text-dim)] text-[var(--color-text)] ' +
  'focus-visible:outline-none focus-visible:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/30 ' +
  'disabled:opacity-50 transition-colors';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(inputBase, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(inputBase, 'h-auto py-2 min-h-[80px]', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(inputBase, 'cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  );
});

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(function Label(
  { className, children, ...rest },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn('block text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)] mb-1.5', className)}
      {...rest}
    >
      {children}
    </label>
  );
});

// ─── Card ─────────────────────────────────────────────────────────

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-raised)] shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2>
        {description ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{description}</p> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

// ─── Badge ────────────────────────────────────────────────────────

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]',
  brand: 'bg-[var(--color-brand)]/15 text-[var(--color-brand)] border-[var(--color-brand)]/30',
  success: 'bg-[var(--color-success)]/15 text-[var(--color-success)] border-[var(--color-success)]/30',
  warn: 'bg-[var(--color-warn)]/15 text-[var(--color-warn)] border-[var(--color-warn)]/30',
  danger: 'bg-[var(--color-danger)]/15 text-[var(--color-danger)] border-[var(--color-danger)]/30',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium uppercase tracking-wide',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-[var(--color-bg-surface)]', className)} />;
}

// ─── Empty state ──────────────────────────────────────────────────

export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 text-sm font-medium text-[var(--color-text)]">{title}</div>
      {description ? <p className="mb-4 max-w-md text-xs text-[var(--color-text-secondary)]">{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <div
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-raised)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
          <h3 className="text-base font-semibold text-[var(--color-text)]">{title}</h3>
          {description ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{description}</p> : null}
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Toast (single global instance, opt-in) ───────────────────────

type ToastTone = 'info' | 'success' | 'warn' | 'danger';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

let nextId = 1;
const toastListeners = new Set<(toasts: ToastItem[]) => void>();
let toastState: ToastItem[] = [];

function notify() {
  for (const fn of toastListeners) fn(toastState);
}

export function pushToast(tone: ToastTone, message: string, ttlMs = 4000): number {
  const id = nextId++;
  toastState = [...toastState, { id, tone, message }];
  notify();
  if (ttlMs > 0) {
    setTimeout(() => dismissToast(id), ttlMs);
  }
  return id;
}

export function dismissToast(id: number): void {
  toastState = toastState.filter((t) => t.id !== id);
  notify();
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<ToastItem[]>(toastState);
  useEffect(() => {
    toastListeners.add(setToasts);
    return () => { toastListeners.delete(setToasts); };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-lg backdrop-blur',
            t.tone === 'success' && 'border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]',
            t.tone === 'info' && 'border-[var(--color-brand)]/40 bg-[var(--color-brand)]/10 text-[var(--color-text)]',
            t.tone === 'warn' && 'border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 text-[var(--color-warn)]',
            t.tone === 'danger' && 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
          )}
          onClick={() => dismissToast(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── Inline copy-to-clipboard helper for sensitive one-time values ─

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (timeout.current) clearTimeout(timeout.current);
          timeout.current = setTimeout(() => setCopied(false), 1500);
        } catch {
          pushToast('warn', 'Clipboard unavailable — select + copy manually.');
        }
      }}
    >
      {copied ? 'Copied ✓' : label}
    </Button>
  );
}
