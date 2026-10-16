/** Small DOM helpers shared by every module. Kept deliberately tiny. */

export type Child = Node | string | null | undefined | false;

type Attrs = Record<string, unknown>;

/**
 * Create an element. Attribute rules:
 *   - `class` sets className, `text` sets textContent;
 *   - `dataset` merges into element.dataset;
 *   - keys starting with `on` and holding a function become event listeners;
 *   - `true` writes a valueless attribute, `null`/`false`/`undefined` skip it.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (name === 'class') el.className = String(value);
      else if (name === 'text') el.textContent = String(value);
      else if (name === 'dataset' && typeof value === 'object')
        Object.assign(el.dataset, value as Record<string, string>);
      else if (name.startsWith('on') && typeof value === 'function')
        el.addEventListener(name.slice(2), value as EventListener);
      else if (value === true) el.setAttribute(name, '');
      else el.setAttribute(name, String(value));
    }
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child == null || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Build an SVG element from a TRUSTED markup string (never user input). */
export function svgIcon(markup: string): SVGElement {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  const el = template.content.firstElementChild;
  if (!el || !(el instanceof SVGElement)) throw new Error('svgIcon() expects a single <svg> root element');
  return el;
}

/** Remove every child of an element. */
export function clear(el: Element): void {
  el.replaceChildren();
}
