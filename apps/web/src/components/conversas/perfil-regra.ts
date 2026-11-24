/**
 * CLIENTES E PARCEIROS (Imova, 23/11/2026): as regras puras.
 *
 * Pedido do usuário: "Todos os que entram em contato pela primeira vez com a
 * Imova devem entrar como Cliente e devem permanecer por lá até que seja mudado
 * o perfil dele para Parceiro." Parceiro é quem já fechou algo com a Imova. O
 * perfil mora na marca da Consultoria (`public.consultoria`, com `tipo` e
 * `anuncio_id`); sem a linha, é Cliente.
 *
 * As três tags (mesmo dia, mais tarde): "os parceiros devem ser divididos
 * entre: Proprietário, Colaborador, Inquilino. Essas são as tags que os
 * parceiros devem ter. Já os clientes devem ter a placa de prospecção (que já
 * possuem)". Comprador e Outro saíram; a tag é obrigatória (o banco recusa
 * sem ela). A placa dos Clientes é o canal de chegada, que não muda.
 *
 * Decidido no protótipo (as quatro sugestões aceitas):
 *   1. a IA que atende não responde Parceiros (no banco, `app.ia_atende`),
 *      menos os de tag Colaborador, que ela responde (24/11/2026);
 *   2. negócio ganho não muda o perfil sozinho: a conversa só sugere;
 *   3. a mudança guarda a tag e, se houver, o imóvel;
 *   4. quem atende muda o perfil (admin, gestor e SDR: `app.is_manager()`).
 *
 * As telas ficam em `perfil-da-conversa.tsx`; aqui só o que cabe em teste.
 */
import { EMPRESA } from '@/lib/empresa';

import { aplicarFiltros, normalizar, type CanaisDasConversas } from './montagem';
import {
  FILTROS_VAZIOS,
  type ItemConversa,
  type PerfilDoParceiro,
  type TipoDeParceria,
} from './tipos';

/** O módulo existe nesta empresa? Fora dele (a KOMUNE), nada daqui aparece. */
export const CLIENTES_E_PARCEIROS: boolean = EMPRESA.modulos.clientesEParceiros;

/** As três tags, na ordem do pedido. */
export const TIPOS_DE_PARCERIA: readonly {
  id: TipoDeParceria;
  rotulo: string;
  plural: string;
}[] = [
  { id: 'proprietario', rotulo: 'Proprietário', plural: 'Proprietários' },
  { id: 'colaborador', rotulo: 'Colaborador', plural: 'Colaboradores' },
  { id: 'inquilino', rotulo: 'Inquilino', plural: 'Inquilinos' },
];

/** Parceiro de antes das três tags, sem nenhuma. */
export const SEM_TAG = 'sem_tag' as const;

export function ehTipoDeParceria(valor: unknown): valor is TipoDeParceria {
  return TIPOS_DE_PARCERIA.some((t) => t.id === valor);
}

export function rotuloDaParceria(tipo: TipoDeParceria | null): string {
  return TIPOS_DE_PARCERIA.find((t) => t.id === tipo)?.rotulo ?? 'Sem tag';
}

/**
 * A IA que atende responde este Parceiro? Só o Colaborador (24/11/2026: "Todos
 * os parceiros colaboradores a IA responde, os demais parceiros ela não fala").
 * No banco, a mesma regra está em `app.ia_atende`.
 */
export function aIaRespondeOParceiro(tipo: TipoDeParceria | null): boolean {
  return tipo === 'colaborador';
}

/** O que a tela diz sobre a IA quando a ficha vira Parceiro, ou muda de tag. */
export function avisoDaIaNoParceiro(tipo: TipoDeParceria | null): string {
  return aIaRespondeOParceiro(tipo)
    ? 'A IA que atende continua respondendo: ela responde os Colaboradores.'
    : 'A IA que atende não responde Proprietários nem Inquilinos: quem responde é a equipe.';
}

/** A regra inteira, para o diálogo antes de escolher a tag. */
export const REGRA_DA_IA_NOS_PARCEIROS =
  'A IA que atende responde os Colaboradores; Proprietários e Inquilinos ficam com a equipe.';

/** A linha de `public.consultoria` como o banco devolve, com o anúncio junto. */
export type MarcaDeParceiro = {
  organization_id: string;
  tipo?: string | null;
  anuncio_id?: string | null;
  desde?: string | null;
  por?: string | null;
  anuncios?: { codigo: string | null; titulo: string | null } | null;
};

/** "TE0007 · Lote em Pipa": o código e o título, o que existir. */
export function rotuloDoImovel(
  anuncio: { codigo: string | null; titulo: string | null } | null | undefined,
): string | null {
  if (!anuncio) return null;
  const partes = [anuncio.codigo?.trim(), anuncio.titulo?.trim()].filter(Boolean);
  return partes.length ? partes.join(' · ') : null;
}

/** Quem é Parceiro, e como. A chave é a ficha (`organizations.id`). */
export function mapaDosParceiros(
  linhas: readonly MarcaDeParceiro[],
): ReadonlyMap<string, PerfilDoParceiro> {
  return new Map(
    linhas.map((l) => [
      l.organization_id,
      {
        tipo: ehTipoDeParceria(l.tipo) ? l.tipo : null,
        anuncioId: l.anuncio_id ?? null,
        imovel: rotuloDoImovel(l.anuncios),
        desde: l.desde ?? '',
        porId: l.por ?? null,
      },
    ]),
  );
}

