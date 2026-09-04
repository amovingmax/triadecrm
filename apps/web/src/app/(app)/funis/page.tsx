import type { Metadata } from 'next';

import { EmConstrucao } from '@/components/em-construcao';

export const metadata: Metadata = { title: 'Funis' };

export default function Pagina() {
  return (
    <EmConstrucao
      titulo="Funis"
      dia="D3"
      descricao="Kanban dos funis de captação e de produtores, cartão com semáforo, próxima ação obrigatória, motivos de perda e linha do tempo (RF-FUN)."
    />
  );
}
