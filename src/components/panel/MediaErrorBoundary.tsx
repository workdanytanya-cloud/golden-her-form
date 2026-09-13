import type { ReactNode } from "react";
import { Component } from "react";

type Props = { fallback: ReactNode; children: ReactNode };

type State = { failed: boolean };

/** Изолирует ошибку одного видео/блока, чтобы день тренировки оставался доступен. */
export class MediaErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
