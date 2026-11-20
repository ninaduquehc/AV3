import { CategoriaAnalise, FormatoRelatorio, RelatorioJob, StatusRelatorioJob } from '@prisma/client';
import { RelatorioJobRepository } from '../repositories/relatorio-job.repository.js';
import { AnalyticsService } from './analytics/analytics.service.js';
import { AppError } from '../models/erros.js';
import { enfileirarRelatorio } from '../queue/relatorio.queue.js';
import { Celula, gerarCsv } from '../utils/csv.js';

const PREFIXO_PUBLICO = '/api/v1/public';
const MENSAGEM_GENERICA = 'Erro interno ao gerar o relatório.';

export const urlStatusRelatorio = (id: string) => `${PREFIXO_PUBLICO}/relatorios/${id}`;

export function resumirJob(job: RelatorioJob) {
  return {
    id: job.id,
    categoria: job.categoria,
    formato: job.formato,
    status: job.status,
    tentativas: job.tentativas,
    erro: job.erro,
    criadoEm: job.createdAt,
    iniciadoEm: job.iniciadoEm,
    concluidoEm: job.concluidoEm,
    downloadUrl: job.status === StatusRelatorioJob.CONCLUIDO ? `${urlStatusRelatorio(job.id)}/download` : null,
  };
}

export class RelatorioService {
  constructor(
    private repo = new RelatorioJobRepository(),
    private analytics = new AnalyticsService()
  ) {}

  // ---------- Lado da API: solicitar, consultar e baixar ----------
  async solicitar(
    apiKey: { id: string; organizacaoId: string },
    dados: { categoria: CategoriaAnalise; formato: FormatoRelatorio }
  ) {
    const job = await this.repo.create({
      categoria: dados.categoria,
      formato: dados.formato,
      apiKeyId: apiKey.id,
      parametros: { organizacaoId: apiKey.organizacaoId },
    });

    try {
      await enfileirarRelatorio(job.id);
    } catch (err) {
      console.error('[relatorio] falha ao enfileirar:', err);
      await this.repo.marcarFalhaNoEnfileiramento(job.id, 'Fila de processamento indisponível.');
      throw new AppError('Serviço de relatórios temporariamente indisponível. Tente novamente em instantes.', 503);
    }

    return job;
  }

  // 404 também quando o relatório pertence a outra organização.
  async consultar(organizacaoId: string, id: string) {
    const job = await this.repo.findById(id);
    if (!job || job.apiKey.organizacaoId !== organizacaoId) {
      throw new AppError('Relatório não encontrado.', 404);
    }
    return job;
  }

  async baixar(organizacaoId: string, id: string) {
    const job = await this.consultar(organizacaoId, id);

    if (job.status !== StatusRelatorioJob.CONCLUIDO) {
      throw new AppError(`Relatório não está disponível para download (status: ${job.status}).`, 409);
    }
    if (job.resultado === null) {
      throw new AppError('Conteúdo do relatório indisponível.', 500);
    }

    const extensao = job.formato === FormatoRelatorio.CSV ? 'csv' : 'json';
    const categoria = job.categoria.toLowerCase().replace(/_/g, '-');

    return {
      conteudo: job.resultado,
      formato: job.formato,
      nomeArquivo: `relatorio-${categoria}-${job.id.slice(0, 8)}.${extensao}`,
    };
  }

  // ---------- Lado do worker: processar e registrar falhas ----------
  // Idempotente: reprocessar um job concluído não faz nada; reprocessar um job com falha apenas o regera.
  async processar(id: string, tentativa: number) {
    const job = await this.repo.findById(id);
    if (!job) {
      console.warn(`[relatorio] job ${id} não encontrado no banco; ignorado.`);
      return;
    }
    if (job.status === StatusRelatorioJob.CONCLUIDO) return;

    await this.repo.marcarProcessando(id, tentativa);

    const conteudo = await this.gerarConteudo(job.categoria, job.formato, job.apiKey.organizacaoId);
    await this.repo.marcarConcluido(id, conteudo);
  }

  async registrarFalha(id: string, definitiva: boolean, err: unknown) {
    // Só mensagens de negócio chegam ao parceiro; o resto é detalhe interno (fica no log do servidor).
    const mensagem = err instanceof AppError ? err.message : MENSAGEM_GENERICA;
    await this.repo.registrarFalha(
      id,
      definitiva ? StatusRelatorioJob.FALHA : StatusRelatorioJob.PENDENTE,
      mensagem
    );
  }

  // ---------- Geração do arquivo (sempre restrita à organização da chave) ----------
  private async gerarConteudo(
    categoria: CategoriaAnalise,
    formato: FormatoRelatorio,
    organizacaoId: string
  ): Promise<string> {
    let dados: unknown;
    let colunas: string[] = [];
    let linhas: Celula[][] = [];

    switch (categoria) {
      case CategoriaAnalise.EFICIENCIA_OPERACIONAL: {
        const r = await this.analytics.eficiencia(organizacaoId);
        dados = {
          ...r,
          // Dados de funcionários não saem pela API pública: operadores anonimizados.
          porOperador: r.porOperador.map((o, i) => ({
            operador: `Operador ${i + 1}`,
            etapasConcluidas: o.etapasConcluidas,
            tempoMedioPorEtapaHoras: o.tempoMedioPorEtapaHoras,
            tempoMedioTriagemHoras: o.tempoMedioTriagemHoras,
          })),
        };
        colunas = ['status', 'amostras', 'tempoMedioHoras', 'medianaHoras', 'gargalo'];
        linhas = r.porEtapa.map((e) => [e.status, e.amostras, e.tempoMedioHoras, e.medianaHoras, e.gargalo]);
        break;
      }

      case CategoriaAnalise.RENTABILIDADE: {
        const r = await this.analytics.rentabilidade(organizacaoId);
        dados = r;
        colunas = ['tipo', 'amostras', 'valorMedio', 'medianaValor', 'desvioPadraoValor', 'valorTotal'];
        linhas = r.porTipo.map((t) => [
          t.tipo,
          t.amostras,
          t.valorMedio,
          t.medianaValor,
          t.desvioPadraoValor,
          t.valorTotal,
        ]);
        break;
      }

      case CategoriaAnalise.VIDA_UTIL: {
        const r = await this.analytics.vidaUtil({ organizacaoId, detalharEquipamentos: true });
        dados = r;
        colunas = [
          'codigoBarrasInterno',
          'tipo',
          'status',
          'anoFabricacao',
          'idadeAnos',
          'vidaUtilEstimadaAnos',
          'vidaUtilRestanteAnos',
          'anoInservivelProjetado',
        ];
        linhas = (r.equipamentos ?? []).map((e) => [
          e.codigoBarrasInterno,
          e.tipo,
          e.status,
          e.anoFabricacao,
          e.idadeAnos,
          e.vidaUtilEstimadaAnos,
          e.vidaUtilRestanteAnos,
          e.anoInservivelProjetado,
        ]);
        break;
      }
    }

    if (formato === FormatoRelatorio.CSV) return gerarCsv(colunas, linhas);

    return JSON.stringify({ categoria, geradoEm: new Date().toISOString(), dados }, null, 2);
  }
}