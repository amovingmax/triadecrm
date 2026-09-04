'use client';

import { normalizeInstagram, normalizePhoneBr } from '@komune/schema';

import { createClient } from '@/lib/supabase/client';

import {
  POR_PAGINA,
  type FiltrosParceiros,
  type LinhaParceiro,
  type ResultadoBusca,
} from './tipos';

/**
 * Prepara o texto digitado antes de mandar para `public.search_organizations`.
 *
 * A busca precisa achar a pessoa por qualquer coisa que o time tenha na mão: o nome,
 * o telefone anotado em qualquer formato, o @ do Instagram, o CNPJ ou o bairro
 * (RF-BAS-12). O banco também normaliza, mas normalizar aqui evita uma ida ao servidor
 * com um número que a gente já sabe que está mal formatado, e faz o pedido sair no
 * mesmo E.164 que está gravado.
 *
 * Devolve `null` quando não há texto (a lista mostra tudo, paginado).
 */
export function prepararConsulta(texto: string): string | null {
  const bruto = texto.trim();
  if (!bruto) return null;

  // Só dígitos e pontuação de telefone: tenta virar E.164.
  if (/^[\d\s()+.-]+$/.test(bruto)) {
    const digitos = bruto.replace(/\D/g, '');
    const e164 = normalizePhoneBr(bruto);
    // CNPJ tem 14 dígitos e não é telefone: segue cru, o banco reconhece.
    if (e164 && digitos.length !== 14) return e164;
    return bruto;
  }

  // @perfil ou link de perfil do Instagram.
  if (/^@|instagram\.com\//i.test(bruto)) {
    const arroba = normalizeInstagram(bruto);
    if (arroba) return `@${arroba}`;
  }

  return bruto;
}

/**
 * `true` quando o texto digitado é um pedaço de telefone que a RPC não casa por
 * igualdade (os quatro últimos dígitos lidos num cartão, o miolo do número).
 *
 * A `search_organizations` só busca por "contém" para quem lê o telefone de base
 * (admin, gestor, leitura, financeiro): para sdr e embaixador isso seria um oráculo
 * que reconstrói o número sem passar por `reveal_phone` (RF-BAS-14). A regra está
 * certa, mas invisível, e sem aviso a pessoa conclui que o parceiro não está na base.
 * Daqui sai a frase que o estado vazio acrescenta.
 */
export function buscaPorTrechoDeTelefone(texto: string): boolean {
  const bruto = texto.trim();
  if (!/^[\d\s()+.-]+$/.test(bruto)) return false;
  const digitos = bruto.replace(/\D/g, '');
  // Menos de 4 dígitos não busca por trecho para ninguém; 14 dígitos é CNPJ.
  if (digitos.length < 4 || digitos.length === 14) return false;
  // Se vira E.164, a busca por igualdade acha e o aviso não faz sentido.
  return normalizePhoneBr(bruto) === null;
}

/** Chave de cache do TanStack Query: muda quando qualquer recorte muda. */
export function chaveDaBusca(f: FiltrosParceiros) {
  return [
    'parceiros',
    prepararConsulta(f.q),
    f.categoriaId,
    f.cidadeId,
    f.etapaId,
    f.responsavelId,
    f.pagina,
  ] as const;
}

/**
 * Uma página da busca. A RPC devolve `total_count` repetido em toda linha (window
 * function), então a contagem sai da primeira linha e não custa uma segunda consulta.
 */
export async function buscarParceiros(f: FiltrosParceiros): Promise<ResultadoBusca> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc('search_organizations', {
    q: prepararConsulta(f.q) ?? undefined,
    p_category_id: f.categoriaId ?? undefined,
    p_city_id: f.cidadeId ?? undefined,
    p_stage_id: f.etapaId ?? undefined,
    p_owner_id: f.responsavelId ?? undefined,
    p_limit: POR_PAGINA,
    p_offset: (Math.max(1, f.pagina) - 1) * POR_PAGINA,
  });

  if (error) throw new Error(error.message);

  const linhas = (data ?? []) as unknown as LinhaParceiro[];
  return { linhas, total: Number(linhas[0]?.total_count ?? 0) };
}
