import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find-or-create by Apple's stable `sub`. Email is only present on the first
   * Sign in with Apple (and may be a private-relay address); we keep the first
   * non-null we see and don't clobber it with later nulls.
   */
  async upsertByApple(appleSub: string, email?: string | null): Promise<User> {
    return this.prisma.user.upsert({
      where: { appleSub },
      create: { appleSub, email: email ?? null },
      update: email ? { email } : {},
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
