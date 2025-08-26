/**
 * Network-specific constants for TRON mainnet and testnet
 */

export const NETWORK_CONSTANTS = {
  mainnet: {
    name: 'TRON Mainnet',
    explorer: 'https://tronscan.org',
    nodes: {
      full: 'https://api.trongrid.io',
      solidity: 'https://api.trongrid.io',
      event: 'https://api.trongrid.io',
    },
    tronscan: {
      api: 'https://apilist.tronscanapi.com/api',
    },
    contracts: {
      // Official USDT (TRC-20) contract on TRON mainnet
      usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    },
    // Chain ID for mainnet
    chainId: '0x2b6653dc',
  },
  testnet: {
    name: 'Shasta Testnet',
    explorer: 'https://shasta.tronscan.org',
    nodes: {
      full: 'https://api.shasta.trongrid.io',
      solidity: 'https://api.shasta.trongrid.io',
      event: 'https://api.shasta.trongrid.io',
    },
    tronscan: {
      api: 'https://shastapi.tronscan.org/api',
    },
    contracts: {
      // Test USDT contract on Shasta testnet
      usdt: 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    },
    // Chain ID for Shasta testnet
    chainId: '0x94a9059e',
  },
} as const;

/**
 * Get network constants based on network type
 */
export function getNetworkConstants(network: 'mainnet' | 'testnet') {
  return NETWORK_CONSTANTS[network];
}

/**
 * Validate that a USDT contract address matches the expected network
 */
export function validateUSDTContract(contractAddress: string, network: 'mainnet' | 'testnet'): boolean {
  const expectedContract = NETWORK_CONSTANTS[network].contracts.usdt;
  return contractAddress === expectedContract;
}

/**
 * Get the appropriate TronGrid URL for the network
 */
export function getTronGridUrl(network: 'mainnet' | 'testnet'): string {
  return NETWORK_CONSTANTS[network].nodes.full;
}

/**
 * Check if a URL is for testnet based on common patterns
 */
export function isTestnetUrl(url: string): boolean {
  return url.toLowerCase().includes('shasta') || url.toLowerCase().includes('test');
}

/**
 * Get block explorer URL for a transaction
 */
export function getTransactionUrl(txHash: string, network: 'mainnet' | 'testnet'): string {
  return `${NETWORK_CONSTANTS[network].explorer}/#/transaction/${txHash}`;
}

/**
 * Get block explorer URL for an address
 */
export function getAddressUrl(address: string, network: 'mainnet' | 'testnet'): string {
  return `${NETWORK_CONSTANTS[network].explorer}/#/address/${address}`;
}

/**
 * Get TronScan API URL for the network
 */
export function getTronScanApiUrl(network: 'mainnet' | 'testnet'): string {
  return NETWORK_CONSTANTS[network].tronscan.api;
}