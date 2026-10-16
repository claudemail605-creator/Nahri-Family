import { PAD } from './layout';

/**
 * One owner for every pointer/wheel/keyboard input on the tree stage
 * (PLAN §4 — the reference's three-times-patched gesture code replaced by a
 * single controller).
 *
 * The maths is exported as pure functions so it can be unit-tested without a
 * browser: zoom-at-point invariance, clamps, and the tap-vs-drag thresholds.
 * The controller itself only wires DOM events to that maths.
 *
 * Interaction rules:
 *   1 pointer  — drag pans after a movement threshold; below it the gesture
 *                ends as a tap (select) if it started on a person card;
 *   2 pointers — pinch zooms around the finger midpoint and pans with it;
 *   wheel      — zoom at the cursor;          double-click — zoom at the point;
 *   keyboard   — +/- zoom, arrows pan (the stage is focusable).
 *
 * Pointer capture is taken ONLY when the gesture starts on the stage/cards —
 * never on buttons or links, so native click semantics for controls (collapse
 * toggles, add-child) are untouched.
 */

export interface Transform {
  tx: number;
  ty: number;
  scale: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2.2;
export const FIT_MIN_SCALE = 0.55;
export const DRAG_THRESHOLD_MOUSE = 4;
export const DRAG_THRESHOLD_TOUCH = 8;
export const TAP_MAX_MS = 500;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom by `factor` while keeping the world point under (cx, cy) fixed —
 * the invariant the unit tests pin down.
 */
export function zoomAtPoint(t: Transform, factor: number, cx: number, cy: number): Transform {
  const next = clampScale(t.scale * factor);
  const ratio = next / t.scale;
  return {
    tx: cx - (cx - t.tx) * ratio,
    ty: cy - (cy - t.ty) * ratio,
    scale: next,
  };
}

export function dragThreshold(pointerType: string): number {
  return pointerType === 'mouse' ? DRAG_THRESHOLD_MOUSE : DRAG_THRESHOLD_TOUCH;
}

/** Below threshold and inside the time window → the gesture is a tap. */
export function isTapGesture(
  dx: number,
  dy: number,
  elapsedMs: number,
  pointerType: string,
): boolean {
  return Math.hypot(dx, dy) <= dragThreshold(pointerType) && elapsedMs < TAP_MAX_MS;
}

export interface FitOptions {
  /** World point to centre on when the tree is wider than the stage. */
  focus?: { x: number; y: number } | null;
  /** Several root groups: start at the left edge rather than centring one root. */
  multiRoot?: boolean;
}

/**
 * The reference's `fit()`: never below 0.55 scale (readable minimum); if the
 * tree is wider than the stage, centre on the first root (or the left edge
 * when there are several roots) and let the user pan.
 */
export function fitTransform(
  stageW: number,
  stageH: number,
  worldW: number,
  worldH: number,
  options: FitOptions = {},
): Transform {
  const s = Math.min(1, Math.min(stageW / worldW, (stageH - 40) / worldH));
  const scale = Math.max(FIT_MIN_SCALE, s);
  let tx: number;
  if (worldW * scale <= stageW) tx = (stageW - worldW * scale) / 2;
  else if (options.multiRoot) tx = 30 - PAD * scale;
  else tx = stageW / 2 - (PAD + (options.focus ? options.focus.x : 0)) * scale;
  let ty = Math.max(20, (stageH - worldH * scale) / 2 - 10);
  if (worldH * scale > stageH) ty = 20 - PAD * scale + 40;
  return { tx, ty, scale };
}

export interface PanZoomCallbacks {
  /** A tap (not a drag) ended on a card; the element carries data-person-id. */
  onTap?(card: HTMLElement): void;
}

interface PointerPos {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startTx: number;
  startTy: number;
  startedAt: number;
  pointerType: string;
  moved: boolean;
  card: HTMLElement | null;
}

interface PinchState {
  dist: number;
  mid: PointerPos;
}

const CONTROL_SELECTOR = 'button, a, input, select, textarea, [data-no-gesture]';

export class PanZoomController {
  private t: Transform = { tx: 0, ty: 0, scale: 1 };
  private readonly pointers = new Map<number, PointerPos>();
  private drag: DragState | null = null;
  private pinch: PinchState | null = null;
  private disposed = false;

