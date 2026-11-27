/**
 * A VALORIZAÇÃO DA REGIÃO (V1), regra 2 do dono (27/11/2026):
 *
 *   "Não devemos falar 'Não há garantia de valorização'. Caso não tenha de fato, a gente
 *   não cita nada. Mas caso haja possibilidade da região valorizar, com base nas fontes
 *   que extraímos, diga ao cliente algo parecido: 'É uma área com forte possibilidade de
 *   valorização'. [...] traduza isso para conversa e contextualize ao cliente."
 *
 * O motor olha as fontes que o banco já tem e conta os sinais da região do imóvel:
 *   - PREÇOS: o índice FipeZAP de Natal (preço médio pedido) subiu em TODOS os anos da
 *     série, comparando o mesmo mês (só para imóvel em Natal; o índice é da cidade);
 *   - COMPRA E VENDA: o ITBI arrecadado pelo município (Siconfi) não caiu em nenhum ano e
 *     cresceu pelo menos 20% do primeiro ao último ano;
 *   - OBRAS: o bairro está entre os 10 de Natal com mais unidades aprovadas em alvarás de
 *     2021 a 2023 (GeoMapas; a mesma régua da vantagem C2.construcao);
 *   - POPULAÇÃO: a população da região cresceu 15% ou mais de 2010 a 2022 (Censo do IBGE,
 *     quando o banco tiver a linha).
 * "Forte possibilidade" quando há dois sinais e um deles é de preço ou de compra e venda,
 * ou quando a compra e venda cresceu 50% ou mais sozinha. Sem isso, nenhuma frase: a IA
 * não fala de valorização. A frase vai sem número (o dono pediu conversa); os números
 * vão na prova, para quem aprova conferir. Cresceu mais de 3 vezes: vai como "conferir".
 */
import { semAc, somaDias, temNum } from './estatistica';
import type { EntradaDoBanco, LinhaDeSerie } from './entrada';
import type { BaseDoMotor, Vantagem } from './tipos';

export interface SinalDeValorizacao {
  id: 'precos' | 'compra_e_venda' | 'obras' | 'populacao';
  /** O pedaço da frase, sem número ("os preços dos imóveis em Natal subiram todos os anos desde 2022"). */
  trecho: string;
  /** A fonte, de leve ("pelo índice FipeZAP de Natal"). */
  fonte: string;
  /** A fonte na lista do banco (`mercado_fontes.id`). */
  fonteId: string;
  /** O dado mais novo do sinal (AAAA-MM-DD). */
  dataDado: string;
  numeros: Record<string, number | string>;
  /** Só a compra e venda: o quanto cresceu do primeiro ao último ano (0,5 = 50%). */
  crescimento?: number;
}

const ordenar = (l: LinhaDeSerie[]): LinhaDeSerie[] =>
  [...l].sort((a, b) => String(a.mes).localeCompare(String(b.mes)));

/** O índice FipeZAP de Natal subiu em todos os anos, no mesmo mês? */
export function sinalDePrecos(indices: LinhaDeSerie[], cidade: string): SinalDeValorizacao | null {
  if (semAc(cidade) !== 'natal') return null;
  const serie = ordenar(indices.filter((x) => x.serie === 'fipezap-natal-venda' && temNum(Number(x.valor))));
  const ult = serie.at(-1);
  if (!ult) return null;
  const mes = String(ult.mes).slice(5, 7);
  const anuais = serie.filter((x) => String(x.mes).slice(5, 7) === mes);
  if (anuais.length < 4) return null;
  for (let i = 1; i < anuais.length; i++)
    if (!(Number(anuais[i]!.valor) > Number(anuais[i - 1]!.valor))) return null;
  const ano0 = String(anuais[0]!.mes).slice(0, 4);
  return {
    id: 'precos',
    trecho: `os preços dos imóveis em Natal subiram todos os anos desde ${ano0}`,
    fonte: 'pelo índice FipeZAP de Natal',
    fonteId: 'fipezap-planilha',
    dataDado: String(ult.mes).slice(0, 10),
    numeros: Object.fromEntries(
      anuais.map((x) => [String(x.mes).slice(0, 7), Math.round(Number(x.valor))]),
    ),
  };
}

