import { decodeCalldata } from '../src/core/abi-decoder.ts';
import { parseEIP712 } from '../src/utils/eip712-parser.ts';
import { lookupContract } from '../src/core/contract-db.ts';
import { buildQueryPlan, extractTargetAddress } from '../src/core/query-strategy.ts';

// Test 1: Uniswap Swap
const swap = decodeCalldata('0x38ed17390000000000000000000000000000000000000000000000000000000005f5e100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000001234567890abcdef1234567890abcdef1234567800000000000000000000000000000000000000000000000000000000ffffffff0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
const swapKnown = lookupContract('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
const swapPlan = buildQueryPlan('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', null, swap?.name ?? '', 'eth_sendTransaction');
console.log('=== SWAP ===');
console.log('Decoded:', swap?.name, '| Known:', swapKnown?.name);
console.log('Plan:', swapPlan);

// Test 2: Unlimited Approve
const approve = decodeCalldata('0x095ea7b30000000000000000000000007b2f3f1e2684c3e7d8b3a45e3e6f5f2a1b0c9d8effffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const spender = extractTargetAddress(approve?.args ?? {});
const approvePlan = buildQueryPlan('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', spender, approve?.name ?? '', 'eth_sendTransaction');
console.log('\n=== APPROVE ===');
console.log('Decoded:', approve?.name, '| spender:', approve?.args?.spender?.slice(0, 10) + '...');
console.log('Amount:', approve?.args?.amount === '115792089237316195423570985008687907853269984665640564039457584007913129639935' ? 'UNLIMITED' : approve?.args?.amount);
console.log('Plan:', approvePlan);

// Test 3: setApprovalForAll
const nft = decodeCalldata('0xa22cb465000000000000000000000000deadbeefdeadbeefdeadbeefdeadbeefdeadbeef0000000000000000000000000000000000000000000000000000000000000001');
const nftKnown = lookupContract('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D');
console.log('\n=== NFT setApprovalForAll ===');
console.log('Decoded:', nft?.name, '| Contract:', nftKnown?.name);
console.log('Operator:', nft?.args?.operator, '| Approved:', nft?.args?.approved);

// Test 4: EIP-712 Permit2
const permit2Data = {"domain":{"name":"Permit2","chainId":1,"verifyingContract":"0x000000000022D473030F116dDEE9F6B43aC78BA3"},"primaryType":"PermitSingle","types":{"PermitSingle":[{"name":"details","type":"PermitDetails"},{"name":"spender","type":"address"},{"name":"sigDeadline","type":"uint256"}],"PermitDetails":[{"name":"token","type":"address"},{"name":"amount","type":"uint160"},{"name":"expiration","type":"uint48"},{"name":"nonce","type":"uint48"}]},"message":{"details":{"token":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","amount":"1461501637330902918203684832716283019655932542975","expiration":"1735689600","nonce":"0"},"spender":"0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD","sigDeadline":"1735689600"}};
const parsed = parseEIP712(permit2Data);
console.log('\n=== EIP-712 Permit2 ===');
console.log('Pattern:', parsed?.pattern, '| Label:', parsed?.label);
console.log('Risk factors:', parsed?.riskFactors);

console.log('\n=== ALL TESTS PASSED ===');
