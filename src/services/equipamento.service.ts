import { EquipamentoRepository } from '../repositories/equipamento.repository.js';
import { StatusEquipamento, StatusLote, CondicaoFisica } from '@prisma/client';
import { LoteRepository } from '../repositories/lote.repository.js';
import { AppError } from '../models/erros.js';

type DadosAvaliacao = {
  marca?: string;
  modelo?: string;
  condicaoFisica?: CondicaoFisica;
  anoFabricacao?: number;
  dataAvaliacao?: Date;
  valorRecuperacao?: number;
};

export class EquipamentoService {
  constructor(
    private repo = new EquipamentoRepository(),
    private loteRepo = new LoteRepository()
  ) { }

  // Se informaram uma condição avaliada sem data, registra agora.
  // A análise de vida útil depende dessa data.
  private normalizarAvaliacao<T extends DadosAvaliacao>(dados: T): T {
    const avaliado = dados.condicaoFisica && dados.condicaoFisica !== CondicaoFisica.NAO_AVALIADO;
    if (avaliado && !dados.dataAvaliacao) return { ...dados, dataAvaliacao: new Date() };
    return dados;
  }

  async criar(data: {
    codigoBarrasInterno: string;
    tipo: string;
    loteId: string;
  } & DadosAvaliacao) {
    const lote = await this.loteRepo.findById(data.loteId);
    if (!lote) throw new AppError('Lote especificado não encontrado.', 404);

    if (lote.status === StatusLote.CANCELADO) {
      throw new AppError('Não é possível adicionar equipamentos a um lote cancelado.', 422);
    }

    const existe = await this.repo.findByCodigoBarras(data.codigoBarrasInterno);
    if (existe) throw new AppError('Código de barras já cadastrado.', 409);

    const { codigoBarrasInterno, tipo, loteId, ...avaliacao } = data;

    return this.repo.create({
      codigoBarrasInterno,
      tipo,
      loteId,
      status: StatusEquipamento.RECEBIDO,
      ...this.normalizarAvaliacao(avaliacao),
    });
  }

  async buscarPorId(id: string) {
    const eq = await this.repo.findById(id);
    if (!eq) throw new AppError('Equipamento não encontrado.', 404);
    return eq;
  }

  async listarPaginado(params: { status?: StatusEquipamento; page?: number; limit?: number }) {
    return this.repo.findAll(params);
  }

  async atualizar(id: string, data: { tipo?: string } & DadosAvaliacao) {
    await this.buscarPorId(id);
    return this.repo.update(id, this.normalizarAvaliacao(data));
  }

  async remover(id: string) {
    const eq = await this.buscarPorId(id);

    if (eq.status !== StatusEquipamento.RECEBIDO || (eq.movimentacoes && eq.movimentacoes.length > 0)) {
      throw new AppError('Só é possível remover equipamentos com status RECEBIDO e sem movimentações registradas.', 409);
    }

    return this.repo.delete(id);
  }
}