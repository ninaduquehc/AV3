import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

// Chaves de demonstração criadas pelo seed
const CHAVE_COMPLETA = 'gc_demo0001_3f9a1c5e7b2d4a6c8e0f1b3d5a7c9e2f'; // Tech Solutions, todos os escopos
const CHAVE_LEITURA = 'gc_demo0002_8b4d6f0a2c4e6a8c0e2a4c6e8a0c2e4f'; // Verde Corp, só rastreabilidade
const CHAVE_LIMITADA = 'gc_demo0003_c1e3a5d7f9b1c3e5a7d9f1b3c5e7a9d1'; // Banco Digital, LOTES_READ, 3/min

const PUB = '/api/v1/public';
const INT = '/api/v1/internal';
const comChave = (chave: string) => ({ 'x-api-key': chave });

describe('API Pública v1', () => {
  let app: FastifyInstance;
  let tokenAdmin: string;
  let tokenOperador: string;

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const admin = await app.inject({
      method: 'POST',
      url: `${INT}/auth/login`,
      payload: { email: 'admin@greencode.com', senha: 'admin123' },
    });
    tokenAdmin = admin.json().token;

    const operador = await app.inject({
      method: 'POST',
      url: `${INT}/auth/login`,
      payload: { email: 'operador@greencode.com', senha: 'operador123' },
    });
    tokenOperador = operador.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------- Autenticação e permissões ----------
  it('Autenticação (401): rejeita requisição sem chave', async () => {
    const res = await app.inject({ method: 'GET', url: `${PUB}/lotes` });
    expect(res.statusCode).toBe(401);
  });

  it('Autenticação (401): rejeita chave em formato inválido', async () => {
    const res = await app.inject({ method: 'GET', url: `${PUB}/lotes`, headers: comChave('abc') });
    expect(res.statusCode).toBe(401);
  });

  it('Autenticação (401): rejeita chave com formato válido que não existe', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${PUB}/lotes`,
      headers: comChave(`gc_zzzzzzzz_${'0'.repeat(32)}`),
    });
    expect(res.statusCode).toBe(401);
  });

  it('Escopo (403): chave sem LOTES_READ não lista lotes', async () => {
    const res = await app.inject({ method: 'GET', url: `${PUB}/lotes`, headers: comChave(CHAVE_LEITURA) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('LOTES_READ');
  });

  it('Escopo (403): chave sem LOTES_WRITE não cria lotes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${PUB}/lotes`,
      headers: comChave(CHAVE_LEITURA),
      payload: { codigo: 'LOT-NEGADO', equipamentos: [{ codigoBarrasInterno: 'NEGADO-1', tipo: 'Notebook' }] },
    });
    expect(res.statusCode).toBe(403);
  });

  // ---------- Dados e isolamento ----------
  it('Lotes (200): lista paginada, sem expor dados internos', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${PUB}/lotes?limit=5`,
      headers: comChave(CHAVE_COMPLETA),
    });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.total).toBeGreaterThan(0);
    expect(corpo.data.length).toBeLessThanOrEqual(5);
    expect(typeof corpo.data[0].totalEquipamentos).toBe('number');
    expect(corpo.data[0]).not.toHaveProperty('organizacaoId');
  });

  it('Rastreabilidade (200): retorna equipamento e histórico da própria organização', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${PUB}/equipamentos/EQP-2026-0001/rastreabilidade`,
      headers: comChave(CHAVE_COMPLETA),
    });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.codigoBarrasInterno).toBe('EQP-2026-0001');
    expect(Array.isArray(corpo.movimentacoes)).toBe(true);
    expect(corpo).not.toHaveProperty('loteId');
  });

  it('Isolamento (404): parceiro não vê equipamento de outra organização', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${PUB}/equipamentos/EQP-2026-0001/rastreabilidade`,
      headers: comChave(CHAVE_LEITURA),
    });
    expect(res.statusCode).toBe(404);
  });

  it('Rastreabilidade (404): equipamento inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${PUB}/equipamentos/NAO-EXISTE-999/rastreabilidade`,
      headers: comChave(CHAVE_COMPLETA),
    });
    expect(res.statusCode).toBe(404);
  });

  it('Lotes (201): cria lote com inventário e permite consultá-lo', async () => {
    const stamp = Date.now();
    const codigo = `LOT-PUB-${stamp}`;

    const res = await app.inject({
      method: 'POST',
      url: `${PUB}/lotes`,
      headers: comChave(CHAVE_COMPLETA),
      payload: {
        codigo,
        equipamentos: [
          { codigoBarrasInterno: `EQP-PUB-A-${stamp}`, tipo: 'Notebook' },
          { codigoBarrasInterno: `EQP-PUB-B-${stamp}`, tipo: 'Monitor LED' },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const criado = res.json();
    expect(criado.codigo).toBe(codigo);
    expect(criado.status).toBe('RECEBIDO');
    expect(criado.totalEquipamentos).toBe(2);
    expect(criado.equipamentos).toHaveLength(2);

    const consulta = await app.inject({
      method: 'GET',
      url: `${PUB}/lotes/${criado.id}`,
      headers: comChave(CHAVE_COMPLETA),
    });
    expect(consulta.statusCode).toBe(200);
    expect(consulta.json().codigo).toBe(codigo);
  });

  it('Lotes (409): código de lote duplicado', async () => {
    const stamp = Date.now();
    const codigo = `LOT-DUP-${stamp}`;
    const enviar = (sufixo: string) =>
      app.inject({
        method: 'POST',
        url: `${PUB}/lotes`,
        headers: comChave(CHAVE_COMPLETA),
        payload: { codigo, equipamentos: [{ codigoBarrasInterno: `EQP-DUP-${sufixo}-${stamp}`, tipo: 'Mouse' }] },
      });

    expect((await enviar('1')).statusCode).toBe(201);
    expect((await enviar('2')).statusCode).toBe(409);
  });

  it('Lotes (400): rejeita lote sem equipamentos', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${PUB}/lotes`,
      headers: comChave(CHAVE_COMPLETA),
      payload: { codigo: 'LOT-VAZIO', equipamentos: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('detalhes');
  });

  it('Isolamento (404): parceiro não vê lote de outra organização', async () => {
    const lista = await app.inject({
      method: 'GET',
      url: `${PUB}/lotes?limit=1`,
      headers: comChave(CHAVE_COMPLETA),
    });
    const loteDaTech = lista.json().data[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `${PUB}/lotes/${loteDaTech}`,
      headers: comChave(CHAVE_LIMITADA),
    });
    expect(res.statusCode).toBe(404);
  });

  it('Rate limit (429): a chave de limite baixo é bloqueada ao exceder o limite', async () => {
    const codigos: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'GET', url: `${PUB}/lotes`, headers: comChave(CHAVE_LIMITADA) });
      codigos.push(res.statusCode);
    }
    expect(codigos[0]).toBe(200);
    expect(codigos).toContain(429);
    expect(codigos.filter((c) => c === 200).length).toBeLessThanOrEqual(3);
  });

  // ---------- Módulo de chaves (interno) ----------
  it('RBAC (403): OPERADOR não gera chaves de API', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${INT}/api-keys`,
      headers: bearer(tokenOperador),
      payload: {
        nome: 'Tentativa',
        organizacaoId: '00000000-0000-4000-8000-000000000000',
        scopes: ['LOTES_READ'],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Chaves (201/204): ADMIN gera, a chave funciona, não vaza o segredo e a revogação a bloqueia', async () => {
    const orgs = await app.inject({ method: 'GET', url: `${INT}/organizacoes`, headers: bearer(tokenAdmin) });
    const organizacaoId = orgs.json()[0].id;

    const criada = await app.inject({
      method: 'POST',
      url: `${INT}/api-keys`,
      headers: bearer(tokenAdmin),
      payload: { nome: 'Chave de teste', organizacaoId, scopes: ['LOTES_READ'], limitePorMinuto: 30 },
    });
    expect(criada.statusCode).toBe(201);
    const { id, chave, prefixo } = criada.json();
    expect(chave).toMatch(/^gc_[a-z0-9]{8}_[a-f0-9]{32}$/);
    expect(criada.json()).not.toHaveProperty('hash');

    const uso = await app.inject({ method: 'GET', url: `${PUB}/lotes`, headers: comChave(chave) });
    expect(uso.statusCode).toBe(200);

    const lista = await app.inject({ method: 'GET', url: `${INT}/api-keys`, headers: bearer(tokenAdmin) });
    expect(lista.statusCode).toBe(200);
    const item = lista.json().find((k: { prefixo: string }) => k.prefixo === prefixo);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('hash');
    expect(item).not.toHaveProperty('chave');

    const revogacao = await app.inject({
      method: 'DELETE',
      url: `${INT}/api-keys/${id}`,
      headers: bearer(tokenAdmin),
    });
    expect(revogacao.statusCode).toBe(204);

    const depois = await app.inject({ method: 'GET', url: `${PUB}/lotes`, headers: comChave(chave) });
    expect(depois.statusCode).toBe(401);
  });

  // ---------- Documentação ----------
  it('Swagger: a documentação pública e a interna são separadas', async () => {
    const publica = await app.inject({ method: 'GET', url: '/docs/public/json' });
    expect(publica.statusCode).toBe(200);
    const caminhosPublicos = Object.keys(publica.json().paths);
    expect(caminhosPublicos.length).toBeGreaterThan(0);
    expect(caminhosPublicos.every((p) => p.startsWith('/api/v1/public'))).toBe(true);

    const interna = await app.inject({ method: 'GET', url: '/docs/internal/json' });
    expect(interna.statusCode).toBe(200);
    const caminhosInternos = Object.keys(interna.json().paths);
    expect(caminhosInternos.some((p) => p.startsWith('/api/v1/internal'))).toBe(true);
    expect(caminhosInternos.some((p) => p.startsWith('/api/v1/public'))).toBe(false);
  });

  it('Swagger: /docs redireciona para a documentação interna', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/docs/internal');
  });
});