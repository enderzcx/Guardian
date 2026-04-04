/**
 * Known Contract Database — identifies trusted/verified contracts
 * In-memory for now, can migrate to IndexedDB for persistence
 */

export interface KnownContract {
  name: string;
  protocol: string;
  category: 'dex' | 'lending' | 'nft' | 'bridge' | 'token' | 'other';
  trusted: boolean;
}

/** Top contracts on Ethereum mainnet */
const KNOWN_CONTRACTS: Record<string, KnownContract> = {
  // Uniswap
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { name: 'Uniswap V2 Router', protocol: 'Uniswap', category: 'dex', trusted: true },
  '0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'Uniswap V3 Router', protocol: 'Uniswap', category: 'dex', trusted: true },
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { name: 'Uniswap Universal Router', protocol: 'Uniswap', category: 'dex', trusted: true },
  '0x000000000022d473030f116ddee9f6b43ac78ba3': { name: 'Permit2', protocol: 'Uniswap', category: 'dex', trusted: true },
  // Aave
  '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': { name: 'Aave V3 Pool', protocol: 'Aave', category: 'lending', trusted: true },
  // Lido
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { name: 'stETH', protocol: 'Lido', category: 'other', trusted: true },
  // OpenSea
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc': { name: 'Seaport 1.5', protocol: 'OpenSea', category: 'nft', trusted: true },
  // Top tokens
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USDC', protocol: 'Circle', category: 'token', trusted: true },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'USDT', protocol: 'Tether', category: 'token', trusted: true },
  '0x6b175474e89094c44da98b954eedeac495271d0f': { name: 'DAI', protocol: 'MakerDAO', category: 'token', trusted: true },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { name: 'WETH', protocol: 'Ethereum', category: 'token', trusted: true },
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { name: 'WBTC', protocol: 'BitGo', category: 'token', trusted: true },
  // Top NFTs
  '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d': { name: 'BAYC', protocol: 'Yuga Labs', category: 'nft', trusted: true },
  '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb': { name: 'CryptoPunks', protocol: 'Larva Labs', category: 'nft', trusted: true },
  // 1inch
  '0x1111111254eeb25477b68fb85ed929f73a960582': { name: '1inch Router V5', protocol: '1inch', category: 'dex', trusted: true },
  // Curve
  '0x99a58482bd75cbab83b27ec03ca68ff489b5788f': { name: 'Curve Router', protocol: 'Curve', category: 'dex', trusted: true },
};

export function lookupContract(address: string): KnownContract | null {
  return KNOWN_CONTRACTS[address.toLowerCase()] ?? null;
}

export function isKnownContract(address: string): boolean {
  return address.toLowerCase() in KNOWN_CONTRACTS;
}

export function isTrustedContract(address: string): boolean {
  return KNOWN_CONTRACTS[address.toLowerCase()]?.trusted ?? false;
}
