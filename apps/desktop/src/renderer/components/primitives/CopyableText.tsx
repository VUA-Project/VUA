import { useEffect, useRef, useState } from "react";
import { Icon } from "@vua/design-system";
import "./copyable-text.css";

export interface CopyableTextProps {
  readonly value: string;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly className?: string;
}

/** Inline monospace path/identifier with a 28px single-click copy button and transient status feedback. */
export function CopyableText({ value, copyLabel, copiedLabel, className }: CopyableTextProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1800);
    } catch {
      /* Clipboard unavailable in restricted sandbox: button stays quiet. */
    }
  };

  return (
    <span className={className ? `vua-copyable ${className}` : "vua-copyable"}>
      <code className="vua-copyable__text" title={value}>{value}</code>
      <button
        type="button"
        className="vua-copyable__button"
        data-copied={copied || undefined}
        aria-label={copied ? copiedLabel : copyLabel}
        title={copied ? copiedLabel : copyLabel}
        onClick={() => { void handleCopy(); }}
      >
        <Icon name={copied ? "check" : "copy"} size={16} />
      </button>
    </span>
  );
}
