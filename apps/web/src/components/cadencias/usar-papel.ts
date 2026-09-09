'use client';

import { useQuery } from '@tanstack/react-query';

import { createClient } from '@/lib/supabase/client';

import { ErroDasCadencias } from './consultas';
import { meuPapelSchema, type MeuPapel } from './tipos';

/**
 * O que o meu papel faz — perguntado ao Postgres, não deduzido aqui.
 *
 * Duas telas precisam decidir se OFERECEM um gesto: o kanban precisa saber se arrastar
 * um cartão vai dar em alguma coisa (`app.can_write()`), e a tela das cadências precisa
 * saber se oferece "Matricular" (`app.pode_matricular()`). A tentação é escrever a
 * lista de papéis aqui — `['admin', 'gestor', 'sdr', 'embaixador'].includes(papel)` — e
 * é exatamente a segunda verdade que o ADR-03 existe para não deixar nascer: no dia em
 * que o enum mudar, o banco recusa e a tela continua oferecendo.
 *
 * `public.meu_papel()` responde as três perguntas de uma vez, das mesmas funções que a
 * RLS usa. Isto NÃO é autorização — quem autoriza continua sendo a política e a
 * checagem dentro de cada RPC. É só o que evita oferecer um caminho fechado.
 *
 * Mora nesta pasta porque foi ela que trouxe `public.meu_papel()` ao produto; quando
 * uma terceira tela precisar dele, o lugar passa a ser `lib/`.
 */
export const CHAVE_MEU_PAPEL = ['meu-papel'] as const;

export async function buscarMeuPapel(): Promise<MeuPapel> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('meu_papel');
  if (error) throw new ErroDasCadencias(error.message, error.code);
  return meuPapelSchema.parse(data);
}

/**
 * Enquanto a resposta não chega, a tela assume o papel MAIS RESTRITO.
 *
 * O contrário — oferecer e depois tirar — pisca o botão na cara de quem não pode usá-lo
 * e, pior, deixa o cartão arrastável por um segundo. Errar para o lado de não oferecer
 * custa meio segundo de espera; errar para o outro custa uma recusa que a pessoa não
 * entende.
 */
export function usePapel(): MeuPapel {
  const consulta = useQuery({
    queryKey: CHAVE_MEU_PAPEL,
    queryFn: buscarMeuPapel,
    // O papel só muda com um login novo: relê-lo a cada montagem de tela é gasto puro.
    staleTime: 30 * 60_000,
  });

  return consulta.data ?? { papel: 'leitura', escreve: false, gerencia: false, matricula: false };
}
