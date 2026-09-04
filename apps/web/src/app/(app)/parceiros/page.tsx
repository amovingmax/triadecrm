import type { Metadata } from 'next';

import { EmConstrucao } from '@/components/em-construcao';

export const metadata: Metadata = { title: 'Parceiros' };

export default function Pagina() {
  return (
    <EmConstrucao
      titulo="Parceiros"
      dia="D1/D2"
      descricao="Base de organizações e pessoas com busca global, filtros, criação rápida com dedup por telefone (RF-BAS-15) e importação de planilha (RF-BAS-07 a 11)."
    />
  );
}
