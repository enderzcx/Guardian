/**
 * Token Flow Row — shows "Sending X → Receiving Y" with USD values
 */

import type { TokenFlow } from '@/types';
import { el } from './dom';
import { COLORS } from './styles';

export function createTokenFlowRow(flow: TokenFlow): HTMLElement {
  const row = el('div', {
    style: `
      display:flex; align-items:center; gap:8px;
      margin-top:10px; padding:8px 10px; border-radius:8px;
      background:${COLORS.bgElevated}; font-size:12px;
    `,
  });

  if (flow.out) {
    const outEl = el('span', {
      style: `color:${COLORS.red.accent};`,
      text: `-${flow.out.amount} ${flow.out.symbol}`,
    });
    row.appendChild(outEl);

    const usdOut = el('span', {
      style: `color:${COLORS.textMuted}; font-size:11px;`,
      text: flow.out.usdValue,
    });
    row.appendChild(usdOut);
  }

  if (flow.out && flow.in) {
    row.appendChild(el('span', {
      style: `color:${COLORS.textMuted};`,
      text: '\u2192',
    }));
  }

  if (flow.in) {
    const inEl = el('span', {
      style: `color:${COLORS.green.accent};`,
      text: `+${flow.in.amount} ${flow.in.symbol}`,
    });
    row.appendChild(inEl);

    const usdIn = el('span', {
      style: `color:${COLORS.textMuted}; font-size:11px;`,
      text: flow.in.usdValue,
    });
    row.appendChild(usdIn);
  }

  return row;
}
