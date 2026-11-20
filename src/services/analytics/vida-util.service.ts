import { StatusEquipamento } from '@prisma/client';
import { AnalyticsRepository, EquipamentoVidaUtil } from '../../repositories/analytics.repository.js';
import {
  MIN_AMOSTRAS_REGRESSAO,
  NOTA_CONDICAO,
  ajustarVidaUtil,
  arredondar,
  resumir,
} from '../../utils/estatistica.js';

type Opcoes = { organizacaoId?: string; detalharEquipamentos?: boolean; anoAtual?: number };

// Função pura (sem banco): facilita teste unitário.
// `todos` = equipamentos de todas as organizações (treino do modelo).
// O filtro por organização só afeta a lista detalhada de equipamentos.
export function calcularVidaUtil(todos: EquipamentoVidaUtil[], opcoes: Opcoes = {}) {
  const anoAtual = opcoes.anoAtual ?? new Date().getUTCFullYear();

  const pontosPorTipo = new Map<string, Array<[number, number]>>();
  const idadesInserviveis = new Map<string, number[]>();

  for (const eq of todos) {
    const nota = NOTA_CONDICAO[eq.condicaoFisica];
    if (nota === null || !eq.dataAvaliacao) continue;

    const idade = eq.dataAvaliacao.getUTCFullYear() - eq.anoFabricacao;
    if (idade < 0) continue;

    const pontos = pontosPorTipo.get(eq.tipo) ?? [];
    pontos.push([idade, nota]);
    pontosPorTipo.set(eq.tipo, pontos);

    if (nota === 0) {
      const idades = idadesInserviveis.get(eq.tipo) ?? [];
      idades.push(idade);
      idadesInserviveis.set(eq.tipo, idades);
    }
  }

  const tipos = [...new Set(todos.map((e) => e.tipo))].sort();
  const porTipo = tipos.map((tipo) => {
    const modelo = ajustarVidaUtil(pontosPorTipo.get(tipo) ?? []);
    const observadas = idadesInserviveis.get(tipo);
    return {
      tipo,
      ...modelo,
      idadeInservivelObservadaAnos: observadas && observadas.length > 0 ? resumir(observadas).media : null,
    };
  });

  let equipamentos:
    | Array<{
        equipamentoId: string;
        codigoBarrasInterno: string;
        tipo: string;
        status: StatusEquipamento;
        anoFabricacao: number;
        idadeAnos: number;
        vidaUtilEstimadaAnos: number | null;
        vidaUtilRestanteAnos: number | null;
        anoInservivelProjetado: number | null;
      }>
    | undefined;

  if (opcoes.detalharEquipamentos) {
    const vidaPorTipo = new Map(porTipo.map((p) => [p.tipo, p.vidaUtilEstimadaAnos]));

    equipamentos = todos
      .filter(
        (e) =>
          e.status !== StatusEquipamento.DESCARTE &&
          (!opcoes.organizacaoId || e.organizacaoId === opcoes.organizacaoId)
      )
      .map((e) => {
        const idade = anoAtual - e.anoFabricacao;
        const vida = vidaPorTipo.get(e.tipo) ?? null;
        return {
          equipamentoId: e.id,
          codigoBarrasInterno: e.codigoBarrasInterno,
          tipo: e.tipo,
          status: e.status,
          anoFabricacao: e.anoFabricacao,
          idadeAnos: idade,
          vidaUtilEstimadaAnos: vida,
          vidaUtilRestanteAnos: vida === null ? null : arredondar(Math.max(0, vida - idade)),
          anoInservivelProjetado: vida === null ? null : Math.round(e.anoFabricacao + vida),
        };
      })
      .sort(
        (a, b) =>
          (a.vidaUtilRestanteAnos ?? Number.MAX_SAFE_INTEGER) -
          (b.vidaUtilRestanteAnos ?? Number.MAX_SAFE_INTEGER)
      );
  }

  return {
    anoReferencia: anoAtual,
    minimoAmostras: MIN_AMOSTRAS_REGRESSAO,
    porTipo,
    ...(equipamentos ? { equipamentos } : {}),
  };
}

export class VidaUtilService {
  constructor(private repo = new AnalyticsRepository()) {}

  async gerar(opcoes: Opcoes = {}) {
    const todos = await this.repo.equipamentosComAnoFabricacao();
    return calcularVidaUtil(todos, opcoes);
  }
}