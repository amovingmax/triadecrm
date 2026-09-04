import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { carregarCatalogos } from '@/components/conversas/catalogos';
import { TelaConversas } from '@/components/conversas/tela-conversas';
import { estadoDaUrl } from '@/components/conversas/tipos';

export const metadata: Metadata = { title: 'Conversas' };

/**
 * Conversas (RF-CON-05, RF-CON-06; anexo R04).
 *
 * O inbox de WhatsApp ainda não é possível: ele depende da verificação do CNPJ da
 * Komune no Meta Business, do Coexistence do número "Heloísa · Komune" e da aprovação
 * dos modelos de mensagem (RF-CON-02), que levam semanas e não são trabalho de
 * software. O que já existe, e já tem valor, é a linha do tempo do relacionamento —
 * ligação, visita, reunião, nota, registro de mensagem e cada mudança de etapa, com
 * quem fez e o desfecho. É ela que esta tela entrega, no formato em que as mensagens
 * vão entrar depois, e ela mesma diz o que ainda falta.
 *
 * O servidor faz duas coisas: lê os catálogos (o time, as etapas dos funis e os 34
 * desfechos do catálogo de interações) e traduz a query string no estado inicial, para
 * um link com `?org=` abrir já na conversa certa. Todo o resto roda no cliente, sob a
 * mesma RLS.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, catalogos, params] = await Promise.all([
    requireSession(),
    carregarCatalogos(),
    searchParams,
  ]);

  const { filtros, organizacaoId } = estadoDaUrl(params);

  return (
    <TelaConversas
      catalogos={catalogos}
      filtrosIniciais={filtros}
      organizacaoInicial={organizacaoId}
    />
  );
}
