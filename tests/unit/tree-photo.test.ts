import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createI18n, type I18n } from '../../src/core/i18n';
import {
  PHOTO_MAX_MB,
  PhotoError,
  clearPhotoCache,
  photoErrorMessage,
  photoExtFor,
  photoKey,
  photoValidationMessage,
  removePhoto,
  signedPhotoUrl,
  signedPhotoUrls,
  uploadPhoto,
  validatePhoto,
} from '../../src/features/tree/photo';

/* ------------------------------ validation ------------------------------- */

describe('photoKey', () => {
  it('accepts the forms the reference stores and rejects junk', () => {
    expect(photoKey('person-a/1.png')).toBe('person-a/1.png');
    expect(photoKey('/person-a/1.png')).toBe('person-a/1.png');
    expect(photoKey('photos/person-a/1.png')).toBe('person-a/1.png');
    expect(photoKey('photos')).toBeNull();
    expect(photoKey('')).toBeNull();
    expect(photoKey(null)).toBeNull();
    expect(photoKey(undefined)).toBeNull();
  });
});

describe('photoExtFor / validatePhoto', () => {
  it('recognises the four allowed types by MIME type or extension', () => {
    expect(photoExtFor({ type: 'image/png', name: 'x' })).toBe('png');
    expect(photoExtFor({ name: 'x.JPEG' })).toBe('jpeg');
    expect(photoExtFor({ name: 'x.WebP' })).toBe('webp');
    expect(photoExtFor({ name: 'x.gif' })).toBe('gif');
    expect(photoExtFor({ name: 'x.txt' })).toBeNull();
    expect(photoExtFor(null)).toBeNull();
  });

  it('reports a missing file, a bad type and an oversize file', () => {
    expect(validatePhoto(null)).toEqual({ ok: false, key: 'photos.errNoFile' });
    expect(validatePhoto({ name: 'notes.txt', type: 'text/plain', size: 10 })).toEqual({
      ok: false,
      key: 'photos.errType',
    });
    expect(validatePhoto({ name: 'big.png', type: 'image/png', size: (PHOTO_MAX_MB + 1) * 1024 * 1024 })).toEqual({
      ok: false,
      key: 'photos.errSize',
      max: PHOTO_MAX_MB,
    });
    expect(validatePhoto({ name: 'ok.png', type: 'image/png', size: 1024 })).toEqual({ ok: true });
  });
});

describe('photoValidationMessage', () => {
  const i18n: I18n = createI18n({ loadScriptFonts: false });

  beforeEach(() => {
    localStorage.clear();
  });

  it('is null when the file is fine', () => {
    expect(photoValidationMessage(i18n, { size: 10 }, { ok: true })).toBeNull();
  });

  it('says how heavy the rejected file is, in the form wording', () => {
    const msg = photoValidationMessage(
      i18n,
      { size: 4.2 * 1024 * 1024 },
      { ok: false, key: 'photos.errSize', max: PHOTO_MAX_MB },
    );
    expect(msg).toContain('4.2');
    expect(msg).toContain('3 MB');
  });

  it('maps a bad type to the form message and other codes to the dictionary', () => {
    expect(photoValidationMessage(i18n, { size: 1 }, { ok: false, key: 'photos.errType' })).toBe(
      'Only JPEG, PNG or WebP photos are allowed.',
    );
    expect(photoValidationMessage(i18n, { size: 1 }, { ok: false, key: 'photos.errNoFile' })).toBe(
      'Choose an image file first.',
    );
  });
});

