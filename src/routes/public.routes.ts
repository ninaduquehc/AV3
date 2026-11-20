import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiScope } from '@prisma/client';
import { erroSchema } from '../schemas/swagger.schemas.js';
import { lotePublicoSchema, rastreabilidadeSchema } from '../schemas/public.schemas.js';
import { PublicController } from '../controllers/public.controller.js';
import { authenticateApiKey, requireScopes } from '../middlewares/apiKey.js';

// Exemplos em markdown no description (o Zod 3 não suporta "example" no schema).
const json = (obj: unknown) => '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
const curl = (...linhas: string[]) => '```bash\n' + linhas.join(' \\\n  ') + '\n```';

const URL_BASE = 'http://localhost:3000/api/v1/public';
const CABECALHO = '-H "x-api-key: gc_demo0001_3f9a1c5e7b2d4a6c8e0f1b3d5a7c9e2f"';

const E400 = '- `400`: corpo, parâmetros ou consulta em formato inválido.';
const E401 = '- `401`: chave ausente, inválida ou revogada.';
const E403 = '- `403`: a chave não possui o escopo necessário.';
const E404 = '- `404`: recurso inexistente ou pertencente a outra organização.';
const E409 = '- `409`: já existe um registro com o mesmo código.';
const E429 = '- `429`: limite de requisições por minuto da chave excedido.';

