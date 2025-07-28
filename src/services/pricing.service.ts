import axios from 'axios';
import { logger, config } from '../config';
import { energyService } from './energy.service';
import { energyRateService } from '../modules/energy-rate';

interface PriceData {
  usdtPrice: number;
  trxPrice: number;
  energyPriceSun: number; // SUN per energy unit (dynamic market price)
  timestamp: Date;
}

interface TransactionCostResult {
  numberOfTransactions: number;
  energyPerTransaction: number;
  totalEnergyRequired: number;
  energyCostInTRX: number;
  energyCostInUSDT: number;
  gasFeeSavings: number;
  timestamp: Date;
}

export class PricingService {
  private cache: PriceData | null = null;
  private readonly CACHE_TTL_MS = config.pricing.cacheTtlMs;
  private readonly BINANCE_API_URL = 'https://api.binance.com/api/v3/ticker/price';
  private readonly FALLBACK_USDT_PRICE = config.pricing.fallbackUsdtPrice;
  private readonly FALLBACK_TRX_PRICE = config.pricing.fallbackTrxPrice;
  private readonly SERVICE_DISCOUNT = config.pricing.serviceDiscountPercentage / 100;

  /**
   * Calculate live energy price based on market conditions
   * 
   * CALCULATION LOGIC:
   * - Based on user feedback: 65,000 energy ≈ 4 TRX
   * - This means: 1 energy ≈ 61.5 SUN
   * - We'll use a dynamic calculation based on TRX price and market conditions
   * 
   * In production, this could fetch from:
   * - TRON resource marketplace APIs
   * - Energy trading platforms
   * - Calculate from staking rewards and energy generation rates
   */
  private async calculateLiveEnergyPrice(trxPrice: number): Promise<number> {
    try {
      // Based on tr.energy pricing:
      // 20 transactions = 1,303,000 energy = 84.7 TRX
      // 1,303,000 energy = 84,700,000 SUN
      // Therefore: 1 energy = 84,700,000 / 1,303,000 = 65 SUN
      
      // Using fixed 65 SUN per energy to match tr.energy
      const baseEnergyPriceSun = 65;
      
      // Small market adjustment based on TRX price
      // If TRX > $0.30, slight premium; if < $0.30, slight discount
      const marketAdjustment = 1 + ((trxPrice - 0.30) * 0.05); // Reduced adjustment factor
      const adjustedEnergyPrice = baseEnergyPriceSun * Math.max(0.95, Math.min(1.05, marketAdjustment));
      
      return Math.round(adjustedEnergyPrice);
    } catch (error) {
      logger.error('Failed to calculate live energy price', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Fallback to reasonable default
      return 62; // ~4 TRX per 65,000 energy
    }
  }

  /**
   * Get live prices from Binance API
   * @returns Price data for USDT and TRX
   */
  private async fetchLivePrices(): Promise<PriceData> {
    try {
      // Fetch both USDT/USD and TRX/USDT prices from Binance
      const [usdtResponse, trxResponse] = await Promise.all([
        axios.get(`${this.BINANCE_API_URL}?symbol=USDTUSDC`).catch(() => null),
        axios.get(`${this.BINANCE_API_URL}?symbol=TRXUSDT`)
      ]);

      // USDT is typically pegged to 1 USD, but we check USDT/USDC for accuracy
      const usdtPrice = usdtResponse?.data?.price ? parseFloat(usdtResponse.data.price) : this.FALLBACK_USDT_PRICE;
      const trxPriceInUsdt = parseFloat(trxResponse.data.price);
      const trxPrice = trxPriceInUsdt * usdtPrice;

      // Calculate live energy price based on TRX market price
      const energyPriceSun = await this.calculateLiveEnergyPrice(trxPrice);

      const priceData: PriceData = {
        usdtPrice,
        trxPrice,
        energyPriceSun,
        timestamp: new Date()
      };

      logger.info('Fetched live prices', {
        usdtPrice: priceData.usdtPrice,
        trxPrice: priceData.trxPrice,
        energyPriceSun: priceData.energyPriceSun,
        source: 'Binance API + Dynamic Energy Calculation'
      });

      return priceData;
    } catch (error) {
      logger.error('Failed to fetch live prices, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        usdtPrice: this.FALLBACK_USDT_PRICE,
        trxPrice: this.FALLBACK_TRX_PRICE,
        energyPriceSun: 62, // Fallback: ~4 TRX per 65,000 energy
        timestamp: new Date()
      };
    }
  }

  /**
   * Get cached or fresh price data
   * @returns Current price data
   */
  private async getPrices(): Promise<PriceData> {
    // Check if cache is valid
    if (this.cache && (Date.now() - this.cache.timestamp.getTime()) < this.CACHE_TTL_MS) {
      return this.cache;
    }

    // Fetch fresh prices and update cache
    this.cache = await this.fetchLivePrices();
    return this.cache;
  }

  /**
   * Calculate USDT value for a given number of transactions
   * @param numberOfTransactions Number of USDT transactions
   * @param usdtAmountPerTx Optional USDT amount per transaction (default: 100 USDT)
   * @returns Cost breakdown for the transactions
   */
  async calculateTransactionCost(
    numberOfTransactions: number,
    usdtAmountPerTx: number = 100
  ): Promise<TransactionCostResult> {
    try {
      // Get current prices
      const prices = await this.getPrices();

      // Calculate energy requirement per transaction
      const energyPerTransaction = energyService.calculateRequiredEnergy(usdtAmountPerTx);

      // Calculate total energy needed
      const totalEnergyRequired = energyPerTransaction * numberOfTransactions;

      // Convert energy to TRX cost using live energy price
      const sunAmount = totalEnergyRequired * prices.energyPriceSun;
      const energyCostInTRX = sunAmount / 1_000_000; // Convert SUN to TRX

      // Convert TRX cost to USDT
      const energyCostInUSDT = energyCostInTRX * prices.trxPrice / prices.usdtPrice;

      // Calculate gas fee savings (compared to direct TRX payment)
      // Users save through our service discount
      const gasFeeSavings = energyCostInUSDT * this.SERVICE_DISCOUNT;

      const result: TransactionCostResult = {
        numberOfTransactions,
        energyPerTransaction,
        totalEnergyRequired,
        energyCostInTRX,
        energyCostInUSDT,
        gasFeeSavings,
        timestamp: prices.timestamp
      };

      logger.info('Calculated transaction cost', {
        numberOfTransactions,
        usdtAmountPerTx,
        result
      });

      return result;
    } catch (error) {
      logger.error('Failed to calculate transaction cost', {
        error: error instanceof Error ? error.message : 'Unknown error',
        numberOfTransactions,
        usdtAmountPerTx
      });

      throw error;
    }
  }

  /**
   * Calculate cost for a specific USDT amount
   * @param usdtAmount Total USDT amount to transfer
   * @returns Energy cost in USDT
   */
  async calculateUSDTTransferCost(usdtAmount: number): Promise<{
    usdtAmount: number;
    requiredEnergy: number;
    costInTRX: number;
    costInUSDT: number;
    pricePerThousandEnergy: number;
    timestamp: Date;
  }> {
    try {
      const prices = await this.getPrices();

      // Calculate required energy
      const requiredEnergy = energyService.calculateRequiredEnergy(usdtAmount);

      // Convert to TRX
      const costInTRX = energyService.convertEnergyToTRX(requiredEnergy);

      // Convert to USDT
      const costInUSDT = costInTRX * prices.trxPrice / prices.usdtPrice;

      // Calculate price per 1000 energy in USDT
      const pricePerThousandEnergy = (costInUSDT / requiredEnergy) * 1000;

      return {
        usdtAmount,
        requiredEnergy,
        costInTRX,
        costInUSDT,
        pricePerThousandEnergy,
        timestamp: prices.timestamp
      };
    } catch (error) {
      logger.error('Failed to calculate USDT transfer cost', {
        error: error instanceof Error ? error.message : 'Unknown error',
        usdtAmount
      });

      throw error;
    }
  }

  /**
   * Get current market prices
   * @returns Current USDT and TRX prices
   */
  async getCurrentPrices(): Promise<PriceData> {
    return this.getPrices();
  }

  /**
   * Calculate energy package pricing
   * @param energyAmount Amount of energy to purchase
   * @returns Pricing details
   */
  async calculateEnergyPackagePrice(energyAmount: number): Promise<{
    energyAmount: number;
    priceInTRX: number;
    priceInUSDT: number;
    priceInUSD: number;
    savingsPercentage: number;
    timestamp: Date;
  }> {
    try {
      const prices = await this.getPrices();

      // Convert energy to TRX
      const priceInTRX = energyService.convertEnergyToTRX(energyAmount);

      // Convert to USDT
      const priceInUSDT = priceInTRX * prices.trxPrice / prices.usdtPrice;

      // Convert to USD
      const priceInUSD = priceInUSDT * prices.usdtPrice;

      // Calculate savings percentage from configuration
      const savingsPercentage = config.pricing.serviceDiscountPercentage;

      return {
        energyAmount,
        priceInTRX,
        priceInUSDT,
        priceInUSD,
        savingsPercentage,
        timestamp: prices.timestamp
      };
    } catch (error) {
      logger.error('Failed to calculate energy package price', {
        error: error instanceof Error ? error.message : 'Unknown error',
        energyAmount
      });

      throw error;
    }
  }

  /**
   * Calculate the USDT value required for a given number of transactions
   * This method calculates how much USDT is needed based on current energy costs
   * @param numberOfTransactions Number of transactions to calculate for
   * @returns USDT value and breakdown
   */
  async calculateTransactionValue(numberOfTransactions: number): Promise<{
    numberOfTransactions: number;
    energyPerTransaction: number;
    totalEnergyRequired: number;
    energyCostInTRX: number;
    totalUSDTValue: number;
    pricePerTransaction: number;
    currentTRXPrice: number;
    currentUSDTPrice: number;
    timestamp: Date;
  }> {
    try {
      // Get current prices
      const prices = await this.getPrices();

      // Get current rate from database
      const currentRate = await energyRateService.getCurrentRate();
      
      // Base energy required for a USDT transaction
      const baseEnergy = currentRate.energyPerTransaction;
      
      // Calculate average energy per transaction (with buffer)
      const energyPerTransaction = Math.floor(baseEnergy * (1 + currentRate.bufferPercentage / 100));

      // Total energy needed
      const totalEnergyRequired = energyPerTransaction * numberOfTransactions;

      // Convert energy to TRX cost using live energy price
      const sunAmount = totalEnergyRequired * prices.energyPriceSun;
      const energyCostInTRX = sunAmount / 1_000_000; // Convert SUN to TRX

      // Convert TRX cost to USDT (this is the cost of energy in USDT)
      const energyCostInUSDT = energyCostInTRX * prices.trxPrice / prices.usdtPrice;

      // Apply service markup to the energy cost
      // Add 15% markup to cover service costs (multiply by 1.15)
      const serviceMarkup = 1 + (this.SERVICE_DISCOUNT || 0.15);
      const totalUSDTValue = energyCostInUSDT * serviceMarkup;

      // Price per transaction
      const pricePerTransaction = totalUSDTValue / numberOfTransactions;

      logger.info('Calculated transaction value', {
        numberOfTransactions,
        totalUSDTValue,
        energyCostInUSDT,
        pricePerTransaction
      });

      return {
        numberOfTransactions,
        energyPerTransaction,
        totalEnergyRequired,
        energyCostInTRX,
        totalUSDTValue,
        pricePerTransaction,
        currentTRXPrice: prices.trxPrice,
        currentUSDTPrice: prices.usdtPrice,
        timestamp: prices.timestamp
      };
    } catch (error) {
      logger.error('Failed to calculate transaction value', {
        error: error instanceof Error ? error.message : 'Unknown error',
        numberOfTransactions
      });

      throw error;
    }
  }

  /**
   * Calculate USDT cost for transactions based on live market rates
   * Returns a clean, rounded-up USDT amount for user-friendly pricing
   * 
   * WORKFLOW DOCUMENTATION:
   * 
   * 1. FETCH LIVE RATES:
   *    - Gets current USDT/USD price from Binance (typically ~$1.00)
   *    - Gets current TRX/USDT price from Binance (varies with market)
   *    - Rates are cached for 1 minute to reduce API calls
   * 
   * 2. CALCULATE ENERGY REQUIREMENTS:
   *    - Base energy per USDT transaction: 65,000 (exact amount)
   *    - No buffer added to match market pricing
   *    - Total energy = 65,000 × numberOfTransactions
   * 
   * 3. CONVERT ENERGY TO TRX:
   *    - Energy price: Dynamically calculated based on market (≈62 SUN per energy)
   *    - Based on: 65,000 energy ≈ 4 TRX market rate
   *    - TRX amount = (totalEnergy × energyPriceSun) / 1,000,000
   * 
   * 4. CONVERT TRX TO USDT:
   *    - Use live TRX/USD rate from step 1
   *    - USDT amount = TRX amount × (TRX price / USDT price)
   * 
   * 5. APPLY SERVICE MARKUP:
   *    - Service markup: 5% (competitive rate)
   *    - Final USDT = calculated USDT × 1.05
   *    - This represents the actual cost users pay including minimal service fee
   * 
   * 6. ROUND UP FOR USER-FRIENDLY PRICING:
   *    - Always round up to nearest whole number
   *    - Example: 55.23 USDT → 56 USDT
   *    - Ensures we never undercharge
   * 
   * EXAMPLE CALCULATION:
   * - Input: 50 transactions
   * - Energy: 50 × 65,000 = 3,250,000 energy
   * - Live energy price: 65 SUN per energy
   * - TRX cost: (3,250,000 × 65) / 1,000,000 = 211.25 TRX
   * - If TRX = $0.30, USDT value = 211.25 × 0.30 = $63.38
   * - With 5% markup: $63.38 × 1.05 = $66.55
   * - Final: Math.ceil(66.55) = 67 USDT
   * 
   * @param numberOfTransactions Number of USDT transactions to price
   * @returns Object with transactions count and rounded USDT cost
   */
  async getTransactionUSDTCost(numberOfTransactions: number): Promise<{
    numberOfTransactions: number;
    costInUSDT: number;
    timestamp: Date;
  }> {
    try {
      // Step 1: Get live market prices
      const prices = await this.getPrices();
      
      // Get current rate from database
      const currentRate = await energyRateService.getCurrentRate();
      
      // Step 2: Calculate energy requirements
      // Using exact energy without buffer to match tr.energy pricing
      const baseEnergy = currentRate.energyPerTransaction;
      const energyPerTransaction = baseEnergy; // No buffer for accurate pricing
      const totalEnergyRequired = energyPerTransaction * numberOfTransactions;
      
      // Step 3: Convert energy to TRX using live energy price
      // Instead of using static config price, use the live market price
      const sunAmount = totalEnergyRequired * prices.energyPriceSun;
      const energyCostInTRX = sunAmount / 1_000_000; // Convert SUN to TRX
      
      // Step 4: Convert TRX to USDT using live rates
      const energyCostInUSDT = energyCostInTRX * prices.trxPrice / prices.usdtPrice;
      
      // Step 5: Apply minimal service markup to stay competitive
      // Using 5% markup to match market rates (tr.energy likely uses minimal markup)
      const serviceMarkup = 1.05; // 5% markup
      const totalUSDTValue = energyCostInUSDT * serviceMarkup;
      
      // Step 6: Round up to nearest whole number for clean pricing
      const roundedCostInUSDT = Math.ceil(totalUSDTValue);
      
      logger.info('Calculated transaction USDT cost', {
        numberOfTransactions,
        rawUSDTValue: totalUSDTValue,
        roundedCostInUSDT,
        energyPerTransaction,
        totalEnergyRequired,
        trxPrice: prices.trxPrice,
        usdtPrice: prices.usdtPrice
      });
      
      return {
        numberOfTransactions,
        costInUSDT: roundedCostInUSDT,
        timestamp: prices.timestamp
      };
    } catch (error) {
      logger.error('Failed to calculate transaction USDT cost', {
        error: error instanceof Error ? error.message : 'Unknown error',
        numberOfTransactions
      });
      
      throw error;
    }
  }

  /**
   * Refresh price cache
   */
  async refreshPrices(): Promise<void> {
    this.cache = null;
    await this.getPrices();
  }
}

export const pricingService = new PricingService();