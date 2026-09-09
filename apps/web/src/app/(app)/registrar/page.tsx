import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { LEITURA } from '@/lib/larguras';
import { carregarContextoDoRegistro } from '@/components/registro/dados';
import { TelaRegistro } from '@/components/registro/tela-registro';

export const metadata: Metadata = { title: 'Registrar contato' };

/**
 * Registrar contato (RF-MET-06, RF-FUN-12/13).
 *
 * A tela existe porque a temperatura do CRM estava morta por falta de entrada: a base
 * tem 100 organizações reais e todas apareciam "Frio, sem contato", porque não havia
 * nenhum lugar onde alguém dissesse o que aconteceu numa conversa. Aqui são três
 * toques — parceiro, canal, desfecho —, e o terceiro grava.
 *
 * O servidor entrega o catálogo de desfechos, os motivos de perda, as etapas e os
 * feriados prontos: são listas pequenas, legíveis por qualquer papel autenticado, e
 * buscá-las no cliente atrasaria o primeiro toque em quatro idas à rede. Todo o resto
 * (busca, gravação e recibo) roda no cliente, sob a mesma RLS.
 *
 * `?org=<id>` abre direto no passo 2, para a ficha do parceiro e a fila do dia
 * poderem apontar para cá.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sessao, contexto, params] = await Promise.all([
    requireSession(),
    carregarContextoDoRegistro(),
    searchParams,
  ]);

  const org = typeof params.org === 'string' ? params.org : null;

  return (
    // Era `mx-auto max-w-xl`: a única tela do CRM que ainda se centralizava. Numa
    // janela de 1425px o título nascia em x=528 enquanto as outras onze começavam em
    // x=232 — quase 300px de salto no item nº2 do menu, o mais usado do dia. Agora é
    // a mesma coluna de leitura do /ligar, que é o fluxo irmão deste.
    <div className={LEITURA}>
      <h1 className="sr-only">Registrar contato</h1>
      <TelaRegistro usuarioId={sessao.id} contexto={contexto} organizacaoInicial={org} />
    </div>
  );
}
