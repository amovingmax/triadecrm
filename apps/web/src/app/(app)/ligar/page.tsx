import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { podeLigar } from '@/components/ligacao/chamada-contexto';
import { TelaDeLotes } from '@/components/ligacao/lote-tela';

export const metadata: Metadata = { title: 'Ligar' };

/**
 * Prospecção ativa por ligação (R13) — a metade em que se MONTA o lote.
 *
 * A rota existe por uma restrição de calendário e uma de contrato: o WhatsApp não abre
 * conversa antes de a Meta liberar o número (duas a três semanas), e não existe
 * discador contratado. Ligar não espera nada disso: dos 100 parceiros reais da base,
 * 66 têm telefone.
 *
 * Aqui se monta o lote e se acompanham os que estão de pé. Quem liga trabalha em
 * `/ligar/[id]`, e a separação é o desenho: montar é uma vez por turno e é onde se
 * pensa; ligar é o dia inteiro e é onde não se escolhe mais para quem ligar (R13 §3.1).
 *
 * `?montar=1` abre a folha de montagem já aberta, para o atalho de outra tela cair
 * direto no trabalho.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sessao, params] = await Promise.all([requireSession(), searchParams]);

  return <TelaDeLotes podeMontar={podeLigar(sessao.papel)} abrirMontagem={params.montar === '1'} />;
}
