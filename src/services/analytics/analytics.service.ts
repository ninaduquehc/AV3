import { CategoriaAnalise, OrigemAnalise } from '@prisma/client';
import { AnalyticsRepository, PrevisaoParaSalvar } from '../../repositories/analytics.repository.js';
import { AppError } from '../../models/erros.js';
import { EficienciaService } from './eficiencia.service.js';
import { RentabilidadeService } from './rentabilidade.service.js';
import { VidaUtilService } from './vida-util.service.js';

// Orquestrador: roda as análises independentes e persiste os resultados.
// Será chamado pelo endpoint manual agora e pelo job agendado na Fase 5.
export class AnalyticsService {
  constructor(
    private repo = new AnalyticsRepository(),
    private eficienciaService = new EficienciaService(),
    private rentabilidadeService = new RentabilidadeService(),
    private vidaUtilService = new VidaUtilService()
  ) {}

  eficiencia(organizacaoId?: string) {
    return this.eficienciaService.gerar(organizacaoId);
  }

  rentabilidade(organizacaoId?: string) {
    return this.rentabilidadeService.gerar(organizacaoId);
  }

  vidaUtil(opcoes: { organizacaoId?: string; detalharEquipamentos?: boolean } = {}) {
    return this.vidaUtilService.gerar(opcoes);
  }

  private async calcular(
    categoria: CategoriaAnalise
  ): Promise<{ resultado: unknown; previsoes?: PrevisaoParaSalvar[] }> {
    switch (categoria) {
      case CategoriaAnalise.EFICIENCIA_OPERACIONAL:
        return { resultado: await this.eficienciaService.gerar() };

      case CategoriaAnalise.RENTABILIDADE:
        return { resultado: await this.rentabilidadeService.gerar() };

      case CategoriaAnalise.VIDA_UTIL: {
        const r = await this.vidaUtilService.gerar();
        const previsoes = r.porTipo.map((p) => ({
          tipoEquipamento: p.tipo,
          amostras: p.amostras,
          inclinacao: p.inclinacao,
          intercepto: p.intercepto,
          r2: p.r2,
          vidaUtilEstimadaAnos: p.vidaUtilEstimadaAnos,
          idadeInservivelObservadaAnos: p.idadeInservivelObservadaAnos,
        }));
        return { resultado: r, previsoes };
      }
    }
  }

  // Calcula (visão global, sem filtro de organização) e grava um snapshot por categoria.
  async recalcular(categorias: CategoriaAnalise[] | undefined, origem: OrigemAnalise) {
    const alvo = categorias && categorias.length > 0 ? [...new Set(categorias)] : Object.values(CategoriaAnalise);

    const salvos = [];
    for (const categoria of alvo) {
      const { resultado, previsoes } = await this.calcular(categoria);
      salvos.push(await this.repo.salvarRelatorio({ categoria, origem, resultado, previsoes }));
    }
    return salvos;
  }

  historico(params: { categoria?: CategoriaAnalise; limit?: number }) {
    return this.repo.listarRelatorios({ categoria: params.categoria, limit: params.limit ?? 20 });
  }

  async buscarRelatorio(id: string) {
    const relatorio = await this.repo.buscarRelatorio(id);
    if (!relatorio) throw new AppError('Relatório analítico não encontrado.', 404);
    return relatorio;
  }

  previsoes(params: { tipo?: string; limit?: number }) {
    return this.repo.listarPrevisoes({ tipo: params.tipo, limit: params.limit ?? 50 });
  }
}