import { SITUACOES, type Situacao } from '@/components/anuncios/tipos';

import { recadoDoMotivo } from './acoes-reuniao';
import { lugarDeVerdade } from './tipos';

/**
 * O imóvel da visita, a parte pura (11/11/2026, só na Imova, módulo
 * `agendaComImovel`).
 *
 * Pedido do usuário: "Caso seja visita presencial, deverá ter o endereço e o código
 * do imóvel/terreno que será tratado." Na Imova TODA visita tem imóvel: o código e o
 * endereço de um anúncio ou, na avaliação do imóvel de um proprietário (que ainda não
 * tem anúncio), um endereço escrito. Quem guarda é o banco (`public.visita_imoveis`,
 * uma linha por visita, gravada por `visita_marcar_com_imovel` e
 * `visita_definir_imovel`, e pelo Calendly e pela IA). Aqui ficam a régua da escolha,
 * a busca na lista de anúncios, o anúncio que a folha já abre escolhido e as frases.
 */

/** Um anúncio na lista de escolha do imóvel. */
export type AnuncioDaEscolha = {
  id: string;
  /** IM0003, SA0012_IMOVA, TE0004… */
  codigo: string;
  titulo: string;
  situacao: Situacao;
  /** Montado como no banco (`enderecoDoAnuncio`). Nulo quando o anúncio não tem rua nem bairro. */
  endereco: string | null;
};

export type OrigemDoImovel = 'crm' | 'calendly' | 'convite' | 'ia' | 'corrigido';

/** Uma linha de `public.visita_imoveis`, com o título e a situação do anúncio. */
export type ImovelDaVisita = {
  anuncioId: string | null;
  /** O código do anúncio; nulo = imóvel sem anúncio (avaliação de proprietário). */
  codigo: string | null;
  endereco: string;
  /** O título do anúncio; nulo sem anúncio, ou quando o anúncio saiu da base. */
  titulo: string | null;
  situacao: Situacao | null;
  origem: OrigemDoImovel;
};

// ---------------------------------------------------------------------------
// O endereço do anúncio
// ---------------------------------------------------------------------------

function limpo(valor: string | null | undefined): string | null {
  const texto = valor?.replace(/\s+/g, ' ').trim();
  return texto ? texto : null;
}

/**
 * "Av. Roberto Freire, 4715, Sala A, Ponta Negra, Natal": a mesma montagem de
 * `app.calendly_codigo_do_anuncio`, para a escolha mostrar o endereço que o banco vai
 * gravar. O número não se repete quando já está na rua ("Av Barra de Tabatinga,
 * 2004"), e sem rua o número não aparece sozinho.
 */
export function enderecoDoAnuncio(a: {
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
}): string | null {
  const rua = limpo(a.endereco);
  const numero = limpo(a.numero);
  const ruaENumero = rua ? (numero && !rua.includes(numero) ? `${rua}, ${numero}` : rua) : null;
  const partes = [ruaENumero, limpo(a.complemento), limpo(a.bairro), limpo(a.cidade)].filter(
    (p): p is string => p !== null,
  );
  return partes.length > 0 ? partes.join(', ') : null;
}

// ---------------------------------------------------------------------------
// A busca na lista
// ---------------------------------------------------------------------------

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * "IM3", "im 0003", "IM-3" e "IM0003_IMOVA" viram a mesma chave ("IM3"): a régua do
 * banco (`app.calendly_codigo_do_anuncio`), que casa a tag e o número sem os zeros.
 * Nulo quando o texto não é um código.
 */
export function chaveDoCodigo(texto: string): string | null {
  const achado = /^(im|sa|te|co|pt)[ -]?0*(\d{1,9})(?:_[a-z]+)?$/i.exec(texto.trim());
  if (!achado?.[1] || !achado[2]) return null;
  return `${achado[1].toUpperCase()}${achado[2]}`;
}

/** No ar primeiro (é o que o cliente vê nos portais), depois pelo código. */
export function ordenarAnuncios(lista: readonly AnuncioDaEscolha[]): AnuncioDaEscolha[] {
  return [...lista].sort(
    (a, b) =>
      Number(b.situacao === 'no_ar') - Number(a.situacao === 'no_ar') ||
      a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }),
  );
}

/**
 * Os anúncios que casam com o que a pessoa digitou: pelo código ("IM3" acha o
 * IM0003), pelo título e pelo endereço, sem acento e sem maiúscula, cada palavra
 * em qualquer parte. O código exato vem primeiro.
 */
export function filtrarAnuncios(
  lista: readonly AnuncioDaEscolha[],
  busca: string,
): AnuncioDaEscolha[] {
  const ordenada = ordenarAnuncios(lista);
  const termo = normalizar(busca);
  if (!termo) return ordenada;
  const chave = chaveDoCodigo(busca);
  const palavras = termo.split(/\s+/);
  const exatos = chave ? ordenada.filter((a) => chaveDoCodigo(a.codigo) === chave) : [];
  const outros = ordenada.filter((a) => {
    if (exatos.includes(a)) return false;
    const onde = normalizar(`${a.codigo} ${a.titulo} ${a.endereco ?? ''}`);
    return palavras.every((p) => onde.includes(p));
  });
  return [...exatos, ...outros];
}

// ---------------------------------------------------------------------------
// O anúncio que a folha já abre escolhido
// ---------------------------------------------------------------------------

/**
 * O anúncio de onde o cliente veio, para a folha do link já abrir nele:
 *
 *   1. o lead do portal da conversa ("Veio do anúncio IM0003"): o anúncio do CRM
 *      ligado a ele, ou o de mesmo código. "Parecido com o anúncio X" não conta:
 *      é palpite, e mandar o endereço errado é pior do que pedir para escolher;
 *   2. o código que a IA leu na foto da placa ou do anúncio (canal de chegada).
 *
 * Só vale anúncio que está na lista (não excluído). Sem pista, nulo: a pessoa escolhe.
 */
