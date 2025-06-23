import { UserRepository } from './user.repository';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { createUserRoutes } from './user.routes';

// Create module dependencies
const userRepository = new UserRepository();
const userService = new UserService(userRepository);
const userController = new UserController(userService);
const userRoutes = createUserRoutes(userController);

export {
  userRepository,
  userService,
  userController,
  userRoutes,
};

export * from './user.types';