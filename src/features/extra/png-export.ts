/**
 * Save the tree as PNG (L4) — the reference `js/extras.js` `exportPng`, drawn
 * from the layout numbers the same numbers the on-screen tree uses, at 2x for
 * a crisp file. Colours come from the design tokens at their current
 * (light/dark) values, so the picture matches the theme on screen.
 *
 * The picture comes from the workspace's live layout when one is available —
 * exactly what is on screen, collapse state and filters included (reference
 * behaviour: the geometry uses the same numbers the DOM layout uses). Without
 * a snapshot the full tree is recomputed from the model.
 */
import type { I18n } from '../../core/i18n';
import { getDisplayName } from '../../core/i18n/display';
import { NODE_H, NODE_W, PAD, SPOUSE_GAP, layoutTree, type LayoutResult } from '../tree/layout';
import { genderClass, type TreeModel } from '../tree/model';
import { cardDates, elbowPath } from '../tree/render';

const SCALE = 2; // export at 2x for a crisp image
const CLIP_WIDTH = 4000;
const TITLE_PAD = 46;

function token(css: CSSStyleDeclaration, name: string, fallback: string): string {
  return (css.getPropertyValue(name) || fallback).trim();
}

/** Shorten text to a pixel width, with an ellipsis (reference helper). */
function ellipsis(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x, y + w, rr);
  ctx.closePath();
}

export interface PngSnapshot {
  /** The workspace's own last layout (collapse state and filters included). */
  layout: LayoutResult;
  collapsed: ReadonlySet<string>;
}

export interface PngExportDeps {
  i18n: I18n;
  getModel(): TreeModel;
  /** The live render state; when absent the full tree is recomputed. */
  getRenderState?(): PngSnapshot | null;
}

/** Draw and download; throws for the caller to toast honestly. */
export async function exportTreePng(deps: PngExportDeps): Promise<void> {
  const model = deps.getModel();
  if (!model.people.length) throw new Error('empty tree');

  const snap = deps.getRenderState?.() ?? null;
  const layout = snap?.layout ?? layoutTree(model.roots, model.kids, snap?.collapsed ?? new Set());
  let maxX = 0;
  let maxY = 0;
  for (const v of layout.pos.values()) {
    maxX = Math.max(maxX, v.x + v.w);
    maxY = Math.max(maxY, v.y + NODE_H);
  }
  const W = Math.min(CLIP_WIDTH, maxX + PAD * 2);
  const H = maxY + PAD * 2 + TITLE_PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.scale(SCALE, SCALE);

  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => token(css, name, fallback);
  ctx.fillStyle = v('--bg', '#faf9f5');
  ctx.fillRect(0, 0, W, H);

  // Title and date.
  const font = v('--font-ui', 'sans-serif');
  ctx.fillStyle = v('--ink-900', '#1e2a47');
  ctx.font = `600 18px ${font}`;
  ctx.fillText(deps.i18n.t('brand.title'), 18, 28);
  ctx.font = `12px ${font}`;
  ctx.fillStyle = v('--ink-500', '#5b688f');
  ctx.fillText(new Date().toLocaleDateString(), 18, 44);

  const oy = TITLE_PAD;

  // Parent → child elbows, drawn with the exact function the interactive
  // view's svg uses — its coordinates are already PAD-inclusive world space.
  ctx.strokeStyle = v('--border-strong', '#38425e');
  ctx.lineWidth = 1.6;
  for (const [id, p] of layout.pos) {
    if (!model.byId.has(id)) continue;
    for (const kid of model.kids.get(id) ?? []) {
      const q = layout.pos.get(kid.id);
      if (!q) continue;
      const d = elbowPath(
        PAD + p.x + p.w / 2,
        oy + PAD + p.y + NODE_H,
        PAD + q.x + q.w / 2,
        oy + PAD + q.y,
      );
      ctx.stroke(new Path2D(d));
    }
  }

  // Cards.
  for (const [id, p] of layout.pos) {
    const person = model.byId.get(id);
    if (!person) continue;
    const x = PAD + p.x;
    const y = oy + PAD + p.y;
    const g = genderClass(person);
    const colour = v(
      g === 'male' ? '--gender-male' : g === 'female' ? '--gender-female' : '--gender-unknown',
      '#8891a1',
    );
    roundRect(ctx, x, y, NODE_W, NODE_H, 10);
    ctx.fillStyle = v('--surface', '#ffffff');
    ctx.fill();
    ctx.strokeStyle = v('--border', '#ccd3e7');
    ctx.lineWidth = 1;
    ctx.stroke();
    // Rail.
    roundRect(ctx, x, y + 1, 4, NODE_H - 2, 2);
    ctx.fillStyle = colour;
    ctx.fill();
    // Initials disc.
    ctx.beginPath();
    ctx.arc(x + 30, y + NODE_H / 2, 16, 0, Math.PI * 2);
    ctx.fillStyle = v(
      g === 'male' ? '--gender-male-soft' : g === 'female' ? '--gender-female-soft' : '--gender-unknown-soft',
      '#f3eee3',
    );
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.font = `700 13px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(person._initials ?? '').slice(0, 2), x + 30, y + NODE_H / 2);
    // Name + secondary line + dates.
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = v('--ink-800', '#2b3a5c');
    ctx.font = `600 12.5px ${font}`;
    const name = getDisplayName(person, deps.i18n.currentLang());
    ctx.fillText(ellipsis(ctx, name, NODE_W - 62), x + 54, y + 30);
    const sub = person.nick
      ? deps.i18n.fmt('panel.nick', { nick: person.nick })
      : (person.qual ?? '');
    if (sub) {
      ctx.fillStyle = v('--ink-500', '#5b688f');
      ctx.font = `11.5px ${font}`;
      ctx.fillText(ellipsis(ctx, sub, NODE_W - 62), x + 54, y + 46);
    }
    const dates = cardDates(person);
    if (dates) {
      ctx.fillStyle = v('--ink-400', '#7c88b0');
      ctx.font = `10.5px ${font}`;
      ctx.fillText(ellipsis(ctx, dates, NODE_W - 62), x + 54, y + 62);
    }
    if (person.dod) {
      ctx.fillStyle = v('--ink-500', '#5b688f');
      ctx.font = `12px ${font}`;
      ctx.textBaseline = 'top';
      ctx.fillText('†', x + NODE_W - 16, y + 4);
    }
    // Spouse bond, dashed like the interactive view.
    if (person.spouse) {
      ctx.save();
      ctx.strokeStyle = v('--accent', '#c07c52');
      ctx.lineWidth = 2;
      ctx.beginPath();
      const by = y + NODE_H / 2;
      ctx.setLineDash([1, 5]);
      ctx.moveTo(x + NODE_W, by);
      ctx.lineTo(x + NODE_W + SPOUSE_GAP, by);
      ctx.stroke();
      ctx.restore();
    }
  }

  const anchor = document.createElement('a');
  anchor.href = canvas.toDataURL('image/png');
  anchor.download = `Nahri_Family_Tree_${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
