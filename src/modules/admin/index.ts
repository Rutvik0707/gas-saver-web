export * from './admin.types';
export * from './admin.repository';
export * from './admin.service';
export * from './admin.controller';
// Don't export routes to avoid circular dependency
// export * from './admin.routes';

import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';

// Create singleton instances
const adminRepository = new AdminRepository();
const adminService = new AdminService(adminRepository);

export { adminRepository, adminService };