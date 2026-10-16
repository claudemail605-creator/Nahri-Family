import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeActiveModal, openModal } from '../../src/ui/modal';

function press(el: Element, key: string, shift = false): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true }),
  );
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  closeActiveModal();
});

describe('openModal', () => {
  it('renders an accessible, labelled dialog and focuses it', () => {
    const handle = openModal({ title: 'Sign in', content: 'Hi' });
    expect(document.querySelector('[role="dialog"]')).toBe(handle.dialog);
    expect(handle.dialog.getAttribute('aria-modal')).toBe('true');
    const titleId = handle.dialog.getAttribute('aria-labelledby')!;
    expect(handle.dialog.querySelector(`#${titleId}`)!.textContent).toBe('Sign in');
    expect(handle.dialog.querySelector('.modal__text')!.textContent).toBe('Hi');
    expect(document.activeElement).toBe(handle.dialog);
  });

  it('restores focus to the opener on close', () => {
    const opener = document.createElement('button');
    opener.textContent = 'open';
    document.body.append(opener);
    opener.focus();
    const handle = openModal({ title: 'T', content: 'C' });
    handle.close();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape when dismissible', () => {
    const handle = openModal({ title: 'T', content: 'C' });
    press(handle.dialog, 'Escape');
    expect(handle.root.isConnected).toBe(false);
    expect(document.querySelector('.modal-backdrop')).toBeNull();
  });

  it('closes on Escape even when focus has left the dialog', () => {
    const handle = openModal({ title: 'T', content: 'C' });
    // A disabled action button (save in flight) drops focus to the body; the
    // dialog must still dismiss.
    (document.activeElement as HTMLElement | null)?.blur();
    press(document.body, 'Escape');
    expect(handle.root.isConnected).toBe(false);
  });

  it('ignores Escape and hides the close button when not dismissible', () => {
    const handle = openModal({ title: 'T', content: 'C', dismissible: false });
    expect(handle.dialog.querySelector('.modal__close')).toBeNull();
    press(handle.dialog, 'Escape');
    expect(handle.root.isConnected).toBe(true);
  });

  it('traps Tab focus inside the dialog', () => {
    const handle = openModal({
      title: 'T',
      content: 'C',
      actions: [
        { label: 'One', kind: 'primary', onClick: () => {} },
        { label: 'Two', onClick: () => {} },
      ],
    });
    const buttons = Array.from(handle.dialog.querySelectorAll('button'));
    const first = buttons[0]!; // close button (header)
    const last = buttons[buttons.length - 1]!; // "Two"
    last.focus();
    press(last, 'Tab');
    expect(document.activeElement).toBe(first);
    press(first, 'Tab', true);
    expect(document.activeElement).toBe(last);
  });

  it('closes on backdrop click when dismissible', () => {
    const handle = openModal({ title: 'T', content: 'C' });
    handle.root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handle.root.isConnected).toBe(false);
  });

  it('invokes action handlers with a close function', () => {
    const onClick = vi.fn((close: () => void) => close());
    const handle = openModal({
      title: 'T',
      content: 'C',
      actions: [{ label: 'Go', kind: 'primary', onClick }],
    });
    const go = Array.from(handle.dialog.querySelectorAll('button')).find(
      (button) => button.textContent === 'Go',
    )!;
    go.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(handle.root.isConnected).toBe(false);
  });

  it('stacks dialogs: Escape closes only the top one and reveals the one below', () => {
    const first = openModal({ title: 'First', content: '1' });
    const second = openModal({ title: 'Second', content: '2' });
    expect(first.root.isConnected).toBe(true);
    expect(second.root.isConnected).toBe(true);
    expect(document.querySelectorAll('.modal-backdrop')).toHaveLength(2);
    // The dialog below is inert while the top one is up.
    expect(first.root.hasAttribute('inert')).toBe(true);

    press(document.body, 'Escape');
    expect(second.root.isConnected).toBe(false);
    expect(first.root.isConnected).toBe(true);
    expect(first.root.hasAttribute('inert')).toBe(false);
    // Page scroll stays locked while a dialog is still open.
    expect(document.documentElement.classList.contains('modal-open')).toBe(true);

    press(document.body, 'Escape');
    expect(first.root.isConnected).toBe(false);
    expect(document.documentElement.classList.contains('modal-open')).toBe(false);
  });

  it('calls onClose exactly once', () => {
    const onClose = vi.fn();
    const handle = openModal({ title: 'T', content: 'C', onClose });
    handle.close();
    handle.close();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders an optional subtitle and extra dialog classes', () => {
    const handle = openModal({
      title: 'Add person',
      subtitle: 'Names please',
      content: 'C',
      dialogClass: 'modal--wide person-modal',
    });
    expect(handle.dialog.querySelector('.modal__sub')!.textContent).toBe('Names please');
    expect(handle.dialog.classList.contains('person-modal')).toBe(true);
    expect(handle.dialog.classList.contains('modal--wide')).toBe(true);
  });

  it('re-evaluates a dismissible function on every attempt', () => {
    let locked = true;
    const handle = openModal({ title: 'T', content: 'C', dismissible: () => !locked });
    press(handle.dialog, 'Escape');
    expect(handle.root.isConnected).toBe(true);
    // Not dismissible at open → no close button, but Escape must start working
    // as soon as the function says so.
    expect(handle.dialog.querySelector('.modal__close')).toBeNull();

    locked = false;
    press(handle.dialog, 'Escape');
    expect(handle.root.isConnected).toBe(false);
  });

  it('wires a submit action to its form without running the click handler', () => {
    const form = document.createElement('form');
    form.id = 'person-form-1';
    document.body.append(form);
    const handle = openModal({
      title: 'T',
      content: 'C',
      actions: [{ label: 'Save', kind: 'accent', type: 'submit', form: 'person-form-1' }],
    });
    const save = Array.from(handle.dialog.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save',
    ) as HTMLButtonElement;
    expect(save.type).toBe('submit');
    expect(save.getAttribute('form')).toBe('person-form-1');
  });

  it('locks page scroll while open and releases it on close', () => {
    const handle = openModal({ title: 'T', content: 'C' });
    expect(document.documentElement.classList.contains('modal-open')).toBe(true);
    handle.close();
    expect(document.documentElement.classList.contains('modal-open')).toBe(false);
  });
});
