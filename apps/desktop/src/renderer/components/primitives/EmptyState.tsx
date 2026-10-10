import type { ReactNode } from "react";
import "./empty-state.css";

/**
 * Empty and unavailable states retain a grouped title, explanation and real action.
 * Decorative character art is retired; the message carries the state itself.
 */
export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="vua-empty-state">
      <p className="vua-empty-state__title">{title}</p>
      {description ? <p className="vua-caption vua-text-secondary">{description}</p> : null}
      {action}
    </div>
  );
}
