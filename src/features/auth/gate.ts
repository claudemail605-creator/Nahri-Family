import type { I18n, MessageKey } from '../../core/i18n';
import { h, clear } from '../../ui/dom';
import type { AuthController, AuthState } from './controller';
import { friendlyAuthError } from './errors';

/**
 * The full-screen sign-in gate. Renders from AuthState only:
 *   unavailable — the Supabase client could not be created
 *   loading     — the stored session is still settling
 *   set-password— invite / recovery link is active
 *   verifying   — session present, profile being confirmed (retry on error)
 *   sign-in     — email + password, with the notice and a forgot-password view
 *
 * The LTR tree canvas is a separate host; this gate inherits the document
 * direction so Urdu lays out right-to-left.
 */

export interface AuthGateDeps {
  i18n: I18n;
  auth: AuthController;
}

export interface AuthGate {
  dispose(): void;
}

type SignInView = 'sign-in' | 'forgot';

export function mountAuthGate(host: HTMLElement, deps: AuthGateDeps): AuthGate {
  const { i18n, auth } = deps;
  let view: SignInView = 'sign-in';

  /* ------------------------------ helpers ------------------------------ */

  const t = (key: MessageKey): string => i18n.t(key);

  function showMessage(el: HTMLElement, kind: 'error' | 'ok', text: string): void {
    el.className = `gate-msg gate-msg--${kind}`;
    el.textContent = text;
  }

  function clearMessage(el: HTMLElement): void {
    el.className = 'gate-msg';
    el.textContent = '';
  }

  function setBusy(button: HTMLButtonElement, labelKey: MessageKey): void {
    button.disabled = true;
    button.textContent = t(labelKey);
  }

  function unsetBusy(button: HTMLButtonElement, labelKey: MessageKey): void {
    button.disabled = false;
    button.textContent = t(labelKey);
  }

  /** Keep the busy label translated if the language changes mid-request. */
  function relabel(button: HTMLButtonElement, key: MessageKey): void {
    if (button.disabled) button.textContent = t(key);
  }

  interface PasswordField {
    elements: HTMLElement[];
    input: HTMLInputElement;
    toggle: HTMLButtonElement;
  }

  function buildPasswordField(
    id: string,
    labelKey: MessageKey,
    autocomplete: string,
  ): PasswordField {
    const input = h('input', {
      class: 'input',
      id,
      type: 'password',
      autocomplete,
      required: true,
    });
    const toggle = h(
      'button',
      {
        type: 'button',
        class: 'pw-field__toggle',
        'data-pw-toggle': id,
        'data-pw-state': 'hidden',
        'aria-pressed': 'false',
      },
      t('auth.showPassword'),
    );
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.dataset.pwState = show ? 'shown' : 'hidden';
      toggle.textContent = t(show ? 'auth.hidePassword' : 'auth.showPassword');
    });
    const label = h('label', { class: 'field-label', for: id, 'data-i18n': true }, labelKey);
    const wrapper = h('div', { class: 'pw-field' }, input, toggle);
    return { elements: [label, wrapper], input, toggle };
  }

  function syncPasswordToggles(scope: HTMLElement): void {
    scope.querySelectorAll<HTMLButtonElement>('.pw-field__toggle').forEach((toggle) => {
      toggle.textContent =
        toggle.dataset.pwState === 'shown' ? t('auth.hidePassword') : t('auth.showPassword');
    });
  }

  function emailField(id: string): { label: HTMLLabelElement; input: HTMLInputElement } {
    const label = h('label', { class: 'field-label', for: id, 'data-i18n': true }, 'auth.email');
    const input = h('input', {
      class: 'input',
      id,
      type: 'email',
      autocomplete: 'username',
      required: true,
    });
    return { label, input };
  }

  /* ------------------------------ views ------------------------------ */

  function renderUnavailable(state: AuthState): HTMLElement {
    return h(
      'div',
      { class: 'gate-card gate-card--center' },
      h('h2', { class: 'gate-title', 'data-i18n': true }, 'auth.unavailableTitle'),
      h('p', {
        class: 'gate-sub',
        text: i18n.fmt('auth.supabaseUnavailable', { msg: state.failureReason ?? '' }),
      }),
    );
  }

  function renderLoading(key: MessageKey): HTMLElement {
    return h(
      'div',
      { class: 'gate-card gate-card--center', role: 'status' },
      h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('p', { class: 'gate-sub', 'data-i18n': true }, key),
    );
  }

  function renderVerifying(state: AuthState): HTMLElement {
    if (!state.profileError) return renderLoading('auth.verifying');
    return h(
      'div',
      { class: 'gate-card gate-card--center', role: 'alert' },
      h('h2', { class: 'gate-title', 'data-i18n': true }, 'auth.unavailableTitle'),
      h('p', {
        class: 'gate-sub',
        text: i18n.fmt('auth.supabaseUnavailable', { msg: state.profileError }),
      }),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary',
          'data-i18n': true,
          onclick: () => auth.retryProfile(),
        },
        'generic.retry',
      ),
    );
  }

  function renderSignIn(state: AuthState): HTMLElement {
    const email = emailField('sign-in-email');
    const password = buildPasswordField('sign-in-password', 'auth.password', 'current-password');
    const message = h('p', { class: 'gate-msg', role: 'alert' });
    const submit = h(
      'button',
      { type: 'submit', class: 'btn btn--primary gate-go', id: 'sign-in-submit', 'data-i18n': true },
      'auth.signIn',
    );

    const notice = state.notice
      ? h('div', { class: 'gate-notice', role: 'status', 'data-i18n': true }, state.notice)
      : null;

    const form = h(
      'form',
      { class: 'gate-card', id: 'sign-in-form', novalidate: true },
      h('h2', { class: 'gate-title', 'data-i18n': true }, 'auth.signIn'),
      h('p', { class: 'gate-sub', 'data-i18n': true }, 'auth.signInSub'),
      notice,
      email.label,
      email.input,
      ...password.elements,
      message,
      submit,
      h(
        'button',
        {
          type: 'button',
          class: 'link gate-link',
          id: 'sign-in-forgot',
          'data-i18n': true,
          onclick: () => {
            auth.clearNotice();
            view = 'forgot';
            render(auth.getState());
          },
        },
        'auth.forgot',
      ),
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const emailValue = email.input.value.trim();
      const passwordValue = password.input.value;
      clearMessage(message);
      if (!emailValue) {
        showMessage(message, 'error', t('auth.emailRequired'));
        email.input.focus();
        return;
      }
      if (!passwordValue) {
        showMessage(message, 'error', t('auth.passwordRequired'));
        password.input.focus();
        return;
      }
      setBusy(submit, 'auth.signingIn');
      auth.signIn(emailValue, passwordValue).catch((err: unknown) => {
        showMessage(message, 'error', friendlyAuthError(err, i18n));
        unsetBusy(submit, 'auth.signIn');
        // The password may be wrong — leave the field ready for a retry.
        password.input.focus();
      });
    });

    return form;
  }

  function renderForgot(): HTMLElement {
    const email = emailField('forgot-email');
    const message = h('p', { class: 'gate-msg', role: 'alert' });
    const submit = h(
      'button',
      { type: 'submit', class: 'btn btn--primary gate-go', id: 'forgot-submit', 'data-i18n': true },
      'auth.sendReset',
    );

    const form = h(
      'form',
      { class: 'gate-card', id: 'forgot-form', novalidate: true },
      h('h2', { class: 'gate-title', 'data-i18n': true }, 'auth.forgotTitle'),
      h('p', { class: 'gate-sub', 'data-i18n': true }, 'auth.forgotSub'),
      email.label,
      email.input,
      message,
      submit,
      h(
        'button',
        {
          type: 'button',
          class: 'link gate-link',
          id: 'forgot-back',
          'data-i18n': true,
          onclick: () => {
            view = 'sign-in';
            render(auth.getState());
          },
        },
        'auth.backToSignIn',
      ),
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const emailValue = email.input.value.trim();
      clearMessage(message);
      if (!emailValue) {
        showMessage(message, 'error', t('auth.emailRequired'));
        email.input.focus();
        return;
      }
      setBusy(submit, 'auth.sending');
      auth
        .requestPasswordReset(emailValue)
        .then(() => {
          // Same message whether or not the address is registered — the
          // server never tells, and neither do we.
          showMessage(message, 'ok', t('auth.resetSent'));
          unsetBusy(submit, 'auth.sendReset');
        })
        .catch((err: unknown) => {
          showMessage(message, 'error', friendlyAuthError(err, i18n));
          unsetBusy(submit, 'auth.sendReset');
        });
    });

    return form;
  }

  function renderSetPassword(state: AuthState): HTMLElement {
    const invited = state.pendingLink === 'invite';
    const password = buildPasswordField('set-pw-password', 'auth.newPassword', 'new-password');
    const confirm = buildPasswordField('set-pw-confirm', 'auth.confirmPassword', 'new-password');
    const message = h('p', { class: 'gate-msg', role: 'alert' });
    const submit = h(
      'button',
      {
        type: 'submit',
        class: 'btn btn--primary gate-go',
        id: 'set-password-submit',
        'data-i18n': true,
      },
      'auth.savePassword',
    );

    const form = h(
      'form',
      { class: 'gate-card', id: 'set-password-form', novalidate: true },
      h(
        'h2',
        { class: 'gate-title', 'data-i18n': true },
        invited ? 'auth.setPasswordInvite' : 'auth.setPassword',
      ),
      h(
        'p',
        { class: 'gate-sub', 'data-i18n': true },
        invited ? 'auth.setPasswordInviteSub' : 'auth.setPasswordSub',
      ),
      ...password.elements,
      ...confirm.elements,
      h('p', { class: 'gate-hint', 'data-i18n': true }, 'auth.minChars'),
      message,
      submit,
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const pw = password.input.value;
      const pw2 = confirm.input.value;
      clearMessage(message);
      if (!pw || pw.length < 8) {
        showMessage(message, 'error', t('auth.pwTooShort'));
        password.input.focus();
        return;
      }
      if (pw !== pw2) {
        showMessage(message, 'error', t('auth.pwMismatch'));
        confirm.input.focus();
        return;
      }
      setBusy(submit, 'auth.saving');
      auth.setNewPassword(pw, pw2).catch((err: unknown) => {
        const raw = err instanceof Error ? err.message : String(err);
        showMessage(
          message,
          'error',
          raw === 'PASSWORD_TOO_SHORT'
            ? t('auth.pwTooShort')
            : raw === 'PASSWORD_MISMATCH'
              ? t('auth.pwMismatch')
              : i18n.fmt('auth.pwFailed', { msg: raw }),
        );
        unsetBusy(submit, 'auth.savePassword');
      });
    });

    return form;
  }

  /* ------------------------------ mounting ------------------------------ */

  // Only a meaningful change re-renders the gate. The client re-emits the same
  // status right after getSession() settles (INITIAL_SESSION), and rebuilding
  // the DOM would drop the auto-focused email field — and anything typed into
  // it. The key covers every value the gate actually displays.
  let lastRenderKey: string | null = null;

  function renderKey(state: AuthState): string {
    return [
      state.status,
      view,
      state.notice ?? '',
      state.profileError ?? '',
      state.failureReason ?? '',
      state.pendingLink ?? '',
    ].join('\u0001');
  }

  function render(state: AuthState): void {
    if (state.status !== 'sign-in' && view !== 'sign-in') view = 'sign-in';

    const key = renderKey(state);
    if (key === lastRenderKey) return;
    lastRenderKey = key;

    let card: HTMLElement;
    let focusTarget: HTMLElement | null = null;

    switch (state.status) {
      case 'unavailable':
        card = renderUnavailable(state);
        break;
      case 'loading':
        card = renderLoading('generic.loading');
        break;
      case 'set-password': {
        card = renderSetPassword(state);
        focusTarget = card.querySelector<HTMLElement>('#set-pw-password');
        break;
      }
      case 'verifying':
        card = renderVerifying(state);
        break;
      case 'ready':
        clear(host);
        return;
      case 'sign-in':
      default: {
        if (view === 'forgot') {
          card = renderForgot();
          focusTarget = card.querySelector<HTMLElement>('#forgot-email');
        } else {
          card = renderSignIn(state);
          focusTarget = card.querySelector<HTMLElement>('#sign-in-email');
        }
        break;
      }
    }

    clear(host);
    host.append(card);
    i18n.apply();
    // Focus the first field for keyboard users when a view appears. Identical
    // states never reach this point (see renderKey), so an untouched form
    // keeps its focus and its typed text.
    focusTarget?.focus();
  }

  render(auth.getState());
  const unsubscribeState = auth.onStateChange(render);
  const unsubscribeLang = i18n.onLanguageChange(() => {
    syncPasswordToggles(host);
    // Busy labels live on real buttons — re-translate them in place.
    const relabelIf = (selector: string, key: MessageKey): void => {
      const button = host.querySelector<HTMLButtonElement>(selector);
      if (button) relabel(button, key);
    };
    relabelIf('#sign-in-submit', 'auth.signIn');
    relabelIf('#forgot-submit', 'auth.sendReset');
    relabelIf('#set-password-submit', 'auth.savePassword');
  });

  return {
    dispose() {
      unsubscribeState();
      unsubscribeLang();
      clear(host);
    },
  };
}
