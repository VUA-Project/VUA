import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/primitives/Button.tsx";
import { Card } from "../components/primitives/Card.tsx";
import { format, strings } from "../i18n/index.ts";
import {
  emptyNavConfirmQueue,
  navConfirmAnswer,
  navConfirmEnqueue,
  type NavConfirmQueue,
} from "./navigation-confirm-model.ts";

/**
 * 导航确认卡(015 §12,批 B-3;U9(1)/(3) 确认层的渲染层载体):
 * App 挂载一次,全局消费 Main 发来的确认请求——清单外 http/https 页
 * (确认后转当前内嵌视图)与外部协议(确认后交系统打开)。逐条呈现,作答
 * 回发 Main;用户不答=不执行。A-1 要素:完整 URL＋来源标识。
 */
const copy = strings.navConfirm;

export function NavigationConfirmOverlay() {
  const [queue, setQueue] = useState<NavConfirmQueue>(emptyNavConfirmQueue);

  useEffect(() => {
    const remote = window.vua?.navigationConfirm;
    if (remote === undefined) return undefined;
    return remote.events.subscribe((request) => {
      setQueue((current) => navConfirmEnqueue(current, request));
    });
  }, []);

  const current = queue[0];
  const answer = useMemo(
    () => (approved: boolean) => {
      const result = navConfirmAnswer(queue, approved);
      setQueue(result.queue);
      if (result.answered !== null) {
        void window.vua?.navigationConfirm?.respond(result.answered.confirmId, approved);
      }
    },
    [queue],
  );

  if (current === undefined) return null;

  const external = current.reason === "external_protocol";
  const title = external ? copy.externalTitle : copy.offAllowlistTitle;
  const body = external ? copy.externalBody : copy.offAllowlistBody;

  return (
    <div className="vua-nav-confirm__backdrop" data-vua-native-occluder="" role="dialog" aria-modal="true" aria-label={title}>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{title}</h2>
          <p className="vua-text-secondary">{body}</p>
          <p className="vua-nav-confirm__url" title={current.url}>
            {current.url}
          </p>
          <div className="vua-nav-confirm__actions">
            <Button variant="default" onClick={() => answer(false)}>
              {copy.cancelCta}
            </Button>
            <Button variant="primary" onClick={() => answer(true)}>
              {copy.openCta}
            </Button>
          </div>
          {queue.length > 1 ? (
            <p className="vua-caption vua-text-secondary">
              {format(copy.pendingCount, { count: queue.length - 1 })}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
