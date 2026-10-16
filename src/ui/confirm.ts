import { openModal } from './modal';

/**
 * A promise-based confirmation dialog built on the shared modal — the
 * replacement for `window.confirm` (which cannot be styled, translated or
 * tested through the DOM). Resolves `true` only when the confirm button is
 * clicked; Escape, the close button and a backdrop click resolve `false`.
 */

export interface ConfirmOptions {
  title: string;
  message: string | Node;
  confirmLabel: string;
  cancelLabel: string;
  /** Visual weight of the confirm button (default `primary`). */
  kind?: 'primary' | 'accent' | 'ghost' | 'danger';
  /** Accessible label for the close button. */
  closeLabel?: string;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openModal({
      title: options.title,
      content: options.message,
      closeLabel: options.closeLabel ?? options.cancelLabel,
      actions: [
        {
          label: options.cancelLabel,
          kind: 'ghost',
          onClick: (close) => {
            settle(false);
            close();
          },
        },
        {
          label: options.confirmLabel,
          kind: options.kind ?? 'primary',
          onClick: (close) => {
            settle(true);
            close();
          },
        },
      ],
      onClose: () => settle(false),
    });
  });
}
