import { Router } from 'express';
import { pricingController } from './pricing.controller';
import { validateBody } from '../../middleware';
import { 
  calculateTransactionCostSchema,
  calculateUSDTTransferCostSchema,
  calculateEnergyPackageSchema,
  transactionUSDTCostSchema
} from './pricing.types';

export const pricingRoutes = Router();

/**
 * @swagger
 * /pricing/transaction-cost:
 *   post:
 *     summary: Calculate USDT value for given number of transactions
 *     description: |
 *       Calculates the current USDT cost for performing a specified number of USDT transactions based on live market rates. 
 *       If usdtAmountPerTransaction is not provided, it calculates the total USDT value needed based on current energy costs.
 *       
 *       **Note:** This endpoint uses exact energy requirements (65,000 per transaction) with no buffer and competitive 5% markup.
 *     tags: [Pricing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - numberOfTransactions
 *             properties:
 *               numberOfTransactions:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 10000
 *                 description: Number of USDT transactions to calculate cost for
 *               usdtAmountPerTransaction:
 *                 type: number
 *                 minimum: 0.01
 *                 maximum: 1000000
 *                 description: Optional USDT amount per transaction. If not provided, calculates total USDT value based on live rates
 *     responses:
 *       200:
 *         description: Successfully calculated transaction cost
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     numberOfTransactions:
 *                       type: number
 *                     energyPerTransaction:
 *                       type: number
 *                     totalEnergyRequired:
 *                       type: number
 *                     energyCostInTRX:
 *                       type: number
 *                     energyCostInUSDT:
 *                       type: number
 *                     gasFeeSavings:
 *                       type: number
 *                     totalUSDTValue:
 *                       type: number
 *                       description: Total USDT value when only numberOfTransactions is provided
 *                     pricePerTransaction:
 *                       type: number
 *                       description: USDT price per transaction when calculated from live rates
 *                     currentTRXPrice:
 *                       type: number
 *                       description: Current TRX price in USD
 *                     currentUSDTPrice:
 *                       type: number
 *                       description: Current USDT price in USD
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 */
pricingRoutes.post(
  '/transaction-cost',
  validateBody(calculateTransactionCostSchema.shape.body),
  pricingController.calculateTransactionCost
);

/**
 * @swagger
 * /pricing/usdt-transfer-cost:
 *   post:
 *     summary: Calculate cost for a specific USDT transfer amount
 *     description: Calculates the energy cost in USDT for transferring a specific amount of USDT
 *     tags: [Pricing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - usdtAmount
 *             properties:
 *               usdtAmount:
 *                 type: number
 *                 minimum: 0.01
 *                 maximum: 10000000
 *                 description: USDT amount to transfer
 *     responses:
 *       200:
 *         description: Successfully calculated transfer cost
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     usdtAmount:
 *                       type: number
 *                     requiredEnergy:
 *                       type: number
 *                     costInTRX:
 *                       type: number
 *                     costInUSDT:
 *                       type: number
 *                     pricePerThousandEnergy:
 *                       type: number
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 */
pricingRoutes.post(
  '/usdt-transfer-cost',
  validateBody(calculateUSDTTransferCostSchema.shape.body),
  pricingController.calculateUSDTTransferCost
);

/**
 * @swagger
 * /pricing/energy-package:
 *   post:
 *     summary: Calculate pricing for energy package
 *     description: |
 *       Calculates the price in TRX, USDT, and USD for a specific amount of energy.
 *       Uses live market rates with ~65 SUN per energy unit and 5% service markup.
 *     tags: [Pricing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - energyAmount
 *             properties:
 *               energyAmount:
 *                 type: number
 *                 minimum: 1000
 *                 maximum: 10000000
 *                 description: Amount of energy to price
 *     responses:
 *       200:
 *         description: Successfully calculated energy package price
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     energyAmount:
 *                       type: number
 *                     priceInTRX:
 *                       type: number
 *                     priceInUSDT:
 *                       type: number
 *                     priceInUSD:
 *                       type: number
 *                     savingsPercentage:
 *                       type: number
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 */
pricingRoutes.post(
  '/energy-package',
  validateBody(calculateEnergyPackageSchema.shape.body),
  pricingController.calculateEnergyPackage
);

