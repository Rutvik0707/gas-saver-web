import { prisma } from '../../config';
import { User, Prisma } from '@prisma/client';
import { CreateUserDto, UpdateUserDto, UserWithRelations } from './user.types';

export class UserRepository {
  async create(userData: CreateUserDto & { passwordHash: string }): Promise<User> {
    const { password, ...data } = userData as any;
    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        tronAddress: data.tronAddress,
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