import { createHash, randomUUID } from 'node:crypto';
import {
  PrismaClient,
  Prisma,
  Role,
  StatusLote,
  StatusEquipamento,
  TipoOrganizacao,
  CondicaoFisica,
  ApiScope,
} from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ---------- Gerador pseudoaleatório determinístico ----------
function mulberry32(semente: number) {
  return () => {
    semente |= 0;
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261120);
const entre = (min: number, max: number) => min + rand() * (max - min);
const inteiro = (min: number, max: number) => Math.floor(entre(min, max + 1));
const escolher = <T>(lista: T[]): T => lista[Math.floor(rand() * lista.length)];
const arred = (n: number) => Math.round(n * 100) / 100;

// ---------- Parâmetros do cenário ----------
const AGORA = new Date('2026-11-20T12:00:00Z').getTime();
const H = 3600 * 1000;

const DATAS_LOTES = [
  '2026-01-10', '2026-02-03', '2026-02-27', '2026-03-23', '2026-04-16',
  '2026-05-10', '2026-06-03', '2026-06-27', '2026-07-21', '2026-08-14',
  '2026-09-07', '2026-10-01', '2026-10-22', '2026-11-06', '2026-11-14',
];

// Sazonalidade: meses mais cheios deixam o processamento mais lento
const FATOR_MES = [0.9, 0.9, 1.0, 1.0, 1.0, 1.1, 1.1, 1.0, 1.0, 1.2, 1.3, 1.3];

const TIPOS: Array<{
  tipo: string;
  vidaUtil: number;
  valorBase: number;
  marcas: Record<string, string[]>;
}> = [
  { tipo: 'Notebook', vidaUtil: 7, valorBase: 600, marcas: { Dell: ['Latitude 5420', 'Inspiron 15'], Lenovo: ['ThinkPad T14', 'IdeaPad 3'], HP: ['ProBook 450', 'EliteBook 840'] } },
  { tipo: 'Monitor LED', vidaUtil: 10, valorBase: 180, marcas: { Samsung: ['S24F350', 'T350'], LG: ['24MK430H', '22MP48'], Dell: ['P2419H', 'E2220H'] } },
  { tipo: 'Servidor Rack', vidaUtil: 9, valorBase: 1500, marcas: { Dell: ['PowerEdge R640', 'PowerEdge R440'], HP: ['ProLiant DL380', 'ProLiant DL360'], Lenovo: ['ThinkSystem SR650'] } },
  { tipo: 'Impressora', vidaUtil: 6, valorBase: 120, marcas: { HP: ['LaserJet M404', 'LaserJet Pro M15'], Epson: ['L3150', 'L375'], Brother: ['HL-1202', 'DCP-L2540'] } },
  { tipo: 'Nobreak', vidaUtil: 8, valorBase: 250, marcas: { APC: ['Back-UPS 1500', 'Smart-UPS 750'], SMS: ['Manager III', 'Net4+'] } },
];

const FATOR_MARCA: Record<string, number> = {
  Dell: 1.1, HP: 1.0, Lenovo: 1.05, Samsung: 1.0, LG: 0.95, Epson: 1.0, Brother: 0.9, APC: 1.2, SMS: 0.85,
};

const FATOR_CONDICAO: Record<CondicaoFisica, number> = {
  NAO_AVALIADO: 0, BOM: 1.0, REGULAR: 0.6, RUIM: 0.3, INSERVIVEL: 0.1,
};

// Tempo (em horas) que o equipamento permanece em cada status antes de avançar
const DURACAO_HORAS: Record<string, [number, number]> = {
  RECEBIDO: [6, 60],
  EM_TRIAGEM: [4, 24],
  EM_DESMONTAGEM: [24, 96], // gargalo proposital
  TESTE_COMPONENTES: [8, 36],
  PRONTO_REUSO: [12, 72],
  PRONTO_DESCARTE: [12, 72],
};

const S = StatusEquipamento;
const CAMINHOS: Record<'A' | 'B' | 'C', StatusEquipamento[]> = {
  A: [S.EM_TRIAGEM, S.PRONTO_REUSO, S.REUSO],
  B: [S.EM_TRIAGEM, S.EM_DESMONTAGEM, S.TESTE_COMPONENTES, S.PRONTO_REUSO, S.REUSO],
  C: [S.EM_TRIAGEM, S.EM_DESMONTAGEM, S.TESTE_COMPONENTES, S.PRONTO_DESCARTE, S.DESCARTE],
};

function condicaoPorRazao(razao: number): CondicaoFisica {
  if (razao < 0.35) return CondicaoFisica.BOM;
  if (razao < 0.7) return CondicaoFisica.REGULAR;
  if (razao < 1.0) return CondicaoFisica.RUIM;
  return CondicaoFisica.INSERVIVEL;
}

function caminhoPorCondicao(c: CondicaoFisica): 'A' | 'B' | 'C' {
  if (c === CondicaoFisica.BOM) return rand() < 0.8 ? 'A' : 'B';
  if (c === CondicaoFisica.REGULAR) return rand() < 0.5 ? 'A' : 'B';
  if (c === CondicaoFisica.RUIM) return rand() < 0.6 ? 'C' : 'B';
  return 'C';
}

// Mesma regra de sincronização usada pelo MovimentacaoService
function statusDoLote(statuses: StatusEquipamento[]): StatusLote {
  if (statuses.every((s) => s === S.REUSO || s === S.DESCARTE)) return StatusLote.PROCESSADO;
  if (statuses.some((s) => s !== S.RECEBIDO)) return StatusLote.EM_TRIAGEM;
  return StatusLote.RECEBIDO;
}

// ---------- Chaves de API de demonstração (SOMENTE DESENVOLVIMENTO) ----------
// Formato: gc_<prefixo de 8 caracteres>_<segredo de 32 hex>. Hash = SHA-256 (hex) da chave completa.
const CHAVE_DEMO_COMPLETA = 'gc_demo0001_3f9a1c5e7b2d4a6c8e0f1b3d5a7c9e2f';
const CHAVE_DEMO_LEITURA = 'gc_demo0002_8b4d6f0a2c4e6a8c0e2a4c6e8a0c2e4f';
const CHAVE_DEMO_LIMITADA = 'gc_demo0003_c1e3a5d7f9b1c3e5a7d9f1b3c5e7a9d1';
const hashChave = (chave: string) => createHash('sha256').update(chave).digest('hex');
const prefixoChave = (chave: string) => chave.split('_')[1];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ERRO DE SEGURANÇA: O comando de seed não pode ser executado em ambiente de PRODUÇÃO!');
  }

  // Limpeza em ordem respeitando Restrict
  await prisma.relatorioJob.deleteMany();
  await prisma.previsaoVidaUtil.deleteMany();
  await prisma.relatorioAnalitico.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.movimentacao.deleteMany();
  await prisma.equipamento.deleteMany();
  await prisma.lote.deleteMany();
  await prisma.contrato.deleteMany();
  await prisma.organizacao.deleteMany();
  await prisma.usuario.deleteMany();

  // 1. Usuários
  const senhaAdmin = await bcrypt.hash('admin123', 10);
  const senhaOperador = await bcrypt.hash('operador123', 10);

  await prisma.usuario.create({
    data: { nome: 'Administrador GreenCode', email: 'admin@greencode.com', senha: senhaAdmin, role: Role.ADMIN },
  });

  // "velocidade" multiplica o tempo das etapas de trabalho (menor = mais rápido)
  const defOperadores = [
    { nome: 'Operador Logístico', email: 'operador@greencode.com', velocidade: 1.0 },
    { nome: 'Operador Turno B', email: 'operador2@greencode.com', velocidade: 0.6 },
    { nome: 'Operador Turno C', email: 'operador3@greencode.com', velocidade: 1.5 },
  ];
  const operadores: Array<{ id: string; velocidade: number }> = [];
  for (const op of defOperadores) {
    const u = await prisma.usuario.create({
      data: { nome: op.nome, email: op.email, senha: senhaOperador, role: Role.OPERADOR },
    });
    operadores.push({ id: u.id, velocidade: op.velocidade });
  }

  // 2. Organizações (CNPJs válidos)
  const orgTech = await prisma.organizacao.create({
    data: { nome: 'Tech Solutions SA', cnpj: '11222333000262', tipo: TipoOrganizacao.gerador },
  });
  const orgVerde = await prisma.organizacao.create({
    data: { nome: 'Verde Corp Tecnologia LTDA', cnpj: '11222333000181', tipo: TipoOrganizacao.gerador },
  });
  const orgBanco = await prisma.organizacao.create({
    data: { nome: 'Banco Digital Brasil SA', cnpj: '11444777000161', tipo: TipoOrganizacao.gerador },
  });
  await prisma.organizacao.create({
    data: { nome: 'ReciclaTech Desmontagem LTDA', cnpj: '43722216000185', tipo: TipoOrganizacao.desmontadora },
  });

  // 3. Contratos
  await prisma.contrato.create({
    data: {
      numeroContrato: 'CTR-2026-001',
      vigenciaInicio: new Date('2026-01-01'),
      vigenciaFim: new Date('2026-12-31'),
      organizacaoId: orgTech.id,
      clausulas: {
        valorBaseMensal: 15000.0,
        tarifaPorKgResiduo: 4.5,
        metaReciclagemPorcentagem: 95,
        multaDescumprimentoPercentual: 5.0,
      },
    },
  });
  await prisma.contrato.create({
    data: {
      numeroContrato: 'CTR-2026-002',
      vigenciaInicio: new Date('2026-03-01'),
      vigenciaFim: new Date('2027-02-28'),
      organizacaoId: orgVerde.id,
      clausulas: {
        valorBaseMensal: 8000.0,
        tarifaPorKgResiduo: 3.8,
        metaReciclagemPorcentagem: 90,
        multaDescumprimentoPercentual: 3.0,
      },
    },
  });

  // 4. Chaves de API de demonstração
  await prisma.apiKey.create({
    data: {
      nome: 'Parceiro Demo - Tech Solutions (acesso completo)',
      prefixo: prefixoChave(CHAVE_DEMO_COMPLETA),
      hash: hashChave(CHAVE_DEMO_COMPLETA),
      scopes: [ApiScope.RASTREABILIDADE_READ, ApiScope.LOTES_READ, ApiScope.LOTES_WRITE, ApiScope.RELATORIOS_READ],
      limitePorMinuto: 60,
      organizacaoId: orgTech.id,
    },
  });
  await prisma.apiKey.create({
    data: {
      nome: 'Parceiro Demo - Verde Corp (somente rastreabilidade)',
      prefixo: prefixoChave(CHAVE_DEMO_LEITURA),
      hash: hashChave(CHAVE_DEMO_LEITURA),
      scopes: [ApiScope.RASTREABILIDADE_READ],
      limitePorMinuto: 60,
      organizacaoId: orgVerde.id,
    },
  });
  await prisma.apiKey.create({
    data: {
      nome: 'Parceiro Demo - Banco Digital (limite baixo)',
      prefixo: prefixoChave(CHAVE_DEMO_LIMITADA),
      hash: hashChave(CHAVE_DEMO_LIMITADA),
      scopes: [ApiScope.LOTES_READ],
      limitePorMinuto: 3,
      organizacaoId: orgBanco.id,
    },
  });

  // 5. Lotes, equipamentos e movimentações com histórico
  const geradoras = [orgTech, orgVerde, orgBanco];
  const lotes: Prisma.LoteCreateManyInput[] = [];
  const equipamentos: Prisma.EquipamentoCreateManyInput[] = [];
  const movimentacoes: Prisma.MovimentacaoCreateManyInput[] = [];
  let seq = 1;

  for (let i = 0; i < DATAS_LOTES.length; i++) {
    const recebimento = new Date(`${DATAS_LOTES[i]}T12:00:00Z`);
    const org = geradoras[i % geradoras.length];
    const operador = escolher(operadores);
    const fatorMes = FATOR_MES[recebimento.getUTCMonth()];
    const loteId = randomUUID();
    const statusDosEquipamentos: StatusEquipamento[] = [];
    const quantidade = inteiro(5, 8);

    for (let n = 0; n < quantidade; n++) {
      const cfg = escolher(TIPOS);
      const [marca, modelos] = escolher(Object.entries(cfg.marcas));
      const modelo = escolher(modelos);
      const idade = inteiro(1, cfg.vidaUtil + 4);
      const razao = idade / cfg.vidaUtil + entre(-0.12, 0.12);
      const condicao = condicaoPorRazao(razao);
      const caminho = CAMINHOS[caminhoPorCondicao(condicao)];

      // Alguns equipamentos param no meio do fluxo (em andamento)
      const limite = rand() < 0.12 ? inteiro(0, caminho.length - 1) : caminho.length;

      let t = recebimento.getTime();
      let atual: StatusEquipamento = S.RECEBIDO;
      const movs: Array<{ dataHora: Date; statusAnterior: StatusEquipamento; statusNovo: StatusEquipamento }> = [];

      for (const proximo of caminho.slice(0, limite)) {
        const [min, max] = DURACAO_HORAS[atual];
        const multiplicador = atual === S.RECEBIDO ? 1 : operador.velocidade;
        t += entre(min, max) * multiplicador * fatorMes * H;
        if (t > AGORA) break;
        movs.push({ dataHora: new Date(t), statusAnterior: atual, statusNovo: proximo });
        atual = proximo;
      }

      const avaliado = movs.length > 0;
      const eqId = randomUUID();

      equipamentos.push({
        id: eqId,
        codigoBarrasInterno: `EQP-2026-${String(seq++).padStart(4, '0')}`,
        tipo: cfg.tipo,
        marca,
        modelo,
        condicaoFisica: avaliado ? condicao : CondicaoFisica.NAO_AVALIADO,
        anoFabricacao: 2026 - idade,
        dataAvaliacao: avaliado ? movs[0].dataHora : null,
        valorRecuperacao: avaliado
          ? arred(cfg.valorBase * FATOR_CONDICAO[condicao] * (FATOR_MARCA[marca] ?? 1) * entre(0.85, 1.15))
          : null,
        status: atual,
        version: movs.length,
        loteId,
        createdAt: recebimento,
        updatedAt: avaliado ? movs[movs.length - 1].dataHora : recebimento,
      });

      for (const m of movs) {
        movimentacoes.push({ ...m, equipamentoId: eqId, usuarioId: operador.id });
      }
      statusDosEquipamentos.push(atual);
    }

    lotes.push({
      id: loteId,
      codigo: `LOT-2026-${String(i + 1).padStart(3, '0')}`,
      status: statusDoLote(statusDosEquipamentos),
      dataRecebimento: recebimento,
      organizacaoId: org.id,
      createdAt: recebimento,
      updatedAt: recebimento,
    });
  }

  // Lote cancelado (para demonstrar a regra de bloqueio)
  const dataCancelado = new Date('2026-09-15T12:00:00Z');
  const loteCanceladoId = randomUUID();
  lotes.push({
    id: loteCanceladoId,
    codigo: 'LOT-2026-016',
    status: StatusLote.CANCELADO,
    dataRecebimento: dataCancelado,
    organizacaoId: orgTech.id,
    createdAt: dataCancelado,
    updatedAt: dataCancelado,
  });
  for (let n = 0; n < 3; n++) {
    equipamentos.push({
      id: randomUUID(),
      codigoBarrasInterno: `EQP-2026-${String(seq++).padStart(4, '0')}`,
      tipo: 'Notebook',
      status: S.RECEBIDO,
      version: 0,
      loteId: loteCanceladoId,
      createdAt: dataCancelado,
      updatedAt: dataCancelado,
    });
  }

  await prisma.lote.createMany({ data: lotes });
  await prisma.equipamento.createMany({ data: equipamentos });
  await prisma.movimentacao.createMany({ data: movimentacoes });

  console.log(
    `Seed concluído: ${lotes.length} lotes, ${equipamentos.length} equipamentos, ${movimentacoes.length} movimentações.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });