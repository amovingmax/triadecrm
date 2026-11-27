/**
 * Ajustes → Inteligência de mercado → Vantagens para a IA: as regras sem tela
 * (etapa 6, 19/11/2026, só na Imova; só admin e gestor).
 *
 * O motor propõe, por imóvel da carteira, as vantagens verdadeiras (número, de onde
 * veio, data); o dono aprova POR IMÓVEL e a IA só recebe o que está aprovado e dentro
 * da validade (`public.mercado_vantagens_para_ia`). Aqui mora o que dá para decidir
 * sem React e sem banco: a situação de cada vantagem em palavras simples, o que mudou
 * desde a última aprovação, de onde veio o número, quando a IA usa, o que acontece ao
 * aprovar ou reprovar e as recusas do banco em frases claras.
 *
 * NENHUM NOME DE PORTAL NOS TEXTOS DESTE ARQUIVO (decisão do dono, 18/11/2026). De
 * onde vieram os anúncios aparece como "anúncios à venda de N sites liberados", sem
 * nome. O TEXTO de cada vantagem e a fonte citada aparecem como estão no banco, porque
 * são exatamente o que a IA manda ao cliente e o dono precisa ver o que aprova; o banco
 * já recusa texto com nome de fonte de anúncio (`app.mercado_texto_proibido`). Se mesmo
 * assim o texto citar um nome ligado a portal (o índice da Fipe tem um no nome), a tela
 * avisa (`avisoDePortalNoTexto`) em vez de esconder.
 */
import { NOMES_DOS_PERFIS, perfisDaVantagem } from '@komune/prompts';
import { TIMEZONE } from '@komune/schema';

import {
  citaPortal,
  diaEMes,
  limparTexto,
  nomeNaTela,
  proximaColeta,
  quandoFoi,
  resumoDaUltimaColeta,
  type ChaveDaColeta,
  type Coleta,
  type FonteDeMercado,
} from './mercado-regras';

// ---------------------------------------------------------------------------
// O que vem do banco
// ---------------------------------------------------------------------------

export type StatusDaVantagem = 'proposto' | 'aprovado' | 'recusado' | 'vencido';

export type Momento =
  'apresentacao' | 'interesse' | 'preco' | 'comparacao' | 'antes_convite' | 'retomada';

export type Objecao =
  'caro' | 'mais_barato' | 'regiao' | 'investimento' | 'tamanho' | 'documentacao' | 'por_que_esse';

/** Números de uma vantagem (`numeros`, `aprovado_numeros`): só o que é número conta. */
export type Numeros = Record<string, unknown>;

/** Uma linha de `public.mercado_argumentos`, só com o que a tela usa. */
export type VantagemDoMercado = {
  id: string;
  imovel_codigo: string;
  chave: string;
  regra: string;
  eixo: string;
  forca: 'A' | 'B' | 'C' | string;
  texto: string;
  fonte_texto: string;
  numeros: Numeros;
  prova: { anuncios?: unknown; itens?: unknown; conjunto?: unknown } | null;
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
  status: StatusDaVantagem | string;
  motivo_status: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
  aprovado_numeros: Numeros | null;
  aprovado_texto: string | null;
  renovacoes: number;
  renovado_em: string | null;
  ultima_versao_em: string | null;
  recusado_por: string | null;
  recusado_em: string | null;
  criado_em: string;
  atualizado_em: string;
};

/** A última vez que o motor rodou para um imóvel (`public.mercado_motor_execucoes`). */
export type ExecucaoDoMotor = {
  imovel_codigo: string;
  executado_em: string;
  nao_use: string[];
};

/** O código e o título de um imóvel da carteira (`anuncios` ou `anuncios_no_canal_pro`). */
export type ImovelDaCarteira = { codigo: string; titulo: string | null };

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

const DIA_ISO = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIMEZONE,
});

/** Hoje em Natal, "2026-11-19" (a régua de `app.mercado_hoje()`). */
export function hojeEmNatal(agora: Date): string {
  return DIA_ISO.format(agora);
}

/**
 * Coluna `date` ("2026-12-03") em "03/12"; com o ano quando não é o de `hoje`. A data
 * pura é fatiada, nunca convertida: `new Date('2026-12-03')` é meia-noite em UTC, que
 * em Natal ainda é o dia 2.
 */
export function dataCurta(data: string, hoje: string): string {
  const [ano, mes, dia] = data.slice(0, 10).split('-');
  if (!ano || !mes || !dia) return data;
  return ano === hoje.slice(0, 4) ? `${dia}/${mes}` : `${dia}/${mes}/${ano}`;
}

// ---------------------------------------------------------------------------
// A situação de cada vantagem
// ---------------------------------------------------------------------------

export type Situacao = 'proposta' | 'aprovada' | 'renovada' | 'vencida' | 'reprovada';

