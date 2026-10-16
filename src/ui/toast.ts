import { h } from './dom';

/**
 * Transient notifications. The host element is created by the app shell with
 * `aria-live="polite"`; error toasts additionally use `role="alert"` so they
 * are announced immediately.
 */

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** Auto-dismiss delay in ms; 0 keeps the toast until dismissed. */
  durationMs?: number;
  /** Accessible label for the dismiss button (localised by the caller). */
  dismissLabel?: string;
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  info: 4200,
  success: 4200,
  error: 7000,
};

export class ToastHost {
  constructor(private readonly host: HTMLElement) {}

  /** Show a toast; returns a function that dismisses it early. */
  show(message: string, options: ToastOptions = {}): () => void {
    const kind = options.kind ?? 'info';
    const duration = options.durationMs ?? DEFAULT_DURATION[kind];

    let timer: ReturnType<typeof setTimeout> | undefined;
    const dismiss = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      el.remove();
    };

    const closeButton = h(
      'button',
      {
        type: 'button',
        class: 'toast__close',
        'aria-label': options.dismissLabel ?? 'Dismiss',
        onclick: () => dismiss(),
      },
      '×',
    );
    const el = h(
      'div',
      { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' },
      h('span', { class: 'toast__message', text: message }),
      closeButton,
    );

    this.host.append(el);
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return dismiss;
  }
}
