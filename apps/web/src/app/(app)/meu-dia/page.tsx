import type { Metadata } from 'next';

import { EmConstrucao } from '@/components/em-construcao';

export const metadata: Metadata = { title: 'Meu dia' };

export default function Pagina() {
  return (
    <EmConstrucao
      titulo="Meu dia"
      dia="D8"
      descricao="Metas do dia, agenda (Meets e rota), fila de ações ordenada e conversas sem resposta, com abas Inbox / Feito / Futuro (RF-MET-03)."
    />
  );
}
