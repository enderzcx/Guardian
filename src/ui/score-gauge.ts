/**
 * Score Gauge — circular SVG gauge showing risk score 0-100
 * Animates from 0 to target score on render
 */

import { riskColors, type RiskLevel } from './styles';

const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function createScoreGauge(score: number, level: RiskLevel): HTMLElement {
  const colors = riskColors(level);
  const container = document.createElement('div');
  container.style.cssText = 'position:relative; width:88px; height:88px; flex-shrink:0;';

  const ns = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(ns, 'svg');
  svgEl.setAttribute('width', '88');
  svgEl.setAttribute('height', '88');
  svgEl.setAttribute('viewBox', '0 0 88 88');

  // Background circle
  const bgCircle = document.createElementNS(ns, 'circle');
  setAttrs(bgCircle, {
    cx: '44', cy: '44', r: String(RADIUS),
    fill: 'none', stroke: 'rgba(255,255,255,0.08)', 'stroke-width': '6',
  });

  // Progress arc
  const progress = document.createElementNS(ns, 'circle');
  const offset = CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE;
  setAttrs(progress, {
    cx: '44', cy: '44', r: String(RADIUS),
    fill: 'none', stroke: colors.accent, 'stroke-width': '6',
    'stroke-linecap': 'round',
    'stroke-dasharray': String(CIRCUMFERENCE),
    'stroke-dashoffset': String(CIRCUMFERENCE),
    transform: 'rotate(-90 44 44)',
  });

  svgEl.appendChild(bgCircle);
  svgEl.appendChild(progress);
  container.appendChild(svgEl);

  // Score text
  const label = document.createElement('div');
  label.style.cssText = `
    position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
    font-size:22px; font-weight:700; color:${colors.accent};
    font-variant-numeric:tabular-nums;
  `;
  label.textContent = String(score);
  label.setAttribute('data-guardian-score', '');
  container.appendChild(label);

  // Animate on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      progress.style.transition = 'stroke-dashoffset 0.8s ease-out';
      progress.setAttribute('stroke-dashoffset', String(offset));
    });
  });

  return container;
}

export function updateScoreGauge(
  container: HTMLElement,
  score: number,
  level: RiskLevel,
): void {
  const colors = riskColors(level);
  const progress = container.querySelector('circle:last-of-type');
  if (progress) {
    const offset = CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE;
    progress.setAttribute('stroke', colors.accent);
    progress.setAttribute('stroke-dashoffset', String(offset));
  }
  const label = container.querySelector('[data-guardian-score]');
  if (label) {
    (label as HTMLElement).style.color = colors.accent;
    label.textContent = String(score);
  }
}

function setAttrs(el: Element, attrs: Record<string, string>): void {
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
}
