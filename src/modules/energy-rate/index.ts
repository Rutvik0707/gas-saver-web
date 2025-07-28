export * from './energy-rate.types';
export * from './energy-rate.repository';
export * from './energy-rate.service';
export * from './energy-rate.controller';
export { default as energyRateRoutes } from './energy-rate.routes';

// Export singleton instance
import { EnergyRateRepository } from './energy-rate.repository';
import { EnergyRateService } from './energy-rate.service';

const energyRateRepository = new EnergyRateRepository();
export const energyRateService = new EnergyRateService(energyRateRepository);