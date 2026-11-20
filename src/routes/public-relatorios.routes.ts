import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiScope, FormatoRelatorio, StatusRelatorioJob } from '@prisma/client';
import { erroSchema } from '../schemas/swagger.schemas.js';
import { schemaCategoriaAnalise } from '../schemas/analytics.schemas.js';
import { RelatorioController } from '../controllers/relatorio.controller.js';
import { authenticateApiKey, requireScopes } from '../middlewares/apiKey.js';

const json = (obj: unknown) => '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
const curl = (...linhas: string[]) => '```bash\n' + linhas.join(' \\\n  ') + '\n```';

const URL_BASE = 'http://localhost:3000/api/v1/public';
const CABECALHO = '-H "x-api-key: gc_demo0001_3f9a1c5e7b2d4a6c8e0f1b3d5a7c9e2f"';
const ID_EXEMPLO = '5b1f0c2e-7d3a-4e8b-9c6d-2a4f6e8b0c1d';

const E400 = '- `400`: corpo ou parâmetros em formato inválido.';
const E401 = '- `401`: chave ausente, inválida ou revogada.';
const E403 = '- `403`: a chave não possui o escopo `RELATORIOS_READ`.';
const E404 = '- `404`: relatório inexistente ou pertencente a outra organização.';
const E409 = '- `409`: o relatório ainda não foi concluído (ou falhou), então não há arquivo para baixar.';
const E429 = '- `429`: limite de requisições por minuto da chave excedido.';
const E503 = '- `503`: serviço de fila indisponível; tente novamente em instantes.';

const dataSchema = z.string().or(z.date());

const relatorioStatusSchema = z.object({
  id: z.string().uuid().describe('Identificador da tarefa (jobId)'),
  categoria: schemaCategoriaAnalise,
  formato: z.nativeEnum(FormatoRelatorio),
  status: z
    .nativeEnum(StatusRelatorioJob)
    .describe(
      'PENDENTE (na fila ou aguardando nova tentativa), PROCESSANDO, CONCLUIDO (pronto para download) ou FALHA'
    ),
  tentativas: z.number().int().describe('Número da tentativa de processamento em andamento ou concluída'),
  erro: z.string().nullable().describe('Motivo da última falha, quando houver'),
  criadoEm: dataSchema,
  iniciadoEm: dataSchema.nullable(),
  concluidoEm: dataSchema.nullable(),
  downloadUrl: z.string().nullable().describe('Disponível somente quando o status é CONCLUIDO'),
});

const exemploStatus = (status: string, extra: Record<string, unknown> = {}) => ({
  id: ID_EXEMPLO,
  categoria: 'VIDA_UTIL',
  formato: 'CSV',
  status,
  tentativas: 0,
  erro: null,
  criadoEm: '2026-11-20T15:00:00.000Z',
  iniciadoEm: null,
  concluidoEm: null,
  downloadUrl: null,
  ...extra,
});

