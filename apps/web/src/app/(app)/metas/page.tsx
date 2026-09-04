import type { Metadata } from 'next';

import { EmConstrucao } from '@/components/em-construcao';

export const metadata: Metadata = { title: 'Metas' };

export default function Pagina() {
  return (
    <EmConstrucao
      titulo="Metas"
      dia="D8"
      descricao="Metas diárias por pessoa (3 portas abertas), acumulado × meta e fechamento do dia no resumo das 18:00 (RF-MET, RF-AST)."
    />
  );
}
