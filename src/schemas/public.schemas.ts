import { z } from 'zod';
import { schemaStatusEquipamento, schemaCondicaoFisica, schemaStatusLote } from './swagger.schemas.js';

const dataSchema = z.string().or(z.date());

// Schemas próprios da API pública: não expõem IDs internos nem dados de operadores.
export const equipamentoPublicoSchema = z.object({
  codigoBarrasInterno: z.string().describe('Código de barras interno do equipamento'),
  tipo: z.string().describe('Categoria do equipamento (ex: Notebook)'),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  condicaoFisica: schemaCondicaoFisica,
  anoFabricacao: z.number().int().nullable().optional(),
  status: schemaStatusEquipamento,
});

export const movimentacaoPublicaSchema = z.object({
  dataHora: dataSchema,
  statusAnterior: schemaStatusEquipamento,
  statusNovo: schemaStatusEquipamento,
  observacao: z.string().nullable().optional(),
});

export const rastreabilidadeSchema = equipamentoPublicoSchema.extend({
  loteCodigo: z.string().describe('Código do lote ao qual o equipamento pertence'),
  movimentacoes: z.array(movimentacaoPublicaSchema).describe('Histórico em ordem cronológica'),
});

export const lotePublicoSchema = z.object({
  id: z.string().uuid(),
  codigo: z.string(),
  status: schemaStatusLote,
  dataRecebimento: dataSchema,
  totalEquipamentos: z.number().int(),
  equipamentos: z.array(equipamentoPublicoSchema).optional().describe('Presente apenas na consulta de um lote'),
});