/** O ITBI arrecadado pelo município cresceu sem cair? */
export function sinalDeCompraEVenda(
  indices: LinhaDeSerie[],
  cidade: string,
): SinalDeValorizacao | null {
  const serie = ordenar(
    indices.filter(
      (x) =>
        /^itbi-anual-/.test(x.serie) && semAc(x.local ?? '') === semAc(cidade) && Number(x.valor) > 0,
    ),
  );
  if (serie.length < 3) return null;
  for (let i = 1; i < serie.length; i++)
    if (Number(serie[i]!.valor) < Number(serie[i - 1]!.valor)) return null;
  const crescimento = Number(serie.at(-1)!.valor) / Number(serie[0]!.valor) - 1;
  if (!(crescimento >= 0.2)) return null;
  return {
    id: 'compra_e_venda',
    trecho: `a compra e venda de imóveis em ${cidade} cresceu muito nos últimos anos`,
    fonte: `pelo imposto de transmissão de imóveis arrecadado em ${cidade}`,
    fonteId: 'siconfi',
    dataDado: String(serie.at(-1)!.mes).slice(0, 10),
    numeros: Object.fromEntries(
      serie.map((x) => [String(x.mes).slice(0, 4), Math.round(Number(x.valor))]),
    ),
    crescimento,
  };
}

/** O bairro (Natal) está entre os 10 com mais unidades aprovadas em alvarás de 2021 a 2023? */
export function sinalDeObras(
  construcao: BaseDoMotor['construcao'],
  bairro: string,
  cidade: string,
): SinalDeValorizacao | null {
  if (semAc(cidade) !== 'natal' || !construcao) return null;
  const soma = (x: Record<string, { unidades?: number }>, anos: string[]): number =>
    anos.reduce((t, a) => t + (x[`alvara_${a}`]?.unidades ?? 0), 0);
  const linhas = Object.entries(construcao).map(([nome, x]) => ({
    nome,
    recente: soma(x, ['2021', '2022', '2023']),
    antes: soma(x, ['2017', '2018', '2019']),
  }));
  const cidadeRecente = linhas.reduce((t, l) => t + l.recente, 0);
  const cidadeAntes = linhas.reduce((t, l) => t + l.antes, 0);
  const alvo = semAc(bairro.replace(/\s*\(.*\)\s*/g, ''));
  const ranking = [...linhas].sort((a, b) => b.recente - a.recente);
  const pos = ranking.findIndex((l) => semAc(l.nome) === alvo);
  if (pos < 0 || pos >= 10) return null;
  const l = ranking[pos]!;
  if (!(l.recente > 0)) return null;
  return {
    id: 'obras',
    trecho: `${l.nome} está entre os bairros de Natal com mais obras novas aprovadas`,
    fonte: 'pelos alvarás de construção da Prefeitura de Natal',
    fonteId: 'geomapas-natal',
    dataDado: '2023-12-31',
    numeros: {
      posicao: pos + 1,
      unidades_2021_2023: l.recente,
      unidades_2017_2019: l.antes,
      cidade_2021_2023: cidadeRecente,
      cidade_2017_2019: cidadeAntes,
    },
  };
}

/** A população da região cresceu 15% ou mais (Censo 2010–2022)? */
export function sinalDePopulacao(
  ibge: EntradaDoBanco['ibge'],
  regiao: string,
  lugar: string,
): SinalDeValorizacao | null {
  const linha = ibge.find((g) => g.regiao_id === regiao && temNum(g.crescimento_2010_2022_pct));
  const c = linha?.crescimento_2010_2022_pct;
  if (!temNum(c) || c < 15) return null;
  return {
    id: 'populacao',
    trecho: `a população ${lugar} cresceu bastante na última década`,
    fonte: 'pelo Censo do IBGE',
    fonteId: 'ibge',
    dataDado: '2022-08-01',
    numeros: { crescimento_2010_2022_pct: c },
  };
}

// O sinal do lugar (obras, população) antes do da cidade inteira (compra e venda): a frase
// fica mais do bairro.
const ORDEM: SinalDeValorizacao['id'][] = ['precos', 'obras', 'populacao', 'compra_e_venda'];
const PREFIXO_DA_FRASE = 'É uma área com forte possibilidade de valorização: ';
const TETO_DA_FRASE = 200;

/** A frase com os dois primeiros sinais (ou um, se os dois passarem do teto). */
export function fraseDaValorizacao(sinais: SinalDeValorizacao[]): string {
  const s = [...sinais].sort((a, b) => ORDEM.indexOf(a.id) - ORDEM.indexOf(b.id));
  const dois = s.length >= 2 ? `${PREFIXO_DA_FRASE}${s[0]!.trecho}, e ${s[1]!.trecho}.` : null;
  if (dois !== null && dois.length <= TETO_DA_FRASE) return dois;
  return `${PREFIXO_DA_FRASE}${s[0]!.trecho}.`;
}

