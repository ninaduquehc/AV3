import 'fastify';
import type { ApiScope } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: {
      id: string;
      nome: string;
      organizacaoId: string;
      scopes: ApiScope[];
      limitePorMinuto: number;
    };
  }
}