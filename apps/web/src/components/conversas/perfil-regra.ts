/**
 * CLIENTES E PARCEIROS (Imova, 23/11/2026): as regras puras.
 *
 * Pedido do usuário: "Todos os que entram em contato pela primeira vez com a
 * Imova devem entrar como Cliente e devem permanecer por lá até que seja mudado
 * o perfil dele para Parceiro." Parceiro é quem já fechou algo com a Imova
 * (inquilino, proprietário, comprador). O perfil mora na marca da Consultoria
 * (`public.consultoria`, com `tipo` e `anuncio_id`); sem a linha, é Cliente.
 *
 * Decidido no protótipo (as quatro sugestões aceitas):
 *   1. a IA que atende não responde Parceiros (no banco, `app.ia_atende`);
 *   2. negócio ganho não muda o perfil sozinho: a conversa só sugere;
 *   3. a mudança guarda o tipo da parceria e, se houver, o imóvel;
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

export const TIPOS_DE_PARCERIA: readonly {
  id: TipoDeParceria;
  rotulo: string;
  plural: string;
}[] = [
  { id: 'inquilino', rotulo: 'Inquilino', plural: 'Inquilinos' },
  { id: 'proprietario', rotulo: 'Proprietário', plural: 'Proprietários' },
  { id: 'comprador', rotulo: 'Comprador', plural: 'Compradores' },
  { id: 'outro', rotulo: 'Outro', plural: 'Outros' },
];

export function ehTipoDeParceria(valor: unknown): valor is TipoDeParceria {
  return TIPOS_DE_PARCERIA.some((t) => t.id === valor);
}

export function rotuloDaParceria(tipo: TipoDeParceria | null): string {
  return TIPOS_DE_PARCERIA.find((t) => t.id === tipo)?.rotulo ?? 'Parceiro';
}

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

/** O que a caixa Parceiros mostra: a busca, o tipo e a gaveta das concluídas. */
export type RecorteDosParceiros = {
  busca: string;
  tipo: TipoDeParceria | 'todos';
  concluidas: boolean;
};

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
    if (recorte.tipo !== 'todos' && (i.parceiro?.tipo ?? 'outro') !== recorte.tipo) return false;
    if (!termo) return true;
    const alvo = normalizar(
      [i.nome, i.categoria, i.bairro, i.cidade, i.parceiro?.imovel].filter(Boolean).join(' '),
    );
    return alvo.includes(termo);
  });
}

/** Quantos Parceiros de cada tipo (os sem tipo contam como "Outro"). */
export function contarPorTipo(itens: readonly ItemConversa[]): ReadonlyMap<TipoDeParceria, number> {
  const contagem = new Map<TipoDeParceria, number>();
  for (const i of itens) {
    const tipo = i.parceiro?.tipo ?? 'outro';
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
 * O tipo que o diálogo já traz marcado: quem tem negócio ganho tende a ser
 * comprador; a ficha de Proprietário, proprietário. Sem pista, nada vem
 * marcado: a pessoa escolhe.
 */
export function sugestaoDeTipo(item: Pick<ItemConversa, 'ganhou' | 'tipo'>): TipoDeParceria | null {
  if (item.tipo === 'fornecedor') return 'proprietario';
  if (item.ganhou) return 'comprador';
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
  tipo_invalido: 'Escolha o tipo da parceria.',
  anuncio_invalido: 'Este anúncio não existe mais. Escolha outro ou deixe sem imóvel.',
};

export function recadoDoPerfil(motivo: string): string {
  return RECUSAS[motivo] ?? 'Não deu certo. Tente de novo em instantes.';
}
