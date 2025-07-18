import { logger, config, tronWeb, tronUtils } from '../config';
import { NETWORK_CONSTANTS } from '../config/network-constants';

interface AddressValidationResult {
  address: string;
  isValid: boolean;
  network: 'mainnet' | 'testnet';
  networkMatch: boolean;
  networkWarning?: string;
  exists?: boolean;
  balance?: {
    TRX: string;
    USDT: string;
  };
  error?: string;
}

export class ValidationService {
  /**
   * Validate a TRON address with comprehensive checks
   * 
   * This service validates:
   * 1. Basic format (starts with T, 34 characters, valid base58)
   * 2. Network compatibility (mainnet vs testnet)
   * 3. Optional on-chain existence check
   * 
   * Network Detection Logic:
   * - Mainnet addresses: Typically have more activity and different patterns
   * - Testnet addresses: Often have test transactions or faucet interactions
   * - We check against known contract addresses and patterns
   */
  async validateTronAddress(
    address: string,
    checkOnChain: boolean = false
  ): Promise<AddressValidationResult> {
    try {
      // Step 1: Basic format validation
      if (!address || typeof address !== 'string') {
        return {
          address,
          isValid: false,
          network: config.tron.network,
          networkMatch: false,
          error: 'Invalid address format',
        };
      }

      // Use TronWeb's built-in validation
      const isValidFormat = tronUtils.isAddress(address);
      if (!isValidFormat) {
        return {
          address,
          isValid: false,
          network: config.tron.network,
          networkMatch: false,
          error: 'Invalid TRON address format. Must start with T and be 34 characters.',
        };
      }

      // Step 2: Network compatibility check
      const currentNetwork = config.tron.network;
      const networkMatch = await this.checkNetworkCompatibility(address, currentNetwork);
      
      // Prepare base result
      const result: AddressValidationResult = {
        address,
        isValid: isValidFormat,
        network: currentNetwork,
        networkMatch: networkMatch.isCompatible,
        networkWarning: networkMatch.warning,
      };

      // Step 3: Optional on-chain validation
      if (checkOnChain && isValidFormat) {
        try {
          const onChainData = await this.checkAddressOnChain(address);
          result.exists = onChainData.exists;
          result.balance = onChainData.balance;
        } catch (error) {
          logger.warn('Failed to check address on-chain', {
            address,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // Don't fail the validation, just skip on-chain data
        }
      }

      logger.info('TRON address validated', {
        address,
        isValid: result.isValid,
        network: result.network,
        networkMatch: result.networkMatch,
        exists: result.exists,
      });

      return result;
    } catch (error) {
      logger.error('Address validation failed', {
        address,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        address,
        isValid: false,
        network: config.tron.network,
        networkMatch: false,
        error: 'Validation failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
      };
    }
  }

  /**
   * Check if an address is compatible with the current network
   * 
   * Detection strategy:
   * 1. Check against known mainnet/testnet contract addresses
   * 2. For livecoins mode: Warn if address matches known testnet patterns
   * 3. For devcoins mode: Warn if address matches known mainnet patterns
   */
  private async checkNetworkCompatibility(
    address: string,
    currentNetwork: 'mainnet' | 'testnet'
  ): Promise<{ isCompatible: boolean; warning?: string }> {
    // Known mainnet addresses (add more as needed)
    const knownMainnetAddresses: string[] = [
      NETWORK_CONSTANTS.mainnet.contracts.usdt,
      // Add other known mainnet contracts here
    ];

    // Known testnet addresses
    const knownTestnetAddresses: string[] = [
      NETWORK_CONSTANTS.testnet.contracts.usdt,
      // Add other known testnet contracts here
    ];

    const isKnownMainnet = knownMainnetAddresses.includes(address);
    const isKnownTestnet = knownTestnetAddresses.includes(address);

    if (currentNetwork === 'mainnet') {
      if (isKnownTestnet) {
        return {
          isCompatible: false,
          warning: 'This appears to be a testnet address. Please use a mainnet address for live transactions.',
        };
      }
      return { isCompatible: true };
    } else {
      // testnet mode
      if (isKnownMainnet) {
        return {
          isCompatible: false,
          warning: 'This appears to be a mainnet address. Please use a testnet address for development.',
        };
      }
      return { isCompatible: true };
    }
  }

  /**
   * Check if an address exists on the blockchain
   * Also retrieves balance information
   */
  private async checkAddressOnChain(address: string): Promise<{
    exists: boolean;
    balance?: {
      TRX: string;
      USDT: string;
    };
  }> {
    try {
      // Get account info
      const account = await tronWeb.trx.getAccount(address);
      
      // If account object is empty, address doesn't exist on-chain
      if (!account || Object.keys(account).length === 0) {
        return { exists: false };
      }

      // Get TRX balance
      const trxBalance = await tronWeb.trx.getBalance(address);
      const trxInTRX = tronUtils.fromSun(trxBalance);

      // Get USDT balance
      let usdtBalance = '0';
      try {
        const usdtContract = await tronWeb.contract().at(config.tron.usdtContract);
        const usdtRaw = await usdtContract.balanceOf(address).call();
        usdtBalance = (Number(usdtRaw) / Math.pow(10, 6)).toFixed(6); // USDT has 6 decimals
      } catch (error) {
        // Address might not have USDT or contract call failed
        logger.debug('Failed to get USDT balance', {
          address,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      return {
        exists: true,
        balance: {
          TRX: trxInTRX.toString(),
          USDT: usdtBalance,
        },
      };
    } catch (error) {
      logger.error('Failed to check address on-chain', {
        address,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      // If we can't check, assume it doesn't exist
      return { exists: false };
    }
  }

  /**
   * Batch validate multiple addresses
   * Useful for validating multiple recipients
   */
  async validateMultipleAddresses(
    addresses: string[],
    checkOnChain: boolean = false
  ): Promise<AddressValidationResult[]> {
    const results = await Promise.all(
      addresses.map(address => this.validateTronAddress(address, checkOnChain))
    );
    
    return results;
  }

  /**
   * Check if an address is a contract
   */
  async isContract(address: string): Promise<boolean> {
    try {
      const account = await tronWeb.trx.getAccount(address);
      return account && account.type === 1; // Type 1 indicates a contract
    } catch (error) {
      logger.error('Failed to check if address is contract', {
        address,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }
}

export const validationService = new ValidationService();