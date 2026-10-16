import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../../src/ui/toast';

let host: HTMLElement;
let toasts: ToastHost;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  toasts = new ToastHost(host);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastHost', () => {
  it('shows a message and auto-dismisses', () => {
    toasts.show('Saved', { kind: 'success' });
    expect(host.querySelector('.toast__message')!.textContent).toBe('Saved');
    expect(host.querySelector('.toast')!.getAttribute('role')).toBe('status');
    vi.advanceTimersByTime(4199);
    expect(host.querySelectorAll('.toast')).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(host.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('uses role=alert for errors, which linger longer', () => {
    toasts.show('Boom', { kind: 'error' });
    expect(host.querySelector('.toast')!.getAttribute('role')).toBe('alert');
    vi.advanceTimersByTime(5000);
    expect(host.querySelectorAll('.toast')).toHaveLength(1);
    vi.advanceTimersByTime(2001);
    expect(host.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('durationMs 0 keeps the toast until dismissed', () => {
    const dismiss = toasts.show('Sticky', { durationMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(host.querySelectorAll('.toast')).toHaveLength(1);
    dismiss();
    expect(host.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('dismiss button removes the toast and dismiss() is idempotent', () => {
    const dismiss = toasts.show('Bye');
    (host.querySelector('.toast__close') as HTMLButtonElement).click();
    expect(host.querySelectorAll('.toast')).toHaveLength(0);
    expect(() => dismiss()).not.toThrow();
    expect(() => dismiss()).not.toThrow();
  });

  it('keeps multiple toasts stacked in order', () => {
    toasts.show('First');
    toasts.show('Second');
    const messages = Array.from(host.querySelectorAll('.toast__message')).map((el) => el.textContent);
    expect(messages).toEqual(['First', 'Second']);
  });
});