describe('photoErrorMessage', () => {
  const i18n: I18n = createI18n({ loadScriptFonts: false });

  it('translates PhotoError codes, with the size limit filled in', () => {
    expect(photoErrorMessage(i18n, new PhotoError('photos.errSize', 3))).toContain('3 MB');
    expect(photoErrorMessage(i18n, new PhotoError('photos.errType'))).toBe(
      'That file isn’t a supported image — use JPG, PNG, WebP or GIF.',
    );
  });

  it('classifies RLS/permission and auth failures from the server message', () => {
    expect(photoErrorMessage(i18n, { message: 'new row violates row-level security policy' })).toBe(
      'You don’t have permission to change this person’s photo.',
    );
    expect(photoErrorMessage(i18n, { message: 'JWT expired' })).toBe(
      'Your sign-in expired — sign in again to change the photo.',
    );
    expect(photoErrorMessage(i18n, { message: 'boom' })).toBe('Couldn’t save the photo: boom');
  });
});

/* ------------------------------ signed URLs ------------------------------ */

interface StorageCalls {
  batches: Array<[string[], number]>;
  singles: Array<[string, number]>;
  uploads: Array<{ path: string; options: unknown }>;
  removals: string[][];
}

function makeClient(options: {
  batchRows?: Array<{ path: string; signedUrl?: string | null; error?: string | null } | null>;
  batchError?: { message: string } | null;
  singleUrl?: string | null;
  uploadErrors?: Array<{ message: string } | null>;
  updateError?: { message: string } | null;
} = {}): { client: SupabaseClient; calls: StorageCalls } {
  const calls: StorageCalls = { batches: [], singles: [], uploads: [], removals: [] };

  const updateBuilder = {
    update() {
      return updateBuilder;
    },
    eq() {
      return updateBuilder;
    },
    then(resolve: (value: unknown) => void) {
      resolve({ error: options.updateError ?? null });
    },
  };

  const client = {
    from() {
      return updateBuilder;
    },
    storage: {
      from() {
        return {
          createSignedUrl: async (path: string, ttl: number) => {
            calls.singles.push([path, ttl]);
            return {
              data: options.singleUrl === null ? null : { signedUrl: options.singleUrl ?? `https://signed/${path}` },
              error: null,
            };
          },
          createSignedUrls: async (paths: string[], ttl: number) => {
            calls.batches.push([paths, ttl]);
            return {
              data:
                options.batchRows ??
                paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
              error: options.batchError ?? null,
            };
          },
          upload: async (path: string, _payload: unknown, uploadOptions: unknown) => {
            calls.uploads.push({ path, options: uploadOptions });
            const error = options.uploadErrors?.shift() ?? null;
            return { data: error ? null : { path }, error };
          },
          remove: async (keys: string[]) => {
            calls.removals.push(keys);
            return { data: [], error: null };
          },
        };
      },
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('signedPhotoUrl / signedPhotoUrls', () => {
  beforeEach(() => {
    clearPhotoCache();
  });

  it('signs a single path once, then serves the cache', async () => {
    const { client, calls } = makeClient();
    const first = await signedPhotoUrl(client, 'person-a/1.png');
    const second = await signedPhotoUrl(client, '/person-a/1.png');
    expect(first).toBe('https://signed/person-a/1.png');
    expect(second).toBe(first);
    expect(calls.singles).toEqual([['person-a/1.png', 3600]]);
  });

  it('batch-signs the missing keys in one request and de-duplicates', async () => {
    const { client, calls } = makeClient();
    const urls = await signedPhotoUrls(client, [
      'person-a/1.png',
      'person-b/2.png',
      'person-a/1.png',
      'photos/person-c/3.png',
      '',
    ]);
    expect(calls.batches).toHaveLength(1);
    expect(calls.batches[0]![0]).toEqual(['person-a/1.png', 'person-b/2.png', 'person-c/3.png']);
    expect(urls.size).toBe(3);
    expect(urls.get('person-c/3.png')).toBe('https://signed/person-c/3.png');

    await signedPhotoUrls(client, ['person-a/1.png', 'person-b/2.png', 'person-c/3.png']);
    expect(calls.batches).toHaveLength(1);
  });

  it('leaves errored rows out of the map and re-asks after a cache clear', async () => {
    const { client, calls } = makeClient({
      batchRows: [
        { path: 'a/1.png', signedUrl: 'https://signed/a/1.png', error: null },
        { path: 'a/2.png', signedUrl: null, error: 'Object not found' },
      ],
    });
    const urls = await signedPhotoUrls(client, ['a/1.png', 'a/2.png']);
    expect(urls.has('a/1.png')).toBe(true);
    expect(urls.has('a/2.png')).toBe(false);

    clearPhotoCache();
    await signedPhotoUrls(client, ['a/1.png']);
    expect(calls.batches).toHaveLength(2);
  });

  it('throws batch failures instead of hiding them', async () => {
    const { client } = makeClient({ batchError: { message: 'denied' } });
    await expect(signedPhotoUrls(client, ['a/1.png'])).rejects.toEqual({ message: 'denied' });
  });

  it('a missing single URL is null, not an error', async () => {
    const { client } = makeClient({ singleUrl: null });
    await expect(signedPhotoUrl(client, 'a/1.png')).resolves.toBeNull();
  });
});

/* ------------------------------- mutations ------------------------------- */

describe('uploadPhoto', () => {
  beforeEach(() => {
    clearPhotoCache();
  });

  it('uploads under a fresh object name, points the row at it, then deletes the old object', async () => {
    const { client, calls } = makeClient();
    const file = { type: 'image/png', name: 'portrait.png' } as unknown as File;
    const key = await uploadPhoto(client, 'person-a', file, 'person-a/old.png');

    expect(key).toMatch(/^person-a\/\d+\.png$/);
    expect(calls.uploads).toHaveLength(1);
    expect(calls.uploads[0]!.path).toBe(key);
    expect(calls.uploads[0]!.options).toMatchObject({
      upsert: false,
      contentType: 'image/png',
    });
    expect(calls.removals).toEqual([['person-a/old.png']]);
  });

  it('retries the next millisecond when the object name already exists', async () => {
    const { client, calls } = makeClient({
      uploadErrors: [{ message: 'The resource already exists' }],
    });
    const file = { type: 'image/jpeg', name: 'x.jpg' } as unknown as File;
    const key = await uploadPhoto(client, 'person-b', file, null);
    expect(calls.uploads).toHaveLength(2);
    expect(calls.uploads[0]!.path).not.toBe(key);
    expect(calls.uploads[1]!.path).toBe(key);
    expect(calls.removals).toEqual([]);
  });

  it('removes the just-uploaded object again when the row update fails', async () => {
    const { client, calls } = makeClient({ updateError: { message: 'denied' } });
    const file = { type: 'image/png', name: 'x.png' } as unknown as File;
    await expect(uploadPhoto(client, 'person-c', file, null)).rejects.toEqual({ message: 'denied' });
    expect(calls.removals).toHaveLength(1);
    expect(calls.removals[0]![0]).toBe(calls.uploads[0]!.path);
  });
});

describe('removePhoto', () => {
  beforeEach(() => {
    clearPhotoCache();
  });

  it('clears the row first and then deletes the object', async () => {
    const { client, calls } = makeClient();
    await removePhoto(client, 'person-a', 'person-a/old.png');
    expect(calls.removals).toEqual([['person-a/old.png']]);
  });

  it('still clears the row when there is no stored path', async () => {
    const { client, calls } = makeClient();
    await removePhoto(client, 'person-a', null);
    expect(calls.removals).toEqual([]);
  });

  it('reports a row update failure and never touches the object', async () => {
    const { client, calls } = makeClient({ updateError: { message: 'denied' } });
    await expect(removePhoto(client, 'person-a', 'person-a/old.png')).rejects.toEqual({ message: 'denied' });
    expect(calls.removals).toEqual([]);
  });
});

describe('cache hygiene', () => {
  it('clearPhotoCache forces a fresh signature', async () => {
    clearPhotoCache();
    const { client, calls } = makeClient();
    await signedPhotoUrl(client, 'a/1.png');
    clearPhotoCache();
    await signedPhotoUrl(client, 'a/1.png');
    expect(calls.singles).toHaveLength(2);
  });
});
