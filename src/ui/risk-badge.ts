/**
 * Risk Badge — colored pill showing risk level label
 */

import { riskColors, type RiskLevel } from './styles';
import { el } from './dom';

const LABELS: Record<RiskLevel, string> = {
  green: 'Low Risk',
  yellow: 'Caution',
  red: 'Danger',
};

export function createRiskBadge(level: RiskLevel): HTMLElement {
  const colors = riskColors(level);
  const badge = el('span', {
    style: `
      display:inline-block; padding:2px 10px; border-radius:12px;
      font-size:11px; font-weight:600; letter-spacing:0.3px;
      color:${colors.accent}; background:${colors.bg};
      border:1px solid ${colors.border};
    `,
    text: LABELS[level],
  });
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-label', `Risk level: ${LABELS[level]}`);
  return badge;
}
