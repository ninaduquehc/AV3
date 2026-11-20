import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { StatusEquipamento } from '@prisma/client';
import { buildApp } from '../app.js';
import { ajustarVidaUtil, resumir } from '../utils/estatistica.js';
import { calcularEficiencia } from '../services/analytics/eficiencia.service.js';

describe('Analytics - funções puras', () => {
  it('resumir calcula média, mediana e desvio padrão', () => {
    expect(resumir([2, 4, 6])).toEqual({ amostras: 3, media: 4, mediana: 4, desvioPadrao: 1.63 });
  });

  it('resumir de lista vazia retorna nulos', () => {
    expect(resumir([])).toEqual({ amostras: 0, media: null, mediana: null, desvioPadrao: null });
  });

  it('ajustarVidaUtil recupera a reta e a vida útil de dados perfeitamente lineares', () => {
    // nota = 3 - 0.3 * idade  ->  chega a 0 aos 10 anos
    const pontos: Array<[number, number]> = Array.from(
      { length: 6 },
      (_, i) => [i + 1, 3 - 0.3 * (i + 1)] as [number, number]
    );
    const m = ajustarVidaUtil(pontos);
    expect(m.inclinacao).toBeCloseTo(-0.3, 3);
    expect(m.intercepto).toBeCloseTo(3, 3);
    expect(m.vidaUtilEstimadaAnos).toBeCloseTo(10, 1);
    expect(m.r2).toBeCloseTo(1, 3);
    expect(m.observacao).toBeNull();
  });

  it('ajustarVidaUtil recusa amostras insuficientes', () => {
    const m = ajustarVidaUtil([[1, 3], [2, 2], [3, 1]]);
    expect(m.vidaUtilEstimadaAnos).toBeNull();
    expect(m.observacao).toContain('insuficientes');
  });

  it('ajustarVidaUtil recusa tendência crescente', () => {
    const m = ajustarVidaUtil([[1, 0], [2, 1], [3, 2], [4, 2], [5, 3]]);
    expect(m.vidaUtilEstimadaAnos).toBeNull();
    expect(m.observacao).toContain('Sem tendência');
  });

  it('calcularEficiencia mede tempos de lote, etapas, operador e mês', () => {
    const S = StatusEquipamento;
    const T0 = new Date('2026-01-01T00:00:00Z');
    const h = (n: number) => new Date(T0.getTime() + n * 3_600_000);

    const resultado = calcularEficiencia(
      [
        {
          id: 'a',
          loteId: 'l1',
          loteRecebidoEm: T0,
          movimentacoes: [
            { dataHora: h(10), statusAnterior: S.RECEBIDO, statusNovo: S.EM_TRIAGEM, usuarioId: 'u1' },
            { dataHora: h(20), statusAnterior: S.EM_TRIAGEM, statusNovo: S.PRONTO_REUSO, usuarioId: 'u1' },
          ],
        },
        {
          id: 'b',
          loteId: 'l1',
          loteRecebidoEm: T0,
          movimentacoes: [
            { dataHora: h(12), statusAnterior: S.RECEBIDO, statusNovo: S.EM_TRIAGEM, usuarioId: 'u1' },
            { dataHora: h(36), statusAnterior: S.EM_TRIAGEM, statusNovo: S.EM_DESMONTAGEM, usuarioId: 'u1' },
          ],
        },
        // lote sem nenhuma movimentação: continua em andamento
        { id: 'c', loteId: 'l2', loteRecebidoEm: T0, movimentacoes: [] },
      ],
      new Map([['u1', 'Ana']])
    );

    expect(resultado.resumo.lotesAnalisados).toBe(1);
    expect(resultado.resumo.lotesEmAndamento).toBe(1);
    expect(resultado.resumo.tempoMedioTriagemLoteHoras).toBe(36);
    expect(resultado.porEtapa[0]).toMatchObject({ status: 'EM_TRIAGEM', amostras: 2, tempoMedioHoras: 17 });
    expect(resultado.porEtapa[1]).toMatchObject({ status: 'RECEBIDO', amostras: 2, tempoMedioHoras: 11 });
    expect(resultado.porOperador).toEqual([
      {
        usuarioId: 'u1',
        nome: 'Ana',
        etapasConcluidas: 2,
        tempoMedioPorEtapaHoras: 17,
        tempoMedioTriagemHoras: 17,
      },
    ]);
    expect(resultado.porMes).toEqual([{ mes: '2026-01', lotes: 1, tempoMedioTriagemHoras: 36 }]);
  });
});

