import { createClient as criarClienteSupabase } from '@supabase/supabase-js';

import { supabaseUrl } from '@/lib/env';

/**
 * Cliente Supabase com `service_role`, para rotas de servidor.
 *
 * Ele IGNORA a RLS. Por isso três regras que não se negociam:
 *
 * 1. **Nunca importe este arquivo de um componente.** Ele não tem `'use client'` e
 *    o import iria parar no bundle do navegador junto com a chave. O `server-only`
 *    logo abaixo transforma esse engano em erro de build, e não em vazamento em
 *    produção.
 * 2. **Toda rota que o usa autentica a pessoa antes**, com o cliente normal (que
 *    respeita a RLS), e só então age em nome dela. Este cliente é para alcançar o
 *    que a pessoa não pode alcançar sozinha — o refresh token no Vault —, não
 *    para pular a checagem de quem ela é.
 * 3. **A chave não tem prefixo `NEXT_PUBLIC_`**, de propósito: o Next só injeta no
 *    navegador o que tem esse prefixo.
 *
 * A chave vive em `SUPABASE_SERVICE_ROLE_KEY` na Vercel. Sem ela, as rotas da
 * agenda respondem "não configurado" em vez de estourar — o CRM inteiro não pode
 * cair porque a integração da agenda não foi configurada.
 */
import 'server-only';

export function temChaveDeServico(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function criarClienteAdmin() {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY não definida. A integração com o Google Agenda precisa dela ' +
        'para ler o token guardado no Vault.',
    );
  }
  return criarClienteSupabase(supabaseUrl(), chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
