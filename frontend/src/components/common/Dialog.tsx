import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from './Button';
import styles from './Dialog.module.css';

export interface DialogOptions {
  /** Optional bold title shown above the message */
  title?: string;
  /** Body content of the dialog */
  message: React.ReactNode;
  /** Confirm button label */
  confirmText?: string;
  /** Cancel button label (only shown when showCancel is true) */
  cancelText?: string;
  /** Whether to render the cancel button (confirm dialogs) */
  showCancel?: boolean;
  /** Render the confirm button in a destructive (red) style */
  danger?: boolean;
}

interface DialogProps extends DialogOptions {
  onClose: (result: boolean) => void;
}

function Dialog({
  title,
  message,
  confirmText = 'OK',
  cancelText = 'Cancel',
  showCancel = false,
  danger = false,
  onClose,
}: DialogProps) {
  const [visible, setVisible] = useState(false);

  // Trigger enter animation after mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = (result: boolean) => {
    setVisible(false);
    // Allow exit animation to play before unmounting
    window.setTimeout(() => onClose(result), 150);
  };

  // Keyboard: Enter confirms, Escape cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`${styles.overlay} ${visible ? styles.visible : ''}`}
      onMouseDown={(e) => {
        // Click on backdrop dismisses (treated as cancel)
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true">
        {title && <div className={styles.title}>{title}</div>}
        <div className={styles.message}>{message}</div>
        <div className={styles.footer}>
          {showCancel && (
            <Button variant="secondary" size="small" onClick={() => close(false)}>
              {cancelText}
            </Button>
          )}
          <Button
            variant="primary"
            size="small"
            className={danger ? styles.danger : undefined}
            onClick={() => close(true)}
            autoFocus
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Imperatively show a themed dialog. Resolves to true if confirmed, false if cancelled/dismissed.
 * Renders into a throwaway container so it can be called from anywhere (including outside React).
 */
function showDialog(options: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const handleClose = (result: boolean) => {
      root.unmount();
      container.remove();
      resolve(result);
    };

    root.render(<Dialog {...options} onClose={handleClose} />);
  });
}

/**
 * Dark-themed replacement for window.confirm(). Resolves true when confirmed.
 */
export function confirmDialog(
  options: Omit<DialogOptions, 'showCancel'>,
): Promise<boolean> {
  return showDialog({ confirmText: 'Confirm', cancelText: 'Cancel', ...options, showCancel: true });
}

/**
 * Dark-themed replacement for window.alert(). Resolves once dismissed.
 */
export function alertDialog(
  options: Omit<DialogOptions, 'showCancel' | 'danger'>,
): Promise<void> {
  return showDialog({ confirmText: 'OK', ...options, showCancel: false }).then(() => undefined);
}
