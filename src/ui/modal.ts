import { h } from './dom';

/**
 * Modal dialog infrastructure: a stack of dialogs (a confirm can open on top
 * of the person form without destroying it), focus moved inside on open and
 * restored on close, Escape/backdrop dismissal (when dismissible), and a Tab
 * focus trap. Escape is captured at the document level so it works even when
 * focus has left the dialog (e.g. a disabled action button moves focus to the
 * body while a save is in flight). Written against the DOM only so jsdom can
 * unit-test the behaviour.
 */

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'accent' | 'ghost' | 'danger';
  /** `submit` buttons submit the form named by `form` (reference's form= attribute). */
  type?: 'button' | 'submit';
  /** DOM id of the form this button submits. */
  form?: string;
  /** `button` is the action's own button, so callers can toggle a busy state. */
  onClick?: (close: () => void, button: HTMLButtonElement) => void;
}

export interface OpenModalOptions {
  title: string;
  /** Optional second line under the title. */
  subtitle?: string;
  content: string | Node;
  actions?: ModalAction[];
  /**
   * Default true — Escape and backdrop clicks close the dialog. A function is
   * re-evaluated on every attempt, so a dialog can refuse to close while a
   * save is in flight.
   */
  dismissible?: boolean | (() => boolean);
  /** Accessible label for the close button. */
  closeLabel?: string;
  /** Extra class on the dialog element (width/style variants). */
  dialogClass?: string;
  /**
   * Extra element(s) for the head, next to the close button — the tools'
   * print/PNG buttons sit there like the reference's modal-head-actions.
   */
  headActions?: Node;
  onClose?: () => void;
}

export interface ModalHandle {
  close(): void;
  readonly root: HTMLElement;
  readonly dialog: HTMLElement;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, bottom first. `activeModal` is always the top of the stack. */
const modalStack: ModalHandle[] = [];
let modalSeq = 0;

export function openModal(options: OpenModalOptions, doc: Document = document): ModalHandle {
  // The dialog below (if any) stays open but becomes inert while this one is
  // up, so a nested confirmation never destroys the form it came from.
  modalStack[modalStack.length - 1]?.root.setAttribute('inert', '');

  const isTop = (): boolean => modalStack[modalStack.length - 1] === handle;
  const canDismiss = (): boolean =>
    typeof options.dismissible === 'function' ? options.dismissible() : (options.dismissible ?? true);
  const dismissibleAtOpen = canDismiss();
  const titleId = `modal-title-${++modalSeq}`;
  const previouslyFocused =
    doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body
      ? doc.activeElement
      : null;

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    const at = modalStack.indexOf(handle);
    if (at !== -1) modalStack.splice(at, 1);
    doc.removeEventListener('keydown', onKeydown);
    root.remove();
    const top = modalStack[modalStack.length - 1] ?? null;
    if (top) {
      top.root.removeAttribute('inert');
    } else {
      doc.documentElement.classList.remove('modal-open');
    }
    if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    options.onClose?.();
  }

  function onKeydown(event: KeyboardEvent): void {
    // Every open dialog listens; only the top one may act.
    if (event.key !== 'Escape' || !isTop() || !canDismiss()) return;
    event.preventDefault();
    close();
  }

  const closeButton = h('button', {
    type: 'button',
    class: 'modal__close',
    'aria-label': options.closeLabel ?? 'Close',
    onclick: () => {
      if (canDismiss()) close();
    },
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
        ...options.actions.map((action) => {
          const button = h(
            'button',
            {
              type: action.type ?? 'button',
              form: action.form,
              class: `btn btn--${action.kind ?? 'ghost'}`,
            },
            action.label,
          );
          if (action.onClick) {
            const onClick = action.onClick;
            button.addEventListener('click', () => onClick(close, button));
          }
          return button;
        }),
      )
    : null;

  const dialog = h(
    'div',
    {
      class: options.dialogClass ? `modal ${options.dialogClass}` : 'modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabindex: '-1',
    },
    h(
      'header',
      { class: 'modal__head' },
      h(
        'div',
        { class: 'modal__titles' },
        h('h2', { class: 'modal__title', id: titleId, text: options.title }),
        options.subtitle ? h('p', { class: 'modal__sub', text: options.subtitle }) : null,
      ),
      options.headActions
        ? h('div', { class: 'modal__head-actions' }, options.headActions)
        : null,
      dismissibleAtOpen ? closeButton : null,
    ),
    body,
    actions,
  );

  const root = h('div', { class: 'modal-backdrop' }, dialog);

  root.addEventListener('click', (event) => {
    if (event.target === root && canDismiss()) close();
  });

  dialog.addEventListener('keydown', (event) => {
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
  doc.documentElement.classList.add('modal-open');
  dialog.focus();
  doc.addEventListener('keydown', onKeydown);

  const handle: ModalHandle = { close, root, dialog };
  modalStack.push(handle);
  return handle;
}

/** Test/teardown helper: closes every open dialog and clears module state. */
export function closeActiveModal(): void {
  while (modalStack.length) modalStack[modalStack.length - 1]!.close();
}
