import { prisma } from '../../config';
import { User, Prisma } from '@prisma/client';
import { CreateUserDto, UpdateUserDto, UserWithRelations } from './user.types';

interface CreateUserData extends Omit<CreateUserDto, 'password'> {
  passwordHash: string;
  verificationToken?: string;
}

export class UserRepository {
  async create(userData: CreateUserData): Promise<User> {
    const { password, ...data } = userData as any;
    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        tronAddress: data.tronAddress,
        verificationToken: data.verificationToken,
        verificationTokenExpiry: data.verificationToken ? new Date(Date.now() + 24 * 60 * 60 * 1000) : undefined, // 24 hours from now
      },
    });
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  async findByTronAddress(tronAddress: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { tronAddress },
    });
  }
  
  async findByVerificationToken(token: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: { verificationToken: token },
    });
  }
  
  async setVerified(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { 
        isVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null
      },
    });
  }
  
  async createVerificationToken(id: string, token: string, expiryHours: number = 24): Promise<User> {
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + expiryHours);
    
    return prisma.user.update({
      where: { id },
      data: {
        verificationToken: token,
        verificationTokenExpiry: expiryDate
      },
    });
  }

  async findByIdWithRelations(id: string): Promise<UserWithRelations | null> {
    return prisma.user.findUnique({
      where: { id },
      include: {
        deposits: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  async update(id: string, userData: UpdateUserDto): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: userData,
    });
  }

  async updateCredits(id: string, credits: number): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { credits },
    });
  }

  async incrementCredits(id: string, amount: number): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        credits: {
          increment: amount,
        },
      },
    });
  }

  async findMany(options: {
    skip?: number;
    take?: number;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  } = {}): Promise<User[]> {
    return prisma.user.findMany(options);
  }

  async count(where?: Prisma.UserWhereInput): Promise<number> {
    return prisma.user.count({ where });
  }

  async delete(id: string): Promise<User> {
    return prisma.user.delete({
      where: { id },
    });
  }
}