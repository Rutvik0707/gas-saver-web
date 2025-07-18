import { Request, Response } from 'express';
import { pricingService } from '../../services/pricing.service';
import { logger } from '../../config';
import { 
  CalculateTransactionCostInput,
  CalculateUSDTTransferCostInput,
  CalculateEnergyPackageInput,
  TransactionUSDTCostInput
} from './pricing.types';

export class PricingController {
  /**
   * Calculate USDT value for a given number of transactions
   */
  async calculateTransactionCost(req: Request<{}, {}, CalculateTransactionCostInput>, res: Response) {
    try {
      const { numberOfTransactions, usdtAmountPerTransaction } = req.body;

      // If no USDT amount is provided, calculate the value based on live rates
      if (!usdtAmountPerTransaction) {
        const valueResult = await pricingService.calculateTransactionValue(numberOfTransactions);
        
        return res.json({
          success: true,
          data: {
            numberOfTransactions: valueResult.numberOfTransactions,
            energyPerTransaction: valueResult.energyPerTransaction,
            totalEnergyRequired: valueResult.totalEnergyRequired,
            energyCostInTRX: valueResult.energyCostInTRX,
            energyCostInUSDT: valueResult.totalUSDTValue,
            totalUSDTValue: valueResult.totalUSDTValue,
            pricePerTransaction: valueResult.pricePerTransaction,
            currentTRXPrice: valueResult.currentTRXPrice,
            currentUSDTPrice: valueResult.currentUSDTPrice,
            timestamp: valueResult.timestamp,
          },
        });
      }

      // Otherwise, calculate cost for specific USDT amount per transaction
      const result = await pricingService.calculateTransactionCost(
        numberOfTransactions,
        usdtAmountPerTransaction
      );

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Failed to calculate transaction cost', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body,
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to calculate transaction cost',
      });
    }
  }

  /**
   * Calculate cost for a specific USDT transfer amount
   */
  async calculateUSDTTransferCost(req: Request<{}, {}, CalculateUSDTTransferCostInput>, res: Response) {
    try {
      const { usdtAmount } = req.body;

      const result = await pricingService.calculateUSDTTransferCost(usdtAmount);

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Failed to calculate USDT transfer cost', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body,
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to calculate USDT transfer cost',
      });
    }
  }

  /**
   * Calculate energy package pricing
   */
  async calculateEnergyPackage(req: Request<{}, {}, CalculateEnergyPackageInput>, res: Response) {
    try {
      const { energyAmount } = req.body;

      const result = await pricingService.calculateEnergyPackagePrice(energyAmount);

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Failed to calculate energy package price', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body,
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to calculate energy package price',
      });
    }
  }

  /**
   * Get current market prices
   */
  async getCurrentPrices(req: Request, res: Response) {
    try {
      const prices = await pricingService.getCurrentPrices();

      return res.json({
        success: true,
        data: prices,
      });
    } catch (error) {
      logger.error('Failed to get current prices', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to get current prices',
      });
    }
  }

  /**
   * Refresh price cache
   */
  async refreshPrices(req: Request, res: Response) {
    try {
      await pricingService.refreshPrices();

      return res.json({
        success: true,
        message: 'Price cache refreshed successfully',
      });
    } catch (error) {
      logger.error('Failed to refresh prices', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to refresh prices',
      });
    }
  }

  /**
   * Calculate USDT cost for transactions - Clean API for UI integration
   * 
   * This endpoint is designed to match the UI requirement where users
   * input number of transactions and get back the USDT cost.
   * 
   * WORKFLOW:
   * 1. Accepts number of transactions (e.g., 50)
   * 2. Calculates cost using live market rates
   * 3. Returns rounded USDT amount (e.g., 56)
   * 
   * The calculation uses:
   * - Live USDT/TRX rates from Binance
   * - Current energy costs on TRON network
   * - Service markup configuration
   * - Rounds up to nearest whole number
   * 
   * Example: 50 transactions → 56 USDT (if live calculation is 55.23)
   */
  async getTransactionUSDTCost(req: Request<{}, {}, TransactionUSDTCostInput>, res: Response) {
    try {
      const { numberOfTransactions } = req.body;

      // Log the incoming request for monitoring
      logger.info('Transaction USDT cost request', { numberOfTransactions });

      // Call the service method that handles all the calculation logic
      const result = await pricingService.getTransactionUSDTCost(numberOfTransactions);

      // Return clean response matching UI requirements
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Failed to get transaction USDT cost', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body,
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to calculate transaction cost',
      });
    }
  }
}

export const pricingController = new PricingController();