  constructor(
    private readonly stage: HTMLElement,
    private readonly world: HTMLElement,
    private readonly callbacks: PanZoomCallbacks = {},
  ) {
    stage.addEventListener('pointerdown', this.onPointerDown);
    stage.addEventListener('pointermove', this.onPointerMove);
    stage.addEventListener('pointerup', this.onPointerUp);
    stage.addEventListener('pointercancel', this.onPointerEnd);
    stage.addEventListener('lostpointercapture', this.onLostCapture);
    stage.addEventListener('wheel', this.onWheel, { passive: false });
    stage.addEventListener('dblclick', this.onDoubleClick);
    stage.addEventListener('keydown', this.onKeyDown);
  }

  get transform(): Transform {
    return { ...this.t };
  }

  set(t: Transform): void {
    this.t = { ...t };
    this.apply();
  }

  apply(): void {
    this.world.style.transform = `translate(${this.t.tx}px,${this.t.ty}px) scale(${this.t.scale})`;
  }

  zoomAt(factor: number, cx: number, cy: number): void {
    this.t = zoomAtPoint(this.t, factor, cx, cy);
    this.apply();
  }

  /** Zoom around the stage centre (the ± buttons). */
  zoomBy(factor: number): void {
    const rect = this.stage.getBoundingClientRect();
    this.zoomAt(factor, rect.width / 2, rect.height / 2);
  }

  fit(worldW: number, worldH: number, options: FitOptions = {}): void {
    const rect = this.stage.getBoundingClientRect();
    this.t = fitTransform(rect.width, rect.height, worldW, worldH, options);
    this.apply();
  }

  /** Centre a world point, keeping at least `minScale` (the focus action). */
  centreOn(worldX: number, worldY: number, scale?: number): void {
    const rect = this.stage.getBoundingClientRect();
    this.t.scale = clampScale(Math.max(scale ?? this.t.scale, 0.9));
    this.t.tx = rect.width / 2 - (PAD + worldX) * this.t.scale;
    this.t.ty = rect.height / 2 - (PAD + worldY) * this.t.scale;
    this.apply();
  }

  dispose(): void {
    this.disposed = true;
    const stage = this.stage;
    stage.removeEventListener('pointerdown', this.onPointerDown);
    stage.removeEventListener('pointermove', this.onPointerMove);
    stage.removeEventListener('pointerup', this.onPointerUp);
    stage.removeEventListener('pointercancel', this.onPointerEnd);
    stage.removeEventListener('lostpointercapture', this.onLostCapture);
    stage.removeEventListener('wheel', this.onWheel);
    stage.removeEventListener('dblclick', this.onDoubleClick);
    stage.removeEventListener('keydown', this.onKeyDown);
    this.pointers.clear();
    this.drag = null;
    this.pinch = null;
  }

  /* ------------------------------ internals ------------------------------ */

  private localPoint(event: { clientX: number; clientY: number }): PointerPos {
    const rect = this.stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private captureCard(target: EventTarget | null): HTMLElement | null {
    const el = target instanceof Element ? target : null;
    if (!el || el.closest(CONTROL_SELECTOR)) return null;
    return el.closest<HTMLElement>('[data-person-id]');
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.disposed) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2) {
      // Second finger: switch to pinch, positioned so nothing jumps.
      const [a, b] = [...this.pointers.values()];
      const rect = this.stage.getBoundingClientRect();
      this.drag = null;
      this.pinch = {
        dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1,
        mid: { x: (a!.x + b!.x) / 2 - rect.left, y: (a!.y + b!.y) / 2 - rect.top },
      };
      this.stage.classList.add('panning');
      return;
    }
    if (this.pointers.size > 2) return;

    const target = event.target instanceof Element ? event.target : null;
    const onControl = !!target?.closest(CONTROL_SELECTOR);
    if (!onControl) {
      // Capture so a drag that leaves the stage keeps panning (and never
      // turns into a click on whatever it ends over).
      this.stage.setPointerCapture(event.pointerId);
    }
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTx: this.t.tx,
      startTy: this.t.ty,
      startedAt: performance.now(),
      pointerType: event.pointerType || 'mouse',
      moved: false,
      card: this.captureCard(event.target),
    };
    this.stage.classList.add('panning');
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.disposed || !this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      const rect = this.stage.getBoundingClientRect();
      const mid = {
        x: (a!.x + b!.x) / 2 - rect.left,
        y: (a!.y + b!.y) / 2 - rect.top,
      };
      this.t = zoomAtPoint(this.t, dist / this.pinch.dist, mid.x, mid.y);
      // Pan with the midpoint as well — one motion, no jump between steps.
      this.t.tx += mid.x - this.pinch.mid.x;
      this.t.ty += mid.y - this.pinch.mid.y;
      this.pinch = { dist, mid };
      this.apply();
      return;
    }

    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - this.drag.startX;
    const dy = event.clientY - this.drag.startY;
    if (!this.drag.moved && Math.hypot(dx, dy) > dragThreshold(this.drag.pointerType)) {
      this.drag.moved = true;
    }
    if (!this.drag.moved) return;
    this.t.tx = this.drag.startTx + dx;
    this.t.ty = this.drag.startTy + dy;
    this.apply();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.disposed) return;
    const drag = this.drag && this.drag.pointerId === event.pointerId ? this.drag : null;
    if (drag) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const elapsed = performance.now() - drag.startedAt;
      if (!drag.moved && drag.card && isTapGesture(dx, dy, elapsed, drag.pointerType)) {
        this.callbacks.onTap?.(drag.card);
      }
    }
    this.releasePointer(event.pointerId);
  };

  private onPointerEnd = (event: PointerEvent): void => {
    this.releasePointer(event.pointerId);
  };

  private onLostCapture = (event: PointerEvent): void => {
    this.releasePointer(event.pointerId);
  };

  private releasePointer(pointerId: number): void {
    this.pointers.delete(pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.drag && this.drag.pointerId === pointerId) this.drag = null;
    if (this.pointers.size === 1 && !this.drag) {
      // Pinch recovered to one finger: rebase the drag from where the finger
      // is now, so continued movement pans without a jump. A gesture that has
      // already moved can no longer become a tap.
      const [id, pos] = [...this.pointers.entries()][0]!;
      this.drag = {
        pointerId: id,
        startX: pos.x,
        startY: pos.y,
        startTx: this.t.tx,
        startTy: this.t.ty,
        startedAt: performance.now(),
        pointerType: 'touch',
        moved: true,
        card: null,
      };
      try {
        this.stage.setPointerCapture(id);
      } catch {
        /* capture is best-effort */
      }
    }
    if (!this.pointers.size) this.stage.classList.remove('panning');
  }

  private onWheel = (event: WheelEvent): void => {
    if (this.disposed) return;
    event.preventDefault();
    const local = this.localPoint(event);
    this.zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, local.x, local.y);
  };

  private onDoubleClick = (event: MouseEvent): void => {
    if (this.disposed) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(`${CONTROL_SELECTOR}, [data-person-id]`)) return;
    const local = this.localPoint(event);
    this.zoomAt(1.3, local.x, local.y);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    const pan = 60;
    switch (event.key) {
      case '+':
      case '=':
        this.zoomBy(1.25);
        break;
      case '-':
      case '_':
        this.zoomBy(1 / 1.25);
        break;
      case 'ArrowLeft':
        this.t.tx += pan;
        break;
      case 'ArrowRight':
        this.t.tx -= pan;
        break;
      case 'ArrowUp':
        this.t.ty += pan;
        break;
      case 'ArrowDown':
        this.t.ty -= pan;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.apply();
  };
}
