import { FastifyRequest, FastifyReply } from 'fastify';
import { ApiScope } from '@prisma/client';
import { ApiKeyService } from '../services/apikey.service.js';
import { AppError } from '../models/erros.js';
import { responderErro } from '../utils/http.js';

const service = new ApiKeyService();

export async function authenticateApiKey(req: FastifyRequest, reply: FastifyReply) {
  try {
    const chave = req.headers['x-api-key'];
    if (typeof chave !== 'string' || chave.length === 0) {
      throw new AppError('Chave de API ausente. Informe o cabeçalho x-api-key.', 401);
    }
    req.apiKey = await service.validar(chave);
  } catch (err) {
    return responderErro(reply, err);
  }
}

export function requireScopes(...necessarios: ApiScope[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const concedidos = req.apiKey?.scopes ?? [];
    const faltando = necessarios.filter((s) => !concedidos.includes(s));

    if (faltando.length > 0) {
      return responderErro(
        reply,
        new AppError(`Permissão insuficiente. Escopo necessário: ${faltando.join(', ')}.`, 403)
      );
    }
  };
}