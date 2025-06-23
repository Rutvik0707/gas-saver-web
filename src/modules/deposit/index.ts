import { DepositRepository } from './deposit.repository';
import { DepositService } from './deposit.service';
import { DepositController } from './deposit.controller';
import { createDepositRoutes } from './deposit.routes';

// Create module dependencies
const depositRepository = new DepositRepository();
const depositService = new DepositService(depositRepository);
const depositController = new DepositController(depositService);
const depositRoutes = createDepositRoutes(depositController);

export {
  depositRepository,
  depositService,
  depositController,
  depositRoutes,
};

export * from './deposit.types';