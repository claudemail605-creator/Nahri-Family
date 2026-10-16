/**
 * Motion helpers shared by the UI layers.
 *
 * All entrance/exit animations are CSS-driven; the global override in
 * `base.css` collapses them to ~0 ms under `prefers-reduced-motion: reduce`.
 * JavaScript tweens (the canvas transform) must ask here first so they honour
 * the same preference — that is the one animation CSS cannot switch off.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Cubic ease-out: fast start, gentle settle (matches --ease-out's spirit). */
export function easeOutCubic(progress: number): number {
  const c = 1 - progress;
  return 1 - c * c * c;
}
