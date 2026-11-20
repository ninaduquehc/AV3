import { CondicaoFisica } from '@prisma/client';
import { AnalyticsRepository, EquipamentoComValor } from '../../repositories/analytics.repository.js';
import { agrupar, arredondar, resumir } from '../../utils/estatistica.js';

const mediaDe = (lista: EquipamentoComValor[]) => resumir(lista.map((i) => i.valor)).media as number;

// Função pura (sem banco): facilita teste unitário.
export function calcularRentabilidade(itens: EquipamentoComValor[]) {
  const porTipo = [...agrupar(itens, (i) => i.tipo).entries()]
    .map(([tipo, lista]) => {
      const valores = lista.map((i) => i.valor);
      const r = resumir(valores);

      const porCondicao = [...agrupar(lista, (i) => i.condicaoFisica).entries()]
        .map(([condicao, grupo]) => ({
          condicaoFisica: condicao as CondicaoFisica,
          amostras: grupo.length,
          valorMedio: mediaDe(grupo),
        }))
        .sort((a, b) => b.valorMedio - a.valorMedio);

      const porMarca = [...agrupar(lista, (i) => i.marca ?? 'Não informada').entries()]
        .map(([marca, grupo]) => ({ marca, amostras: grupo.length, valorMedio: mediaDe(grupo) }))
        .sort((a, b) => b.valorMedio - a.valorMedio);

      const porModelo = [...agrupar(lista, (i) => `${i.marca ?? ''}||${i.modelo ?? ''}`).values()]
        .map((grupo) => ({
          marca: grupo[0].marca ?? 'Não informada',
          modelo: grupo[0].modelo ?? 'Não informado',
          amostras: grupo.length,
          valorMedio: mediaDe(grupo),
        }))
        .sort((a, b) => b.valorMedio - a.valorMedio);

      return {
        tipo,
        amostras: r.amostras,
        valorMedio: r.media as number,
        medianaValor: r.mediana as number,
        desvioPadraoValor: r.desvioPadrao as number,
        valorTotal: arredondar(valores.reduce((soma, v) => soma + v, 0)),
        porCondicao,
        porMarca,
        porModelo,
      };
    })
    .sort((a, b) => b.valorMedio - a.valorMedio);

  return {
    totalAmostras: itens.length,
    porTipo,
    ranking: porTipo.map((t, indice) => ({ posicao: indice + 1, tipo: t.tipo, valorMedio: t.valorMedio })),
  };
}

export class RentabilidadeService {
  constructor(private repo = new AnalyticsRepository()) {}

  async gerar(organizacaoId?: string) {
    const itens = await this.repo.equipamentosComValor(organizacaoId);
    return calcularRentabilidade(itens);
  }
}