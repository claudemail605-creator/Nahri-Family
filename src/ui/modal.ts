import { h } from './dom';

/**
 * Modal dialog infrastructure: one dialog at a time, focus moved inside on
 * open and restored on close, Escape/backdrop dismissal (when dismissible),
 * and a Tab focus trap. Written against the DOM only so jsdom can unit-test
 * the behaviour.
 */

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'accent' | 'ghost' | 'danger';
  onClick: (close: () => void) => void;
}

export interface OpenModalOptions {
  title: string;
  content: string | Node;
  actions?: ModalAction[];
  /** Default true — Escape and backdrop clicks close the dialog. */
  dismissible?: boolean;
  /** Accessible label for the close button. */
  closeLabel?: string;
  onClose?: () => void;
}

export interface ModalHandle {
  close(): void;
  readonly root: HTMLElement;
  readonly dialog: HTMLElement;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let activeModal: ModalHandle | null = null;
let modalSeq = 0;

export function openModal(options: OpenModalOptions, doc: Document = document): ModalHandle {
  // Single-dialog policy: opening a second modal closes the first.
  activeModal?.close();

  const dismissible = options.dismissible ?? true;
  const titleId = `modal-title-${++modalSeq}`;
  const previouslyFocused =
    doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body
      ? doc.activeElement
      : null;

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    if (activeModal === handle) activeModal = null;
    root.remove();
    if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    options.onClose?.();
  }

  const closeButton = h('button', {
    type: 'button',
    class: 'modal__close',
    'aria-label': options.closeLabel ?? 'Close',
    onclick: () => close(),
  }, '×');

  const body = h('div', { class: 'modal__body' });
  if (typeof options.content === 'string') {
    body.appendChild(h('p', { class: 'modal__text', text: options.content }));
  } else {
    body.appendChild(options.content);
  }

  const actions = options.actions?.length
    ? h(
        'div',
        { class: 'modal__actions' },
        ...options.actions.map((action) =>
          h(
            'button',
            {
              type: 'button',
              class: `btn btn--${action.kind ?? 'ghost'}`,
              onclick: () => action.onClick(close),
            },
            action.label,
          ),
        ),
      )
    : null;

  const dialog = h(
    'div',
    {
      class: 'modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabindex: '-1',
    },
    h(
      'header',
      { class: 'modal__head' },
      h('h2', { class: 'modal__title', id: titleId, text: options.title }),
      dismissible ? closeButton : null,
    ),
    body,
    actions,
  );

  const root = h('div', { class: 'modal-backdrop' }, dialog);

  root.addEventListener('click', (event) => {
    if (event.target === root && dismissible) close();
  });

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusables.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const activeIndex = focusables.indexOf(doc.activeElement as HTMLElement);
    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeIndex === focusables.length - 1) {
      event.preventDefault();
      first.focus();
    }
  });

  doc.body.appendChild(root);
  dialog.focus();

  const handle: ModalHandle = { close, root, dialog };
  activeModal = handle;
  return handle;
}

/** Test/teardown helper: closes any open dialog and clears module state. */
export function closeActiveModal(): void {
  activeModal?.close();
  activeModal = null;
}
