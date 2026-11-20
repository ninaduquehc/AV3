import { FastifyRequest, FastifyReply } from 'fastify';
import { PublicService } from '../services/public.service.js';
import { responderErro } from '../utils/http.js';

// req.apiKey sempre existe aqui: o middleware authenticateApiKey roda antes de cada rota.
export class PublicController {
  constructor(private service = new PublicService()) {}

  async rastrear(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { codigoBarras } = req.params as { codigoBarras: string };
      return reply.send(await this.service.rastrear(req.apiKey!.organizacaoId, codigoBarras));
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async listarLotes(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { page, limit } = req.query as { page?: number; limit?: number };
      return reply.send(await this.service.listarLotes(req.apiKey!.organizacaoId, page ?? 1, limit ?? 20));
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async buscarLote(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      return reply.send(await this.service.buscarLote(req.apiKey!.organizacaoId, id));
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async criarLote(req: FastifyRequest, reply: FastifyReply) {
    try {
      const body = req.body as {
        codigo: string;
        dataRecebimento?: string;
        equipamentos: Array<{ codigoBarrasInterno: string; tipo: string }>;
      };
      const result = await this.service.criarLote(req.apiKey!.organizacaoId, {
        codigo: body.codigo,
        dataRecebimento: body.dataRecebimento ? new Date(body.dataRecebimento) : undefined,
        equipamentos: body.equipamentos,
      });
      return reply.status(201).send(result);
    } catch (err) {
      return responderErro(reply, err);
    }
  }
}