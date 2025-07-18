import { Router } from 'express';
import { validationController } from './validation.controller';
import { validateBody } from '../../middleware';
import { 
  validateAddressSchema,
  validateMultipleAddressesSchema,
  isContractSchema
} from './validation.types';

export const validationRoutes = Router();

/**
 * @swagger
 * /validation/address:
 *   post:
 *     summary: Validate a TRON address
 *     description: |
 *       Validates a TRON address with comprehensive checks including:
 *       - Basic format validation (starts with T, 34 characters, valid base58)
 *       - Network compatibility check (mainnet vs testnet based on current mode)
 *       - Optional on-chain existence verification with balance information
 *       
 *       **Network Detection:**
 *       - In livecoins mode: Validates against mainnet patterns
 *       - In devcoins mode: Validates against testnet (Shasta) patterns
 *       - Warns if address belongs to wrong network for current mode
 *     tags: [Validation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - address
 *             properties:
 *               address:
 *                 type: string
 *                 description: TRON address to validate
 *                 example: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
 *               checkOnChain:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to check if address exists on blockchain with balance info
 *                 example: true
 *     responses:
 *       200:
 *         description: Address validation result
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
 *                     address:
 *                       type: string
 *                       example: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
 *                     isValid:
 *                       type: boolean
 *                       description: Whether the address format is valid
 *                       example: true
 *                     network:
 *                       type: string
 *                       enum: [mainnet, testnet]
 *                       description: Current network mode
 *                       example: "mainnet"
 *                     networkMatch:
 *                       type: boolean
 *                       description: Whether address matches current network
 *                       example: true
 *                     networkWarning:
 *                       type: string
 *                       description: Warning if address belongs to wrong network
 *                       example: "This appears to be a testnet address. Please use a mainnet address for live transactions."
 *                     exists:
 *                       type: boolean
 *                       description: Whether address exists on blockchain (only if checkOnChain=true)
 *                       example: true
 *                     balance:
 *                       type: object
 *                       description: Balance information (only if checkOnChain=true and exists=true)
 *                       properties:
 *                         TRX:
 *                           type: string
 *                           example: "100.5"
 *                         USDT:
 *                           type: string
 *                           example: "1500.750000"
 *                     error:
 *                       type: string
 *                       description: Error message if validation failed
 *                       example: "Invalid TRON address format"
 *             examples:
 *               validMainnet:
 *                 summary: Valid mainnet address
 *                 value:
 *                   success: true
 *                   data:
 *                     address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
 *                     isValid: true
 *                     network: "mainnet"
 *                     networkMatch: true
 *               invalidFormat:
 *                 summary: Invalid address format
 *                 value:
 *                   success: true
 *                   data:
 *                     address: "invalid-address"
 *                     isValid: false
 *                     network: "mainnet"
 *                     networkMatch: false
 *                     error: "Invalid TRON address format. Must start with T and be 34 characters."
 *               networkMismatch:
 *                 summary: Network mismatch warning
 *                 value:
 *                   success: true
 *                   data:
 *                     address: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs"
 *                     isValid: true
 *                     network: "mainnet"
 *                     networkMatch: false
 *                     networkWarning: "This appears to be a testnet address. Please use a mainnet address for live transactions."
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
validationRoutes.post(
  '/address',
  validateBody(validateAddressSchema.shape.body),
  validationController.validateAddress
);

/**
 * @swagger
 * /validation/addresses:
 *   post:
 *     summary: Validate multiple TRON addresses
 *     description: |
 *       Batch validate multiple TRON addresses with the same comprehensive checks as single validation.
 *       Useful for validating recipient lists or bulk operations.
 *       
 *       **Limits:**
 *       - Maximum 100 addresses per request
 *       - Returns summary statistics along with individual results
 *     tags: [Validation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *                 maxItems: 100
 *                 description: Array of TRON addresses to validate
 *                 example: ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs"]
 *               checkOnChain:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to check if addresses exist on blockchain
 *                 example: false
 *     responses:
 *       200:
 *         description: Batch validation results
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
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           address:
 *                             type: string
 *                           isValid:
 *                             type: boolean
 *                           network:
 *                             type: string
 *                           networkMatch:
 *                             type: boolean
 *                           networkWarning:
 *                             type: string
 *                           exists:
 *                             type: boolean
 *                           balance:
 *                             type: object
 *                             properties:
 *                               TRX:
 *                                 type: string
 *                               USDT:
 *                                 type: string
 *                           error:
 *                             type: string
 *                     summary:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                           description: Total addresses validated
 *                           example: 2
 *                         valid:
 *                           type: integer
 *                           description: Number of valid addresses
 *                           example: 1
 *                         invalid:
 *                           type: integer
 *                           description: Number of invalid addresses
 *                           example: 1
 *                         networkMismatches:
 *                           type: integer
 *                           description: Number of addresses with network mismatches
 *                           example: 0
 *                         existsOnChain:
 *                           type: integer
 *                           description: Number of addresses that exist on chain (if checked)
 *                           example: 1
 *             examples:
 *               mixedResults:
 *                 summary: Mixed validation results
 *                 value:
 *                   success: true
 *                   data:
 *                     results:
 *                       - address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
 *                         isValid: true
 *                         network: "mainnet"
 *                         networkMatch: true
 *                       - address: "invalid-address"
 *                         isValid: false
 *                         network: "mainnet"
 *                         networkMatch: false
 *                         error: "Invalid TRON address format"
 *                     summary:
 *                       total: 2
 *                       valid: 1
 *                       invalid: 1
 *                       networkMismatches: 0
 *                       existsOnChain: 0
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
validationRoutes.post(
  '/addresses',
  validateBody(validateMultipleAddressesSchema.shape.body),
  validationController.validateMultipleAddresses
);

/**
 * @swagger
 * /validation/is-contract:
 *   post:
 *     summary: Check if address is a smart contract
 *     description: |
 *       Checks whether a TRON address is a smart contract or a regular wallet address.
 *       This is useful for determining if an address can receive certain types of transactions.
 *     tags: [Validation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - address
 *             properties:
 *               address:
 *                 type: string
 *                 description: TRON address to check
 *                 example: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
 *     responses:
 *       200:
 *         description: Contract check result
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
 *                     address:
 *                       type: string
 *                       example: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
 *                     isContract:
 *                       type: boolean
 *                       description: Whether the address is a smart contract
 *                       example: true
 *             examples:
 *               contract:
 *                 summary: Smart contract address
 *                 value:
 *                   success: true
 *                   data:
 *                     address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
 *                     isContract: true
 *               wallet:
 *                 summary: Regular wallet address
 *                 value:
 *                   success: true
 *                   data:
 *                     address: "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9"
 *                     isContract: false
 *       400:
 *         description: Invalid address format
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
 *                   example: "Invalid address format"
 *                 data:
 *                   type: object
 *                   properties:
 *                     address:
 *                       type: string
 *                     isContract:
 *                       type: boolean
 *                     error:
 *                       type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
validationRoutes.post(
  '/is-contract',
  validateBody(isContractSchema.shape.body),
  validationController.isContract
);