import type { Metadata } from 'next';

import { EmConstrucao } from '@/components/em-construcao';

export const metadata: Metadata = { title: 'Agenda' };

export default function Pagina() {
  return (
    <EmConstrucao
      titulo="Agenda"
      dia="D7"
      descricao="Reuniões em vídeo pela manhã, rota de visitas à tarde com link do Google Maps e lembretes de 24 h / 1 h (RF-AGE, RF-ROT)."
    />
  );
}
