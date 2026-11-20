import { CategoriaAnalise, OrigemAnalise, CondicaoFisica, Prisma, StatusEquipamento, StatusLote } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type EquipamentoHistorico = {
  id: string;
  loteId: string;
  loteRecebidoEm: Date;
  movimentacoes: Array<{
    dataHora: Date;
    statusAnterior: StatusEquipamento;
    statusNovo: StatusEquipamento;
    usuarioId: string;
  }>;
};

export type EquipamentoComValor = {
  tipo: string;
  marca: string | null;
  modelo: string | null;
  condicaoFisica: CondicaoFisica;
  valor: number;
};

export type EquipamentoVidaUtil = {
  id: string;
  codigoBarrasInterno: string;
  tipo: string;
  status: StatusEquipamento;
  condicaoFisica: CondicaoFisica;
  anoFabricacao: number;
  dataAvaliacao: Date | null;
  organizacaoId: string;
};

export type PrevisaoParaSalvar = {
  tipoEquipamento: string;
  amostras: number;
  inclinacao: number | null;
  intercepto: number | null;
  r2: number | null;
  vidaUtilEstimadaAnos: number | null;
  idadeInservivelObservadaAnos: number | null;
};

const filtroLote = (organizacaoId?: string): Prisma.LoteWhereInput => ({
  status: { not: StatusLote.CANCELADO },
  ...(organizacaoId ? { organizacaoId } : {}),
});

export class AnalyticsRepository {
  // ---------- Leitura para as análises ----------
  async equipamentosComHistorico(organizacaoId?: string): Promise<EquipamentoHistorico[]> {
    const equipamentos = await prisma.equipamento.findMany({
      where: { lote: filtroLote(organizacaoId) },
      select: {
        id: true,
        loteId: true,
        lote: { select: { dataRecebimento: true } },
        movimentacoes: {
          select: { dataHora: true, statusAnterior: true, statusNovo: true, usuarioId: true },
          orderBy: { dataHora: 'asc' },
        },
      },
    });

    return equipamentos.map((e) => ({
      id: e.id,
      loteId: e.loteId,
      loteRecebidoEm: e.lote.dataRecebimento,
      movimentacoes: e.movimentacoes,
    }));
  }

  async equipamentosComValor(organizacaoId?: string): Promise<EquipamentoComValor[]> {
    const itens = await prisma.equipamento.findMany({
      where: { valorRecuperacao: { not: null }, lote: filtroLote(organizacaoId) },
      select: { tipo: true, marca: true, modelo: true, condicaoFisica: true, valorRecuperacao: true },
    });

    return itens.map((i) => ({
      tipo: i.tipo,
      marca: i.marca,
      modelo: i.modelo,
      condicaoFisica: i.condicaoFisica,
      valor: Number(i.valorRecuperacao),
    }));
  }

  // Sempre global: o modelo de vida útil é treinado com todos os dados.
  async equipamentosComAnoFabricacao(): Promise<EquipamentoVidaUtil[]> {
    const itens = await prisma.equipamento.findMany({
      where: { anoFabricacao: { not: null }, lote: filtroLote() },
      select: {
        id: true,
        codigoBarrasInterno: true,
        tipo: true,
        status: true,
        condicaoFisica: true,
        anoFabricacao: true,
        dataAvaliacao: true,
        lote: { select: { organizacaoId: true } },
      },
    });

    return itens.map((i) => ({
      id: i.id,
      codigoBarrasInterno: i.codigoBarrasInterno,
      tipo: i.tipo,
      status: i.status,
      condicaoFisica: i.condicaoFisica,
      anoFabricacao: i.anoFabricacao as number,
      dataAvaliacao: i.dataAvaliacao,
      organizacaoId: i.lote.organizacaoId,
    }));
  }

  async nomesUsuarios(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const usuarios = await prisma.usuario.findMany({
      where: { id: { in: ids } },
      select: { id: true, nome: true },
    });
    return new Map(usuarios.map((u) => [u.id, u.nome]));
  }

  // ---------- Persistência e histórico ----------
  async salvarRelatorio(data: {
    categoria: CategoriaAnalise;
    origem: OrigemAnalise;
    resultado: unknown;
    previsoes?: PrevisaoParaSalvar[];
  }) {
    return prisma.relatorioAnalitico.create({
      data: {
        categoria: data.categoria,
        origem: data.origem,
        resultado: data.resultado as Prisma.InputJsonValue,
        ...(data.previsoes && data.previsoes.length > 0 ? { previsoes: { create: data.previsoes } } : {}),
      },
      select: { id: true, categoria: true, origem: true, geradoEm: true },
    });
  }

  async listarRelatorios(params: { categoria?: CategoriaAnalise; limit: number }) {
    return prisma.relatorioAnalitico.findMany({
      where: params.categoria ? { categoria: params.categoria } : {},
      orderBy: { geradoEm: 'desc' },
      take: params.limit,
      select: { id: true, categoria: true, origem: true, geradoEm: true },
    });
  }

  async buscarRelatorio(id: string) {
    return prisma.relatorioAnalitico.findUnique({
      where: { id },
      include: { previsoes: { orderBy: { tipoEquipamento: 'asc' } } },
    });
  }

  async listarPrevisoes(params: { tipo?: string; limit: number }) {
    return prisma.previsaoVidaUtil.findMany({
      where: params.tipo ? { tipoEquipamento: params.tipo } : {},
      orderBy: { createdAt: 'desc' },
      take: params.limit,
    });
  }
}