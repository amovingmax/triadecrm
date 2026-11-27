/**
 * AS VANTAGENS DE MERCADO que a IA que atende lê (24/11/2026, revistas em 27/11/2026).
 *
 * O sistema da Imova compara cada imóvel com os parecidos e com dados públicos; a gestão
 * aprova imóvel por imóvel; o banco manda as aprovadas e válidas em
 * `vantagens_de_mercado` (`app.ia_vantagens_de_mercado`, migração 20261127151000). Aqui:
 *   - a leitura desconfiada do que o banco manda (`lerVantagensDoBanco`);
 *   - para quem cada vantagem serve (`perfisDaVantagem`, regra 3 do dono em 27/11/2026:
 *     "entenda o que o cliente busca e personalize a vantagem para ele");
 *   - o bloco VANTAGENS DE MERCADO que vai no sistema (`montarVantagens`).
 * Era o meio da v8 da branch inteligencia-mercado (que nunca subiu); a regra das falas
 * mora na v11.
 */
import { z } from 'zod';

import { varrerMontagem } from '../../nucleo/auditoria-pii';
import type { ImovelDaBaseV2 } from './v2';

// ---------------------------------------------------------------- o que o banco manda

/** Os momentos de uma vantagem, os mesmos de `mercado_argumentos.momentos`. */
export const MOMENTOS_DE_MERCADO = [
  'apresentacao',
  'interesse',
  'preco',
  'comparacao',
  'antes_convite',
  'retomada',
] as const;
export type MomentoDeMercado = (typeof MOMENTOS_DE_MERCADO)[number];

/** Os sinais (objeções) de uma vantagem, os mesmos de `mercado_argumentos.objecoes`. */
export const SINAIS_DE_MERCADO = [
  'caro',
  'mais_barato',
  'regiao',
  'investimento',
  'tamanho',
  'documentacao',
  'por_que_esse',
] as const;
export type SinalDeMercado = (typeof SINAIS_DE_MERCADO)[number];

/** Como o modelo lê cada momento. */
export const NOMES_DOS_MOMENTOS: Readonly<Record<MomentoDeMercado, string>> = {
  apresentacao: 'apresentação',
  interesse: 'interesse forte',
  preco: 'reação ao preço',
  comparacao: 'comparação',
  antes_convite: 'antes do convite',
  retomada: 'retomada',
};

/** Como o modelo lê cada sinal. */
export const NOMES_DOS_SINAIS: Readonly<Record<SinalDeMercado, string>> = {
  caro: 'achou caro',
  mais_barato: 'viu mais barato',
  regiao: 'região',
  investimento: 'investimento',
  tamanho: 'tamanho',
  documentacao: 'documentação',
  por_que_esse: 'por que este',
};

/**
 * O que o cliente busca (regra 3 do dono, 27/11/2026): "O cliente tem filhos pequenos? Diga
 * que é uma região segura, caso seja, possui escola por perto... Ele busca moradia
 * tranquila → região calma, familiar e com segurança. Entenda o que o cliente busca e atue
 * em cima disso."
 */
export const PERFIS_DO_CLIENTE = [
  'familia',
  'tranquilidade',
  'morar',
  'investimento',
  'construir',
  'casa_de_praia',
  'comercial',
  'vem_de_fora',
] as const;
export type PerfilDoCliente = (typeof PERFIS_DO_CLIENTE)[number];

/** Como o modelo (e a tela) lê cada perfil. */
export const NOMES_DOS_PERFIS: Readonly<Record<PerfilDoCliente, string>> = {
  familia: 'filhos e família',
  tranquilidade: 'tranquilidade',
  morar: 'morar',
  investimento: 'investimento',
  construir: 'construir',
  casa_de_praia: 'casa de praia',
  comercial: 'uso comercial',
  vem_de_fora: 'vem de fora',
};

/**
 * Para quem cada vantagem serve, pela regra do catálogo (a parte da chave antes do ponto e
 * o que vem depois). A vantagem de preço serve a todos (lista vazia = qualquer cliente).
 * Uma só tabela para a IA e para a tela de aprovação.
 */
