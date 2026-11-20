import { FastifyRequest, FastifyReply } from 'fastify';
import { CategoriaAnalise, OrigemAnalise } from '@prisma/client';
import { AnalyticsService } from '../services/analytics/analytics.service.js';
import { responderErro } from '../utils/http.js';

export class AnalyticsController {
  constructor(private service = new AnalyticsService()) {}

  async eficiencia(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizacaoId } = req.query as { organizacaoId?: string };
      return reply.send(await this.service.eficiencia(organizacaoId));
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async rentabilidade(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizacaoId } = req.query as { organizacaoId?: string };
      return reply.send(await this.service.rentabilidade(organizacaoId));
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async vidaUtil(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizacaoId, detalhar } = req.query as { organizacaoId?: string; detalhar?: boolean };
      return reply.send(await this.service.vidaUtil({ organizacaoId, detalharEquipamentos: detalhar }));
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async recalcular(req: FastifyRequest, reply: FastifyReply) {
    try {
      const body = (req.body ?? {}) as { categorias?: CategoriaAnalise[] };
      const salvos = await this.service.recalcular(body.categorias, OrigemAnalise.MANUAL);
      return reply.status(201).send(salvos);
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async historico(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as { categoria?: CategoriaAnalise; limit?: number };
      return reply.send(await this.service.historico(query));
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async historicoPorId(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      return reply.send(await this.service.buscarRelatorio(id));
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async previsoes(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as { tipo?: string; limit?: number };
      return reply.send(await this.service.previsoes(query));
    } catch (err) {
      return responderErro(reply, err);
    }
  }
}