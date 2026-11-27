/**
 * Do dossiê do motor à lista que `public.mercado_argumentos_propor` recebe
 * (migração 20261119164000): uma lista COMPLETA por imóvel, por rodada. O
 * banco decide sozinho o que nasce proposto, o que renova (até 10% por rodada,
 * 20% desde a aprovação, mesmo molde e mesmo texto com só os números trocados)
 * e o que volta para aprovação; a que não vier vence. Rodar duas vezes a
 * mesma rodada não duplica nada (chave = imóvel + id da vantagem).
 *
 * O que muda de forma no caminho (e por quê):
 *   - `numeros`: os números que a frase diz (`numeros_obrigatorios`), na
 *     ordem, como n0, n1...: é o que a régua dos 10% compara;
 *   - `momentos` e `objecoes`: os rótulos do protótipo que o banco conhece. Os
 *     objetivos (quer construir, fala de carros, uso comercial...) não têm
 *     coluna: a vantagem só deles vai sem momento, e a IA (v7) a lê como "só
 *     se ele perguntar algo ligado a ela". A retomada fica de fora (fase 1:
 *     a volta de 24 h segue sem dado de mercado, nota 1 c);
 *   - a vantagem que só serve contra OUTRO bairro (`comparacao_bairro`) fica
 *     de fora: o banco não guarda contra quais bairros ela vale;
 *   - `aviso`: o "diga junto" da vantagem e os avisos do imóvel (Pipa: 10%);
 *   - `prova`: os anúncios contados (uuid), os rótulos inteiros, o rigor e a
 *     regra — o pacote que a gestão aprova e a equipe pode contestar.
 */
import { createHash } from 'node:crypto';

import { somaDias } from './estatistica';
import type { BaseMontada } from './entrada';
import type { Dossie, ImovelDoDossie, Vantagem } from './tipos';
import { fontesDaValorizacao } from './valorizacao';

/** Os momentos e as objeções que `mercado_argumentos` aceita (e a IA v7 lê). */
const MOMENTOS_DO_BANCO = ['apresentacao', 'interesse', 'preco', 'comparacao', 'antes_convite'];
const OBJECOES_DO_BANCO = [
  'caro',
  'mais_barato',
  'regiao',
  'investimento',
  'tamanho',
  'documentacao',
  'por_que_esse',
];

/** A família do motor → o eixo do banco. */
const EIXO: Record<string, string> = {
  preco: 'preco',
  tamanho: 'tamanho',
  raridade: 'raridade',
  atributo: 'atributo',
  documentacao: 'documentacao',
  entorno: 'proximidade',
  fato: 'atributo',
  regiao: 'regiao',
  serie: 'serie',
};

export interface ItemParaPropor {
  chave: string;
  regra: string;
  eixo: string;
  forca: string;
  molde: string;
  anel: string | null;
  localidade: string | null;
  regiao_id: string | null;
  sub: string | null;
  texto: string;
  fonte_texto: string;
  numeros: Record<string, number | string>;
  prova: Record<string, unknown>;
  fontes: string[];
  data_dado: string;
  coletado_em: string;
  valido_ate: string;
  momentos: string[];
  objecoes: string[];
  explica_preco: boolean;
  so_com_preco_dito: boolean;
  aviso: string | null;
  marcas: string[];
  hash_dados: string;
}

export interface PropostaDoImovel {
  /** O código do imóvel no CRM (o que o banco usa). */
  imovel: string;
  /** O código do caderno (o do protótipo). */
  ref: string;
  itens: ItemParaPropor[];
  nao_use: string[];
  /** Vantagens que o motor montou e que não vão ao banco, com o motivo. */
  fora: Array<{ id: string; motivo: string }>;
}

