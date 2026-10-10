import type { Metadata } from 'next';

import { requireRole } from '@/lib/auth/session';
import { PAPEIS_QUE_LIGAM } from '@/components/ligacao/chamada-contexto';
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
 *
 * O botão "Ligar" da ficha cai nesta mesma tela, com um lote de um contato
 * (`montar_lote_avulso`): o roteiro e a tabulação da ligação pela ficha são estes.
 */
export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sessao, contexto, { id }, busca] = await Promise.all([
    // Mesma guarda de `/ligar`: a tela de trabalho não pode ser mais aberta
    // que a tela que leva a ela.
    requireRole(...PAPEIS_QUE_LIGAM),
    carregarContextoDaLigacao(),
    params,
    searchParams,
  ]);

  // `?org=` e `?discar=1` vêm do botão Ligar da ficha: a tela é a mesma, mas sabe para
  // onde voltar e já começa a chamada. São só navegação — quem decide se a ligação
  // pode sair continua sendo o banco.
  const org =
    typeof busca.org === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(busca.org)
      ? busca.org
      : null;

  return (
    <TelaLigar
      contexto={contexto}
      quemLiga={sessao.nome}
      loteId={id}
      daFicha={org}
      discarAoAbrir={org !== null && busca.discar === '1'}
    />
  );
}
