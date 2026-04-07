/**
 * GoPlus Security API — threat intelligence for contracts and tokens
 * Free API, no key required
 */

import { GOPLUS_API } from '@/config/endpoints';

export interface GoPlusTokenSecurity {
  isOpenSource: boolean;
  isProxy: boolean;
  isMintable: boolean;
  canPause: boolean;
  canBlacklist: boolean;
  isHoneypot: boolean;
  buyTax: string;
  sellTax: string;
  holderCount: number;
  ownerAddress: string;
  isInDex: boolean;
}

export interface GoPlusAddressSecurity {
  isBlacklisted: boolean;
  isMalicious: boolean;
  isPhishing: boolean;
  flags: string[];
}

export async function checkTokenSecurity(
  chainId: string,
  contractAddress: string,
): Promise<GoPlusTokenSecurity | null> {
  try {
    const url = `${GOPLUS_API}token_security/${chainId}?contract_addresses=${contractAddress.toLowerCase()}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      code: number;
      result: Record<string, Record<string, string>>;
    };

    if (data.code !== 1) return null;

    const info = data.result[contractAddress.toLowerCase()];
    if (!info) return null;

    return {
      isOpenSource: info.is_open_source === '1',
      isProxy: info.is_proxy === '1',
      isMintable: info.is_mintable === '1',
      canPause: info.transfer_pausable === '1',
      canBlacklist: info.personal_slippage_modifiable === '1' || info.is_blacklisted === '1',
      isHoneypot: info.is_honeypot === '1',
      buyTax: info.buy_tax ?? '0',
      sellTax: info.sell_tax ?? '0',
      holderCount: parseInt(info.holder_count ?? '0', 10),
      ownerAddress: info.owner_address ?? '',
      isInDex: info.is_in_dex === '1',
    };
  } catch (error) {
    console.debug('[Guardian] GoPlus checkTokenSecurity failed:', error);
    return null;
  }
}

export async function checkAddressSecurity(
  chainId: string,
  address: string,
): Promise<GoPlusAddressSecurity | null> {
  try {
    const url = `${GOPLUS_API}address_security/${address.toLowerCase()}?chain_id=${chainId}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      code: number;
      result: Record<string, string>;
    };

    if (data.code !== 1) return null;

    const r = data.result;
    const flags: string[] = [];
    if (r.honeypot_related_address === '1') flags.push('honeypot related');
    if (r.phishing_activities === '1') flags.push('phishing');
    if (r.blackmail_activities === '1') flags.push('blackmail');
    if (r.stealing_attack === '1') flags.push('stealing attack');
    if (r.fake_token === '1') flags.push('fake token');
    if (r.contract_address === '1') flags.push('is contract');

    return {
      isBlacklisted: r.blacklist_doubt === '1',
      isMalicious: flags.length > 0,
      isPhishing: r.phishing_activities === '1',
      flags,
    };
  } catch (error) {
    console.debug('[Guardian] GoPlus checkAddressSecurity failed:', error);
    return null;
  }
}
