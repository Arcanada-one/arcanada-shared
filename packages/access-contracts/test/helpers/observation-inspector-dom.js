// SPDX-License-Identifier: MIT
// Small DOM double for read-only inspector behavior; no browser/runtime claim.
export class TestElement {
  constructor(tag, doc, text = '') { this.tag = tag; this.doc = doc; this.text = text; this.children = []; this.parent = null; this.attrs = {}; this.handlers = new Map(); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  hasAttribute(key) { return key in this.attrs; }
  removeAttribute(key) { delete this.attrs[key]; }
  get id() { return this.getAttribute('id'); }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parent = null; return node; }
  remove() { if (this.parent) this.parent.removeChild(this); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  addEventListener(kind, handler) { if (!this.handlers.has(kind)) this.handlers.set(kind, new Set()); this.handlers.get(kind).add(handler); }
  removeEventListener(kind, handler) { this.handlers.get(kind)?.delete(handler); }
  click() { for (const handler of [...(this.handlers.get('click') || [])]) handler({ target: this }); }
  focus() { this.doc.activeElement = this; }
  querySelectorAll(selector) {
    const match = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(selector);
    const result = [];
    const walk = node => { for (const child of node.children) {
      if (match && child.hasAttribute(match[1]) && (match[2] === undefined || child.getAttribute(match[1]) === match[2])) result.push(child);
      walk(child);
    } };
    walk(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

export function inspectorDocument(graph, locale = 'en') {
  const doc = { activeElement: null, documentElement: { lang: locale } };
  doc.createElement = tag => new TestElement(tag, doc);
  doc.createTextNode = text => new TestElement('#text', doc, String(text));
  const graphRoot = doc.createElement('section'), timelineRoot = doc.createElement('section'), inspectorRoot = doc.createElement('section');
  for (const root of [timelineRoot, inspectorRoot]) {
    const placeholder = doc.createElement('p'); placeholder.setAttribute('data-lab-placeholder', ''); root.append(placeholder);
  }
  for (const [items, key, attr] of [[graph.nodes, 'key', 'data-node-key'], [graph.edges, 'edgeKey', 'data-edge-key'], [graph.crosslinks, 'linkId', 'data-link-id']]) {
    for (const item of items) { const row = doc.createElement('li'); row.setAttribute(attr, item[key]); graphRoot.append(row); }
  }
  return { document: doc, graphRoot, timelineRoot, inspectorRoot };
}