export function anuncioPadrao(
  anuncios: readonly AnuncioDaEscolha[],
  pistas: {
    doLead?: { anuncioId: string | null; codigo: string | null; parecido: boolean } | null;
    daChegada?: string | null;
  },
): string | null {
  const porCodigo = (codigo: string | null | undefined) => {
    const chave = codigo ? chaveDoCodigo(codigo) : null;
    if (!chave) return null;
    return ordenarAnuncios(anuncios).find((a) => chaveDoCodigo(a.codigo) === chave)?.id ?? null;
  };
  const lead = pistas.doLead && !pistas.doLead.parecido ? pistas.doLead : null;
  if (lead?.anuncioId && anuncios.some((a) => a.id === lead.anuncioId)) return lead.anuncioId;
  return porCodigo(lead?.codigo) ?? porCodigo(pistas.daChegada);
}

// ---------------------------------------------------------------------------
// A escolha e a régua dela
// ---------------------------------------------------------------------------

/**
 * O que a pessoa escolheu: um anúncio, ou o imóvel sem anúncio, com o endereço
 * escrito (a avaliação do imóvel de um proprietário).
 */
export type EscolhaDoImovel =
  { modo: 'anuncio'; anuncioId: string | null } | { modo: 'sem_anuncio'; endereco: string };

export const ESCOLHA_VAZIA: EscolhaDoImovel = { modo: 'anuncio', anuncioId: null };

/** O rótulo da opção sem anúncio, igual na escolha e na explicação. */
export const ROTULO_SEM_ANUNCIO = 'Imóvel sem anúncio (avaliação de proprietário)';

/** O mesmo teto do `local` da reunião presencial. */
const TETO_DO_ENDERECO = 300;

export type ImovelValidado =
  { ok: true; anuncioId: string | null; endereco: string | null } | { ok: false; recado: string };

/**
 * A régua antes de gravar, a mesma do banco (`visita_sem_imovel`): um anúncio, ou um
 * endereço que seja endereço. "Local a combinar…" não conta: é o que o banco grava
 * quando NÃO sabe onde é.
 */
export function validarImovel(escolha: EscolhaDoImovel): ImovelValidado {
  if (escolha.modo === 'anuncio') {
    return escolha.anuncioId
      ? { ok: true, anuncioId: escolha.anuncioId, endereco: null }
      : { ok: false, recado: 'Escolha o anúncio do imóvel da visita.' };
  }
  const endereco = limpo(escolha.endereco);
  if (!endereco || !lugarDeVerdade(endereco) || !/\p{L}{3,}/u.test(endereco)) {
    return { ok: false, recado: 'Escreva o endereço do imóvel: rua, número, bairro e cidade.' };
  }
  if (endereco.length > TETO_DO_ENDERECO) {
    return { ok: false, recado: `O endereço passa de ${TETO_DO_ENDERECO} letras. Encurte.` };
  }
  return { ok: true, anuncioId: null, endereco };
}

// ---------------------------------------------------------------------------
// O que o cartão mostra
// ---------------------------------------------------------------------------

/**
 * A linha de onde do cartão da visita: "IM0003 · Casa com 3 quartos em Ponta Negra".
 * O anúncio que saiu da base fica só com o código; o imóvel sem anúncio, com o nome
 * do caso. O endereço vai embaixo, em outra linha.
 */
export function linhaDoImovel(imovel: Pick<ImovelDaVisita, 'codigo' | 'titulo'>): string {
  if (!imovel.codigo) return 'Imóvel sem anúncio';
  const titulo = limpo(imovel.titulo);
  return titulo ? `${imovel.codigo} · ${titulo}` : imovel.codigo;
}

/** A busca do Google Maps pelo endereço do imóvel (que já traz o bairro e a cidade). */
export function linkDoMapaDoImovel(endereco: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco.trim())}`;
}

/** O selo e a frase da visita que ainda não tem imóvel. */
export const FALTA_O_IMOVEL = 'Falta o imóvel';

/**
 * O aviso do anúncio que não está no ar: o cliente recebe o código e o endereço
 * do mesmo jeito, mas não acha o anúncio no portal.
 */
export function avisoDoAnuncioForaDoAr(situacao: Situacao | null | undefined): string | null {
  if (!situacao || situacao === 'no_ar') return null;
  const estado = SITUACOES[situacao].toLowerCase();
  return `Este anúncio está ${situacao === 'rascunho' ? 'em rascunho' : estado}: o cliente não o encontra nos portais. O código e o endereço vão do mesmo jeito; confira se o imóvel continua disponível.`;
}

// ---------------------------------------------------------------------------
// As recusas do banco
// ---------------------------------------------------------------------------

const RECADO_DO_IMOVEL: Record<string, string> = {
  visita_sem_imovel:
    'A visita precisa do imóvel: escolha o anúncio ou, na avaliação de proprietário, escreva o endereço.',
  anuncio_invalido: 'Esse anúncio não existe mais ou foi excluído. Escolha outro.',
  nao_e_visita: 'Só a visita tem imóvel. Este compromisso é uma reunião.',
  nao_existe: 'Esta visita não existe mais. Recarregue a agenda.',
  sem_permissao: 'Seu perfil não pode mexer nesta visita.',
};

/**
 * A frase das recusas de `visita_marcar_com_imovel` e `visita_definir_imovel`: as do
 * imóvel aqui, e as da agenda (horário ocupado, dia não útil…) pela tabela de sempre.
 */
export function recadoDoImovel(motivo: string): string {
  return RECADO_DO_IMOVEL[motivo] ?? recadoDoMotivo(motivo);
}
