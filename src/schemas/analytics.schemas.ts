import { z } from 'zod';
import { CategoriaAnalise, OrigemAnalise } from '@prisma/client';
import { schemaStatusEquipamento, schemaCondicaoFisica } from './swagger.schemas.js';

export const schemaCategoriaAnalise = z
  .nativeEnum(CategoriaAnalise)
  .describe('Categoria da análise: EFICIENCIA_OPERACIONAL, RENTABILIDADE ou VIDA_UTIL');

const numeroOuNulo = z.number().nullable();

export const eficienciaSchema = z.object({
  resumo: z.object({
    lotesAnalisados: z.number().describe('Lotes cujos equipamentos já saíram todos da triagem'),
    lotesEmAndamento: z.number().describe('Lotes com ao menos um equipamento ainda não triado'),
    tempoMedioTriagemLoteHoras: numeroOuNulo.describe('Do recebimento do lote até a conclusão da triagem'),
    medianaTriagemLoteHoras: numeroOuNulo,
    desvioPadraoTriagemLoteHoras: numeroOuNulo,
  }),
  porEtapa: z
    .array(
      z.object({
        status: schemaStatusEquipamento,
        amostras: z.number(),
        tempoMedioHoras: z.number(),
        medianaHoras: z.number(),
        gargalo: z.boolean().describe('Etapa com maior tempo médio (mínimo de 3 amostras)'),
      })
    )
    .describe('Tempo médio em cada status, da etapa mais lenta para a mais rápida'),
  porOperador: z.array(
    z.object({
      usuarioId: z.string(),
      nome: z.string(),
      etapasConcluidas: z.number(),
      tempoMedioPorEtapaHoras: z.number(),
      tempoMedioTriagemHoras: numeroOuNulo,
    })
  ),
  porMes: z.array(
    z.object({
      mes: z.string().describe('Mês de recebimento do lote (AAAA-MM)'),
      lotes: z.number(),
      tempoMedioTriagemHoras: z.number(),
    })
  ),
});

const grupoValor = z.object({ amostras: z.number(), valorMedio: z.number() });

export const rentabilidadeSchema = z.object({
  totalAmostras: z.number(),
  porTipo: z.array(
    z.object({
      tipo: z.string(),
      amostras: z.number(),
      valorMedio: z.number(),
      medianaValor: z.number(),
      desvioPadraoValor: z.number(),
      valorTotal: z.number(),
      porCondicao: z.array(grupoValor.extend({ condicaoFisica: schemaCondicaoFisica })),
      porMarca: z.array(grupoValor.extend({ marca: z.string() })),
      porModelo: z.array(grupoValor.extend({ marca: z.string(), modelo: z.string() })),
    })
  ),
  ranking: z.array(z.object({ posicao: z.number(), tipo: z.string(), valorMedio: z.number() })),
});

export const vidaUtilSchema = z.object({
  anoReferencia: z.number(),
  minimoAmostras: z.number(),
  porTipo: z.array(
    z.object({
      tipo: z.string(),
      amostras: z.number(),
      inclinacao: numeroOuNulo,
      intercepto: numeroOuNulo,
      r2: numeroOuNulo,
      vidaUtilEstimadaAnos: numeroOuNulo.describe('Idade em que a condição projetada chega a INSERVIVEL'),
      idadeInservivelObservadaAnos: numeroOuNulo.describe('Idade média dos equipamentos já inservíveis'),
      observacao: z.string().nullable(),
    })
  ),
  equipamentos: z
    .array(
      z.object({
        equipamentoId: z.string().uuid(),
        codigoBarrasInterno: z.string(),
        tipo: z.string(),
        status: schemaStatusEquipamento,
        anoFabricacao: z.number(),
        idadeAnos: z.number(),
        vidaUtilEstimadaAnos: numeroOuNulo,
        vidaUtilRestanteAnos: numeroOuNulo,
        anoInservivelProjetado: numeroOuNulo,
      })
    )
    .optional(),
});

export const relatorioResumoSchema = z.object({
  id: z.string().uuid(),
  categoria: schemaCategoriaAnalise,
  origem: z.nativeEnum(OrigemAnalise),
  geradoEm: z.string().or(z.date()),
});

export const previsaoHistoricoSchema = z.object({
  id: z.string().uuid(),
  relatorioId: z.string().uuid(),
  tipoEquipamento: z.string(),
  amostras: z.number(),
  inclinacao: numeroOuNulo,
  intercepto: numeroOuNulo,
  r2: numeroOuNulo,
  vidaUtilEstimadaAnos: numeroOuNulo,
  idadeInservivelObservadaAnos: numeroOuNulo,
  createdAt: z.string().or(z.date()),
});

export const relatorioCompletoSchema = relatorioResumoSchema.extend({
  parametros: z.unknown().optional(),
  resultado: z.unknown(),
  previsoes: z.array(previsaoHistoricoSchema).optional(),
});