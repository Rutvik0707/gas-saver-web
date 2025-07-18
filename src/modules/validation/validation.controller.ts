import { Request, Response } from 'express';
import { validationService } from '../../services/validation.service';
import { 
  ValidateAddressInput, 
  ValidateMultipleAddressesInput, 
  IsContractInput,
  BatchValidationResponse 
} from './validation.types';
import { logger } from '../../config';

export class ValidationController {
  /**
   * Validate a single TRON address
   * Checks format, network compatibility, and optionally on-chain existence
   */
  async validateAddress(
    req: Request<{}, {}, ValidateAddressInput>,
    res: Response
  ) {
    try {
      const { address, checkOnChain } = req.body;

      logger.info('Validating TRON address', { address, checkOnChain });

      const result = await validationService.validateTronAddress(address, checkOnChain);

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Address validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to validate address',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Validate multiple TRON addresses in batch
   * Useful for validating recipient lists
   */
  async validateMultipleAddresses(
    req: Request<{}, {}, ValidateMultipleAddressesInput>,
    res: Response
  ) {
    try {
      const { addresses, checkOnChain } = req.body;

      logger.info('Validating multiple TRON addresses', { 
        count: addresses.length, 
        checkOnChain 
      });

      const results = await validationService.validateMultipleAddresses(
        addresses, 
        checkOnChain
      );

      // Create summary
      const summary = {
        total: results.length,
        valid: results.filter(r => r.isValid).length,
        invalid: results.filter(r => !r.isValid).length,
        networkMismatches: results.filter(r => !r.networkMatch).length,
        existsOnChain: results.filter(r => r.exists === true).length,
      };

      const response: BatchValidationResponse = {
        results,
        summary,
      };

      return res.json({
        success: true,
        data: response,
      });
    } catch (error) {
      logger.error('Batch address validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to validate addresses',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Check if an address is a smart contract
   */
  async isContract(
    req: Request<{}, {}, IsContractInput>,
    res: Response
  ) {
    try {
      const { address } = req.body;

      logger.info('Checking if address is contract', { address });

      // First validate the address format
      const validation = await validationService.validateTronAddress(address, false);
      
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid address format',
          data: {
            address,
            isContract: false,
            error: validation.error,
          },
        });
      }

      const isContract = await validationService.isContract(address);

      return res.json({
        success: true,
        data: {
          address,
          isContract,
        },
      });
    } catch (error) {
      logger.error('Contract check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to check if address is contract',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

export const validationController = new ValidationController();