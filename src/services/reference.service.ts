import * as QRCode from 'qrcode';
import { logger } from '../config';

export class ReferenceService {
  /**
   * Generate simple QR code with just the wallet address
   */
  async generateAddressQR(walletAddress: string): Promise<string> {
    try {
      const qrCodeBase64 = await QRCode.toDataURL(walletAddress, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });
      
      logger.debug('Generated address QR code', { walletAddress });
      return qrCodeBase64;
    } catch (error) {
      logger.error('Failed to generate QR code', {
        error: error instanceof Error ? error.message : 'Unknown error',
        walletAddress
      });
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Generate deposit instructions for address-based system
   */
  generateDepositInstructions(
    amount: number,
    address: string,
    expirationHours: number = 3
  ): string[] {
    return [
      `Send exactly ${amount} USDT (TRC-20) to the address above`,
      `This address is unique to your deposit - no memo required`,
      `Works with any TRON wallet including TronLink, Trust Wallet, etc.`,
      `Address expires in ${expirationHours} hours if unused`,
      `Ensure you have ~1 TRX for network fees`,
      `Deposits are processed automatically within 5-10 minutes`,
      `Do not send other tokens to this address`
    ];
  }

  /**
   * Validate TRON address format
   */
  isValidTronAddress(address: string): boolean {
    // TRON addresses start with 'T' and are 34 characters long
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  }
}

// Export singleton instance
export const referenceService = new ReferenceService();