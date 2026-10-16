import type { SupabaseClient } from '@supabase/supabase-js';
import type { I18n, MessageKey } from '../../core/i18n';
import { updatePerson } from '../../data/people';

/**
 * Supabase Storage helper for the private "photos" bucket — port of the
 * reference `js/photos.js`. Object keys are `<person-uuid>/<file>`; any active
 * signed-in user may read, only someone who may edit that person may upload /
 * replace / remove. Nothing here decides permissions: the bucket policies do,
 * and their errors are mapped to friendly messages.
 */

export const PHOTO_BUCKET = 'photos';
/** Signed URL lifetime, seconds. */
export const PHOTO_SIGNED_TTL = 60 * 60;
export const PHOTO_MAX_MB = 3;
export const PHOTO_MAX_BYTES = PHOTO_MAX_MB * 1024 * 1024;
/** Photos are scaled down to at most this width before upload. */
export const PHOTO_MAX_WIDTH = 800;

const TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const EXT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** An error with a dictionary key (`photos.*`) the toast layer can translate. */
export class PhotoError extends Error {
  code: MessageKey;
  max: number | undefined;

  constructor(code: MessageKey, max?: number) {
    super(code);
    this.name = 'PhotoError';
    this.code = code;
    this.max = max;
  }
}

/** The object key inside the bucket — accepts `<uuid>/<f>`, `/<uuid>/<f>` or `photos/<uuid>/<f>`. */
export function photoKey(path: string | null | undefined): string | null {
  if (!path) return null;
  let key = String(path).trim().replace(/^\/+/, '');
  if (key === PHOTO_BUCKET) return null;
  if (key.startsWith(PHOTO_BUCKET + '/')) key = key.slice(PHOTO_BUCKET.length + 1);
  return key || null;
}

/** Extension for a browser File, from its MIME type or its name. */
export function photoExtFor(file: { type?: string; name?: string } | null | undefined): string | null {
  if (!file) return null;
  const byType = file.type ? TYPE_EXT[file.type] : undefined;
  if (byType) return byType;
  const match = /\.([a-z0-9]+)\s*$/i.exec(file.name ?? '');
  const ext = match ? match[1]!.toLowerCase() : '';
  return ext && EXT_TYPE[ext] ? ext : null;
}

export type PhotoValidation = { ok: true } | { ok: false; key: MessageKey; max?: number };

/** Type and size checks before anything leaves the browser. */
export function validatePhoto(
  file: { type?: string; name?: string; size?: number } | null | undefined,
): PhotoValidation {
  if (!file) return { ok: false, key: 'photos.errNoFile' };
  if (!photoExtFor(file)) return { ok: false, key: 'photos.errType' };
  if ((file.size ?? 0) > PHOTO_MAX_BYTES) return { ok: false, key: 'photos.errSize', max: PHOTO_MAX_MB };
  return { ok: true };
}

/** The translated message for a failed pick, in the form's wording; null when fine. */
export function photoValidationMessage(
  i18n: I18n,
  file: { size?: number },
  check: PhotoValidation,
): string | null {
  if (check.ok) return null;
  if (check.key === 'photos.errSize') {
    return i18n.fmt('edit.photoTooBig', { mb: ((file.size ?? 0) / (1024 * 1024)).toFixed(1) });
  }
  if (check.key === 'photos.errType') return i18n.t('edit.photoBadType');
  return i18n.t(check.key);
}

export interface PreparedPhoto {
  blob: Blob;
  ext: string;
  type: string;
  name: string;
  width: number;
  height: number;
}

/**
 * Scale a chosen photo down to at most PHOTO_MAX_WIDTH wide, drawing through a
 * canvas. Returns null when the browser cannot decode the file or no scaling
 * is needed — the caller then uploads the original.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto | null> {
  const ext = photoExtFor(file);
  if (!ext || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, PHOTO_MAX_WIDTH / (bitmap.width || PHOTO_MAX_WIDTH));
  const width = Math.max(1, Math.round((bitmap.width || PHOTO_MAX_WIDTH) * scale));
  const height = Math.max(1, Math.round((bitmap.height || PHOTO_MAX_WIDTH) * scale));
  if (scale === 1) {
    bitmap.close?.();
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const type =
    file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) return null;
  return { blob, ext, type, name: file.name || `photo.${ext}`, width, height };
}

/* ------------------------------ signed URLs ------------------------------ */

const urlCache = new Map<string, { url: string; expiresAt: number }>();

/** Signed URL for one stored photo; cached until shortly before it expires. */
export async function signedPhotoUrl(
  client: SupabaseClient,
  path: string | null | undefined,
): Promise<string | null> {
  const key = photoKey(path);
  if (!key) return null;
  const hit = urlCache.get(key);
  if (hit && hit.expiresAt > Date.now() + 30_000) return hit.url;
  const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(key, PHOTO_SIGNED_TTL);
  if (error) throw error;
  const url = data?.signedUrl ?? null;
  if (!url) return null;
  urlCache.set(key, { url, expiresAt: Date.now() + PHOTO_SIGNED_TTL * 1000 });
  return url;
}

