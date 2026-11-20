import { Prisma, StatusRelatorioJob } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export class RelatorioJobRepository {
  async create(data: Prisma.RelatorioJobUncheckedCreateInput) {
    return prisma.relatorioJob.create({ data });
  }

  async findById(id: string) {
    return prisma.relatorioJob.findUnique({
      where: { id },
      include: { apiKey: { select: { organizacaoId: true } } },
    });
  }

  async marcarProcessando(id: string, tentativas: number) {
    return prisma.relatorioJob.update({
      where: { id },
      data: { status: StatusRelatorioJob.PROCESSANDO, tentativas, iniciadoEm: new Date(), erro: null },
    });
  }

  async marcarConcluido(id: string, resultado: string) {
    return prisma.relatorioJob.update({
      where: { id },
      data: { status: StatusRelatorioJob.CONCLUIDO, resultado, concluidoEm: new Date(), erro: null },
    });
  }

  // updateMany: não lança erro se o registro não existir, e nunca sobrescreve um job já concluído.
  async registrarFalha(id: string, status: 'PENDENTE' | 'FALHA', erro: string) {
    return prisma.relatorioJob.updateMany({
      where: { id, status: { not: StatusRelatorioJob.CONCLUIDO } },
      data: {
        status,
        erro,
        ...(status === StatusRelatorioJob.FALHA ? { concluidoEm: new Date() } : {}),
      },
    });
  }

  async marcarFalhaNoEnfileiramento(id: string, erro: string) {
    return prisma.relatorioJob.update({
      where: { id },
      data: { status: StatusRelatorioJob.FALHA, erro, concluidoEm: new Date() },
    });
  }
}