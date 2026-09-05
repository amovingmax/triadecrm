import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { primeiroNome } from '@/components/meu-dia/formatos';
import { TelaResumo } from '@/components/cadencias/tela-resumo';

export const metadata: Metadata = { title: 'Resumo do dia' };

/**
 * O resumo das 07:30 e das 18:00 (RF-AST-02; PRD §7.7; anexo R07 §8).
 *
 * O servidor resolve só o primeiro nome de quem entrou: a mensagem fala com a pessoa,
 * não com "o usuário". O dia, o momento e todos os números saem de
 * `public.resumo_do_dia`, que recorta o dia civil de `America/Fortaleza` — calcular
 * isso no navegador deixaria o resumo trocar de dia conforme o fuso do aparelho.
 */
export default async function Pagina() {
  const sessao = await requireSession();

  return <TelaResumo nome={primeiroNome(sessao.nome)} />;
}
