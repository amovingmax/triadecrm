import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { carregarContextoDaLigacao } from '@/components/ligacao/chamada-dados';
import { TelaLigar } from '@/components/ligacao/tela-ligar';

export const metadata: Metadata = { title: 'Ligando' };

/**
 * A tela onde se liga (R13 §3.1 a §3.4): um contato de cada vez, e nunca uma lista.
 *
 * A telefonia do MVP é manual assistida, porque não existe discador contratado e o
 * Matheus precisa ligar hoje: número em corpo de cartaz, `tel:` que abre o discador do
 * aparelho, "Copiar número" e "Liguei" — tudo atrás da interface `ProvedorTelefonia`,
 * para um discador de verdade entrar depois como adaptador, sem reescrever o módulo.
 *
 * O servidor entrega só as listas estáveis (catálogo de desfechos, motivos de perda,
 * etapas, feriados, funis, roteiros publicados). **Nenhum telefone passa por aqui:**
 * quem revela o número é `proximo_da_fila`, no cliente, com registro em
 * `pii_access_log` (RF-BAS-14) — a coluna `call_batch_items.phone_e164` nem sequer tem
 * `select` concedido a `authenticated`.
 */
export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const [sessao, contexto, { id }] = await Promise.all([
    requireSession(),
    carregarContextoDaLigacao(),
    params,
  ]);

  return <TelaLigar contexto={contexto} quemLiga={sessao.nome} loteId={id} />;
}
