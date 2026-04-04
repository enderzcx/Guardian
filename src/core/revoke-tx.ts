/**
 * Revoke TX Generator — builds calldata for revoking approvals
 * Returns tx params ready for window.ethereum.request({ method: 'eth_sendTransaction' })
 */

import type { ActiveApproval } from './approval-scanner';

/** ERC-20: approve(address spender, uint256 amount) with amount=0 */
const APPROVE_SELECTOR = '0x095ea7b3';

/** ERC-721/1155: setApprovalForAll(address operator, bool approved) with approved=false */
const SET_APPROVAL_FOR_ALL_SELECTOR = '0xa22cb465';

export interface RevokeTxParams {
  from: string;
  to: string;
  data: string;
  value: string;
}

export function buildRevokeTx(
  approval: ActiveApproval,
  fromAddress: string,
): RevokeTxParams {
  const data = approval.type === 'nft-all'
    ? buildSetApprovalForAllRevoke(approval.spender)
    : buildApproveRevoke(approval.spender);

  return {
    from: fromAddress,
    to: approval.token,
    data,
    value: '0x0',
  };
}

function buildApproveRevoke(spender: string): string {
  const paddedSpender = spender.slice(2).toLowerCase().padStart(64, '0');
  const zeroAmount = '0'.repeat(64);
  return `${APPROVE_SELECTOR}${paddedSpender}${zeroAmount}`;
}

function buildSetApprovalForAllRevoke(operator: string): string {
  const paddedOperator = operator.slice(2).toLowerCase().padStart(64, '0');
  const falseBool = '0'.repeat(64);
  return `${SET_APPROVAL_FOR_ALL_SELECTOR}${paddedOperator}${falseBool}`;
}
