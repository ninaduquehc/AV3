import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

// Nunca expõe o hash fora do fluxo de validação.
const selectPublico = {
  id: true,
  nome: true,
  prefixo: true,
  scopes: true,
  limitePorMinuto: true,
  ativa: true,
  organizacaoId: true,
  ultimoUsoEm: true,
  revogadaEm: true,
  createdAt: true,
} satisfies Prisma.ApiKeySelect;

export class ApiKeyRepository {
  async create(data: Prisma.ApiKeyUncheckedCreateInput) {
    return prisma.apiKey.create({ data, select: selectPublico });
  }

  // Retorna o registro completo (inclui o hash): uso exclusivo da validação.
  async findByPrefixo(prefixo: string) {
    return prisma.apiKey.findUnique({ where: { prefixo } });
  }

  async findById(id: string) {
    return prisma.apiKey.findUnique({ where: { id }, select: selectPublico });
  }

  async findAll() {
    return prisma.apiKey.findMany({ select: selectPublico, orderBy: { createdAt: 'desc' } });
  }

  async revogar(id: string) {
    return prisma.apiKey.update({
      where: { id },
      data: { ativa: false, revogadaEm: new Date() },
      select: selectPublico,
    });
  }

  async registrarUso(id: string) {
    return prisma.apiKey.update({
      where: { id },
      data: { ultimoUsoEm: new Date() },
      select: { id: true },
    });
  }
}