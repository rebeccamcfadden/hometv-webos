// Small DOM helpers, from design_preview's core/dom.ts, kept to what Chromium 56 has (no matchAll, no
// replaceChildren).

export type Child = Node | string | number | null | undefined | false | Child[];
type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Record<string, AttrValue> & { html?: string; style?: string };

const isAttrs = (x: unknown): x is Attrs =>
  typeof x === 'object' && x !== null && !(x instanceof Node) && !Array.isArray(x);

/** `h('div.card.is-big#main', { 'data-x': 1 }, child, …)` */
export function h(sel: string, ...rest: (Attrs | Child)[]): HTMLElement {
  const tagMatch = /^[a-z0-9]+/i.exec(sel);
  const el = document.createElement(tagMatch ? tagMatch[0] : 'div');
  const classes = /\.([\w-]+)/g;
  for (let m = classes.exec(sel); m; m = classes.exec(sel)) el.classList.add(m[1]);
  const id = /#([\w-]+)/.exec(sel);
  if (id) el.id = id[1];
  if (rest.length && isAttrs(rest[0])) {
    const attrs = rest.shift() as Attrs;
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'html') el.innerHTML = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, rest as Child[]);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function replace(el: Element, ...children: Child[]): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  append(el, children);
}

/** Text with the characters at `indices` wrapped in <b class="hit">. */
export function highlight(text: string, indices: number[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const set: Record<number, true> = {};
  for (const i of indices) set[i] = true;
  let run = '';
  let hit = false;
  const flush = () => {
    if (!run) return;
    frag.appendChild(hit ? h('b.hit', run) : document.createTextNode(run));
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const isHit = !!set[i];
    if (isHit !== hit) {
      flush();
      hit = isHit;
    }
    run += text[i];
  }
  flush();
  return frag;
}
