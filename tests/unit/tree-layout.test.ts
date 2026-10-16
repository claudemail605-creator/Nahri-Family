import { describe, expect, it } from 'vitest';
import { GAP_X, GAP_Y, NODE_H, NODE_W, PAD, SPOUSE_GAP, layoutTree, unitWidth } from '../../src/features/tree/layout';
import { modelOf, rawRow, FIXTURE_ROWS } from './tree-fixture';

const model = modelOf(...FIXTURE_ROWS);
const layout = (collapsed: string[] = [], kids = model.kids, roots = model.roots) =>
  layoutTree(roots, kids, new Set(collapsed));

describe('unitWidth()', () => {
  it('adds a spouse card for people with a recorded spouse', () => {
    expect(unitWidth(model.byId.get('grandpa')!)).toBe(NODE_W * 2 + SPOUSE_GAP);
    expect(unitWidth(model.byId.get('child-a')!)).toBe(NODE_W);
  });
});

describe('layoutTree()', () => {
  it('lays a lone card at the origin with the PAD margin included in the size', () => {
    const solo = modelOf(rawRow({ id: 'solo', full_name: 'Solo Person' }));
    const { pos, width, height } = layoutTree(solo.roots, solo.kids, new Set());
    expect(pos.get('solo')).toEqual({ x: 0, y: 0, w: NODE_W });
    expect(width).toBe(NODE_W + PAD * 2);
    expect(height).toBe(NODE_H + PAD * 2);
  });

  it('centres parents over their children', () => {
    const { pos } = layout();
    const father = pos.get('father')!;
    const uncle = pos.get('uncle')!;
    const grandpa = pos.get('grandpa')!;
    // father and uncle both carry spouses (420 each) + one gap.
    expect(father.x).toBe(0);
    expect(uncle.x).toBe(NODE_W * 2 + SPOUSE_GAP + GAP_X);
    // grandpa's unit (person + spouse) is centred over the children span [0, 858].
    const parentMid = grandpa.x + grandpa.w / 2;
    const childrenMid = father.x + (uncle.x + uncle.w - father.x) / 2;
    expect(parentMid).toBeCloseTo(childrenMid, 5);
  });

  it('stacks generations by band height', () => {
    const { pos, minGen } = layout();
    expect(minGen).toBe(0);
    expect(pos.get('grandpa')!.y).toBe(0);
    expect(pos.get('father')!.y).toBe(NODE_H + GAP_Y);
    expect(pos.get('child-a')!.y).toBe(2 * (NODE_H + GAP_Y));
  });

  it('re-anchors generation bands when the root starts deeper (filtered view)', () => {
    const { pos, minGen } = layout([], model.kids, [model.byId.get('father')!]);
    expect(minGen).toBe(1);
    expect(pos.get('father')!.y).toBe(0);
    expect(pos.get('child-a')!.y).toBe(NODE_H + GAP_Y);
  });

  it('hides the children of a collapsed node but keeps the node itself', () => {
    const { pos } = layout(['grandpa']);
    expect(pos.has('grandpa')).toBe(true);
    expect(pos.has('father')).toBe(false);
    expect(pos.has('child-a')).toBe(false);
  });

  it('is deterministic — same inputs, identical positions', () => {
    const a = layout();
    const b = layout();
    expect([...a.pos.entries()]).toEqual([...b.pos.entries()]);
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
  });

  it('handles an empty tree', () => {
    const { pos, width, height, minGen } = layoutTree([], new Map(), new Set());
    expect(pos.size).toBe(0);
    expect(width).toBe(0);
    expect(height).toBe(0);
    expect(minGen).toBe(0);
  });

  it('spaces multiple roots apart', () => {
    const two = modelOf(
      rawRow({ id: 'r1', full_name: 'Root One' }),
      rawRow({ id: 'r2', full_name: 'Root Two' }),
    );
    const { pos } = layoutTree(two.roots, two.kids, new Set());
    expect(pos.get('r1')!.x).toBe(0);
    expect(pos.get('r2')!.x).toBe(NODE_W + GAP_X * 2);
  });
});
