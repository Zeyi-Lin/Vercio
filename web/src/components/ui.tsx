import { useEffect, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Check, Copy, X } from "lucide-react";
import { copyText, statusLabel, statusTone } from "../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={
        "btn btn-" +
        variant +
        (size === "sm" ? " btn-sm" : size === "lg" ? " btn-lg" : "") +
        (className ? " " + className : "")
      }
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ large = false }: { large?: boolean }) {
  return <span className={"spinner" + (large ? " spinner-lg" : "")} aria-hidden="true" />;
}

export function StatusPill({
  status,
  label,
  large = false,
}: {
  status?: string;
  label?: string;
  large?: boolean;
}) {
  return (
    <span className={"status status-" + statusTone(status) + (large ? " status-lg" : "")}>
      <span className="status-dot" />
      {label || statusLabel(status)}
    </span>
  );
}

export function Badge({
  children,
  tone = "default",
  mono = false,
  className = "",
}: {
  children: ReactNode;
  tone?: "default" | "blue" | "green" | "amber";
  mono?: boolean;
  className?: string;
}) {
  return (
    <span
      className={
        "badge" +
        (tone !== "default" ? " badge-" + tone : "") +
        (mono ? " badge-mono" : "") +
        (className ? " " + className : "")
      }
    >
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={
          "modal" + (size === "lg" ? " modal-lg" : size === "sm" ? " modal-sm" : "") +
          (className ? " " + className : "")
        }
        role="dialog"
        aria-modal="true"
      >
        <button className="icon-btn modal-close" onClick={onClose} aria-label="Close dialog">
          <X size={16} />
        </button>
        {(title || description) && (
          <div className="modal-head" style={{ flexDirection: "column", alignItems: "stretch" }}>
            {title && <h2 className="modal-title">{title}</h2>}
            {description && <p className="modal-desc">{description}</p>}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  confirmationText,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  confirmationText?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (open) setValue("");
  }, [open]);
  const disabled = Boolean(confirmationText) && value.trim() !== confirmationText;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={disabled || busy} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {confirmationText && (
        <div className="field">
          <label className="label">
            Type <span className="mono">{confirmationText}</span> to confirm
          </label>
          <input
            className="input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={confirmationText}
            autoFocus
          />
        </div>
      )}
    </Modal>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label && <span className="label">{label}</span>}
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={"input " + className} {...rest} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea className={"textarea " + className} {...rest} />;
}

export function Skeleton({
  width = "100%",
  height = 14,
  style,
}: {
  width?: number | string;
  height?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <span className="skeleton" style={{ display: "block", width, height, ...style }} aria-hidden="true" />
  );
}

export function CopyButton({
  value,
  label = "Copy",
  className = "btn btn-sm btn-secondary",
  onCopied,
}: {
  value: string;
  label?: string;
  className?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    await copyText(value);
    setCopied(true);
    onCopied?.();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button className={className} onClick={copy} type="button">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3 className="empty-title">{title}</h3>
      {description && <p className="empty-desc">{description}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}