export function invalidatePhoto(path: string | null | undefined): void {
  const key = photoKey(path);
  if (key) urlCache.delete(key);
}

/**
 * Batch signing for the tree cards: many photos, ONE request (hundreds of
 * cards would otherwise mean hundreds of round trips). Cached per key like
 * the single version. Unresolvable paths are simply absent from the map.
 */
export async function signedPhotoUrls(
  client: SupabaseClient,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const keys = [...new Set(paths.map((p) => photoKey(p)).filter((k): k is string => !!k))];
  const missing: string[] = [];
  for (const key of keys) {
    const hit = urlCache.get(key);
    if (hit && hit.expiresAt > Date.now() + 30_000) out.set(key, hit.url);
    else missing.push(key);
  }
  if (!missing.length) return out;
  const { data, error } = await client.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(missing, PHOTO_SIGNED_TTL);
  if (error) throw error;
  const expiresAt = Date.now() + PHOTO_SIGNED_TTL * 1000;
  for (const row of data ?? []) {
    if (!row || row.error || !row.path || !row.signedUrl) continue;
    const key = photoKey(row.path) ?? row.path;
    out.set(key, row.signedUrl);
    urlCache.set(key, { url: row.signedUrl, expiresAt });
  }
  return out;
}

/** Sign-out must not leave another user's photo URLs behind (parity A4). */
export function clearPhotoCache(): void {
  urlCache.clear();
}

/* ------------------------------- mutations ------------------------------- */

function uploadOptions(ext: string, type?: string): { cacheControl: string; upsert: boolean; contentType: string } {
  return {
    cacheControl: '3600',
    upsert: false,
    contentType: type || EXT_TYPE[ext] || 'application/octet-stream',
  };
}

/**
 * Upload a photo for a person and point `people.photo_path` at it (row first
 * when removing; object first when adding). A new object name on every upload
 * keeps replaces from fighting the browser cache. The previous object, if any,
 * is deleted afterwards, best effort.
 */
export async function uploadPhoto(
  client: SupabaseClient,
  personId: string,
  input: File | PreparedPhoto,
  prevPath: string | null,
): Promise<string> {
  const prepared = 'blob' in input ? input : null;
  const file = 'blob' in input ? null : input;
  const ext = prepared ? prepared.ext : (photoExtFor(file) as string);
  const payload: Blob = prepared ? prepared.blob : file!;
  const type = prepared ? prepared.type : file!.type;
  // `Date.now()` can collide when two uploads land in the same millisecond.
  let name = `${Date.now()}.${ext}`;
  let { error: upErr } = await client.storage
    .from(PHOTO_BUCKET)
    .upload(`${personId}/${name}`, payload, uploadOptions(ext, type));
  if (upErr && /exists/i.test(upErr.message ?? '')) {
    name = `${Date.now() + 1}.${ext}`;
    ({ error: upErr } = await client.storage
      .from(PHOTO_BUCKET)
      .upload(`${personId}/${name}`, payload, uploadOptions(ext, type)));
  }
  if (upErr) throw upErr;

  const key = `${personId}/${name}`;
  try {
    await updatePerson(client, personId, { photo_path: key });
  } catch (err) {
    // Do not leave behind an object the database does not reference.
    try {
      await client.storage.from(PHOTO_BUCKET).remove([key]);
    } catch {
      /* best effort */
    }
    throw err;
  }

  const prevKey = photoKey(prevPath);
  if (prevKey && prevKey !== key) {
    try {
      await client.storage.from(PHOTO_BUCKET).remove([prevKey]);
    } catch {
      /* the old object can be cleaned up later */
    }
    invalidatePhoto(prevKey);
  }
  return key;
}

/** Clear `people.photo_path`, then delete the object (row first, best effort). */
export async function removePhoto(
  client: SupabaseClient,
  personId: string,
  path: string | null | undefined,
): Promise<void> {
  await updatePerson(client, personId, { photo_path: null });
  const key = photoKey(path);
  if (key) {
    try {
      const { error } = await client.storage.from(PHOTO_BUCKET).remove([key]);
      if (error) console.warn('Photo object was not deleted:', error.message);
    } catch (err) {
      console.warn('Photo object was not deleted:', err instanceof Error ? err.message : err);
    }
    invalidatePhoto(key);
  }
}

/** Storage/RLS failure → the translated message to show. */
export function photoErrorMessage(i18n: I18n, err: unknown): string {
  if (err instanceof PhotoError) {
    return err.code === 'photos.errSize'
      ? i18n.fmt('photos.errSize', { max: err.max ?? PHOTO_MAX_MB })
      : i18n.t(err.code);
  }
  const e = err as { message?: string; error_description?: string } | null;
  const msg = e?.message || e?.error_description || String(err);
  if (/row-level security|permission|not allowed|forbids|violates|unauthoriz|403/i.test(msg)) {
    return i18n.t('photos.errPerm');
  }
  if (/invalid api key|jwt|invalid_token|expired/i.test(msg)) return i18n.t('photos.errAuth');
  return i18n.fmt('photos.errFailed', { msg });
}