export const publicRoutes: FastifyPluginAsyncZod = async (app) => {
  const controller = new PublicController();

  app.get('/equipamentos/:codigoBarras/rastreabilidade', {
    onRequest: [authenticateApiKey, requireScopes(ApiScope.RASTREABILIDADE_READ)],
    schema: {
      tags: ['Rastreabilidade'],
      summary: 'Consultar a rastreabilidade de um equipamento',
      description: [
        'Retorna os dados do equipamento e todo o histórico de movimentações, em ordem cronológica.',
        '',
        '**Escopo necessário:** `RASTREABILIDADE_READ`',
        '',
        '**Exemplo de requisição:**',
        curl(`curl "${URL_BASE}/equipamentos/EQP-2026-0001/rastreabilidade"`, CABECALHO),
        '',
        '**Exemplo de resposta (200):**',
        json({
          codigoBarrasInterno: 'EQP-2026-0001',
          tipo: 'Notebook',
          marca: 'Dell',
          modelo: 'Latitude 5420',
          condicaoFisica: 'BOM',
          anoFabricacao: 2022,
          status: 'REUSO',
          loteCodigo: 'LOT-2026-001',
          movimentacoes: [
            {
              dataHora: '2026-01-11T09:30:00.000Z',
              statusAnterior: 'RECEBIDO',
              statusNovo: 'EM_TRIAGEM',
              observacao: null,
            },
          ],
        }),
        '',
        '**Códigos de erro:**',
        E401,
        E403,
        E404,
        E429,
      ].join('\n'),
      params: z.object({
        codigoBarras: z.string().min(1).max(100).describe('Código de barras interno (ex: EQP-2026-0001)'),
      }),
      response: {
        200: rastreabilidadeSchema,
        401: erroSchema,
        403: erroSchema,
        404: erroSchema,
        429: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.rastrear(req, reply));

  app.get('/lotes', {
    onRequest: [authenticateApiKey, requireScopes(ApiScope.LOTES_READ)],
    schema: {
      tags: ['Lotes'],
      summary: 'Listar os lotes da sua organização',
      description: [
        'Lista paginada dos lotes da organização dona da chave, do mais recente para o mais antigo.',
        '',
        '**Escopo necessário:** `LOTES_READ`',
        '',
        '**Exemplo de requisição:**',
        curl(`curl "${URL_BASE}/lotes?page=1&limit=10"`, CABECALHO),
        '',
        '**Exemplo de resposta (200):**',
        json({
          total: 6,
          page: 1,
          limit: 10,
          totalPages: 1,
          data: [
            {
              id: '3f6d2c1e-8a4b-4c5d-9e7f-1a2b3c4d5e6f',
              codigo: 'LOT-2026-013',
              status: 'EM_TRIAGEM',
              dataRecebimento: '2026-11-06T12:00:00.000Z',
              totalEquipamentos: 7,
            },
          ],
        }),
        '',
        '**Códigos de erro:**',
        E400,
        E401,
        E403,
        E429,
      ].join('\n'),
      querystring: z.object({
        page: z
          .string()
          .regex(/^\d+$/)
          .transform(Number)
          .pipe(z.number().int().positive())
          .optional()
          .describe('Página (padrão 1)'),
        limit: z
          .string()
          .regex(/^\d+$/)
          .transform(Number)
          .pipe(z.number().int().min(1).max(100))
          .optional()
          .describe('Itens por página, de 1 a 100 (padrão 20)'),
      }),
      response: {
        200: z.object({
          total: z.number(),
          page: z.number(),
          limit: z.number(),
          totalPages: z.number(),
          data: z.array(lotePublicoSchema),
        }),
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        429: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.listarLotes(req, reply));

  app.get('/lotes/:id', {
    onRequest: [authenticateApiKey, requireScopes(ApiScope.LOTES_READ)],
    schema: {
      tags: ['Lotes'],
      summary: 'Consultar um lote e seus equipamentos',
      description: [
        '**Escopo necessário:** `LOTES_READ`',
        '',
        '**Exemplo de requisição:**',
        curl(`curl "${URL_BASE}/lotes/3f6d2c1e-8a4b-4c5d-9e7f-1a2b3c4d5e6f"`, CABECALHO),
        '',
        '**Exemplo de resposta (200):**',
        json({
          id: '3f6d2c1e-8a4b-4c5d-9e7f-1a2b3c4d5e6f',
          codigo: 'LOT-2026-013',
          status: 'EM_TRIAGEM',
          dataRecebimento: '2026-11-06T12:00:00.000Z',
          totalEquipamentos: 1,
          equipamentos: [
            {
              codigoBarrasInterno: 'EQP-2026-0090',
              tipo: 'Monitor LED',
              marca: 'LG',
              modelo: '24MK430H',
              condicaoFisica: 'REGULAR',
              anoFabricacao: 2019,
              status: 'EM_TRIAGEM',
            },
          ],
        }),
        '',
        '**Códigos de erro:**',
        E400,
        E401,
        E403,
        E404,
        E429,
      ].join('\n'),
      params: z.object({ id: z.string().uuid().describe('ID do lote') }),
      response: {
        200: lotePublicoSchema,
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        404: erroSchema,
        429: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.buscarLote(req, reply));

  app.post('/lotes', {
    onRequest: [authenticateApiKey, requireScopes(ApiScope.LOTES_WRITE)],
    schema: {
      tags: ['Lotes'],
      summary: 'Submeter um novo lote com seu inventário de equipamentos',
      description: [
        'Cria o lote para a organização dona da chave, com todos os equipamentos, em uma única transação: ' +
          'se qualquer código estiver duplicado, nada é gravado. O lote e os equipamentos entram como `RECEBIDO`.',
        '',
        '**Escopo necessário:** `LOTES_WRITE`',
        '',
        '**Exemplo de requisição:**',
        curl(
          `curl -X POST "${URL_BASE}/lotes"`,
          CABECALHO,
          '-H "Content-Type: application/json"',
          `-d '${JSON.stringify({
            codigo: 'LOT-PARCEIRO-001',
            equipamentos: [
              { codigoBarrasInterno: 'PARC-0001', tipo: 'Notebook' },
              { codigoBarrasInterno: 'PARC-0002', tipo: 'Monitor LED' },
            ],
          })}'`
        ),
        '',
        '**Exemplo de resposta (201):**',
        json({
          id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
          codigo: 'LOT-PARCEIRO-001',
          status: 'RECEBIDO',
          dataRecebimento: '2026-11-20T15:00:00.000Z',
          totalEquipamentos: 2,
          equipamentos: [
            {
              codigoBarrasInterno: 'PARC-0001',
              tipo: 'Notebook',
              marca: null,
              modelo: null,
              condicaoFisica: 'NAO_AVALIADO',
              anoFabricacao: null,
              status: 'RECEBIDO',
            },
            {
              codigoBarrasInterno: 'PARC-0002',
              tipo: 'Monitor LED',
              marca: null,
              modelo: null,
              condicaoFisica: 'NAO_AVALIADO',
              anoFabricacao: null,
              status: 'RECEBIDO',
            },
          ],
        }),
        '',
        '**Códigos de erro:**',
        E400,
        E401,
        E403,
        E409,
        E429,
      ].join('\n'),
      body: z.object({
        codigo: z.string().min(1).max(50).describe('Código único do lote (ex: LOT-PARCEIRO-001)'),
        dataRecebimento: z
          .string()
          .datetime()
          .optional()
          .describe('Data de recebimento em ISO 8601 (padrão: agora)'),
        equipamentos: z
          .array(
            z.object({
              codigoBarrasInterno: z.string().min(1).max(100).describe('Código único do equipamento'),
              tipo: z.string().min(1).max(100).describe('Categoria (ex: Notebook, Monitor LED)'),
            })
          )
          .min(1)
          .max(100)
          .describe('Inventário do lote (1 a 100 itens)'),
      }),
      response: {
        201: lotePublicoSchema,
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        409: erroSchema,
        429: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.criarLote(req, reply));
};