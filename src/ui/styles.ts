/** Shared design tokens and style constants */

export const COLORS = {
  bg: '#1a1a2e',
  bgElevated: '#222240',
  textPrimary: '#e0e0e0',
  textSecondary: '#a0a0b0',
  textMuted: '#707080',
  borderSubtle: 'rgba(255,255,255,0.06)',
  green: { accent: '#4ade80', bg: '#1a2e1a', border: '#2d5a27' },
  yellow: { accent: '#facc15', bg: '#2e2a1a', border: '#5a4f27' },
  red: { accent: '#f87171', bg: '#2e1a1a', border: '#5a2727' },
} as const;

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

export type RiskLevel = 'green' | 'yellow' | 'red';

export function riskColors(level: RiskLevel): { accent: string; bg: string; border: string } {
  return COLORS[level];
}