describe('Analytics - endpoints internos', () => {
  let app: FastifyInstance;
  let tokenAdmin: string;
  let organizacaoId: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const base = '/api/v1/internal/analytics';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/auth/login',
      payload: { email: 'admin@greencode.com', senha: 'admin123' },
    });
    tokenAdmin = login.json().token;

    const orgs = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/organizacoes',
      headers: auth(tokenAdmin),
    });
    organizacaoId = orgs.json()[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Autenticação (401): analytics exige token', async () => {
    const res = await app.inject({ method: 'GET', url: `${base}/eficiencia-operacional` });
    expect(res.statusCode).toBe(401);
  });

  it('RBAC (403): CLIENTE não acessa analytics', async () => {
    const email = `cliente.${Date.now()}@greencode.com`;
    const criado = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/usuarios',
      headers: auth(tokenAdmin),
      payload: { nome: 'Cliente Teste', email, senha: 'cliente123', role: 'CLIENTE' },
    });
    expect(criado.statusCode).toBe(201);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/auth/login',
      payload: { email, senha: 'cliente123' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `${base}/eficiencia-operacional`,
      headers: auth(login.json().token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('Eficiência (200): retorna resumo, etapas, operadores e meses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${base}/eficiencia-operacional`,
      headers: auth(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.resumo.lotesAnalisados).toBeGreaterThan(0);
    expect(corpo.resumo.tempoMedioTriagemLoteHoras).toBeGreaterThan(0);
    expect(corpo.porEtapa.length).toBeGreaterThan(0);
    expect(corpo.porOperador.length).toBeGreaterThan(0);
    expect(corpo.porMes.length).toBeGreaterThan(0);
  });

  it('Eficiência (200): aceita filtro por organização', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${base}/eficiencia-operacional?organizacaoId=${organizacaoId}`,
      headers: auth(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
  });

  it('Rentabilidade (200): ranking por tipo em ordem decrescente de valor médio', async () => {
    const res = await app.inject({ method: 'GET', url: `${base}/rentabilidade`, headers: auth(tokenAdmin) });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.porTipo.length).toBeGreaterThan(0);
    const valores = corpo.ranking.map((r: { valorMedio: number }) => r.valorMedio);
    expect(valores).toEqual([...valores].sort((a: number, b: number) => b - a));
  });

  it('Vida útil (200): modelos por tipo e detalhamento por equipamento', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${base}/vida-util?detalhar=true`,
      headers: auth(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.porTipo.length).toBeGreaterThan(0);

    const comModelo = corpo.porTipo.filter(
      (p: { vidaUtilEstimadaAnos: number | null }) => p.vidaUtilEstimadaAnos !== null
    );
    expect(comModelo.length).toBeGreaterThan(0);
    for (const p of comModelo) expect(p.vidaUtilEstimadaAnos).toBeGreaterThan(0);

    expect(Array.isArray(corpo.equipamentos)).toBe(true);
  });

  it('Recalcular (201): persiste as 3 categorias e permite consultar o histórico', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${base}/recalcular`,
      headers: auth(tokenAdmin),
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const salvos = res.json();
    expect(salvos.map((s: { categoria: string }) => s.categoria).sort()).toEqual([
      'EFICIENCIA_OPERACIONAL',
      'RENTABILIDADE',
      'VIDA_UTIL',
    ]);

    const historico = await app.inject({
      method: 'GET',
      url: `${base}/historico?categoria=VIDA_UTIL`,
      headers: auth(tokenAdmin),
    });
    expect(historico.statusCode).toBe(200);
    expect(historico.json().length).toBeGreaterThan(0);

    const idVidaUtil = salvos.find((s: { categoria: string }) => s.categoria === 'VIDA_UTIL').id;
    const detalhe = await app.inject({
      method: 'GET',
      url: `${base}/historico/${idVidaUtil}`,
      headers: auth(tokenAdmin),
    });
    expect(detalhe.statusCode).toBe(200);
    expect(detalhe.json().resultado).toHaveProperty('porTipo');
    expect(detalhe.json().previsoes.length).toBeGreaterThan(0);
  });

  it('Previsões (200): lista o histórico de previsões por tipo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${base}/previsoes?tipo=Notebook`,
      headers: auth(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);
  });

  it('Histórico (404): relatório inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${base}/historico/00000000-0000-4000-8000-000000000000`,
      headers: auth(tokenAdmin),
    });
    expect(res.statusCode).toBe(404);
  });
});