import type { Metadata } from 'next';

import { EmConstrucao } from '@/components/em-construcao';

export const metadata: Metadata = { title: 'Conversas' };

export default function Pagina() {
  return (
    <EmConstrucao
      titulo="Conversas"
      dia="D5"
      descricao="Inbox de WhatsApp com responsável, fila diária de primeiros contatos em modo assistido e opt-out por regra (RF-CON)."
    />
  );
}
