import { FastifyRequest, FastifyReply } from 'fastify';
import { CategoriaAnalise, FormatoRelatorio } from '@prisma/client';
import { RelatorioService, resumirJob, urlStatusRelatorio } from '../services/relatorio.service.js';
import { responderErro } from '../utils/http.js';

// req.apiKey sempre existe aqui: o middleware authenticateApiKey roda antes de cada rota.
export class RelatorioController {
  constructor(private service = new RelatorioService()) {}

  async solicitar(req: FastifyRequest, reply: FastifyReply) {
    try {
      const body = req.body as { categoria: CategoriaAnalise; formato?: FormatoRelatorio };
      const job = await this.service.solicitar(req.apiKey!, {
        categoria: body.categoria,
        formato: body.formato ?? FormatoRelatorio.JSON,
      });
      return reply.status(202).header('Location', urlStatusRelatorio(job.id)).send(resumirJob(job));
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async status(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const job = await this.service.consultar(req.apiKey!.organizacaoId, id);
      return reply.send(resumirJob(job));
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async download(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const { conteudo, formato, nomeArquivo } = await this.service.baixar(req.apiKey!.organizacaoId, id);
      return reply
        .header(
          'Content-Type',
          formato === FormatoRelatorio.CSV ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8'
        )
        .header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
        .send(conteudo);
    } catch (err) {
      return responderErro(reply, err);
    }
  }
}