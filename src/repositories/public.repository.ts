import { prisma } from '../lib/prisma.js';

export class PublicRepository {
  async findEquipamentoRastreavel(codigoBarrasInterno: string) {
    return prisma.equipamento.findUnique({
      where: { codigoBarrasInterno },
      include: {
        lote: { select: { codigo: true, organizacaoId: true } },
        movimentacoes: {
          orderBy: { dataHora: 'asc' },
          select: { dataHora: true, statusAnterior: true, statusNovo: true, observacao: true },
        },
      },
    });
  }

  async listarLotes(organizacaoId: string, page: number, limit: number) {
    const where = { organizacaoId };
    const [total, data] = await Promise.all([
      prisma.lote.count({ where }),
      prisma.lote.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { dataRecebimento: 'desc' },
        include: { _count: { select: { equipamentos: true } } },
      }),
    ]);
    return { total, data };
  }

  async buscarLote(id: string) {
    return prisma.lote.findUnique({
      where: { id },
      include: {
        equipamentos: {
          orderBy: { codigoBarrasInterno: 'asc' },
          select: {
            codigoBarrasInterno: true,
            tipo: true,
            marca: true,
            modelo: true,
            condicaoFisica: true,
            anoFabricacao: true,
            status: true,
          },
        },
      },
    });
  }
}