/**
 * @swagger
 * /pricing/current-prices:
 *   get:
 *     summary: Get current market prices
 *     description: |
 *       Returns the current USDT and TRX prices in USD.
 *       Also includes the current energy price in SUN per energy unit (dynamically calculated).
 *     tags: [Pricing]
 *     responses:
 *       200:
 *         description: Successfully retrieved current prices
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     usdtPrice:
 *                       type: number
 *                       description: USDT price in USD
 *                       example: 1.0
 *                     trxPrice:
 *                       type: number
 *                       description: TRX price in USD
 *                       example: 0.30
 *                     energyPriceSun:
 *                       type: number
 *                       description: Energy price in SUN per energy unit
 *                       example: 65
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 */
pricingRoutes.get('/current-prices', pricingController.getCurrentPrices);

/**
 * @swagger
 * /pricing/refresh:
 *   post:
 *     summary: Refresh price cache
 *     description: Forces a refresh of the cached price data from external APIs
 *     tags: [Pricing]
 *     responses:
 *       200:
 *         description: Price cache refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
pricingRoutes.post('/refresh', pricingController.refreshPrices);

/**
 * @swagger
 * /pricing/transaction-usdt-cost:
 *   post:
 *     summary: Get USDT cost for number of transactions
 *     description: |
 *       Calculate the USDT cost for a given number of transactions using live market rates.
 *       This endpoint is designed for UI integration where users select number of transactions
 *       and see the USDT cost (e.g., "50 transactions = 56 USDT").
 *       
 *       **Calculation Workflow:**
 *       1. Fetches live USDT/TRX rates from Binance API
 *       2. Calculates energy required (65,000 energy per transaction - no buffer)
 *       3. Converts energy to TRX cost (using live market rate ~65 SUN per energy)
 *       4. Converts TRX to USDT using live rates
 *       5. Applies minimal service markup (5% for competitive pricing)
 *       6. Rounds UP to nearest whole number
 *       
 *       **Example:** 50 transactions = 3,250,000 energy = 211.25 TRX ≈ $63.38 → returns 67 USDT
 *     tags: [Pricing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - numberOfTransactions
 *             properties:
 *               numberOfTransactions:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10000
 *                 description: Number of USDT transactions to calculate cost for
 *                 example: 50
 *     responses:
 *       200:
 *         description: Successfully calculated USDT cost
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     numberOfTransactions:
 *                       type: integer
 *                       description: Number of transactions requested
 *                       example: 50
 *                     costInUSDT:
 *                       type: integer
 *                       description: Total USDT cost (rounded up to nearest whole number)
 *                       example: 56
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                       description: Timestamp of the price calculation
 *                       example: "2025-07-18T18:15:00.000Z"
 *             examples:
 *               small:
 *                 summary: Small transaction count
 *                 value:
 *                   success: true
 *                   data:
 *                     numberOfTransactions: 10
 *                     costInUSDT: 14
 *                     timestamp: "2025-07-18T18:15:00.000Z"
 *               medium:
 *                 summary: Medium transaction count
 *                 value:
 *                   success: true
 *                   data:
 *                     numberOfTransactions: 50
 *                     costInUSDT: 67
 *                     timestamp: "2025-07-18T18:15:00.000Z"
 *               large:
 *                 summary: Large transaction count
 *                 value:
 *                   success: true
 *                   data:
 *                     numberOfTransactions: 500
 *                     costInUSDT: 665
 *                     timestamp: "2025-07-18T18:15:00.000Z"
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Validation error"
 *                 details:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       field:
 *                         type: string
 *                       message:
 *                         type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Failed to calculate transaction cost"
 */
pricingRoutes.post(
  '/transaction-usdt-cost',
  validateBody(transactionUSDTCostSchema.shape.body),
  pricingController.getTransactionUSDTCost
);