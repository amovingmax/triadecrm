import { CarregandoFicha } from '@/components/layout/carregando';

/**
 * Da lista (ou de qualquer um dos oito lugares que apontam para cá) até a ficha.
 * Precisa ser própria: a fronteira de `app/(app)/loading.tsx` fica acima de
 * `/parceiros`, e ir da lista à ficha sem sair da seção não passaria por ela.
 */
export default function Carregando() {
  return <CarregandoFicha />;
}
