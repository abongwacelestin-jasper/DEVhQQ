import React from 'react';

interface Props {
  children: React.ReactNode;
  onError: (reason: string) => void;
}

/** Catches render-time crashes in the Codespaces view and hands control back to the sandbox. */
export class CodespaceErrorBoundary extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(`Codespaces view crashed: ${error.message}`);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
