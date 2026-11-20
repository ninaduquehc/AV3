import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { erroSchema } from '../schemas/swagger.schemas.js';
import {
  schemaCategoriaAnalise,
  eficienciaSchema,
  rentabilidadeSchema,
  vidaUtilSchema,
  relatorioResumoSchema,
  relatorioCompletoSchema,
  previsaoHistoricoSchema,
} from '../schemas/analytics.schemas.js';
import { AnalyticsController } from '../controllers/analytics.controller.js';
import { authenticate, authorize } from '../middlewares/auth.js';

const acesso = [authenticate, authorize(['ADMIN', 'OPERADOR'])];

const queryOrganizacao = z.object({
  organizacaoId: z.string().uuid().optional().describe('Restringe a análise a uma organização'),
});

const limite = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional();

export const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  const controller = new AnalyticsController();

  app.get('/analytics/eficiencia-operacional', {
    onRequest: acesso,
    schema: {
      tags: ['Analytics'],
      summary: 'Eficiência operacional: tempo de triagem, gargalos, operadores e meses',
      querystring: queryOrganizacao,
      response: { 200: eficienciaSchema, 400: erroSchema, 401: erroSchema, 403: erroSchema, 500: erroSchema },
    },
  }, (req, reply) => controller.eficiencia(req, reply));

  app.get('/analytics/rentabilidade', {
    onRequest: acesso,
    schema: {
      tags: ['Analytics'],
      summary: 'Rentabilidade: valor médio de recuperação por tipo, condição, marca e modelo',
      querystring: queryOrganizacao,
      response: { 200: rentabilidadeSchema, 400: erroSchema, 401: erroSchema, 403: erroSchema, 500: erroSchema },
    },
  }, (req, reply) => controller.rentabilidade(req, reply));

  app.get('/analytics/vida-util', {
    onRequest: acesso,
    schema: {
      tags: ['Analytics'],
      summary: 'Previsão de vida útil por tipo (regressão linear) e, opcionalmente, por equipamento',
      querystring: queryOrganizacao.extend({
        detalhar: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional()
          .describe('Se true, inclui a projeção de cada equipamento não descartado'),
      }),
      response: { 200: vidaUtilSchema, 400: erroSchema, 401: erroSchema, 403: erroSchema, 500: erroSchema },
    },
  }, (req, reply) => controller.vidaUtil(req, reply));

  app.post('/analytics/recalcular', {
    onRequest: acesso,
    schema: {
      tags: ['Analytics'],
      summary: 'Recalcula e persiste as análises (visão global). Sem corpo, recalcula as três categorias.',
      body: z.object({ categorias: z.array(schemaCategoriaAnalise).min(1).optional() }).optional(),
      response: {
        201: z.array(relatorioResumoSchema),
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.recalcular(req, reply));

  app.get('/analytics/historico', {
    onRequest: acesso,
    schema: {
      tags: ['Analytics'],
      summary: 'Lista os relatórios analíticos persistidos (mais recentes primeiro)',
      querystring: z.object({ categoria: schemaCategoriaAnalise.optional(), limit: limite }),
      response: {
        200: z.array(relatorioResumoSchema),
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.historico(req, reply));

  app.get('/analytics/historico/:id', {
    onRequest: acesso,
    schema: {
      tags: ['Analytics'],
      summary: 'Busca um relatório analítico persistido, com o resultado completo',
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: relatorioCompletoSchema,
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        404: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.historicoPorId(req, reply));

  app.get('/analytics/previsoes', {
    onRequest: acesso,
    schema: {
      tags: ['Analytics'],
      summary: 'Histórico de previsões de vida útil, para comparar previsão e realização ao longo do tempo',
      querystring: z.object({ tipo: z.string().min(1).optional(), limit: limite }),
      response: {
        200: z.array(previsaoHistoricoSchema),
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.previsoes(req, reply));
};