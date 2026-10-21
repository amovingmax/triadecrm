import 'server-only';

import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/server';

/**
 * O site confere, ao abrir, se o banco ligado a ele é da mesma empresa.
 *
 * Cada empresa tem o seu deploy e o seu banco; o que liga um ao outro são as variáveis
 * de ambiente. Uma chave colada no projeto errado da Vercel faria o site da Imova
 * mostrar — e gravar — no banco da KOMUNE, ou o contrário. O banco diz de quem é
 * (`public.empresa_do_banco()`, migração 20261022090000); se não for desta empresa,
 * o CRM não abre.
 *
 * Só recusa quando tem CERTEZA: banco de outra empresa. Banco sem identidade (antes de
 * ela ser gravada), função que ainda não existe (site publicado antes da migração) ou
 * falha de rede deixam passar — derrubar a KOMUNE por um soluço seria pior —, e a
 * conferência é refeita na próxima tela. Depois de confirmada, não pergunta mais
 * enquanto este servidor estiver de pé.
 */
let confirmada = false;

export type ConferenciaDaEmpresa = { ok: true } | { ok: false; empresaDoBanco: string };

export async function conferirEmpresaDoBanco(): Promise<ConferenciaDaEmpresa> {
  if (confirmada) return { ok: true };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('empresa_do_banco');
  if (error || !data) return { ok: true };
  if (data !== EMPRESA.slug) {
    console.error(
      `[empresa] este site é da "${EMPRESA.slug}" e o banco ligado a ele é da "${data}". O CRM não abre.`,
    );
    return { ok: false, empresaDoBanco: data };
  }
  confirmada = true;
  return { ok: true };
}