export const publicRelatoriosRoutes: FastifyPluginAsyncZod = async (app) => {
  const controller = new RelatorioController();
  const acesso = [authenticateApiKey, requireScopes(ApiScope.RELATORIOS_READ)];

  app.post('/relatorios', {
    onRequest: acesso,
    schema: {
      tags: ['Relatórios'],
      summary: 'Solicitar a geração de um relatório analítico (assíncrono)',
      description: [
        'A geração roda em segundo plano. Esta rota responde **imediatamente** com `202` e o identificador da tarefa; ' +
          'acompanhe o andamento em `GET /relatorios/{id}` e baixe o arquivo em `GET /relatorios/{id}/download`.',
        '',
        '**Escopo necessário:** `RELATORIOS_READ`',
        '',
        '**Categorias:** `EFICIENCIA_OPERACIONAL`, `RENTABILIDADE` e `VIDA_UTIL` (previsão de vida útil de todos os ' +
          'seus equipamentos ativos). O relatório cobre apenas a organização dona da chave.',
        '',
        '**Formatos:** `JSON` (completo, padrão) ou `CSV` (a tabela principal da categoria).',
        '',
        '**Falhas e novas tentativas:** se o processamento falhar, o sistema tenta novamente até 3 vezes, com espera ' +
          'crescente entre as tentativas (2s, depois 4s). Durante as novas tentativas o status volta a `PENDENTE`. ' +
          'Esgotadas as tentativas, o status final é `FALHA`.',
        '',
        '**Exemplo de requisição:**',
        curl(
          `curl -X POST "${URL_BASE}/relatorios"`,
          CABECALHO,
          '-H "Content-Type: application/json"',
          `-d '${JSON.stringify({ categoria: 'VIDA_UTIL', formato: 'CSV' })}'`
        ),
        '',
        '**Exemplo de resposta (202):**',
        json(exemploStatus('PENDENTE')),
        '',
        '**Códigos de erro:**',
        E400,
        E401,
        E403,
        E429,
        E503,
      ].join('\n'),
      body: z.object({
        categoria: schemaCategoriaAnalise,
        formato: z.nativeEnum(FormatoRelatorio).default(FormatoRelatorio.JSON).describe('JSON (padrão) ou CSV'),
      }),
      response: {
        202: relatorioStatusSchema,
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        429: erroSchema,
        503: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.solicitar(req, reply));

  app.get('/relatorios/:id', {
    onRequest: acesso,
    schema: {
      tags: ['Relatórios'],
      summary: 'Consultar o status de um relatório (polling)',
      description: [
        'Consulte periodicamente (sugestão: a cada 2 a 5 segundos) até o status ser `CONCLUIDO` ou `FALHA`.',
        '',
        '**Escopo necessário:** `RELATORIOS_READ`',
        '',
        '**Exemplo de requisição:**',
        curl(`curl "${URL_BASE}/relatorios/${ID_EXEMPLO}"`, CABECALHO),
        '',
        '**Exemplo de resposta (200), relatório concluído:**',
        json(
          exemploStatus('CONCLUIDO', {
            tentativas: 1,
            iniciadoEm: '2026-11-20T15:00:01.000Z',
            concluidoEm: '2026-11-20T15:00:02.000Z',
            downloadUrl: `/api/v1/public/relatorios/${ID_EXEMPLO}/download`,
          })
        ),
        '',
        '**Códigos de erro:**',
        E400,
        E401,
        E403,
        E404,
        E429,
      ].join('\n'),
      params: z.object({ id: z.string().uuid().describe('jobId retornado na solicitação') }),
      response: {
        200: relatorioStatusSchema,
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        404: erroSchema,
        429: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.status(req, reply));

  app.get('/relatorios/:id/download', {
    onRequest: acesso,
    schema: {
      tags: ['Relatórios'],
      summary: 'Baixar o arquivo do relatório concluído',
      description: [
        'Retorna o arquivo (`text/csv` ou `application/json`) como anexo. Só está disponível quando o status é `CONCLUIDO`.',
        '',
        '**Escopo necessário:** `RELATORIOS_READ`',
        '',
        '**Exemplo de requisição:**',
        curl(`curl -OJ "${URL_BASE}/relatorios/${ID_EXEMPLO}/download"`, CABECALHO),
        '',
        '**Exemplo de conteúdo (CSV de VIDA_UTIL):**',
        '```csv\ncodigoBarrasInterno,tipo,status,anoFabricacao,idadeAnos,vidaUtilEstimadaAnos,vidaUtilRestanteAnos,anoInservivelProjetado\nEQP-2026-0004,Notebook,EM_TRIAGEM,2019,7,7.3,0.3,2026\n```',
        '',
        'Para abrir o CSV no Excel, use **Dados > De Texto/CSV**.',
        '',
        '**Códigos de erro:**',
        E400,
        E401,
        E403,
        E404,
        E409,
        E429,
      ].join('\n'),
      params: z.object({ id: z.string().uuid().describe('jobId retornado na solicitação') }),
      response: {
        200: z.string().describe('Conteúdo do arquivo (CSV ou JSON)'),
        400: erroSchema,
        401: erroSchema,
        403: erroSchema,
        404: erroSchema,
        409: erroSchema,
        429: erroSchema,
        500: erroSchema,
      },
    },
  }, (req, reply) => controller.download(req, reply));
};