import type { Metadata } from 'next';

import { EmConstrucao } from '@/components/em-construcao';

export const metadata: Metadata = { title: 'Radar' };

export default function Pagina() {
  return (
    <EmConstrucao
      titulo="Radar"
      dia="D4"
      descricao="Candidatos coletados em fontes públicas (Casamentos.com.br, base CNPJ), fila de revisão e pontuação v0 (RF-RAD)."
    />
  );
}