const PERFIS_POR_CHAVE: ReadonlyArray<readonly [RegExp, readonly PerfilDoCliente[]]> = [
  [/^T1\.area_terreno$/, ['familia', 'morar']],
  [/^T1\./, ['construir', 'investimento']],
  [/^R1\.(vagas|quartos|suites)$/, ['familia', 'morar']],
  [/^R1\.esquina$/, ['comercial', 'construir']],
  [/^R1\.frente_mar$/, ['casa_de_praia', 'investimento']],
  [/^A1\.(vagas|quartos)$/, ['familia', 'morar']],
  [/^A1\.frente_mar$/, ['casa_de_praia', 'investimento']],
  [/^A1\.(frente_avenida|esquina)$/, ['comercial']],
  [/^A1\.condominio_fechado$/, ['familia', 'tranquilidade']],
  [/^D1\.parque$/, ['tranquilidade', 'casa_de_praia', 'familia']],
  [/^D1\.esquina$/, ['comercial']],
  [/^D1\./, ['morar', 'investimento', 'construir']],
  [/^C2\.(populacao|populacao_municipio)$/, ['investimento', 'comercial']],
  [/^C2\.construcao$/, ['investimento', 'construir']],
  [/^C2\.renda$/, ['comercial', 'investimento']],
  [/^C2\.estrangeiros$/, ['vem_de_fora']],
  [/^C3\./, ['construir', 'investimento']],
  [/^C1\.veraneio$/, ['casa_de_praia']],
  [/^S1\./, ['investimento']],
  [/^V1\./, ['investimento']],
  [/^F1\./, ['familia', 'tranquilidade']],
  [/^E1\.(escola|creche)/, ['familia']],
  [/^E1\.(saude|hospital)/, ['familia', 'morar']],
  [/^E1\.(parque|praca)/, ['familia', 'tranquilidade']],
  [/^E1\.(mercado|comercio)/, ['morar']],
  [/^E1\.praia/, ['casa_de_praia', 'tranquilidade']],
];
export function perfisDaVantagem(chave: string): readonly PerfilDoCliente[] {
  for (const [re, perfis] of PERFIS_POR_CHAVE) if (re.test(chave)) return perfis;
  return [];
}

/** A vantagem de valorização da região (V1): a IA fala dela como manda VALORIZAÇÃO. */
export const eValorizacao = (chave: string): boolean => /^V1\./.test(chave);

/** Uma vantagem aprovada, como o worker a entende. */
export interface VantagemDeMercado {
  /** A chave estável da vantagem no banco (`mercado_argumentos.chave`). Não vai ao modelo. */
  readonly id: string;
  readonly texto: string;
  /** Como citar a fonte de leve ("pelo Censo 2022 do IBGE"). */
  readonly fonte: string | null;
  readonly momentos: readonly MomentoDeMercado[];
  readonly sinais: readonly SinalDeMercado[];
  readonly explicaPreco: boolean;
  readonly soComPrecoDito: boolean;
  /** O que tem de ir junto na mesma mensagem. */
  readonly aviso: string | null;
  /** AAAA-MM-DD. */
  readonly validoAte: string | null;
}

/** As vantagens de um imóvel. */
export interface VantagensDoImovel {
  readonly vantagens: readonly VantagemDeMercado[];
  /** "Não use neste imóvel": o que nunca dizer dele. */
  readonly naoUse: readonly string[];
  /** AAAA-MM-DD: o dado mais novo das vantagens aprovadas. */
  readonly dadosDe: string | null;
}

/** Por código de imóvel, como em IMÓVEIS. */
export type VantagensDeMercado = Readonly<Record<string, VantagensDoImovel>>;

const DATA = /^\d{4}-\d{2}-\d{2}/;

const vantagemDoBanco = z.object({
  id: z.string().trim().min(1).max(80),
  texto: z.string().trim().min(10).max(600),
  fonte: z.string().trim().max(300).nullish(),
  valido_ate: z.string().max(40).nullish(),
  momentos: z.array(z.string()).max(20).nullish().catch(null),
  objecoes: z.array(z.string()).max(20).nullish().catch(null),
  explica_preco: z.boolean().nullish().catch(null),
  so_com_preco_dito: z.boolean().nullish().catch(null),
  aviso: z.string().trim().max(600).nullish().catch(null),
});

const imovelDoBanco = z.object({
  diferenciais: z.array(z.unknown()),
  nao_use: z.array(z.unknown()).nullish().catch(null),
  dados_de: z.string().nullish().catch(null),
});

const so = <T extends string>(
  lista: readonly T[],
  valores: readonly string[] | null | undefined,
): T[] => lista.filter((v) => (valores ?? []).includes(v));

const umaLinha = (texto: string): string => texto.replace(/\s+/g, ' ').trim();

/**
 * O que o banco mandou em `vantagens_de_mercado`, lido com desconfiança: o que não tem a
 * forma esperada fica de fora, uma vantagem (ou um imóvel) por vez, e nunca derruba a
 * resposta. Fora de forma por inteiro: nenhuma vantagem.
 */