/** O que a caixa Parceiros mostra: a busca, a tag e a gaveta das concluídas. */
export type RecorteDosParceiros = {
  busca: string;
  tipo: TipoDeParceria | typeof SEM_TAG | 'todos';
  concluidas: boolean;
};

/** A tag de um Parceiro para filtrar e contar: sem tag é `SEM_TAG`. */
function tagDe(item: ItemConversa): TipoDeParceria | typeof SEM_TAG {
  return item.parceiro?.tipo ?? SEM_TAG;
}

export const RECORTE_INICIAL: RecorteDosParceiros = { busca: '', tipo: 'todos', concluidas: false };

/**
 * A lista da caixa Parceiros. A busca acha pelo nome e pelo bairro (como a
 * lista de Clientes) e também pelo imóvel da parceria ("TE0007", "Pipa").
 */
export function filtrarParceiros(
  itens: readonly ItemConversa[],
  recorte: RecorteDosParceiros,
  canais: CanaisDasConversas = null,
): ItemConversa[] {
  const base = aplicarFiltros(
    [...itens],
    { ...FILTROS_VAZIOS, concluidas: recorte.concluidas },
    undefined,
    canais,
  );
  const termo = normalizar(recorte.busca);
  return base.filter((i) => {
    if (recorte.tipo !== 'todos' && tagDe(i) !== recorte.tipo) return false;
    if (!termo) return true;
    const alvo = normalizar(
      [i.nome, i.categoria, i.bairro, i.cidade, i.parceiro?.imovel].filter(Boolean).join(' '),
    );
    return alvo.includes(termo);
  });
}

/** Quantos Parceiros de cada tag (os de antes, sem tag, em `SEM_TAG`). */
export function contarPorTipo(
  itens: readonly ItemConversa[],
): ReadonlyMap<TipoDeParceria | typeof SEM_TAG, number> {
  const contagem = new Map<TipoDeParceria | typeof SEM_TAG, number>();
  for (const i of itens) {
    const tipo = tagDe(i);
    contagem.set(tipo, (contagem.get(tipo) ?? 0) + 1);
  }
  return contagem;
}

/**
 * O número de cada caixa: das conversas que esperam resposta desta pessoa (o
 * número do menu), as de Parceiros e as de Clientes. Quem escreveu sem ficha
 * ainda é Cliente.
 */
export function esperamPorCaixa(
  organizacoes: readonly (string | null)[] | null,
  parceiros: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): { clientes: number | null; parceiros: number | null } {
  if (organizacoes === null) return { clientes: null, parceiros: null };
  const deParceiros = organizacoes.filter((id) => id !== null && parceiros.has(id)).length;
  return { clientes: organizacoes.length - deParceiros, parceiros: deParceiros };
}

/**
 * A tag que o diálogo já traz marcada: a ficha de Proprietário (o funil de
 * captação de imóveis) vem com Proprietário. Sem pista, nada vem marcado: a
 * pessoa escolhe. Negócio ganho não diz se é inquilino ou colaborador.
 */
export function sugestaoDeTipo(item: Pick<ItemConversa, 'ganhou' | 'tipo'>): TipoDeParceria | null {
  if (item.tipo === 'fornecedor') return 'proprietario';
  return null;
}

/** "Inquilino · TE0007 · Lote em Pipa · desde 21/11, por Janio". */
export function descricaoDoParceiro(
  perfil: PerfilDoParceiro,
  nomeDe: (id: string) => string | null,
): string {
  const partes: string[] = [];
  if (perfil.imovel) partes.push(perfil.imovel);
  const quando = dataCurta(perfil.desde);
  const quem = perfil.porId ? nomeDe(perfil.porId) : null;
  if (quando) partes.push(quem ? `desde ${quando}, por ${quem}` : `desde ${quando}`);
  return partes.join(' · ');
}

/** 23/11 (ou 23/11/2025, de outro ano), no fuso de Natal. */
export function dataCurta(iso: string, agora: Date = new Date()): string {
  const data = new Date(iso);
  if (!iso || Number.isNaN(data.getTime())) return '';
  const ano = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', year: 'numeric' }).format(d);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    ...(ano(data) === ano(agora) ? {} : { year: 'numeric' }),
  }).format(data);
}

const RECUSAS: Record<string, string> = {
  sem_permissao: 'Seu perfil não muda o perfil de contatos. Fale com um gestor.',
  ficha_inexistente: 'Esta ficha não existe mais (pode ter sido excluída).',
  tipo_invalido: 'Escolha uma das três tags: Proprietário, Colaborador ou Inquilino.',
  falta_a_tag: 'Escolha a tag do Parceiro: Proprietário, Colaborador ou Inquilino.',
  anuncio_invalido: 'Este anúncio não existe mais. Escolha outro ou deixe sem imóvel.',
};

export function recadoDoPerfil(motivo: string): string {
  return RECUSAS[motivo] ?? 'Não deu certo. Tente de novo em instantes.';
}