/** Os sinais bastam para "forte possibilidade"? */
export function bastam(sinais: SinalDeValorizacao[]): boolean {
  const deMercado = sinais.some((x) => x.id === 'precos' || x.id === 'compra_e_venda');
  const forteSozinho = sinais.some((x) => x.id === 'compra_e_venda' && (x.crescimento ?? 0) >= 0.5);
  return (sinais.length >= 2 && deMercado) || forteSozinho;
}

/** Os sinais da região de um imóvel. */
export function sinaisDaRegiao(
  regiao: string | null,
  base: BaseDoMotor,
  entrada: Pick<EntradaDoBanco, 'indices' | 'ibge'>,
): SinalDeValorizacao[] {
  if (!regiao) return [];
  const r = base.reg.find((x) => x.id === regiao);
  if (!r) return [];
  const cidade = r.cidade;
  const bairro = String(r.nome || '').split(',')[0]!.trim();
  const lugar = bairro && semAc(bairro) !== semAc(cidade) ? `de ${bairro}` : `de ${cidade}`;
  return [
    sinalDePrecos(entrada.indices, cidade),
    sinalDeCompraEVenda(entrada.indices, cidade),
    sinalDeObras(base.construcao, bairro, cidade),
    sinalDePopulacao(entrada.ibge, regiao, lugar),
  ].filter((x): x is SinalDeValorizacao => x !== null);
}

/** A vantagem V1 do imóvel, ou null quando os sinais não bastam. */
export function vantagemDeValorizacao(
  regiao: string | null,
  base: BaseDoMotor,
  entrada: Pick<EntradaDoBanco, 'indices' | 'ibge'>,
): Vantagem | null {
  const sinais = sinaisDaRegiao(regiao, base, entrada);
  if (!bastam(sinais)) return null;
  const usados = [...sinais].sort((a, b) => ORDEM.indexOf(a.id) - ORDEM.indexOf(b.id));
  const texto = fraseDaValorizacao(usados);
  const salto = usados.some((x) => (x.crescimento ?? 0) > 2);
  const dataDado = usados.map((x) => x.dataDado).sort().at(-1)!;
  const fontes = usados.slice(0, 2).map((x) => x.fonte);
  return {
    id: 'V1.valorizacao',
    regra: 'V1',
    familia: 'serie',
    nivel: 'regiao',
    eixo: 'regiao_vs_outras',
    forca: 'B',
    status: salto ? 'conferir' : 'usar',
    texto_base: texto,
    gatilhos: ['investimento', 'regiao'],
    so_com_preco_dito: false,
    explica_preco: false,
    numeros_obrigatorios: [],
    comparacao: {
      nosso: usados.length,
      referencia: null,
      medida: 'sinais de valorização',
      n: usados.length,
      conjunto: usados.map((x) => x.id).join(', '),
    },
    rigor: {
      sinais: usados.map((x) => ({ id: x.id, trecho: x.trecho, fonte: x.fonte, numeros: x.numeros })),
      ...(salto ? { conferir: 'a compra e venda cresceu mais de 3 vezes: confira o dado antes de aprovar' } : {}),
    },
    prova: {
      fonte: usados.map((x) => x.fonte.replace(/^pel[oa]s? /, '')).join('; '),
      data_dado: dataDado,
      regra:
        'V1 (regra do dono, 27/11/2026): dois sinais nas fontes, um de preço ou de compra e venda, ou a compra e venda 50% maior',
    },
    prova_cliente: fontes.join(' e ').slice(0, 200),
    validade: { valido_ate: somaDias(base.coleta, 60), vence_com: 'data' },
  };
}

/** As fontes (ids do banco) de uma V1, para a prova. */
export function fontesDaValorizacao(v: Vantagem): string[] {
  const sinais = (v.rigor?.sinais as Array<{ id: string }> | undefined) ?? [];
  const mapa: Record<string, string> = {
    precos: 'fipezap-planilha',
    compra_e_venda: 'siconfi',
    obras: 'geomapas-natal',
    populacao: 'ibge',
  };
  return [...new Set(sinais.map((s) => mapa[s.id]).filter((x): x is string => !!x))].sort();
}