export function lerVantagensDoBanco(bruto: unknown): VantagensDeMercado {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  const lidas: Record<string, VantagensDoImovel> = {};
  for (const [codigo, valor] of Object.entries(bruto as Record<string, unknown>)) {
    const chave = codigo.trim();
    if (chave === '' || chave.length > 80) continue;
    const imovel = imovelDoBanco.safeParse(valor);
    if (!imovel.success) continue;
    const vantagens: VantagemDeMercado[] = [];
    for (const item of imovel.data.diferenciais) {
      const v = vantagemDoBanco.safeParse(item);
      if (!v.success) continue;
      vantagens.push({
        id: v.data.id,
        texto: umaLinha(v.data.texto),
        fonte: v.data.fonte ? umaLinha(v.data.fonte) : null,
        momentos: so(MOMENTOS_DE_MERCADO, v.data.momentos),
        sinais: so(SINAIS_DE_MERCADO, v.data.objecoes),
        explicaPreco: v.data.explica_preco === true,
        soComPrecoDito: v.data.so_com_preco_dito === true,
        aviso: v.data.aviso ? umaLinha(v.data.aviso) : null,
        validoAte:
          v.data.valido_ate && DATA.test(v.data.valido_ate) ? v.data.valido_ate.slice(0, 10) : null,
      });
    }
    if (vantagens.length === 0) continue;
    const naoUse = (imovel.data.nao_use ?? [])
      .filter((n): n is string => typeof n === 'string')
      .map(umaLinha)
      .filter((n) => n !== '' && n.length <= 300);
    const dadosDe =
      imovel.data.dados_de && DATA.test(imovel.data.dados_de)
        ? imovel.data.dados_de.slice(0, 10)
        : null;
    lidas[chave] = { vantagens, naoUse, dadosDe };
  }
  return lidas;
}

// ---------------------------------------------------------------- o bloco do sistema

/** No máximo por imóvel: o banco já manda na ordem (força, depois eixo). */
export const TETO_DE_VANTAGENS_POR_IMOVEL = 8;
export const TETO_DO_NAO_USE = 15;

const LETRAS = 'abcdefghijklmnop';

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** "2026-11-19" → "novembro de 2026": data em dígitos colada a número vira telefone na auditoria. */
export function mesPorExtenso(data: string | null): string | null {
  if (data === null) return null;
  const [ano, mes] = data.split('-');
  const nome = MESES[Number(mes) - 1];
  return ano && /^\d{4}$/.test(ano) && nome ? `${nome} de ${ano}` : null;
}

export interface VantagemNoBloco {
  readonly codigo: string;
  /** "a", "b"...: o que o modelo escreve no motivo ("Vantagem: TE0001 (a)"). */
  readonly letra: string;
  readonly id: string;
}

export interface DescartadaDoBloco {
  readonly codigo: string;
  readonly id: string | null;
  readonly motivo:
    | 'imovel_fora_da_lista'
    | 'imovel_pausado'
    | 'vencida'
    | 'acima_do_teto'
    | 'parece_dado_pessoal'
    | 'bloco_parece_dado_pessoal';
}

export interface BlocoDeVantagens {
  /** O bloco VANTAGENS DE MERCADO; vazio quando nada sobra (a v11 fica sem o bloco). */
  readonly texto: string;
  /** O que foi ao modelo, na ordem do bloco. */
  readonly vantagens: readonly VantagemNoBloco[];
  readonly descartadas: readonly DescartadaDoBloco[];
}

export interface OpcoesDoBloco {
  /** AAAA-MM-DD no fuso de Fortaleza: vantagem com validade antes disso fica de fora. */
  readonly hoje?: string;
}

const CABECALHO_DO_BLOCO =
  'VANTAGENS DE MERCADO (o sistema da Imova calculou e a gestão aprovou, imóvel por imóvel; todas dentro da validade; use como manda AS VANTAGENS DE MERCADO):';

function rotuloDoImovel(i: ImovelDaBaseV2, dadosDe: string | null): string {
  const lugar = [i.bairro, [i.cidade, i.estado].filter(Boolean).join('/')]
    .filter((p) => p !== null && p !== undefined && p !== '')
    .map((p) => umaLinha(String(p)));
  const mes = mesPorExtenso(dadosDe);
  return [
    i.codigo,
    i.tipo ?? 'imóvel',
    ...lugar,
    ...(mes === null ? [] : [`dados de ${mes}`]),
  ].join(' · ');
}

