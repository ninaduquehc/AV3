import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiScope } from '@prisma/client';
import { erroSchema } from '../schemas/swagger.schemas.js';
import { ApiKeyController } from '../controllers/apikey.controller.js';
import { authenticate, authorize } from '../middlewares/auth.js';

const dataSchema = z.string().or(z.date());

const apiKeySchema = z.object({
  id: z.string().uuid(),
  nome: z.string().describe('Identificação do parceiro/integração'),
  prefixo: z.string().describe('Identificador público da chave (não é secreto)'),
  scopes: z.array(z.nativeEnum(ApiScope)),
  limitePorMinuto: z.number().int(),
  ativa: z.boolean(),
  organizacaoId: z.string().uuid().describe('Organização cujos dados a chave pode acessar'),
  ultimoUsoEm: dataSchema.nullable().optional(),
  revogadaEm: dataSchema.nullable().optional(),
  createdAt: dataSchema,
});

export const apiKeyRoutes: FastifyPluginAsyncZod = async (app) => {
  const controller = new ApiKeyController();
  const somenteAdmin = [authenticate, authorize(['ADMIN'])];

  app.post('/api-keys', {
    onRequest: somenteAdmin,
    schema: {
      tags: ['API Keys'],
      summary: 'Gerar uma chave de API para um parceiro (Apenas Admin)',
      description:
        'A chave completa (`chave`) é exibida **somente nesta resposta**. Depois disso apenas o hash fica armazenado, ' +
        'e não há como recuperá-la: se for perdida, revogue e gere outra.\n\n' +
        '**Escopos:** `RASTREABILIDADE_READ`, `LOTES_READ`, `LOTES_WRITE`, `RELATORIOS_READ`.',
      body: z.object({
        nome: z.string().min(2).max(100),
        organizacaoId: z.string().uuid(),
        scopes: z.array(z.nativeEnum(ApiScope)).min(1).describe('Permissões concedidas à chave'),
        limitePorMinuto: z.number().int().min(1).max(1000).default(60).describe('Requisições por minuto'),
      }),
      response: {
        201: apiKeySchema.extend({ chave: z.string().describe('Chave completa, exibida uma única vez') }),
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        404: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.create(req, reply));

  app.get('/api-keys', {
    onRequest: somenteAdmin,
    schema: {
      tags: ['API Keys'],
      summary: 'Listar as chaves de API (sem o segredo)',
      response: { 200: z.array(apiKeySchema), 401: erroSchema, 403: erroSchema, 500: erroSchema },
    },
  }, (req, reply) => controller.index(req, reply));

  app.delete('/api-keys/:id', {
    onRequest: somenteAdmin,
    schema: {
      tags: ['API Keys'],
      summary: 'Revogar uma chave de API',
      params: z.object({ id: z.string().uuid() }),
      response: { 204: z.null(), 401: erroSchema, 403: erroSchema, 404: erroSchema, 500: erroSchema },
    },
  }, (req, reply) => controller.delete(req, reply));
};