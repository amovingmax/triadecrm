import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { carregarCatalogos } from '@/components/conversas/catalogos';
import { TelaConversas } from '@/components/conversas/tela-conversas';
import { estadoDaUrl } from '@/components/conversas/tipos';

export const metadata: Metadata = { title: 'Conversas' };

/**
 * Conversas (RF-CON-03 a RF-CON-06, RF-CON-22; anexos R04 e R08).
 *
 * O inbox de WhatsApp: a conversa nos dois sentidos, o estado de entrega de cada
 * mensagem, o relógio da janela de 24 h — que é o que decide se dá para responder
 * livremente ou só por modelo aprovado — e a fila de aprovação do ADR-05, onde o
 * rascunho da IA espera uma pessoa antes de virar mensagem.
 *
 * O que NÃO existe ainda fica escrito na própria tela, com números lidos do banco:
 * o número "Heloísa · Komune" espera a verificação do CNPJ no Meta Business, os
 * modelos esperam aprovação (RF-CON-02) e o worker que entrega já existe mas está
 * parado, sem número nem token. Mensagem entra; mensagem ainda não sai. O que a
 * pessoa aprova aqui fica na fila até lá.
 *
 * O servidor faz duas coisas: lê os catálogos (o time, as etapas dos funis e os 34
 * desfechos do catálogo de interações) e traduz a query string no estado inicial, para
 * um link com `?org=` abrir já na conversa certa e `?aba=aprovar` cair na fila. Todo o
 * resto roda no cliente, sob a mesma RLS.
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

  const { filtros, organizacaoId, aba } = estadoDaUrl(params);

  return (
    <TelaConversas
      catalogos={catalogos}
      filtrosIniciais={filtros}
      organizacaoInicial={organizacaoId}
      abaInicial={aba}
    />
  );
}
