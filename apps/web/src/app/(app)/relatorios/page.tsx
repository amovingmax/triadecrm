import type { Metadata } from 'next';

import { EmConstrucao } from '@/components/em-construcao';

export const metadata: Metadata = { title: 'Relatórios' };

export default function Pagina() {
  return (
    <EmConstrucao
      titulo="Relatórios"
      dia="D9"
      descricao="Relatório de segunda-feira (texto + XLSX), funil e atividades por pessoa; Metabase básico (RF-REL)."
    />
  );
}
