import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Worker } from 'bullmq';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { iniciarWorker } from '../queue/relatorio.worker.js';
import { RentabilidadeService } from '../services/analytics/rentabilidade.service.js';

const PUB = '/api/v1/public';
const INT = '/api/v1/internal';
const CHAVE_SEM_ESCOPO = 'gc_demo0002_8b4d6f0a2c4e6a8c0e2a4c6e8a0c2e4f'; // Verde Corp: só rastreabilidade
const CNPJ_TECH = '11222333000262';
const CNPJ_VERDE = '11222333000181';

describe('API Pública - relatórios assíncronos (fila BullMQ + Redis)', () => {
  let app: FastifyInstance;
  let worker: Worker;
  let tokenAdmin: string;
  let chaveTech: string;
  let chaveVerde: string;
  const idsParaRevogar: string[] = [];
  let apiKeyIdTech: string;

  const bearer = () => ({ authorization: `Bearer ${tokenAdmin}` });
  const comChave = (chave: string) => ({ 'x-api-key': chave });

  async function criarChave(organizacaoId: string, nome: string) {
    const res = await app.inject({
      method: 'POST',
      url: `${INT}/api-keys`,
      headers: bearer(),
      payload: { nome, organizacaoId, scopes: ['RELATORIOS_READ'], limitePorMinuto: 500 },
    });
    expect(res.statusCode).toBe(201);
    idsParaRevogar.push(res.json().id);
    return res.json() as { id: string; chave: string };
  }

  async function solicitar(chave: string, categoria: string, formato: string) {
    const res = await app.inject({
      method: 'POST',
      url: `${PUB}/relatorios`,
      headers: comChave(chave),
      payload: { categoria, formato },
    });
    expect(res.statusCode).toBe(202);
    return res.json() as { id: string; status: string };
  }

  async function aguardarFinal(id: string, chave: string, limiteMs = 15000) {
    const inicio = Date.now();
    for (;;) {
      const res = await app.inject({ method: 'GET', url: `${PUB}/relatorios/${id}`, headers: comChave(chave) });
      const corpo = res.json();
      if (corpo.status === 'CONCLUIDO' || corpo.status === 'FALHA') return corpo;
      if (Date.now() - inicio > limiteMs) {
        throw new Error(`Tempo esgotado aguardando o relatório ${id}; último status: ${corpo.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  beforeAll(async () => {
    process.env.RELATORIO_BACKOFF_MS = '100'; // retries rápidos nos testes

    app = await buildApp();
    await app.ready();
    worker = iniciarWorker();
    await worker.waitUntilReady();

    const login = await app.inject({
      method: 'POST',
      url: `${INT}/auth/login`,
      payload: { email: 'admin@greencode.com', senha: 'admin123' },
    });
    tokenAdmin = login.json().token;

    const orgs = (await app.inject({ method: 'GET', url: `${INT}/organizacoes`, headers: bearer() })).json() as Array<{
      id: string;
      cnpj: string;
    }>;
    const orgTech = orgs.find((o) => o.cnpj === CNPJ_TECH)!;
    const orgVerde = orgs.find((o) => o.cnpj === CNPJ_VERDE)!;

    const tech = await criarChave(orgTech.id, 'Teste relatórios - Tech');
    chaveTech = tech.chave;
    apiKeyIdTech = tech.id;
    chaveVerde = (await criarChave(orgVerde.id, 'Teste relatórios - Verde')).chave;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const id of idsParaRevogar) {
      await app.inject({ method: 'DELETE', url: `${INT}/api-keys/${id}`, headers: bearer() });
    }
    await worker.close();
    await app.close();
  });

  it('Autenticação (401): solicitar relatório exige chave', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${PUB}/relatorios`,
      payload: { categoria: 'RENTABILIDADE' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('Escopo (403): chave sem RELATORIOS_READ não solicita relatórios', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${PUB}/relatorios`,
      headers: comChave(CHAVE_SEM_ESCOPO),
      payload: { categoria: 'RENTABILIDADE' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('RELATORIOS_READ');
  });

  it('Validação (400): rejeita categoria inexistente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${PUB}/relatorios`,
      headers: comChave(chaveTech),
      payload: { categoria: 'INEXISTENTE' },
    });
    expect(res.statusCode).toBe(400);
  });

  it(
    'Fluxo completo (202 -> status -> 200): gera o relatório de rentabilidade em JSON',
    async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${PUB}/relatorios`,
        headers: comChave(chaveTech),
        payload: { categoria: 'RENTABILIDADE', formato: 'JSON' },
      });
      expect(res.statusCode).toBe(202);
      const criado = res.json();
      expect(['PENDENTE', 'PROCESSANDO', 'CONCLUIDO']).toContain(criado.status);
      expect(res.headers.location).toBe(`${PUB}/relatorios/${criado.id}`);

      const final = await aguardarFinal(criado.id, chaveTech);
      expect(final.status).toBe('CONCLUIDO');
      expect(final.tentativas).toBe(1);
      expect(final.downloadUrl).toBe(`${PUB}/relatorios/${criado.id}/download`);

      const dl = await app.inject({ method: 'GET', url: final.downloadUrl, headers: comChave(chaveTech) });
      expect(dl.statusCode).toBe(200);
      expect(dl.headers['content-type']).toContain('application/json');
      expect(dl.headers['content-disposition']).toContain('attachment');

      const corpo = JSON.parse(dl.body);
      expect(corpo.categoria).toBe('RENTABILIDADE');
      expect(Array.isArray(corpo.dados.porTipo)).toBe(true);
    },
    20000
  );

  it(
    'CSV: relatório preditivo de vida útil dos equipamentos da organização',
    async () => {
      const { id } = await solicitar(chaveTech, 'VIDA_UTIL', 'CSV');
      const final = await aguardarFinal(id, chaveTech);
      expect(final.status).toBe('CONCLUIDO');

      const dl = await app.inject({ method: 'GET', url: final.downloadUrl, headers: comChave(chaveTech) });
      expect(dl.statusCode).toBe(200);
      expect(dl.headers['content-type']).toContain('text/csv');
      expect(dl.headers['content-disposition']).toContain('.csv');

      const texto = dl.body.replace(/^\uFEFF/, '');
      const linhas = texto.trim().split('\r\n');
      expect(linhas[0]).toBe(
        'codigoBarrasInterno,tipo,status,anoFabricacao,idadeAnos,vidaUtilEstimadaAnos,vidaUtilRestanteAnos,anoInservivelProjetado'
      );
      expect(linhas.length).toBeGreaterThan(1);
      expect(linhas[1]).toContain('EQP-');
    },
    20000
  );

  it(
    'Privacidade: o relatório de eficiência não expõe nomes nem IDs de operadores',
    async () => {
      const { id } = await solicitar(chaveTech, 'EFICIENCIA_OPERACIONAL', 'JSON');
      const final = await aguardarFinal(id, chaveTech);
      expect(final.status).toBe('CONCLUIDO');

      const dl = await app.inject({ method: 'GET', url: final.downloadUrl, headers: comChave(chaveTech) });
      const corpo = JSON.parse(dl.body);

      for (const op of corpo.dados.porOperador) {
        expect(op.operador).toMatch(/^Operador \d+$/);
        expect(op).not.toHaveProperty('nome');
        expect(op).not.toHaveProperty('usuarioId');
      }
      expect(dl.body).not.toContain('Operador Turno');
      expect(dl.body).not.toContain('Operador Logístico');
    },
    20000
  );

  it('Download (409) e isolamento (404): relatório não concluído e relatório de outra organização', async () => {
    // Registro criado direto no banco e nunca enfileirado: permanece PENDENTE.
    const job = await prisma.relatorioJob.create({
      data: { categoria: 'RENTABILIDADE', formato: 'JSON', apiKeyId: apiKeyIdTech },
    });

    const baixarAntes = await app.inject({
      method: 'GET',
      url: `${PUB}/relatorios/${job.id}/download`,
      headers: comChave(chaveTech),
    });
    expect(baixarAntes.statusCode).toBe(409);

    const statusOutraOrg = await app.inject({
      method: 'GET',
      url: `${PUB}/relatorios/${job.id}`,
      headers: comChave(chaveVerde),
    });
    expect(statusOutraOrg.statusCode).toBe(404);

    const baixarOutraOrg = await app.inject({
      method: 'GET',
      url: `${PUB}/relatorios/${job.id}/download`,
      headers: comChave(chaveVerde),
    });
    expect(baixarOutraOrg.statusCode).toBe(404);
  });

  it('Status (404): relatório inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${PUB}/relatorios/00000000-0000-4000-8000-000000000000`,
      headers: comChave(chaveTech),
    });
    expect(res.statusCode).toBe(404);
  });

  it(
    'Retry: falha transitória é recuperada na segunda tentativa',
    async () => {
      const espiao = vi
        .spyOn(RentabilidadeService.prototype, 'gerar')
        .mockRejectedValueOnce(new Error('falha simulada'));

      const { id } = await solicitar(chaveTech, 'RENTABILIDADE', 'JSON');
      const final = await aguardarFinal(id, chaveTech);

      expect(final.status).toBe('CONCLUIDO');
      expect(final.tentativas).toBe(2);
      expect(final.erro).toBeNull();
      expect(espiao).toHaveBeenCalledTimes(2);
    },
    20000
  );

  it(
    'Retry: falha permanente esgota as 3 tentativas, vira FALHA e não vaza o erro interno',
    async () => {
      const espiao = vi
        .spyOn(RentabilidadeService.prototype, 'gerar')
        .mockRejectedValue(new Error('falha simulada'));

      const { id } = await solicitar(chaveTech, 'RENTABILIDADE', 'JSON');
      const final = await aguardarFinal(id, chaveTech);

      expect(final.status).toBe('FALHA');
      expect(final.tentativas).toBe(3);
      expect(final.erro).toBe('Erro interno ao gerar o relatório.');
      expect(final.downloadUrl).toBeNull();
      expect(espiao).toHaveBeenCalledTimes(3);

      const dl = await app.inject({
        method: 'GET',
        url: `${PUB}/relatorios/${id}/download`,
        headers: comChave(chaveTech),
      });
      expect(dl.statusCode).toBe(409);
    },
    20000
  );
});