import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level safety net: if any render throws (e.g. unexpected data shape that
 * slips past normalization), show a recoverable message instead of a blank page.
 * Offers clearing this workspace's local data, since local-first means corrupt
 * localStorage would otherwise re-trigger the crash on every reload.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled UI error:', error, info);
  }

  private handleClearLocal = () => {
    try {
      // Drop only the CURRENT workspace's cached data (matches the button copy),
      // then reload from server. Other workspaces' unsynced edits are preserved.
      const wid = localStorage.getItem('mcp-workspace:workspace-id');
      if (wid) {
        localStorage.removeItem(`mcp-workspace:ws:${wid}:services`);
        localStorage.removeItem(`mcp-workspace:ws:${wid}:snapshot`);
      }
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'var(--text-primary, #e0e0e0)', fontFamily: 'sans-serif' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: 'var(--text-secondary, #a0a0a0)' }}>
            The app hit an unexpected error while rendering. You can reload, or clear this
            workspace's locally cached data (your last server-saved version is kept).
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--error, #ff4d4f)', fontSize: 12 }}>
            {this.state.error.message}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => window.location.reload()}>Reload</button>
            <button onClick={this.handleClearLocal}>Clear local data &amp; reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
