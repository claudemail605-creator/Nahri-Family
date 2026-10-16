import { describe, expect, it, vi } from 'vitest';
import {
  currentPageUrl,
  isExpiredLinkError,
  isLinkType,
  readAuthLink,
  stripAuthParams,
  type Windowish,
} from '../../src/features/auth/link';

describe('readAuthLink()', () => {
  it('reads the implicit-flow hash', () => {
    expect(readAuthLink({ hash: '#access_token=abc&type=Invite', search: '' })).toEqual({
      type: 'invite',
      error: null,
    });
  });

  it('reads the PKCE query string', () => {
    expect(readAuthLink({ hash: '', search: '?type=recovery&code=xyz' })).toEqual({
      type: 'recovery',
      error: null,
    });
  });

  it('prefers the hash over the query string', () => {
    expect(readAuthLink({ hash: '#type=invite', search: '?type=recovery' }).type).toBe('invite');
  });

  it('captures error codes from expired links', () => {
    expect(
      readAuthLink({
        hash: '#error=access_denied&error_code=otp_expired&error_description=nope',
        search: '',
      }),
    ).toEqual({ type: null, error: 'otp_expired' });
    expect(readAuthLink({ hash: '#error=access_denied', search: '' }).error).toBe('access_denied');
  });

  it('returns nulls for a clean URL', () => {
    expect(readAuthLink({ hash: '', search: '' })).toEqual({ type: null, error: null });
  });
});

describe('link type helpers', () => {
  it('accepts exactly invite / recovery / signup', () => {
    expect(isLinkType('invite')).toBe(true);
    expect(isLinkType('recovery')).toBe(true);
    expect(isLinkType('signup')).toBe(true);
    expect(isLinkType('magiclink')).toBe(false);
    expect(isLinkType(null)).toBe(false);
  });

  it('flags expired / invalid link errors', () => {
    expect(isExpiredLinkError('otp_expired')).toBe(true);
    expect(isExpiredLinkError('invalid_token')).toBe(true);
    expect(isExpiredLinkError('access_denied')).toBe(false);
    expect(isExpiredLinkError(null)).toBe(false);
  });
});

function makeWindow(overrides: Partial<Windowish['location']> = {}): {
  win: Windowish;
  replaceState: ReturnType<typeof vi.fn>;
} {
  const replaceState = vi.fn();
  const win: Windowish = {
    location: {
      hash: '',
      search: '',
      pathname: '/tree/',
      origin: 'https://family.example',
      href: 'https://family.example/tree/',
      ...overrides,
    },
    history: { replaceState },
  };
  return { win, replaceState };
}

describe('currentPageUrl()', () => {
  it('uses origin + pathname', () => {
    const { win } = makeWindow();
    expect(currentPageUrl(win)).toBe('https://family.example/tree/');
  });

  it('falls back to href without query/hash for file:// style origins', () => {
    const { win } = makeWindow({ origin: 'null', href: 'file:///app/index.html?x=1#y' });
    expect(currentPageUrl(win)).toBe('file:///app/index.html');
  });
});

describe('stripAuthParams()', () => {
  it('replaces the URL with the bare pathname when parameters are present', () => {
    const { win, replaceState } = makeWindow({ hash: '#access_token=abc' });
    stripAuthParams(win);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/tree/');
  });

  it('does nothing on a clean URL', () => {
    const { win, replaceState } = makeWindow();
    stripAuthParams(win);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('never throws when history is unavailable', () => {
    const win: Windowish = {
      location: {
        hash: '#x',
        search: '',
        pathname: '/',
        origin: 'https://family.example',
        href: 'https://family.example/',
      },
      history: {
        replaceState: () => {
          throw new Error('blocked');
        },
      },
    };
    expect(() => stripAuthParams(win)).not.toThrow();
  });
});