/** "10.000" → 10000; "48,7%" → 48.7; "R$ 420" → 420. Sem número, o texto fica. */
export function numeroDaFrase(s: string): number | string {
  const limpo = s
    .replace(/[R$%\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(limpo);
  return limpo !== '' && Number.isFinite(n) ? n : s;
}

/** Como a IA cita a fonte, de leve, sem nome de portal nem de imobiliária. */
export function fonteDeLeve(v: Vantagem): string {
  if (v.regra === 'V1') return v.prova_cliente || 'pelos índices de preço e de obras da região';
  if (v.regra === 'D1')
    return (
      (v.prova_cliente && v.prova_cliente.length <= 200 ? v.prova_cliente : null) ??
      'pela ficha do imóvel'
    );
  if (v.id === 'C2.construcao') return 'pelos alvarás de construção da Prefeitura de Natal';
  if (v.id === 'C3.nivel_apto') return 'pela Corrida dos Bairros';
  if (v.regra === 'S1') return 'pelo índice FipeZAP de Natal';
  if (v.familia === 'regiao') return 'pelo Censo 2022 do IBGE';
  if (v.familia === 'atributo') return 'pela análise da Imova dos anúncios à venda na região';
  return 'pelos anúncios à venda na região que a Imova acompanha';
}

function fontesDoItem(v: Vantagem, anuncios: string[], montada: BaseMontada): string[] {
  if (v.regra === 'V1') return fontesDaValorizacao(v);
  if (anuncios.length)
    return [
      ...new Set(
        anuncios.map((id) => montada.anuncios.get(id)?.fonte).filter((f): f is string => !!f),
      ),
    ].sort();
  if (v.id === 'C2.construcao') return ['geomapas-natal'];
  if (v.id === 'C3.nivel_apto') return ['corrida-dos-bairros'];
  if (v.regra === 'S1') return ['fipezap-planilha'];
  if (v.familia === 'regiao') return ['ibge'];
  return [];
}

function itensDaProva(v: Vantagem, regiao: string | null, ref: string): string[] {
  if (v.regra === 'V1') return [`indice:valorizacao|${regiao}`];
  if (v.regra === 'D1') return [`ficha:${ref}:${v.id}`];
  if (v.id === 'C2.construcao') return [`indice:geomapas-alvara|${regiao}`];
  if (v.id === 'C3.nivel_apto') return [`indice:corrida|${regiao}`];
  if (v.regra === 'S1') return ['indice:fipezap-natal-var12'];
  if (v.familia === 'regiao') return [`ibge:${regiao}`];
  return [];
}

/** O lugar que a frase nomeia ("em Parnamirim, fora das praias"), para o dono aprovar junto. */
function localidadeDe(v: Vantagem, curto: string | null): string | null {
  const m = /à venda (.+?),? que acompanhamos/.exec(v.texto_base);
  return (m?.[1] ?? curto ?? null)?.slice(0, 120) ?? null;
}

const hash = (o: unknown): string => createHash('sha256').update(JSON.stringify(o)).digest('hex');

function itemDe(
  v: Vantagem,
  im: ImovelDoDossie,
  ref: string,
  provas: Record<string, string[]>,
  montada: BaseMontada,
  coleta: string,
): ItemParaPropor {
  const linha = montada.carteira[ref];
  const regiao = im.regiao;
  const curto = montada.base.reg.find((r) => r.id === regiao)?.nome?.split(',')[0] ?? null;
  const idsDosAnuncios = provas[v.id] ?? [];
  const uuids = idsDosAnuncios
    .map((id) => montada.anuncios.get(id)?.uuid)
    .filter((u): u is string => !!u)
    .sort();
  const numeros = Object.fromEntries(
    v.numeros_obrigatorios.map((n, i) => [`n${i}`, numeroDaFrase(n)]),
  );
  const momentos = v.gatilhos.filter((g) => MOMENTOS_DO_BANCO.includes(g));
  const objecoes = v.gatilhos.filter((g) => OBJECOES_DO_BANCO.includes(g));
  const avisos = [v.aviso_obrigatorio, ...im.avisos_imovel].filter((a): a is string => !!a);
  const marcas = [
    ...(v.status === 'conferir' ? ['conferir'] : []),
    ...(im.possivel_mesmo_imovel && (v.familia === 'preco' || v.explica_preco)
      ? ['possivel_mesmo_imovel']
      : []),
  ];
  const prova = {
    anuncios: uuids,
    itens: itensDaProva(v, regiao, ref),
    conjunto: v.comparacao?.conjunto ?? null,
    regra: v.prova.regra ?? null,
    fonte: v.prova.fonte,
    comparacao: v.comparacao ?? null,
    rigor: v.rigor ?? null,
    gatilhos: v.gatilhos,
    retomada: !!v.retomada_v2,
    supera: v.supera ?? null,
    prova_cliente: v.prova_cliente ?? null,
    status_no_motor: v.status,
  };
  const validoAte = v.validade.valido_ate ?? somaDias(coleta, 14);
  const dataDado = v.prova.data_dado;
  return {
    chave: v.id,
    regra: v.regra,
    eixo: EIXO[v.familia] ?? 'atributo',
    forca: v.forca,
    molde: v.id,
    anel: v.eixo,
    localidade: localidadeDe(v, curto),
    regiao_id: regiao,
    sub: linha?.sub ?? null,
    texto: v.texto_base,
    fonte_texto: fonteDeLeve(v),
    numeros,
    prova,
    fontes: fontesDoItem(v, idsDosAnuncios, montada),
    data_dado: dataDado,
    coletado_em: `${coleta}T12:00:00-03:00`,
    valido_ate: validoAte < dataDado ? dataDado : validoAte,
    momentos,
    objecoes,
    explica_preco: v.explica_preco,
    so_com_preco_dito: v.so_com_preco_dito,
    aviso: avisos.length ? avisos.join(' ').slice(0, 500) : null,
    marcas,
    hash_dados: hash({ texto: v.texto_base, numeros, prova }),
  };
}

/** A lista de cada imóvel, na ordem do dossiê. */
export function proposicoes(
  dossie: Dossie,
  provas: Record<string, Record<string, string[]>>,
  montada: BaseMontada,
): PropostaDoImovel[] {
  const coleta = montada.base.coleta;
  const out: PropostaDoImovel[] = [];
  for (const im of dossie.imoveis) {
    const linha = montada.carteira[im.ref];
    if (!linha) continue;
    const fora: PropostaDoImovel['fora'] = [];
    const itens: ItemParaPropor[] = [];
    for (const v of im.vantagens) {
      const usaveis = v.gatilhos.filter((g) => g !== 'comparacao_bairro');
      if (!usaveis.length) {
        fora.push({
          id: v.id,
          motivo: 'só serve contra outro bairro, e o banco não guarda contra quais',
        });
        continue;
      }
      itens.push(itemDe(v, im, im.ref, provas[im.ref] ?? {}, montada, coleta));
    }
    for (const v of im.propostas)
      fora.push({ id: v.id, motivo: 'proposta do caderno: espera o "pode" do dono' });
    out.push({
      imovel: linha.codigo,
      ref: im.ref,
      itens,
      nao_use: im.nao_diga.map((t) => t.slice(0, 300)).slice(0, 30),
      fora,
    });
  }
  return out;
}