export const ROTULO_DA_SITUACAO: Record<Situacao, string> = {
  proposta: 'Proposta',
  aprovada: 'Aprovada',
  renovada: 'Renovada sozinha',
  vencida: 'Vencida',
  reprovada: 'Reprovada',
};

/**
 * A situação na tela. A vencida pela data conta como vencida mesmo antes da rotina
 * das 3h15 trocar o estado no banco: a IA já não recebe (`valido_ate >= hoje`).
 */
export function situacaoDaVantagem(
  v: Pick<VantagemDoMercado, 'status' | 'valido_ate' | 'renovacoes'>,
  hoje: string,
): Situacao {
  if (v.status === 'recusado') return 'reprovada';
  if (v.status === 'vencido') return 'vencida';
  if (v.valido_ate < hoje) return 'vencida';
  if (v.status === 'aprovado') return v.renovacoes > 0 ? 'renovada' : 'aprovada';
  return 'proposta';
}

/** Vai para a IA hoje (fora a chave da coleta e as travas que só o banco sabe). */
export function emUso(situacao: Situacao): boolean {
  return situacao === 'aprovada' || situacao === 'renovada';
}

/** Os motivos da volta para aprovação (`renovacao_negada: a, b`) em frases simples. */
const MOTIVO_DA_VOLTA: Record<string, string> = {
  mudou_a_regra_a_forca_o_molde_o_anel_ou_a_localidade:
    'a comparação mudou de jeito (outro grupo de imóveis, outro lugar ou outra força)',
  texto_mudou: 'a frase mudou além dos números',
  'numero_mudou_mais_de_10%': 'um número mudou mais de 10% desde a última versão',
  'numero_mudou_mais_de_20%_desde_a_aprovacao': 'um número mudou mais de 20% desde a aprovação',
  marca_nova: 'apareceu um alerta novo nos dados',
  ficha_do_imovel_mudou: 'a ficha do imóvel mudou (preço, área ou bairro)',
  nao_passou_na_rodada_anterior: 'ela não apareceu na coleta anterior',
  amostra_semanal_sem_conferencia:
    'a equipe não conferiu a amostra semanal nas duas últimas semanas',
  fonte_em_quarentena: 'uma das fontes dos números está em quarentena',
};

export function motivosDaVolta(motivo: string | null | undefined): string[] {
  if (!motivo) return [];
  const m = motivo.match(/^renovacao_negada:\s*(.*)$/);
  if (!m) return [];
  return (m[1] ?? '')
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => MOTIVO_DA_VOLTA[parte] ?? 'os dados mudaram');
}

/** "a, b e c". */
export function juntar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * A frase da situação, embaixo do selo: quem aprovou e quando, por que voltou, por
 * que venceu, o motivo da reprovação.
 */
