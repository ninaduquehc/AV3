import { StatusEquipamento } from '@prisma/client';
import { AnalyticsRepository, EquipamentoHistorico } from '../../repositories/analytics.repository.js';
import { agrupar, resumir } from '../../utils/estatistica.js';

const HORA_MS = 3_600_000;
const MIN_AMOSTRAS_GARGALO = 3;

const horasEntre = (inicio: Date, fim: Date) => (fim.getTime() - inicio.getTime()) / HORA_MS;

type Etapa = { status: StatusEquipamento; horas: number; usuarioId: string | null };

// Função pura (sem banco): facilita teste unitário.
// Etapa = tempo que o equipamento ficou em um status. A etapa inicial (RECEBIDO) vai da data
// de recebimento do lote até a 1ª movimentação e não é atribuída a operador (é espera).
// As demais são atribuídas ao operador que encerrou a etapa (registrou a movimentação seguinte).
export function calcularEficiencia(equipamentos: EquipamentoHistorico[], nomes: Map<string, string>) {
  const etapas: Etapa[] = [];
  const lotes = new Map<
    string,
    { recebidoEm: Date; total: number; concluidos: number; ultimaSaida: Date | null }
  >();

  for (const eq of equipamentos) {
    const movs = [...eq.movimentacoes].sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime());
    const lote = lotes.get(eq.loteId) ?? {
      recebidoEm: eq.loteRecebidoEm,
      total: 0,
      concluidos: 0,
      ultimaSaida: null,
    };
    lote.total += 1;

    if (movs.length > 0) {
      const espera = horasEntre(eq.loteRecebidoEm, movs[0].dataHora);
      if (espera >= 0) etapas.push({ status: movs[0].statusAnterior, horas: espera, usuarioId: null });
    }

    for (let i = 0; i < movs.length - 1; i++) {
      const duracao = horasEntre(movs[i].dataHora, movs[i + 1].dataHora);
      if (duracao >= 0) {
        etapas.push({ status: movs[i].statusNovo, horas: duracao, usuarioId: movs[i + 1].usuarioId });
      }
    }

    // Conclusão da triagem do equipamento = primeira saída de EM_TRIAGEM
    const saida = movs.find((m) => m.statusAnterior === StatusEquipamento.EM_TRIAGEM);
    if (saida) {
      lote.concluidos += 1;
      if (!lote.ultimaSaida || saida.dataHora.getTime() > lote.ultimaSaida.getTime()) {
        lote.ultimaSaida = saida.dataHora;
      }
    }

    lotes.set(eq.loteId, lote);
  }

  // Lote com triagem concluída = todos os equipamentos já saíram de EM_TRIAGEM
  const temposLote: Array<{ mes: string; horas: number }> = [];
  let emAndamento = 0;
  for (const lote of lotes.values()) {
    if (lote.total > 0 && lote.concluidos === lote.total && lote.ultimaSaida) {
      const horas = horasEntre(lote.recebidoEm, lote.ultimaSaida);
      if (horas >= 0) temposLote.push({ mes: lote.recebidoEm.toISOString().slice(0, 7), horas });
    } else {
      emAndamento += 1;
    }
  }

  const resumoLotes = resumir(temposLote.map((t) => t.horas));

  const porEtapa = [...agrupar(etapas, (e) => e.status).entries()]
    .map(([status, lista]) => {
      const r = resumir(lista.map((e) => e.horas));
      return {
        status: status as StatusEquipamento,
        amostras: r.amostras,
        tempoMedioHoras: r.media as number,
        medianaHoras: r.mediana as number,
        gargalo: false,
      };
    })
    .sort((a, b) => b.tempoMedioHoras - a.tempoMedioHoras);

  const candidatoGargalo = porEtapa.find((e) => e.amostras >= MIN_AMOSTRAS_GARGALO);
  if (candidatoGargalo) candidatoGargalo.gargalo = true;

  const comOperador = etapas.filter((e): e is Etapa & { usuarioId: string } => e.usuarioId !== null);
  const porOperador = [...agrupar(comOperador, (e) => e.usuarioId).entries()]
    .map(([usuarioId, lista]) => {
      const triagem = lista.filter((e) => e.status === StatusEquipamento.EM_TRIAGEM).map((e) => e.horas);
      return {
        usuarioId,
        nome: nomes.get(usuarioId) ?? 'Desconhecido',
        etapasConcluidas: lista.length,
        tempoMedioPorEtapaHoras: resumir(lista.map((e) => e.horas)).media as number,
        tempoMedioTriagemHoras: triagem.length > 0 ? resumir(triagem).media : null,
      };
    })
    .sort(
      (a, b) =>
        (a.tempoMedioTriagemHoras ?? Number.MAX_SAFE_INTEGER) -
        (b.tempoMedioTriagemHoras ?? Number.MAX_SAFE_INTEGER)
    );

  const porMes = [...agrupar(temposLote, (t) => t.mes).entries()]
    .map(([mes, lista]) => ({
      mes,
      lotes: lista.length,
      tempoMedioTriagemHoras: resumir(lista.map((l) => l.horas)).media as number,
    }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  return {
    resumo: {
      lotesAnalisados: temposLote.length,
      lotesEmAndamento: emAndamento,
      tempoMedioTriagemLoteHoras: resumoLotes.media,
      medianaTriagemLoteHoras: resumoLotes.mediana,
      desvioPadraoTriagemLoteHoras: resumoLotes.desvioPadrao,
    },
    porEtapa,
    porOperador,
    porMes,
  };
}

export class EficienciaService {
  constructor(private repo = new AnalyticsRepository()) {}

  async gerar(organizacaoId?: string) {
    const equipamentos = await this.repo.equipamentosComHistorico(organizacaoId);
    const ids = [...new Set(equipamentos.flatMap((e) => e.movimentacoes.map((m) => m.usuarioId)))];
    const nomes = await this.repo.nomesUsuarios(ids);
    return calcularEficiencia(equipamentos, nomes);
  }
}