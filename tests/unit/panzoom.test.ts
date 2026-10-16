import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_MOUSE,
  DRAG_THRESHOLD_TOUCH,
  FIT_MIN_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  dragThreshold,
  fitTransform,
  isTapGesture,
  zoomAtPoint,
  type Transform,
} from '../../src/features/tree/panzoom';
import { PAD } from '../../src/features/tree/layout';

describe('clampScale()', () => {
  it('keeps the scale inside the readable range', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(9)).toBe(MAX_SCALE);
    expect(clampScale(1)).toBe(1);
  });
});

describe('zoomAtPoint()', () => {
  const t: Transform = { tx: 100, ty: 50, scale: 1 };

  it('keeps the world point under the cursor fixed', () => {
    const cx = 300;
    const cy = 200;
    const before = { x: (cx - t.tx) / t.scale, y: (cy - t.ty) / t.scale };
    const after = zoomAtPoint(t, 2, cx, cy);
    expect((cx - after.tx) / after.scale).toBeCloseTo(before.x, 10);
    expect((cy - after.ty) / after.scale).toBeCloseTo(before.y, 10);
    expect(after.scale).toBe(2);
  });

  it('zooming out and back in restores the same transform', () => {
    const out = zoomAtPoint(t, 1 / 3, 300, 200);
    const back = zoomAtPoint(out, 3, 300, 200);
    expect(back.tx).toBeCloseTo(t.tx, 10);
    expect(back.ty).toBeCloseTo(t.ty, 10);
    expect(back.scale).toBeCloseTo(t.scale, 10);
  });

  it('clamps but still moves toward the cursor when the limit is hit', () => {
    const zoomed = zoomAtPoint({ ...t, scale: MAX_SCALE }, 2, 300, 200);
    expect(zoomed.scale).toBe(MAX_SCALE);
    // At the clamp the ratio is 1: the transform must not jump.
    expect(zoomed.tx).toBeCloseTo(t.tx, 10);
    expect(zoomed.ty).toBeCloseTo(t.ty, 10);
  });
});

describe('dragThreshold()', () => {
  it('is tighter for a mouse than for touch', () => {
    expect(dragThreshold('mouse')).toBe(DRAG_THRESHOLD_MOUSE);
    expect(dragThreshold('touch')).toBe(DRAG_THRESHOLD_TOUCH);
    expect(dragThreshold('pen')).toBe(DRAG_THRESHOLD_TOUCH);
  });
});

describe('isTapGesture()', () => {
  it('accepts a short, still gesture', () => {
    expect(isTapGesture(2, 2, 100, 'mouse')).toBe(true);
    expect(isTapGesture(5, 0, 100, 'touch')).toBe(true);
  });

  it('rejects a gesture that moved past the threshold', () => {
    expect(isTapGesture(10, 0, 100, 'mouse')).toBe(false);
    expect(isTapGesture(0, 9, 100, 'touch')).toBe(false);
  });

  it('rejects a long press even when nothing moved', () => {
    expect(isTapGesture(1, 1, 900, 'mouse')).toBe(false);
  });
});

describe('fitTransform()', () => {
  const stageW = 800;
  const stageH = 600;

  it('centres a small tree and never zooms past 1', () => {
    const t = fitTransform(stageW, stageH, 400, 300);
    expect(t.scale).toBe(1);
    expect(t.tx).toBe((stageW - 400) / 2);
    expect(t.ty).toBeGreaterThanOrEqual(20);
  });

  it('clamps the scale to the readable minimum for a huge tree', () => {
    const t = fitTransform(stageW, stageH, 40000, 40000);
    expect(t.scale).toBe(FIT_MIN_SCALE);
  });

  it('centres the first root when the tree overflows sideways', () => {
    const t = fitTransform(stageW, stageH, 4000, 1000, { focus: { x: 1000, y: 0 } });
    expect(t.scale).toBe(FIT_MIN_SCALE);
    expect(t.tx).toBeCloseTo(stageW / 2 - (PAD + 1000) * FIT_MIN_SCALE, 10);
  });

  it('starts at the left edge when there are several roots', () => {
    const t = fitTransform(stageW, stageH, 4000, 1000, { multiRoot: true });
    expect(t.tx).toBeCloseTo(30 - PAD * FIT_MIN_SCALE, 10);
  });

  it('pulls a taller-than-stage tree up to the top margin', () => {
    const t = fitTransform(stageW, stageH, 2000, 20000);
    expect(t.ty).toBeCloseTo(20 - PAD * FIT_MIN_SCALE + 40, 10);
  });
});
