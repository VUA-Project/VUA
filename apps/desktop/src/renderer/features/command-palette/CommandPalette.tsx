import { useEffect, useRef, useState } from "react";
import { strings } from "../../i18n/index.ts";
import { ModalOwnerContext, useModalLayer } from "../../components/primitives/modal-layer.tsx";
import { POPOVER_ENTER, useEntranceMotion } from "../../components/primitives/motion.ts";
import {
  filterCommands,
  moveCursor,
  type CommandGroup,
  type CommandItem,
} from "./command-palette-model.ts";
import "./command-palette.css";

const copy = strings.commandPalette;

function groupLabel(group: CommandGroup): string {
  if (group === "guide") return strings.journey.guide;
  return group === "pages" ? copy.groupPages : copy.groupActions;
}

/**
 * 命令面板(C-EFFICIENCY,ui-ux §6.1 Ctrl+P):
 * - 页面跳转 + 百科速查 + 全局动作统一命令列表;过滤/光标语义见 command-palette-model;
 * - 键盘:↑↓ 循环移动光标并自动滚入视区,Enter 执行,Esc 关闭;鼠标 hover 同步光标;
 * - 可访问性:dialog + combobox/listbox 模式(APG) + 模态栈焦点隔离与恢复 + 原生浏览器视图遮挡让位;
 * - 执行即关闭;动作失败不在面板内呈现(本切片命令均为恒可执行的导航/主题)。
 */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: readonly CommandItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const modal = useModalLayer(true, onClose);
  const results = filterCommands(commands, query);
  const active = Math.min(cursor, Math.max(0, results.length - 1));
  const activeId = results[active]?.id;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (activeId === undefined) return;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(activeId)
        : activeId.replace(/["\\]/g, "\\$&");
    const item = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-id="${escaped}"]`,
    );
    item?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  useEntranceMotion(true, modal.overlayRef, [{ opacity: 0 }, { opacity: 1 }]);
  useEntranceMotion(true, modal.panelRef, POPOVER_ENTER);

  const execute = (command: CommandItem) => {
    onClose();
    command.run();
  };

  return (
    <ModalOwnerContext value={modal.id}>
      <div
        ref={modal.overlayRef}
        className="vua-palette__backdrop"
        data-vua-native-occluder=""
        onClick={modal.closeTop}
      >
        <div
          ref={modal.panelRef}
          tabIndex={-1}
          className="vua-palette"
          role="dialog"
          aria-modal="true"
          aria-label={copy.aria}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            ref={inputRef}
            autoFocus
            className="vua-palette__input"
            role="combobox"
            aria-expanded="true"
            aria-controls="vua-palette-list"
            aria-activedescendant={
              activeId !== undefined ? `vua-palette-option-${activeId}` : undefined
            }
            value={query}
            placeholder={copy.placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor(moveCursor(active, 1, results.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor(moveCursor(active, -1, results.length));
              } else if (event.key === "PageUp" || (event.key === "Home" && (query === "" || event.ctrlKey))) {
                event.preventDefault();
                setCursor(0);
              } else if (event.key === "PageDown" || (event.key === "End" && (query === "" || event.ctrlKey))) {
                event.preventDefault();
                setCursor(Math.max(0, results.length - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const command = results[active];
                if (command) execute(command);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <ul ref={listRef} className="vua-palette__list" id="vua-palette-list" role="listbox">
            {results.map((command, index) => (
              <li
                key={command.id}
                id={`vua-palette-option-${command.id}`}
                data-palette-id={command.id}
                role="option"
                aria-selected={index === active}
                data-active={index === active || undefined}
                className="vua-palette__option"
                onMouseEnter={() => setCursor(index)}
                onClick={() => execute(command)}
              >
                <span className="vua-palette__group vua-caption vua-text-secondary">
                  {groupLabel(command.group)}
                </span>
                <span className="vua-palette__label">{command.label}</span>
                {command.hint ? (
                  <span className="vua-palette__hint vua-caption vua-text-secondary">
                    {command.hint}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {results.length === 0 ? (
            <p role="status" className="vua-palette__empty vua-text-secondary">{copy.empty}</p>
          ) : null}
        </div>
      </div>
    </ModalOwnerContext>
  );
}
