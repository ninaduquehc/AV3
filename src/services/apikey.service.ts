import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiScope, Prisma } from '@prisma/client';
import { ApiKeyRepository } from '../repositories/apikey.repository.js';
import { OrganizacaoRepository } from '../repositories/organizacao.repository.js';
import { AppError } from '../models/erros.js';

// Formato: gc_<prefixo de 8 caracteres>_<segredo de 32 hex>
const FORMATO_CHAVE = /^gc_([a-z0-9]{8})_([a-f0-9]{32})$/;
const INTERVALO_REGISTRO_USO_MS = 60_000;
const MENSAGEM_INVALIDA = 'Chave de API inválida, revogada ou inativa.';

export const hashChave = (chave: string) => createHash('sha256').update(chave).digest('hex');

export type ApiKeyAutenticada = {
  id: string;
  nome: string;
  organizacaoId: string;
  scopes: ApiScope[];
  limitePorMinuto: number;
};

export class ApiKeyService {
  constructor(
    private repo = new ApiKeyRepository(),
    private orgRepo = new OrganizacaoRepository()
  ) {}

  async criar(data: { nome: string; organizacaoId: string; scopes: ApiScope[]; limitePorMinuto: number }) {
    const org = await this.orgRepo.findById(data.organizacaoId);
    if (!org) throw new AppError('Organização não encontrada.', 404);

    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const prefixo = randomBytes(4).toString('hex');
      const segredo = randomBytes(16).toString('hex');
      const chave = `gc_${prefixo}_${segredo}`;

      try {
        const criada = await this.repo.create({
          nome: data.nome,
          organizacaoId: data.organizacaoId,
          scopes: [...new Set(data.scopes)],
          limitePorMinuto: data.limitePorMinuto,
          prefixo,
          hash: hashChave(chave),
        });
        // A chave em texto puro só existe neste retorno; depois disso só o hash fica salvo.
        return { ...criada, chave };
      } catch (err) {
        const colisaoDePrefixo = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!colisaoDePrefixo || tentativa === 2) throw err;
      }
    }

    throw new AppError('Não foi possível gerar a chave de API.', 500);
  }

  async validar(chave: string): Promise<ApiKeyAutenticada> {
    const partes = FORMATO_CHAVE.exec(chave);
    if (!partes) throw new AppError(MENSAGEM_INVALIDA, 401);

    const registro = await this.repo.findByPrefixo(partes[1]);
    if (!registro) throw new AppError(MENSAGEM_INVALIDA, 401);

    const esperado = Buffer.from(registro.hash, 'hex');
    const recebido = Buffer.from(hashChave(chave), 'hex');
    const confere = esperado.length === recebido.length && timingSafeEqual(esperado, recebido);

    if (!confere || !registro.ativa || registro.revogadaEm) {
      throw new AppError(MENSAGEM_INVALIDA, 401);
    }

    // Atualiza o último uso no máximo 1 vez por minuto, sem bloquear a requisição.
    const agora = Date.now();
    if (!registro.ultimoUsoEm || agora - registro.ultimoUsoEm.getTime() > INTERVALO_REGISTRO_USO_MS) {
      this.repo.registrarUso(registro.id).catch(() => undefined);
    }

    return {
      id: registro.id,
      nome: registro.nome,
      organizacaoId: registro.organizacaoId,
      scopes: registro.scopes,
      limitePorMinuto: registro.limitePorMinuto,
    };
  }

  async listar() {
    return this.repo.findAll();
  }

  async revogar(id: string) {
    const chave = await this.repo.findById(id);
    if (!chave) throw new AppError('Chave de API não encontrada.', 404);
    if (chave.revogadaEm) return; // já revogada: operação idempotente
    await this.repo.revogar(id);
  }
}