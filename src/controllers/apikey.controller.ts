import { FastifyRequest, FastifyReply } from 'fastify';
import { ApiScope } from '@prisma/client';
import { ApiKeyService } from '../services/apikey.service.js';
import { responderErro } from '../utils/http.js';

export class ApiKeyController {
  constructor(private service = new ApiKeyService()) {}

  async create(req: FastifyRequest, reply: FastifyReply) {
    try {
      const body = req.body as {
        nome: string;
        organizacaoId: string;
        scopes: ApiScope[];
        limitePorMinuto: number;
      };
      const result = await this.service.criar(body);
      return reply.status(201).send(result);
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async index(_req: FastifyRequest, reply: FastifyReply) {
    try {
      return reply.send(await this.service.listar());
    } catch (err) {
      return responderErro(reply, err);
    }
  }

  async delete(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      await this.service.revogar(id);
      return reply.status(204).send();
    } catch (err) {
      return responderErro(reply, err);
    }
  }
}