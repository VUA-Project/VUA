import { Component, type ReactNode } from "react";
import { strings } from "../../i18n/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";

/** A broken optional page/bundle must not take the host shell with it. */
export class AmfBoundary extends Component<{ children: ReactNode; manage: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <EmptyState title={strings.amfModule.changeFailed} description={strings.amfModule.retained}
      action={<Button onClick={this.props.manage}>{strings.amfModule.manage}</Button>} /> : this.props.children;
  }
}
