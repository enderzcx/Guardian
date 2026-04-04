/**
 * Action Bar — Approve / Reject buttons with risk-aware styling
 */

import { riskColors, type RiskLevel, COLORS } from './styles';

export function createActionBar(
  level: RiskLevel,
  onDecision: (approved: boolean) => void,
): HTMLElement {
  const colors = riskColors(level);
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex; gap:8px; margin-top:14px;';

  const approveLabel = level === 'red' ? 'Approve Anyway' : 'Approve';
  const approveBg = level === 'red' ? COLORS.yellow.border : colors.border;

  bar.appendChild(makeButton(approveLabel, approveBg, () => onDecision(true)));
  bar.appendChild(makeButton('Reject', COLORS.red.border, () => onDecision(false)));

  return bar;
}

function makeButton(
  text: string,
  bg: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    flex:1; padding:10px; border-radius:8px; background:${bg};
    color:#fff; border:none; cursor:pointer; font-size:13px;
    font-family:inherit; transition:opacity 0.15s;
  `;
  btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
  btn.addEventListener('click', onClick);
  return btn;
}
