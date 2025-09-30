/**
 * Audit Type Definitions
 *
 * Types and interfaces for energy delegation auditing and transaction pattern analysis
 */

export enum TransactionCategory {
  USDT_TRANSFER = 'USDT_TRANSFER',
  ENERGY_DELEGATE = 'ENERGY_DELEGATE',
  ENERGY_RECLAIM = 'ENERGY_RECLAIM',
  TRX_TRANSFER = 'TRX_TRANSFER',
  OTHER = 'OTHER'
}

export enum TransactionPattern {
  VALID_CYCLE = 'VALID_CYCLE',              // USDT Transfer → Reclaim → Delegate
  SYSTEM_ISSUE = 'SYSTEM_ISSUE',            // Reclaim → Delegate (no USDT)
  FIRST_DELEGATION = 'FIRST_DELEGATION',     // Initial delegate only
  STANDALONE_USDT = 'STANDALONE_USDT',       // USDT transfer without energy ops
  UNKNOWN = 'UNKNOWN'
}

export interface TronScanTransaction {
  hash: string;
  block_timestamp: number;
  block: number;
  from?: string;
  to?: string;
  ownerAddress?: string;
  toAddress?: string;
  value?: string;
  confirmed: boolean;
  contractType: number;
  contractData?: {
    owner_address?: string;
    contract_address?: string;
    data?: string;
    amount?: number;
    resource?: string;
    receiver_address?: string;
    balance?: number;
  };
  tokenInfo?: {
    tokenId?: string;
    tokenAbbr?: string;
    tokenName?: string;
    tokenDecimal?: number;
    tokenCanShow?: number;
    tokenType?: string;
    tokenLogo?: string;
  };
  token_info?: {
    symbol: string;
    address: string;
    decimals: number;
    name: string;
  };
  result?: string;
  cost?: {
    net_fee?: number;
    energy_usage?: number;
    energy_fee?: number;
    energy_usage_total?: number;
    origin_energy_usage?: number;
    net_usage?: number;
  };
}

export interface CategorizedTransaction {
  hash: string;
  timestamp: number;
  category: TransactionCategory;
  from: string;
  to: string;
  amount?: string;
  amountTrx?: number;
  amountSun?: number;
  energyAmount?: number;
  contractAddress?: string;
  resource?: string;
  confirmed: boolean;
  metadata: Record<string, any>;
}

export interface TransactionPatternAnalysis {
  pattern: TransactionPattern;
  transactions: CategorizedTransaction[];
  shouldDecreaseCount: boolean;
  decreaseAmount: number;  // 0, 1, or 2
  reasoning: string;
  timestamp: number;
  cycleId: string;
}

export interface AddressAuditReport {
  address: string;
  totalPurchased: number;
  totalActualTransfers: number;
  currentDbValue: number;
  correctValue: number;
  discrepancy: number;
  patterns: TransactionPatternAnalysis[];
  validCycles: number;
  systemIssueCycles: number;
  recommendations: string[];
  allTransactions: CategorizedTransaction[];
}

export interface LedgerCorrectionPlan {
  address: string;
  userId: string;
  currentTransactionsRemaining: number;
  correctTransactionsRemaining: number;
  difference: number;
  totalPurchased: number;
  actualUsdtTransfers: number;
  validCycles: number;
  systemIssueCycles: number;
  deliveryUpdates: Array<{
    deliveryId: string;
    currentDelivered: number;
    newDelivered: number;
    totalTransactions: number;
  }>;
  auditLog: {
    fixApplied: boolean;
    fixAppliedAt: string;
    fixReason: string;
    oldValue: number;
    newValue: number;
    analysisReport: AddressAuditReport;
  };
}

export interface DelegationCycleAudit {
  cycleId: string;
  tronAddress: string;
  userId?: string;
  startTime: Date;
  endTime?: Date;

  // Reclaim phase
  reclaimTxHash?: string;
  energyBeforeReclaim?: number;
  energyAfterReclaim?: number;
  reclaimedSun?: number;
  reclaimedTrx?: number;
  reclaimedEnergy?: number;

  // Delegate phase
  delegateTxHash?: string;
  energyBeforeDelegate?: number;
  energyAfterDelegate?: number;
  delegatedSun?: number;
  delegatedTrx?: number;
  delegatedEnergy?: number;

  // Transaction impact
  pendingTransactionsBefore: number;
  pendingTransactionsAfter: number;
  transactionDecrease: number;

  // USDT transaction linkage
  relatedUsdtTxHash?: string;
  hasActualTransaction: boolean;

  // Pattern classification
  pattern: TransactionPattern;
  isSystemIssue: boolean;
  issueType?: string;

  // Metadata
  metadata?: Record<string, any>;
}

export interface EnergyDelegationAuditEntry {
  id: string;
  tronAddress: string;
  userId?: string;
  cycleId: string;
  operationType: 'RECLAIM' | 'DELEGATE';
  txHash?: string;
  timestamp: Date;
  energyBefore?: number;
  energyAfter?: number;
  energyDelta?: number;
  reclaimedSun?: bigint;
  reclaimedTrx?: number;
  reclaimedEnergy?: number;
  delegatedSun?: bigint;
  delegatedTrx?: number;
  delegatedEnergy?: number;
  pendingTransactionsBefore: number;
  pendingTransactionsAfter: number;
  transactionDecrease: number;
  relatedUsdtTxHash?: string;
  hasActualTransaction: boolean;
  isSystemIssue: boolean;
  issueType?: string;
  metadata?: any;
  createdAt: Date;
}

export interface BatchAuditResult {
  totalAddresses: number;
  analyzedAddresses: number;
  addressesWithIssues: number;
  addressesCorrect: number;
  totalDiscrepancy: number;
  reports: AddressAuditReport[];
  correctionPlans: LedgerCorrectionPlan[];
  summary: {
    totalPurchased: number;
    totalActualTransfers: number;
    totalValidCycles: number;
    totalSystemIssueCycles: number;
    estimatedFixTime: string;
  };
}

export interface AuditQueryFilters {
  tronAddress?: string;
  userId?: string;
  cycleId?: string;
  operationType?: 'RECLAIM' | 'DELEGATE';
  isSystemIssue?: boolean;
  hasActualTransaction?: boolean;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  limit?: number;
}