export function detalheDaSituacao(
  v: VantagemDoMercado,
  situacao: Situacao,
  hoje: string,
  nomeDe: (id: string) => string | null,
): string {
  const quem = (id: string | null) =>
    id ? (nomeDe(id) ?? 'alguém da equipe') : 'alguém da equipe';
  const motivoLivre = limparTexto(v.motivo_status);
  switch (situacao) {
    case 'aprovada':
      return v.aprovado_em
        ? `Aprovada por ${quem(v.aprovado_por)} em ${diaEMes(v.aprovado_em)}. A IA já pode usar.`
        : 'Aprovada. A IA já pode usar.';
    case 'renovada': {
      const ultima = v.ultima_versao_em ?? v.renovado_em;
      const vezes = v.renovacoes === 1 ? '' : ` ${v.renovacoes} vezes, a última`;
      const aprovada = v.aprovado_em
        ? `Aprovada por ${quem(v.aprovado_por)} em ${diaEMes(v.aprovado_em)}`
        : 'Aprovada';
      return `${aprovada} e renovada sozinha${vezes}${ultima ? ` em ${diaEMes(ultima)}` : ''}: só os números mudaram, até 10%.`;
    }
    case 'reprovada':
      return `Reprovada por ${quem(v.recusado_por)}${v.recusado_em ? ` em ${diaEMes(v.recusado_em)}` : ''}${
        motivoLivre ? `: “${motivoLivre}”` : '.'
      }`;
    case 'vencida':
      if (v.motivo_status === 'saiu_do_motor') {
        return `Saiu da IA em ${diaEMes(v.atualizado_em)}: na última coleta ela não passou mais nas regras.`;
      }
      return `Venceu em ${dataCurta(v.valido_ate, hoje)} e não vai mais para a IA. A próxima coleta refaz a conta.`;
    case 'proposta': {
      const motivos = motivosDaVolta(v.motivo_status);
      if (motivos.length > 0) {
        return `Voltou para aprovação em ${diaEMes(v.atualizado_em)}: ${juntar(motivos)}.`;
      }
      if (v.marcas.includes('contestado') && motivoLivre) {
        return `Saiu da IA em ${diaEMes(v.atualizado_em)}: “${motivoLivre}”.`;
      }
      if (v.aprovado_em && motivoLivre) {
        return `Devolvida para aprovação em ${diaEMes(v.atualizado_em)}: “${motivoLivre}”.`;
      }
      return `O motor propôs em ${diaEMes(v.criado_em)}. Só vai para a IA depois da aprovação.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Os alertas (marcas) de cada vantagem
// ---------------------------------------------------------------------------

/** As marcas que impedem a aprovação (`public.mercado_argumento_decidir`). */
const MARCAS_QUE_TRAVAM = ['contestado', 'quarentena', 'possivel_mesmo_imovel'];

const MARCA: Record<string, string> = {
  conferir:
    'Pede conferência: alguém da equipe precisa confirmar que o anúncio comparado é parecido de verdade antes de aprovar.',
  possivel_mesmo_imovel:
    'Pode ser este mesmo imóvel anunciado por outra imobiliária. Decida isso na Inteligência de mercado antes de aprovar.',
  quarentena:
    'Uma das fontes dos números está em quarentena: a conferência da equipe achou erros. Não dá para aprovar agora.',
  salto:
    'Os preços da região deram um salto nesta coleta. Ela pode ser aprovada, mas não se renova sozinha.',
  contestado:
    'A equipe marcou como errado um anúncio ou fato usado na conta. Não dá para aprovar até a próxima coleta.',
};

export type MarcaNaTela = { marca: string; texto: string; trava: boolean };

export function marcasNaTela(marcas: readonly string[]): MarcaNaTela[] {
  return marcas
    .filter((m) => MARCA[m])
    .map((m) => ({ marca: m, texto: MARCA[m] as string, trava: MARCAS_QUE_TRAVAM.includes(m) }));
}

export function travaAprovacao(v: Pick<VantagemDoMercado, 'marcas'>): boolean {
  return v.marcas.some((m) => MARCAS_QUE_TRAVAM.includes(m));
}

export function pedeConferencia(v: Pick<VantagemDoMercado, 'marcas'>): boolean {
  return v.marcas.includes('conferir');
}

/**
 * O texto vai ao cliente como está; se citar um nome ligado a portal de anúncios, a
 * tela avisa (sem repetir o nome).
 */
export function avisoDePortalNoTexto(
  v: Pick<VantagemDoMercado, 'texto' | 'fonte_texto'>,
): string | null {
  if (!citaPortal(v.texto) && !citaPortal(v.fonte_texto)) return null;
  return 'Esta frase cita um nome ligado a um portal de anúncios. A IA manda a frase assim: reprove se não quiser essa associação.';
}

// ---------------------------------------------------------------------------
// A prova: números, de onde veio, base, data
// ---------------------------------------------------------------------------

const ROTULO_DO_NUMERO: Record<string, string> = {
  comparados: 'Comparados',
  n: 'Comparados',
  menores: 'Menores que este',
  maiores: 'Maiores que este',
  pedem_mais: 'Pedem mais',
  nosso: 'Deste imóvel',
  referencia: 'Referência',
  area: 'Área (m²)',
  renda: 'Renda média',
  cidade: 'Média da cidade',
  var: 'Variação (%)',
};

/** A ordem da tela: o tamanho da amostra primeiro. */
const ORDEM_DO_NUMERO = [
  'comparados',
  'n',
  'menores',
  'maiores',
  'pedem_mais',
  'nosso',
  'referencia',
];

export function rotuloDoNumero(chave: string): string {
  const n = chave.match(/^numero_(\d+)$/);
  if (n) return `Número ${n[1]}`;
  return ROTULO_DO_NUMERO[chave] ?? maiuscula(chave.replace(/_/g, ' '));
}

const NUMERO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function numeroNaTela(n: number): string {
  return NUMERO.format(n);
}

export type NumeroNaTela = { chave: string; rotulo: string; valor: string };

function ehNumero(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function chavesEmOrdem(numeros: Numeros): string[] {
  const peso = (k: string) => {
    const i = ORDEM_DO_NUMERO.indexOf(k);
    return i === -1 ? ORDEM_DO_NUMERO.length : i;
  };
  return Object.keys(numeros).sort((a, b) => peso(a) - peso(b) || a.localeCompare(b));
}

export function numerosNaTela(numeros: Numeros | null | undefined): NumeroNaTela[] {
  if (!numeros || typeof numeros !== 'object') return [];
  return chavesEmOrdem(numeros)
    .filter((k) => ehNumero(numeros[k]))
    .map((k) => ({
      chave: k,
      rotulo: rotuloDoNumero(k),
      valor: numeroNaTela(numeros[k] as number),
    }));
}

function quantosAnuncios(prova: VantagemDoMercado['prova']): number {
  const lista = prova?.anuncios;
  return Array.isArray(lista) ? lista.length : 0;
}

/** "IBGE (Censo 2022, malha de setores...)" vira "IBGE": o nome, sem o detalhe técnico. */
function nomeCurtoDaFonte(fonte: FonteDeMercado): string {
  const nome = nomeNaTela(fonte);
  const curto = nome
    .replace(/\s*\([^)]*\)/g, '')
    .split(',')[0]
    ?.trim();
  return curto || nome;
}

/**
 * De onde veio, em linguagem simples. Os sites de anúncio não são nomeados: "31
 * anúncios à venda de 2 sites liberados". As outras fontes vão pelo nome curto
 * ("IBGE", "Índice de preços de imóveis da Fipe"). Sem fonte, é a ficha do imóvel.
 */
export function deOndeVeio(
  v: Pick<VantagemDoMercado, 'fontes' | 'prova'>,
  fontes: readonly FonteDeMercado[],
): string {
  const porId = new Map(fontes.map((f) => [f.id, f]));
  const sites = v.fontes.filter((id) => porId.get(id)?.grupo === 'anuncios').length;
  const anuncios = quantosAnuncios(v.prova);
  const partes: string[] = [];
  if (sites > 0 || anuncios > 0) {
    const quantos =
      anuncios > 0
        ? `${numeroNaTela(anuncios)} ${anuncios === 1 ? 'anúncio' : 'anúncios'} à venda`
        : 'anúncios à venda';
    const de = sites > 0 ? ` de ${sites} ${sites === 1 ? 'site liberado' : 'sites liberados'}` : '';
    partes.push(quantos + de);
  }
  for (const id of v.fontes) {
    const fonte = porId.get(id);
    if (!fonte || fonte.grupo === 'anuncios') continue;
    const nome = nomeCurtoDaFonte(fonte);
    if (!partes.includes(nome)) partes.push(nome);
  }
  return partes.length > 0 ? juntar(partes) : 'a ficha do imóvel';
}

/** A base da conta ("casas de 43 a 96 m² em Extremoz..."), sem nome de portal. */
export function baseDaConta(v: Pick<VantagemDoMercado, 'prova'>): string | null {
  const conjunto = v.prova?.conjunto;
  return typeof conjunto === 'string' ? limparTexto(conjunto) : null;
}

/** "Vale até 03/12"; com o ano quando é outro. */
export function validadeNaTela(valido_ate: string, hoje: string): string {
  if (valido_ate < hoje) return `Venceu em ${dataCurta(valido_ate, hoje)}`;
  if (valido_ate === hoje) return 'Vale até hoje';
  return `Vale até ${dataCurta(valido_ate, hoje)}`;
}

// ---------------------------------------------------------------------------
// O que mudou desde a última aprovação
// ---------------------------------------------------------------------------

export type NumeroQueMudou = {
  rotulo: string;
  antes: string | null;
  agora: string | null;
  /** "+13%", "-4%"; nulo quando um dos dois lados não existe ou o antes é zero. */
  variacao: string | null;
};

export type Mudanca = {
  /** Desde quando se compara: a aprovação feita por pessoa. */
  desde: string;
  numeros: NumeroQueMudou[];
  /** A frase aprovada, quando a de agora é outra. */
  textoAntes: string | null;
};

/**
 * Compara a versão de agora com a que uma pessoa aprovou (`aprovado_numeros`,
 * `aprovado_texto`). Só para a proposta que já foi aprovada antes e para a renovada.
 */
export function oQueMudou(v: VantagemDoMercado, situacao: Situacao): Mudanca | null {
  if (!v.aprovado_em || (situacao !== 'proposta' && situacao !== 'renovada')) return null;
  const antes = (v.aprovado_numeros ?? {}) as Numeros;
  const agora = (v.numeros ?? {}) as Numeros;
  const chaves = chavesEmOrdem({ ...antes, ...agora });
  const numeros: NumeroQueMudou[] = [];
  for (const k of chaves) {
    const a = antes[k];
    const b = agora[k];
    const aNum = ehNumero(a) ? a : null;
    const bNum = ehNumero(b) ? b : null;
    if (aNum === null && bNum === null) continue;
    if (aNum === bNum) continue;
    let variacao: string | null = null;
    if (aNum !== null && bNum !== null && aNum !== 0) {
      const pct = Math.round((bNum / aNum - 1) * 100);
      variacao = `${pct > 0 ? '+' : ''}${pct}%`;
    }
    numeros.push({
      rotulo: rotuloDoNumero(k),
      antes: aNum === null ? null : numeroNaTela(aNum),
      agora: bNum === null ? null : numeroNaTela(bNum),
      variacao,
    });
  }
  const textoAntes = v.aprovado_texto && v.aprovado_texto !== v.texto ? v.aprovado_texto : null;
  if (numeros.length === 0 && !textoAntes) return null;
  return { desde: diaEMes(v.aprovado_em), numeros, textoAntes };
}

// ---------------------------------------------------------------------------
// Quando a IA usa
// ---------------------------------------------------------------------------

/**
 * Os momentos e as deixas do cliente em que a IA pode usar a vantagem (decisão do
 * dono, 18/11: apresentação, deixas do cliente e a retomada de 24 h; nunca abre a
 * conversa com dados). Rótulos curtos: a tela os mostra lado a lado.
 */
export const ROTULO_DO_MOMENTO: Record<Momento, string> = {
  apresentacao: 'Ao apresentar o imóvel',
  interesse: 'Interesse forte',
  preco: 'Pergunta do preço',
  comparacao: 'Comparação com outro imóvel ou bairro',
  antes_convite: 'Antes do convite para a visita',
  retomada: 'Retomada de 24 h',
};

export const ROTULO_DA_OBJECAO: Record<Objecao, string> = {
  caro: 'Acha caro',
  mais_barato: 'Achou mais barato',
  regiao: 'Pergunta da região',
  investimento: 'Pergunta de investimento',
  tamanho: 'Pergunta do tamanho',
  documentacao: 'Pergunta da documentação',
  por_que_esse: 'Por que este imóvel',
};

/** ["Ao apresentar o imóvel", "Retomada de 24 h", "Pergunta do tamanho"]. */
export function momentosNaTela(
  v: Pick<VantagemDoMercado, 'momentos' | 'objecoes' | 'so_com_preco_dito'>,
): string[] {
  const partes = [
    ...v.momentos
      .filter((m): m is Momento => m in ROTULO_DO_MOMENTO)
      .map((m) => ROTULO_DO_MOMENTO[m]),
    ...v.objecoes
      .filter((o): o is Objecao => o in ROTULO_DA_OBJECAO)
      .map((o) => ROTULO_DA_OBJECAO[o]),
  ];
  if (partes.length === 0) partes.push('Se o assunto aparecer na conversa');
  if (v.so_com_preco_dito) partes.push('Só depois de dizer o preço');
  return [...new Set(partes)];
}

/**
 * Para quem a vantagem serve (regra 3 do dono, 27/11/2026: "entenda o que o cliente busca
 * e personalize a vantagem para ele"): a mesma tabela que a IA lê. Vazio = qualquer
 * cliente (o preço, por exemplo).
 */
export function paraQuemServe(v: Pick<VantagemDoMercado, 'chave'>): string[] {
  return perfisDaVantagem(v.chave).map((p) => {
    const nome = NOMES_DOS_PERFIS[p];
    return nome.charAt(0).toUpperCase() + nome.slice(1);
  });
}

/** "Ao apresentar o imóvel · Retomada de 24 h · Pergunta do tamanho". */
export function quandoAIaUsa(
  v: Pick<VantagemDoMercado, 'momentos' | 'objecoes' | 'so_com_preco_dito'>,
): string {
  return momentosNaTela(v).join(' · ');
}

export const ROTULO_DA_FORCA: Record<string, string> = {
  A: 'Muito forte',
  B: 'Forte',
  C: 'Complementar',
};

export function forcaNaTela(forca: string): string {
  return ROTULO_DA_FORCA[forca] ?? 'Complementar';
}

// ---------------------------------------------------------------------------
// Por imóvel
// ---------------------------------------------------------------------------

export type VantagemNaTela = { v: VantagemDoMercado; situacao: Situacao };

export type ImovelComVantagens = {
  codigo: string;
  titulo: string;
  /** Propostas que esperam decisão (fora as vencidas). */
  propostas: VantagemNaTela[];
  /** Aprovadas e renovadas dentro da validade. */
  emUso: VantagemNaTela[];
  /** Vencidas e reprovadas: ficam recolhidas. */
  fora: VantagemNaTela[];
  /** "Não diga" da última vez que o motor rodou para o imóvel. */
  naoDiga: string[];
  ultimaConta: string | null;
};

const PESO_DA_SITUACAO: Record<Situacao, number> = {
  proposta: 0,
  renovada: 1,
  aprovada: 1,
  reprovada: 2,
  vencida: 3,
};

const ORDEM_DA_FORCA = ['A', 'B', 'C'];

function pesoDaForca(forca: string): number {
  const i = ORDEM_DA_FORCA.indexOf(forca);
  return i === -1 ? ORDEM_DA_FORCA.length : i;
}

/** O título que cabe numa linha: até `max` letras, cortado no espaço. */
export function tituloCurto(titulo: string | null | undefined, max = 60): string {
  const limpo = (titulo ?? '').replace(/\s+/g, ' ').trim();
  if (!limpo) return 'Imóvel sem título no CRM';
  if (limpo.length <= max) return limpo;
  const corte = limpo.slice(0, max);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > max / 2 ? corte.slice(0, espaco) : corte).replace(/[\s,;:.(-]+$/, '')}…`;
}

/**
 * As vantagens agrupadas por imóvel, com o "não diga" da última conta. O imóvel em
 * que o motor rodou e não achou vantagem também entra (a IA segue a conversa normal).
 * Ordem: quem tem proposta esperando primeiro, depois quem tem vantagem em uso, e o
 * código.
 */
export function porImovel(
  vantagens: readonly VantagemDoMercado[],
  execucoes: readonly ExecucaoDoMotor[],
  carteira: readonly ImovelDaCarteira[],
  hoje: string,
): ImovelComVantagens[] {
  const titulos = new Map(carteira.map((c) => [c.codigo, c.titulo]));
  // A execução mais nova de cada imóvel (a lista vem da mais nova para a mais velha,
  // mas a tela não depende disso).
  const ultimas = new Map<string, ExecucaoDoMotor>();
  for (const e of execucoes) {
    const ja = ultimas.get(e.imovel_codigo);
    if (!ja || e.executado_em > ja.executado_em) ultimas.set(e.imovel_codigo, e);
  }
  const codigos = new Set([...vantagens.map((v) => v.imovel_codigo), ...ultimas.keys()]);
  const lista: ImovelComVantagens[] = [];
  for (const codigo of codigos) {
    const daqui = vantagens
      .filter((v) => v.imovel_codigo === codigo)
      .map((v) => ({ v, situacao: situacaoDaVantagem(v, hoje) }))
      .sort(
        (a, b) =>
          PESO_DA_SITUACAO[a.situacao] - PESO_DA_SITUACAO[b.situacao] ||
          pesoDaForca(a.v.forca) - pesoDaForca(b.v.forca) ||
          a.v.chave.localeCompare(b.v.chave),
      );
    const ultima = ultimas.get(codigo);
    lista.push({
      codigo,
      titulo: tituloCurto(titulos.get(codigo)),
      propostas: daqui.filter((x) => x.situacao === 'proposta'),
      emUso: daqui.filter((x) => emUso(x.situacao)),
      fora: daqui.filter((x) => x.situacao === 'vencida' || x.situacao === 'reprovada'),
      naoDiga: ultima?.nao_use ?? [],
      ultimaConta: ultima?.executado_em ?? null,
    });
  }
  const peso = (i: ImovelComVantagens) => (i.propostas.length > 0 ? 0 : i.emUso.length > 0 ? 1 : 2);
  return lista.sort((a, b) => peso(a) - peso(b) || a.codigo.localeCompare(b.codigo, 'pt-BR'));
}

/** "2 para aprovar · 3 em uso pela IA". */
export function resumoDoImovel(im: ImovelComVantagens): string {
  const partes: string[] = [];
  const p = im.propostas.length;
  const u = im.emUso.length;
  if (p > 0) partes.push(`${p} para aprovar`);
  if (u > 0) partes.push(`${u} ${u === 1 ? 'aprovada' : 'aprovadas'}`);
  if (partes.length === 0) {
    return im.fora.length > 0 ? 'Nenhuma vantagem em uso' : 'Nenhuma vantagem nesta conta';
  }
  return partes.join(' · ');
}

/** Quantas propostas esperam no total, para o cabeçalho. */
export function totalParaAprovar(imoveis: readonly ImovelComVantagens[]): number {
  return imoveis.reduce((soma, im) => soma + im.propostas.length, 0);
}

// ---------------------------------------------------------------------------
// Quando a IA recebe
// ---------------------------------------------------------------------------

/**
 * A chave "IA usa as vantagens com clientes" (`app_settings['mercado'].ia_clientes`,
 * migração 20261127151000, `app.mercado_ia_clientes()`). Padrão desligado; só `true`
 * (ou o texto "true", como `ligado`) liga.
 */
export function iaUsaComClientes(chave: ChaveDaColeta | null | undefined): boolean {
  const valor = chave?.ia_clientes;
  return valor === true || valor === 'true';
}

/** "Ligada por Rafael em 25/11: “Testei no treino.”"; nula enquanto ninguém mexeu. */
export function quemMudouAChaveDaIa(
  chave: ChaveDaColeta | null | undefined,
  nomeDe: (id: string) => string | null,
): string | null {
  if (!chave?.ia_clientes_mudou_em) return null;
  const quem = chave.ia_clientes_mudou_por
    ? (nomeDe(chave.ia_clientes_mudou_por) ?? 'alguém da equipe')
    : 'alguém da equipe';
  const motivo = limparTexto(chave.ia_clientes_motivo ?? null);
  return `${iaUsaComClientes(chave) ? 'Ligada' : 'Desligada'} por ${quem} em ${diaEMes(
    chave.ia_clientes_mudou_em,
  )}${motivo ? `: “${motivo}”` : '.'}`;
}

export function quandoAIaRecebe({
  coletaLigada,
  iaClientes,
}: {
  coletaLigada: boolean;
  iaClientes: boolean;
}): { titulo: string; texto: string } {
  if (!coletaLigada) {
    return {
      titulo: 'Hoje a IA não recebe nenhuma vantagem',
      texto:
        'A coleta está desligada, e com ela desligada nada vai para a IA, nem o que já foi aprovado.',
    };
  }
  if (!iaClientes) {
    return {
      titulo: 'Por enquanto, só nas conversas de treino',
      texto:
        'A IA usa as vantagens aprovadas só nas conversas de treino e de teste da equipe. Com os clientes, só depois que a chave “IA usa as vantagens com clientes” for ligada.',
    };
  }
  return {
    titulo: 'A IA usa as vantagens com os clientes',
    texto:
      'As vantagens aprovadas e dentro da validade vão para as conversas com os clientes e para as de treino.',
  };
}

/** O estado vazio, honesto sobre quando as vantagens aparecem. */
export function textoDoVazio({
  coletaLigada,
  coletas,
  agora,
}: {
  coletaLigada: boolean;
  coletas: readonly Coleta[];
  agora: Date;
}): string {
  if (!coletaLigada) {
    return 'Ainda não há vantagens propostas: a coleta está desligada. Elas aparecem aqui depois da primeira coleta, quando ela for ligada.';
  }
  const ultima = resumoDaUltimaColeta(coletas);
  if (ultima.tipo === 'nenhuma') {
    return `Ainda não há vantagens propostas: a primeira coleta é ${quandoFoi(
      proximaColeta(agora).toISOString(),
    )}; as vantagens aparecem aqui depois dela.`;
  }
  return `Ainda não há vantagens propostas. A última coleta foi ${ultima.quando}; as vantagens aparecem aqui quando o motor terminar de comparar os nossos imóveis com ela.`;
}

// ---------------------------------------------------------------------------
// Aprovar, reprovar, voltar
// ---------------------------------------------------------------------------

/** O que acontece ao aprovar as propostas de um imóvel (nunca "tem certeza?"). */
export function consequenciaDeAprovar(
  im: ImovelComVantagens,
  { coletaLigada, iaClientes, hoje }: { coletaLigada: boolean; iaClientes: boolean; hoje: string },
): string[] {
  const aprovaveis = im.propostas.filter((x) => !travaAprovacao(x.v));
  const n = aprovaveis.length;
  if (n === 0) {
    return ['Nenhuma proposta deste imóvel pode ser aprovada agora: veja o alerta em cada uma.'];
  }
  const destino = !coletaLigada
    ? 'assim que a coleta for ligada'
    : iaClientes
      ? 'já na próxima mensagem aos clientes'
      : 'por enquanto só nas conversas de treino';
  const frases = [
    n === 1
      ? `A vantagem proposta deste imóvel passa a ir para a IA, ${destino}.`
      : `As ${n} vantagens propostas deste imóvel passam a ir para a IA, ${destino}.`,
  ];
  const primeira = aprovaveis.map((x) => x.v.valido_ate).sort()[0];
  if (primeira) {
    frases.push(
      n === 1
        ? `Ela sai sozinha da IA quando vencer, em ${dataCurta(primeira, hoje)}.`
        : `Cada uma sai sozinha da IA quando vence; a primeira vence em ${dataCurta(primeira, hoje)}.`,
    );
  }
  frases.push(
    'Nas próximas coletas, se só os números mudarem até 10%, ela se renova sozinha. Se mudar mais, ou se a frase mudar, ela volta para cá.',
  );
  return frases;
}

/** As propostas que o banco vai recusar de qualquer jeito, com o porquê. */
export function propostasTravadas(im: ImovelComVantagens): { texto: string; porque: string }[] {
  return im.propostas
    .filter((x) => travaAprovacao(x.v))
    .map((x) => ({
      texto: x.v.texto,
      porque: marcasNaTela(x.v.marcas).find((m) => m.trava)?.texto ?? 'Há um alerta nos dados.',
    }));
}

export function temConferencia(im: ImovelComVantagens): boolean {
  return im.propostas.some((x) => pedeConferencia(x.v) && !travaAprovacao(x.v));
}

export function rotuloDeAprovar(im: ImovelComVantagens): string {
  return im.propostas.length === 1
    ? 'Aprovar a vantagem deste imóvel'
    : 'Aprovar as vantagens deste imóvel';
}

export function consequenciaDeReprovar(situacao: Situacao): string[] {
  return [
    emUso(situacao) ? 'A IA deixa de usar esta frase na hora.' : 'Esta frase não vai para a IA.',
    'Ela só volta para cá se a comparação mudar, ou se um número mudar mais de 10% numa próxima coleta.',
  ];
}

export const MOTIVO_SUGERIDO_DE_REPROVAR = 'Prefiro que a IA não diga isto aos clientes.';

export const CONSEQUENCIA_DE_VOLTAR =
  'Ela volta para as propostas deste imóvel. A IA só usa depois que alguém aprovar de novo.';

export const MOTIVO_SUGERIDO_DE_VOLTAR = 'Quero rever esta vantagem.';

// ---------------------------------------------------------------------------
// As respostas e recusas do banco
// ---------------------------------------------------------------------------

const RECUSAS: Record<string, string> = {
  vantagem_desconhecida: 'Esta vantagem não existe mais. Atualize a tela.',
  so_proposta_se_aprova: 'Esta vantagem já não espera aprovação. Atualize a tela.',
  vencida: 'Passou da validade. A próxima coleta refaz a conta com números novos.',
  ficha_do_imovel_mudou:
    'A ficha do imóvel mudou depois da conta (preço, área ou bairro). A próxima coleta refaz a vantagem.',
  marca_bloqueia: 'Há um alerta nos dados que impede a aprovação (veja na vantagem).',
  preco_bloqueado_par_sem_decisao:
    'Pode haver este mesmo imóvel anunciado por outra imobiliária. Decida isso na Inteligência de mercado antes de aprovar vantagem de preço.',
  precisa_confirmar_que_conferiu:
    'Pede conferência: marque que a equipe conferiu o anúncio comparado.',
  nada_a_recusar: 'Esta vantagem já não está proposta nem em uso. Atualize a tela.',
  nada_a_voltar: 'Esta vantagem não está aprovada nem reprovada. Atualize a tela.',
  sem_permissao: 'Só admin e gestor aprovam ou reprovam vantagens.',
};

export function fraseDaRecusaDaVantagem(motivo: string | null | undefined): string {
  return RECUSAS[motivo ?? ''] ?? 'O CRM recusou o pedido. Atualize a tela e tente de novo.';
}

export type ResultadoDaAprovacao =
  | { ok: true; aprovadas: number; naoAprovadas: { id: string; chave: string; motivo: string }[] }
  | { ok: false; motivo: string };

/** O que a pessoa lê depois de aprovar: quantas foram e quais ficaram de fora, e por quê. */
export function resumoDaAprovacao(
  r: Extract<ResultadoDaAprovacao, { ok: true }>,
  textoDe: (id: string) => string | null,
): { titulo: string; foraDela: { texto: string; porque: string }[] } {
  const n = r.aprovadas;
  const titulo =
    n === 0
      ? 'Nenhuma vantagem foi aprovada'
      : n === 1
        ? '1 vantagem aprovada'
        : `${n} vantagens aprovadas`;
  return {
    titulo,
    foraDela: r.naoAprovadas.map((x) => ({
      texto: textoDe(x.id) ?? 'Uma vantagem',
      porque: fraseDaRecusaDaVantagem(x.motivo),
    })),
  };
}

// ---------------------------------------------------------------------------
// O que a IA recebe hoje (`public.mercado_vantagens_para_ia`)
// ---------------------------------------------------------------------------

export type DiferencialParaIa = {
  id: string;
  texto: string;
  fonte: string;
  forca: string;
  valido_ate: string;
  momentos: string[];
  objecoes: string[];
  so_com_preco_dito: boolean;
};

export type ImovelParaIa = {
  codigo: string;
  diferenciais: DiferencialParaIa[];
  naoUse: string[];
  dadosDe: string | null;
};

function textos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Lê o JSON que a IA recebe, sem confiar no formato: o que não for o esperado fica
 * de fora, e a ordem dos diferenciais é a do banco (força, eixo, chave).
 */
export function lerParaIa(json: unknown): ImovelParaIa[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  const lista: ImovelParaIa[] = [];
  for (const [codigo, bloco] of Object.entries(json as Record<string, unknown>)) {
    if (!bloco || typeof bloco !== 'object') continue;
    const b = bloco as Record<string, unknown>;
    const diferenciais = (Array.isArray(b.diferenciais) ? b.diferenciais : [])
      .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === 'object')
      .filter((d) => typeof d.texto === 'string')
      .map((d) => ({
        id: typeof d.id === 'string' ? d.id : '',
        texto: d.texto as string,
        fonte: typeof d.fonte === 'string' ? d.fonte : '',
        forca: typeof d.forca === 'string' ? d.forca : 'C',
        valido_ate: typeof d.valido_ate === 'string' ? d.valido_ate : '',
        momentos: textos(d.momentos),
        objecoes: textos(d.objecoes),
        so_com_preco_dito: d.so_com_preco_dito === true,
      }));
    if (diferenciais.length === 0) continue;
    lista.push({
      codigo,
      diferenciais,
      naoUse: textos(b.nao_use),
      dadosDe: typeof b.dados_de === 'string' ? b.dados_de : null,
    });
  }
  return lista.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'));
}

/** "2 imóveis · 5 vantagens". */
export function resumoDoQueAIaRecebe(lista: readonly ImovelParaIa[]): string {
  const im = lista.length;
  const v = lista.reduce((s, x) => s + x.diferenciais.length, 0);
  return `${im} ${im === 1 ? 'imóvel' : 'imóveis'} · ${v} ${v === 1 ? 'vantagem' : 'vantagens'}`;
}
