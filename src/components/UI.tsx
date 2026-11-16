import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type IconName =
  | "upload" | "download" | "undo" | "redo" | "help" | "save" | "folder" | "layers"
  | "cut" | "engrave" | "score" | "pin" | "trash" | "copy" | "rotate" | "plus"
  | "minus" | "fit" | "settings" | "image" | "grid" | "zoom" | "alert" | "check"
  | "x" | "arrow" | "chevron" | "chevronDown" | "chevronUp" | "cat" | "wood"
  | "sparkles" | "ruler" | "eye" | "eyeOff" | "lock" | "unlock" | "file" | "flame"
  | "scissors" | "move" | "target" | "info" | "external" | "sort" | "shapes" | "magnet" | "palette";

const PATHS: Record<IconName, ReactNode> = {
  upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v2h16v-2"/></>,
  undo: <><path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/></>,
  redo: <><path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6v1"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2-2.5 3.6"/><path d="M12 17.2v.1"/></>,
  save: <><path d="M5 4h12l3 3v13H5z"/><path d="M8 4v5h8V4M8 20v-7h8v7"/></>,
  folder: <path d="M3 6h6l2 2h10v11H3z"/>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  cut: <><path d="m5 5 14 14M19 5 5 19"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></>,
  engrave: <><path d="M4 20c4-9 9-14 16-16-2 7-7 12-16 16Z"/><path d="m9 15 4-4M13 17l3-3"/></>,
  score: <><path d="M4 18c4 0 6-12 10-12 3 0 3 4 6 4"/><path d="M4 21h16"/></>,
  pin: <><path d="m9 3 6 6-1 4 3 3-7 1-4 4-1-1 4-4 1-7 3 3 4-1Z"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></>,
  rotate: <><path d="M20 9a8 8 0 1 0 1 6"/><path d="M20 4v5h-5"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  minus: <path d="M5 12h14"/>,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="10" r="2"/><path d="m3 18 5-5 4 4 3-3 6 6"/></>,
  grid: <><path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/></>,
  zoom: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M8 10.5h5M10.5 8v5"/></>,
  alert: <><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17.2v.1"/></>,
  check: <path d="m4 12 5 5L20 6"/>,
  x: <path d="m5 5 14 14M19 5 5 19"/>,
  arrow: <path d="M4 12h16M14 6l6 6-6 6"/>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  chevronDown: <path d="m5 9 7 7 7-7"/>,
  chevronUp: <path d="m5 15 7-7 7 7"/>,
  cat: <><path d="M5 9 4 3l5 3a9 9 0 0 1 6 0l5-3-1 6v5a7 7 0 0 1-14 0Z"/><circle cx="9" cy="12" r=".8" fill="currentColor"/><circle cx="15" cy="12" r=".8" fill="currentColor"/><path d="M11 15h2M10 17c1 .8 3 .8 4 0"/></>,
  wood: <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9c4-2 7 2 11 0s4-1 7 0M3 14c5-2 8 2 12 0 3-1 4 0 6 0M3 19c4-1 8 2 12 0 2-.7 4-.6 6-.2"/></>,
  sparkles: <><path d="m12 3 1.7 4.8L18 9.5l-4.3 1.7L12 16l-1.7-4.8L6 9.5l4.3-1.7L12 3Z"/><path d="m19 15 .9 2.2L22 18l-2.1.8L19 21l-.9-2.2L16 18l2.1-.8L19 15Z"/><path d="m5 14 .7 1.8L7.5 16l-1.8.7L5 18.5l-.7-1.8L2.5 16l1.8-.7L5 14Z"/></>,
  ruler: <><path d="m4 20 16-16 2 2L6 22l-2-2Z"/><path d="m7 17 2 2M10 14l1.5 1.5M12.5 11.5 14 13M15 9l1.5 1.5M17.5 6.5 19 8"/></>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="M3 3l18 18M10 6.2A10 10 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-2.5 3M6.5 7.5A17 17 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 4-1"/><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="1"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/></>,
  file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 13h6M9 17h6"/></>,
  flame: <><path d="M12 2c4 5 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 4-7 0 3 1 4 2 5 1-4 0-7 1-10Z"/></>,
  scissors: <><circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="m8 8 12 9M8 16 20 7"/></>,
  move: <path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8 2 12l4 4M18 8l4 4-4 4"/>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/></>,
  external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></>,
  sort: <><path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/></>,
  shapes: <><rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="7" r="4"/><path d="m7 14 5 8H2l5-8ZM15 14h7v7h-7z"/></>,
  magnet: <><path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4H6Z"/><path d="M6 8h4M14 8h4"/></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2.2-.9 2.2-2 0-.9-.6-1.4-.6-2.2 0-1.2 1-2 2.2-2H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10.5" r=".8" fill="currentColor"/><circle cx="10" cy="7" r=".8" fill="currentColor"/><circle cx="14" cy="7" r=".8" fill="currentColor"/><circle cx="16.5" cy="10.5" r=".8" fill="currentColor"/></>,
};

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className || ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export type IconNameType = IconName;

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "md",
  icon,
  disabled,
  title,
  type = "button",
  className = "",
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "warm";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({
  icon,
  onClick,
  title,
  active,
  disabled,
  size = 18,
  className = "",
}: {
  icon: IconName;
  onClick?: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? "active" : ""} ${className}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Field({ label, hint, children, className = "" }: { label?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix,
  ariaLabel,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(formatNum(value));
  }, [value]);
  const commit = () => {
    const n = parseFloat(text.replace(",", "."));
    if (Number.isFinite(n)) {
      const clamped = Math.max(min, Math.min(max, n));
      setText(formatNum(clamped));
      onChange(clamped);
    } else {
      setText(formatNum(value));
    }
  };
  return (
    <div className={`number-field ${disabled ? "disabled" : ""}`}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        disabled={disabled}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; commit(); }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.currentTarget.blur(); }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const n = Math.max(min, Math.min(max, (parseFloat(text.replace(",", ".")) || 0) + d));
            setText(formatNum(n));
            onChange(n);
          }
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  );
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  compact,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  return (
    <div className={`segmented ${compact ? "compact" : ""}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? "active" : ""}
          title={o.hint}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle-row" title={hint}>
      <span className="toggle-text">{label}{hint && <em>{hint}</em>}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span>{label}</span>
        <b>{format ? format(value) : value}</b>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "920px",
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${className}`} style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon="x" title="Cerrar" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Callout({ kind = "info", children }: { kind?: "info" | "warn" | "ok"; children: ReactNode }) {
  return (
    <div className={`callout callout-${kind}`}>
      <Icon name={kind === "warn" ? "alert" : kind === "ok" ? "check" : "info"} size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Badge({ children, kind = "neutral" }: { children: ReactNode; kind?: "neutral" | "cut" | "engrave" | "score" | "warn" | "ok" }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export function Stepper({ value, onChange, min = 0, max = 999 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Menos">
        <Icon name="minus" size={14} />
      </button>
      <span>{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Más">
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress" aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}
