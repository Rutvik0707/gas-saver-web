import TronWeb from 'tronweb';
import { config } from './environment';
import { logger } from './logger';
import { NETWORK_CONSTANTS, isTestnetUrl } from './network-constants';

// Initialize TronWeb instance
export const tronWeb = new TronWeb({
  fullHost: config.tron.fullNode,
  headers: config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : {},
  privateKey: config.tron.privateKey,
});

// System TronWeb instance for system operations
export const systemTronWeb = new TronWeb({
  fullHost: config.tron.fullNode,
  headers: config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : {},
  privateKey: config.systemWallet.privateKey,
});

// Validate TRON connection
export async function validateTronConnection(): Promise<boolean> {
  try {
    const isConnected = await tronWeb.isConnected();
    if (isConnected) {
      logger.info('✅ TRON network connection established');
      
      // Log network info
      const nodeInfo = await tronWeb.trx.getNodeInfo();
      const networkUrl = config.tron.fullNode;
      const isShasta = networkUrl.includes('shasta');
      
      logger.info(`🌐 Connected to TRON ${isShasta ? 'Shasta Testnet' : config.tron.network}`, {
        endpoint: networkUrl,
        blockNumber: nodeInfo.blockNumber,
        solidityBlockNumber: nodeInfo.solidityBlockNumber,
        usdtContract: config.tron.usdtContract,
      });
      
      // Validate testnet configuration
      if (config.tron.network === 'testnet' && !isShasta) {
        logger.warn('⚠️ Testnet mode enabled but not using Shasta endpoint');
      }
      
      // Additional safety check for mainnet
      if (config.tron.network === 'mainnet') {
        const expectedUrl = NETWORK_CONSTANTS.mainnet.nodes.full;
        const expectedUSDT = NETWORK_CONSTANTS.mainnet.contracts.usdt;
        
        if (isTestnetUrl(networkUrl)) {
          throw new Error('CRITICAL: Mainnet mode enabled but using testnet URL! This is dangerous.');
        }
        
        if (config.tron.usdtContract !== expectedUSDT) {
          throw new Error(`CRITICAL: Wrong USDT contract for mainnet! Expected ${expectedUSDT} but got ${config.tron.usdtContract}`);
        }
        
        logger.warn('🚨 MAINNET MODE ACTIVE - Please ensure all configurations are correct!');
      }
      
      return true;
    } else {
      logger.error('❌ Failed to connect to TRON network');
      return false;
    }
  } catch (error) {
    logger.error('❌ TRON connection error:', error);
    return false;
  }
}

// Get USDT contract instance
export function getUsdtContract() {
  return tronWeb.contract().at(config.tron.usdtContract);
}

// Utility functions for TRON operations
export const tronUtils = {
  // Convert TRX to Sun (1 TRX = 1,000,000 Sun)
  toSun: (trx: number): number => (tronWeb as any).toSun(trx),
  
  // Convert Sun to TRX
  fromSun: (sun: number | string): number => parseFloat((tronWeb as any).fromSun(sun)),
  
  // Validate TRON address
  isAddress: (address: string): boolean => tronWeb.isAddress(address),
  
  // Convert hex address to base58
  hexToBase58: (hex: string): string => tronWeb.address.fromHex(hex),
  
  // Convert base58 address to hex
  base58ToHex: (base58: string): string => tronWeb.address.toHex(base58),
};