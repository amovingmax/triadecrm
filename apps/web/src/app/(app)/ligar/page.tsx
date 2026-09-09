import type { Metadata } from 'next';

import { requireRole } from '@/lib/auth/session';
import { PAPEIS_QUE_LIGAM } from '@/components/ligacao/chamada-contexto';
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
 *
 * `requireRole` no lugar de `requireSession` desde 09/09/2026. A rota não tinha
 * guarda de servidor nenhuma: `leitura` e `financeiro` viam o item no menu,
 * entravam, montavam um lote inteiro e só descobriam a recusa quando a
 * `registrar_contato` devolvia `sem_permissao` — depois de o trabalho estar feito.
 * `PAPEIS_QUE_LIGAM` já era este conjunto no cliente; o que faltava era o servidor
 * dizer a mesma coisa. O item de menu agora declara os mesmos papéis, então
 * ninguém é ejetado para `/sem-permissao` por um link que o CRM ofereceu.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requireRole(...PAPEIS_QUE_LIGAM), searchParams]);

  return <TelaDeLotes podeMontar abrirMontagem={params.montar === '1'} />;
}
