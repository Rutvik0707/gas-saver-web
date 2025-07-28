export { TronAddressService } from './tron-address.service';
export { TronAddressRepository } from './tron-address.repository';
export { TronAddressController } from './tron-address.controller';
export { default as tronAddressRoutes } from './tron-address.routes';
export * from './tron-address.types';

// Export singleton instance
import { TronAddressService } from './tron-address.service';
import { TronAddressRepository } from './tron-address.repository';

export const tronAddressService = new TronAddressService(new TronAddressRepository());