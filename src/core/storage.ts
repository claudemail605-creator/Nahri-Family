/** localStorage access that never throws (private mode, blocked storage, SSR). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function safeStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
