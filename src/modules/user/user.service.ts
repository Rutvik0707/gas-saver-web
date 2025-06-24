import jwt from 'jsonwebtoken';
import { config, logger } from '../../config';
import { cryptoUtils } from '../../shared/utils';
import {
  ValidationException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '../../shared/exceptions';
import { UserRepository } from './user.repository';
import {
  CreateUserDto,
  LoginUserDto,
  UpdateUserDto,
  UserResponse,
  LoginResponse,
  UserWithRelations,
} from './user.types';
import { tronUtils } from '../../config';

export class UserService {
  constructor(private userRepository: UserRepository) {}

  async createUser(userData: CreateUserDto): Promise<UserResponse> {
    const { email, password, tronAddress } = userData;

    // Validate TRON address format
    if (!tronUtils.isAddress(tronAddress)) {
      throw new ValidationException('Invalid TRON address format');
    }

    // Check if user already exists
    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Check if TRON address is already registered
    const existingTronUser = await this.userRepository.findByTronAddress(tronAddress);
    if (existingTronUser) {
      throw new ConflictException('TRON address is already registered');
    }

    // Hash password
    const passwordHash = await cryptoUtils.hashPassword(password);

    // Create user
    const newUser = await this.userRepository.create({
      email,
      password,
      tronAddress,
      passwordHash,
    });

    logger.info(`New user created: ${email}`, { userId: newUser.id });

    return this.formatUserResponse(newUser);
  }

  async loginUser(loginData: LoginUserDto): Promise<LoginResponse> {
    const { email, password } = loginData;

    // Find user by email
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('User account is deactivated');
    }

    // Verify password
    const isPasswordValid = await cryptoUtils.verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Generate JWT token
    const token = this.generateToken(user);

    logger.info(`User logged in: ${email}`, { userId: user.id });

    return {
      user: this.formatUserResponse(user),
      token,
      expiresIn: config.jwt.expiresIn,
    };
  }

  async getUserById(id: string): Promise<UserResponse> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User', id);
    }

    return this.formatUserResponse(user);
  }

  async getUserWithRelations(id: string): Promise<any> {
    const user = await this.userRepository.findByIdWithRelations(id);
    if (!user) {
      throw new NotFoundException('User', id);
    }

    return this.formatUserWithRelationsResponse(user);
  }

  async updateUser(id: string, updateData: UpdateUserDto): Promise<UserResponse> {
    // Check if user exists
    const existingUser = await this.userRepository.findById(id);
    if (!existingUser) {
      throw new NotFoundException('User', id);
    }

    // If updating email, check for conflicts
    if (updateData.email && updateData.email !== existingUser.email) {
      const emailExists = await this.userRepository.findByEmail(updateData.email);
      if (emailExists) {
        throw new ConflictException('Email is already in use');
      }
    }

    // If updating TRON address, validate and check for conflicts
    if (updateData.tronAddress && updateData.tronAddress !== existingUser.tronAddress) {
      if (!tronUtils.isAddress(updateData.tronAddress)) {
        throw new ValidationException('Invalid TRON address format');
      }

      const tronAddressExists = await this.userRepository.findByTronAddress(updateData.tronAddress);
      if (tronAddressExists) {
        throw new ConflictException('TRON address is already registered');
      }
    }

    const updatedUser = await this.userRepository.update(id, updateData);
    
    logger.info(`User updated: ${updatedUser.email}`, { userId: id });

    return this.formatUserResponse(updatedUser);
  }

  async updateUserCredits(userId: string, credits: number): Promise<UserResponse> {
    const updatedUser = await this.userRepository.updateCredits(userId, credits);
    
    logger.info(`User credits updated: ${updatedUser.email}`, { 
      userId, 
      newCredits: credits.toString() 
    });

    return this.formatUserResponse(updatedUser);
  }

  async incrementUserCredits(userId: string, amount: number): Promise<UserResponse> {
    const updatedUser = await this.userRepository.incrementCredits(userId, amount);
    
    logger.info(`User credits incremented: ${updatedUser.email}`, { 
      userId, 
      increment: amount.toString(),
      newCredits: updatedUser.credits.toString()
    });

    return this.formatUserResponse(updatedUser);
  }

  async verifyToken(token: string): Promise<{ id: string; email: string; tronAddress: string }> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      
      // Verify user still exists and is active
      const user = await this.userRepository.findById(decoded.userId);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid token');
      }

      return {
        id: user.id,
        email: user.email,
        tronAddress: user.tronAddress,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private generateToken(user: any): string {
    const payload = {
      userId: user.id,
      email: user.email,
      tronAddress: user.tronAddress,
    };

    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: '24h', // Use literal string to avoid type issues
    });
  }

  private formatUserResponse(user: any): UserResponse {
    return {
      id: user.id,
      email: user.email,
      tronAddress: user.tronAddress,
      credits: user.credits.toString(),
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private formatUserWithRelationsResponse(user: UserWithRelations): any {
    // Helper function to recursively convert problematic types
    const convertTypes = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return obj;
      }
      
      if (typeof obj === 'bigint') {
        return obj.toString();
      }
      
      // Handle Prisma Decimal type
      if (obj && typeof obj === 'object' && 'toString' in obj && obj.constructor.name === 'Decimal') {
        return obj.toString();
      }
      
      // Handle Date objects
      if (obj instanceof Date) {
        return obj.toISOString();
      }
      
      if (Array.isArray(obj)) {
        return obj.map(item => convertTypes(item));
      }
      
      if (typeof obj === 'object') {
        const converted: any = {};
        for (const [key, value] of Object.entries(obj)) {
          converted[key] = convertTypes(value);
        }
        return converted;
      }
      
      return obj;
    };

    return convertTypes({
      id: user.id,
      email: user.email,
      tronAddress: user.tronAddress,
      credits: user.credits.toString(),
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deposits: user.deposits || [],
      transactions: user.transactions || [],
    });
  }
}