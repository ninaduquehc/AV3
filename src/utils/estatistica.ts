import { CondicaoFisica } from '@prisma/client';
import {
  mean,
  median,
  standardDeviation,
  linearRegression,
  linearRegressionLine,
  rSquared,
} from 'simple-statistics';

export const MIN_AMOSTRAS_REGRESSAO = 5;

export function arredondar(n: number, casas = 2): number {
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
}

export function agrupar<T>(itens: T[], chave: (item: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const item of itens) {
    const k = chave(item);
    const lista = mapa.get(k);
    if (lista) lista.push(item);
    else mapa.set(k, [item]);
  }
  return mapa;
}

export type ResumoEstatistico = {
  amostras: number;
  media: number | null;
  mediana: number | null;
  desvioPadrao: number | null;
};

export function resumir(valores: number[], casas = 2): ResumoEstatistico {
  if (valores.length === 0) {
    return { amostras: 0, media: null, mediana: null, desvioPadrao: null };
  }
  return {
    amostras: valores.length,
    media: arredondar(mean(valores), casas),
    mediana: arredondar(median(valores), casas),
    desvioPadrao: arredondar(standardDeviation(valores), casas),
  };
}

// Nota numérica da condição física, usada como variável dependente da regressão.
export const NOTA_CONDICAO: Record<CondicaoFisica, number | null> = {
  NAO_AVALIADO: null,
  BOM: 3,
  REGULAR: 2,
  RUIM: 1,
  INSERVIVEL: 0,
};

export type ModeloVidaUtil = {
  amostras: number;
  inclinacao: number | null;
  intercepto: number | null;
  r2: number | null;
  vidaUtilEstimadaAnos: number | null;
  observacao: string | null;
};

// Regressão linear por mínimos quadrados ordinários: nota = intercepto + inclinacao * idade.
// A vida útil estimada é a idade em que a reta cruza a nota 0 (INSERVIVEL).
export function ajustarVidaUtil(pontos: Array<[number, number]>): ModeloVidaUtil {
  const amostras = pontos.length;
  const vazio = { inclinacao: null, intercepto: null, r2: null, vidaUtilEstimadaAnos: null };

  if (amostras < MIN_AMOSTRAS_REGRESSAO) {
    return {
      amostras,
      ...vazio,
      observacao: `Dados insuficientes: ${amostras} amostra(s), mínimo ${MIN_AMOSTRAS_REGRESSAO}.`,
    };
  }

  if (new Set(pontos.map(([idade]) => idade)).size < 2) {
    return { amostras, ...vazio, observacao: 'Dados insuficientes: todas as amostras têm a mesma idade.' };
  }

  const { m, b } = linearRegression(pontos);
  const r2 = rSquared(pontos, linearRegressionLine({ m, b }));

  const base = {
    amostras,
    inclinacao: arredondar(m, 4),
    intercepto: arredondar(b, 4),
    r2: Number.isFinite(r2) ? arredondar(r2, 3) : null,
  };

  if (m > -1e-9) {
    return {
      ...base,
      vidaUtilEstimadaAnos: null,
      observacao: 'Sem tendência de queda da condição física com a idade.',
    };
  }

  const vida = -b / m;
  if (!Number.isFinite(vida) || vida <= 0) {
    return { ...base, vidaUtilEstimadaAnos: null, observacao: 'Projeção inconsistente com os dados observados.' };
  }

  return { ...base, vidaUtilEstimadaAnos: arredondar(vida), observacao: null };
}