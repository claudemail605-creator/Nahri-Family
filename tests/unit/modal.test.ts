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

  it('keeps a single dialog open at a time', () => {
    const first = openModal({ title: 'First', content: '1' });
    const second = openModal({ title: 'Second', content: '2' });
    expect(first.root.isConnected).toBe(false);
    expect(second.root.isConnected).toBe(true);
    expect(document.querySelectorAll('.modal-backdrop')).toHaveLength(1);
  });

  it('calls onClose exactly once', () => {
    const onClose = vi.fn();
    const handle = openModal({ title: 'T', content: 'C', onClose });
    handle.close();
    handle.close();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
