/** Minimal DOM helpers — XSS-safe, no innerHTML */

export function el(
  tag: string,
  opts: { style?: string; text?: string; cls?: string } = {},
): HTMLElement {
  const element = document.createElement(tag);
  if (opts.style) element.style.cssText = opts.style;
  if (opts.text) element.textContent = opts.text;
  if (opts.cls) element.className = opts.cls;
  return element;
}
