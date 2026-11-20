import { PublicRepository } from '../repositories/public.repository.js';
import { LoteService } from './lote.service.js';
import { AppError } from '../models/erros.js';

// Toda consulta recebe o organizacaoId da CHAVE (nunca do cliente) e responde 404
// quando o recurso pertence a outra organização, para não revelar que ele existe.
export class PublicService {
  constructor(
    private repo = new PublicRepository(),
    private loteService = new LoteService()
  ) {}

  async rastrear(organizacaoId: string, codigoBarras: string) {
    const eq = await this.repo.findEquipamentoRastreavel(codigoBarras);
    if (!eq || eq.lote.organizacaoId !== organizacaoId) {
      throw new AppError('Equipamento não encontrado.', 404);
    }

    return {
      codigoBarrasInterno: eq.codigoBarrasInterno,
      tipo: eq.tipo,
      marca: eq.marca,
      modelo: eq.modelo,
      condicaoFisica: eq.condicaoFisica,
      anoFabricacao: eq.anoFabricacao,
      status: eq.status,
      loteCodigo: eq.lote.codigo,
      movimentacoes: eq.movimentacoes,
    };
  }

  async listarLotes(organizacaoId: string, page: number, limit: number) {
    const { total, data } = await this.repo.listarLotes(organizacaoId, page, limit);
    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: data.map((l) => ({
        id: l.id,
        codigo: l.codigo,
        status: l.status,
        dataRecebimento: l.dataRecebimento,
        totalEquipamentos: l._count.equipamentos,
      })),
    };
  }

  async buscarLote(organizacaoId: string, id: string) {
    const lote = await this.repo.buscarLote(id);
    if (!lote || lote.organizacaoId !== organizacaoId) {
      throw new AppError('Lote não encontrado.', 404);
    }

    return {
      id: lote.id,
      codigo: lote.codigo,
      status: lote.status,
      dataRecebimento: lote.dataRecebimento,
      totalEquipamentos: lote.equipamentos.length,
      equipamentos: lote.equipamentos,
    };
  }

  async criarLote(
    organizacaoId: string,
    dados: {
      codigo: string;
      dataRecebimento?: Date;
      equipamentos: Array<{ codigoBarrasInterno: string; tipo: string }>;
    }
  ) {
    // Reaproveita a regra de negócio já existente (transação atômica e códigos únicos).
    const criado = await this.loteService.criar({
      codigo: dados.codigo,
      dataRecebimento: dados.dataRecebimento,
      organizacaoId,
      equipamentos: dados.equipamentos,
    });
    if (!criado) throw new AppError('Não foi possível registrar o lote.', 500);

    return this.buscarLote(organizacaoId, criado.id);
  }
}