function linhasDaVantagem(v: VantagemDeMercado, letra: string): string {
  const marcas: string[] = [];
  if (v.momentos.length > 0)
    marcas.push(`quando: ${v.momentos.map((m) => NOMES_DOS_MOMENTOS[m]).join(', ')}`);
  if (v.sinais.length > 0)
    marcas.push(`sinais: ${v.sinais.map((s) => NOMES_DOS_SINAIS[s]).join(', ')}`);
  if (marcas.length === 0) marcas.push('quando: só se ele perguntar algo ligado a ela');
  const perfis = perfisDaVantagem(v.id);
  if (perfis.length > 0) marcas.push(`serve para: ${perfis.map((p) => NOMES_DOS_PERFIS[p]).join(', ')}`);
  if (eValorizacao(v.id)) marcas.push('valorização');
  if (v.soComPrecoDito) marcas.push('só depois do preço dito');
  if (v.explicaPreco) marcas.push('explica o preço');
  const linhas = [`  (${letra}) ${marcas.join(' · ')}`, `      ${v.texto}`];
  if (v.fonte) linhas.push(`      fonte: ${v.fonte}`);
  if (v.aviso) linhas.push(`      junto: ${v.aviso}`);
  return linhas.join('\n');
}

const semDadoPessoal = (texto: string): boolean => varrerMontagem(texto).length === 0;

/**
 * O bloco VANTAGENS DE MERCADO, em ordem estável (o cache do modelo depende de cada
 * byte): os imóveis em ordem de código, como IMÓVEIS; as vantagens na ordem do banco.
 * Entra só imóvel que está em IMÓVEIS e não está pausado; só vantagem dentro da validade,
 * até o teto, e cuja linha a auditoria não leia como telefone.
 */
export function montarVantagens(
  vantagens: VantagensDeMercado,
  imoveis: readonly ImovelDaBaseV2[],
  opcoes: OpcoesDoBloco = {},
): BlocoDeVantagens {
  const porCodigo = new Map(imoveis.map((i) => [i.codigo, i]));
  const descartadas: DescartadaDoBloco[] = [];
  const usadas: VantagemNoBloco[] = [];
  const partes: string[] = [];
  const codigos = Object.keys(vantagens).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  for (const codigo of codigos) {
    const doImovel = vantagens[codigo]!;
    const imovel = porCodigo.get(codigo);
    if (imovel === undefined || imovel.situacao === 'pausado') {
      descartadas.push({
        codigo,
        id: null,
        motivo: imovel === undefined ? 'imovel_fora_da_lista' : 'imovel_pausado',
      });
      continue;
    }
    const linhas: string[] = [];
    const doBloco: VantagemNoBloco[] = [];
    for (const v of doImovel.vantagens) {
      if (opcoes.hoje !== undefined && v.validoAte !== null && v.validoAte < opcoes.hoje) {
        descartadas.push({ codigo, id: v.id, motivo: 'vencida' });
        continue;
      }
      if (doBloco.length >= TETO_DE_VANTAGENS_POR_IMOVEL) {
        descartadas.push({ codigo, id: v.id, motivo: 'acima_do_teto' });
        continue;
      }
      const letra = LETRAS[doBloco.length]!;
      const texto = linhasDaVantagem(v, letra);
      if (!semDadoPessoal(texto)) {
        descartadas.push({ codigo, id: v.id, motivo: 'parece_dado_pessoal' });
        continue;
      }
      linhas.push(texto);
      doBloco.push({ codigo, letra, id: v.id });
    }
    if (doBloco.length === 0) continue;
    const naoUse = doImovel.naoUse.slice(0, TETO_DO_NAO_USE).filter(semDadoPessoal);
    partes.push(
      [
        `- ${rotuloDoImovel(imovel, doImovel.dadosDe)}`,
        ...linhas,
        ...(naoUse.length === 0 ? [] : [`  Não use neste imóvel: ${naoUse.join('; ')}.`]),
      ].join('\n'),
    );
    usadas.push(...doBloco);
  }
  if (partes.length === 0) return { texto: '', vantagens: [], descartadas };
  const texto = [CABECALHO_DO_BLOCO, ...partes].join('\n');
  // A rede de segurança: a auditoria corre sobre a montagem inteira (sistema e mensagem).
  // Se o bloco junto acusar o que as linhas sozinhas não acusaram, ele não vai.
  if (!semDadoPessoal(texto)) {
    return {
      texto: '',
      vantagens: [],
      descartadas: [
        ...descartadas,
        ...usadas.map((u) => ({
          codigo: u.codigo,
          id: u.id,
          motivo: 'bloco_parece_dado_pessoal' as const,
        })),
      ],
    };
  }
  return { texto, vantagens: usadas, descartadas };
}
