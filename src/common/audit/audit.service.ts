import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditRecord {
  actorId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  ip?: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async record(rec: AuditRecord): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: rec.actorId ?? null,
          action: rec.action,
          entity: rec.entity ?? null,
          entityId: rec.entityId ?? null,
          ip: rec.ip ?? null,
          metadata: rec.metadata,
        },
      });
    } catch (e) {
      this.logger.error(`Audit yazılamadı: ${rec.action}`, e as Error);
    }
  }
}
