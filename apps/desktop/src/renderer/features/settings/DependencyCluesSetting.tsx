import { useState } from "react";
import { useDependencyClues } from "../../app/dependency-clues-flag.ts";
import { ConfirmDialog } from "../../components/primitives/ConfirmDialog.tsx";
import { Toggle } from "../../components/primitives/Toggle.tsx";
import { strings } from "../../i18n/index.ts";

const copy = strings.settings.experimental;

export function DependencyCluesSetting() {
  const [on, setOn] = useDependencyClues();
  const [confirmOpen, setConfirmOpen] = useState(false);
  return <>
    <section className="vua-exp-card__row">
      <div className="vua-exp-card__text">
        <strong>{copy.dependencyCluesTitle}</strong>
        <p className="vua-caption vua-text-secondary">{copy.dependencyCluesDesc}</p>
      </div>
      <Toggle on={on} label={copy.dependencyCluesTitle}
        onToggle={() => on ? setOn(false) : setConfirmOpen(true)} />
    </section>
    <ConfirmDialog open={confirmOpen} title={copy.dependencyCluesDialogTitle}
      cancelLabel={copy.dialogCancel} confirmLabel={copy.dependencyCluesEnable}
      onCancel={() => setConfirmOpen(false)} onConfirm={() => {
        setConfirmOpen(false);
        setOn(true);
      }}>
      <p>{copy.dependencyCluesWarning}</p>
      <p>{copy.dependencyCluesReverseNote}</p>
    </ConfirmDialog>
  </>;
}
