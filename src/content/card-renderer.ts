/**
 * Card Renderer — creates and updates transaction cards in Shadow DOM
 * Composes UI components, DOM API only, no innerHTML (XSS safe)
 */

import type { AnalysisResult } from '@/types';
import { shortenAddress } from '@/utils/format';
import { el } from '@/ui/dom';
import { COLORS, FONT, riskColors, type RiskLevel } from '@/ui/styles';
import { createScoreGauge, updateScoreGauge } from '@/ui/score-gauge';
import { createRiskBadge } from '@/ui/risk-badge';
import { createTokenFlowRow } from '@/ui/token-flow-row';
import { createActionBar } from '@/ui/action-bar';

export function renderCard(
  root: ShadowRoot,
  result: AnalysisResult,
  onDecision: (approved: boolean) => void,
): void {
  const colors = riskColors(result.riskLevel);

  const card = el('div', {
    style: `
      position:fixed; bottom:24px; right:24px; width:400px;
      background:${COLORS.bg}; border-radius:16px; padding:20px;
      color:${COLORS.textPrimary}; font-family:${FONT};
      box-shadow:0 8px 32px rgba(0,0,0,0.5);
      border:1px solid ${colors.border};
      pointer-events:auto; font-size:13px; line-height:1.5;
      opacity:0; transform:translateY(12px);
      transition:opacity 0.3s ease-out, transform 0.3s ease-out;
    `,
  });
  card.setAttribute('data-guardian-tx-id', result.id);

  // Header row: badge + title + gauge
  const header = el('div', {
    style: 'display:flex; justify-content:space-between; align-items:flex-start; gap:12px;',
  });

  const headerLeft = el('div', { style: 'flex:1; min-width:0;' });
  const badge = createRiskBadge(result.riskLevel);
  badge.setAttribute('data-guardian-badge', '');
  headerLeft.appendChild(badge);

  const title = el('div', {
    style: `margin-top:8px; font-weight:600; font-size:14px; color:${colors.accent};
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`,
    text: result.summary,
  });
  headerLeft.appendChild(title);
  header.appendChild(headerLeft);

  const gauge = createScoreGauge(result.score, result.riskLevel);
  gauge.setAttribute('data-guardian-gauge', '');
  header.appendChild(gauge);
  card.appendChild(header);

  // Decoded info
  if (result.decoded) {
    const info = el('div', {
      style: `margin-top:10px; color:${COLORS.textSecondary}; font-size:12px;`,
    });
    if (result.decoded.contractAddress) {
      info.appendChild(el('div', {
        text: `Contract: ${shortenAddress(result.decoded.contractAddress)}`,
      }));
    }
    for (const [key, value] of Object.entries(result.decoded.args)) {
      const display = value.startsWith('0x') ? shortenAddress(value) : value;
      info.appendChild(el('div', { text: `${key}: ${display}` }));
    }
    if (result.decoded.eip712RiskFactors?.length) {
      for (const factor of result.decoded.eip712RiskFactors) {
        info.appendChild(el('div', {
          style: `color:${colors.accent}; margin-top:4px; font-weight:500;`,
          text: `\u26A0 ${factor}`,
        }));
      }
    }
    card.appendChild(info);
  }

  // Token flow
  if (result.tokenFlow) {
    card.appendChild(createTokenFlowRow(result.tokenFlow));
  }

  // AI explanation
  const aiRow = el('div', {
    style: `
      margin-top:12px; padding-top:10px;
      border-top:1px solid ${COLORS.borderSubtle};
      font-size:12px; color:${COLORS.textSecondary};
    `,
    text: result.aiExplanation ?? 'AI analyzing...',
  });
  aiRow.setAttribute('data-guardian-ai', '');
  card.appendChild(aiRow);

  // Action buttons
  const cleanup = () => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(12px)';
    setTimeout(() => card.remove(), 300);
  };
  card.appendChild(createActionBar(result.riskLevel, (approved) => {
    onDecision(approved);
    cleanup();
  }));

  root.appendChild(card);

  // Entrance animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });
  });
}

export function updateCardWithAI(
  root: ShadowRoot,
  txId: string,
  score: number,
  explanation: string,
  riskFactors: string[],
): void {
  const card = root.querySelector(`[data-guardian-tx-id="${txId}"]`);
  if (!card) return;

  const level: RiskLevel = score <= 30 ? 'green' : score <= 70 ? 'yellow' : 'red';

  // Update risk badge
  const oldBadge = card.querySelector('[data-guardian-badge]');
  if (oldBadge) {
    const newBadge = createRiskBadge(level);
    newBadge.setAttribute('data-guardian-badge', '');
    oldBadge.replaceWith(newBadge);
  }

  // Update gauge
  const gauge = card.querySelector('[data-guardian-gauge]') as HTMLElement | null;
  if (gauge) {
    updateScoreGauge(gauge, score, level);
  }

  // Update AI row with fade
  const aiRow = card.querySelector('[data-guardian-ai]') as HTMLElement | null;
  if (aiRow) {
    aiRow.style.opacity = '0';
    aiRow.style.transition = 'opacity 0.4s ease-in';
    aiRow.textContent = '';

    aiRow.appendChild(document.createTextNode(explanation));
    for (const factor of riskFactors) {
      const line = document.createElement('div');
      line.textContent = `\u2022 ${factor}`;
      line.style.cssText = `margin-top:4px; font-size:11px; color:${COLORS.textMuted};`;
      aiRow.appendChild(line);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => { aiRow.style.opacity = '1'; });
    });
  }
}
