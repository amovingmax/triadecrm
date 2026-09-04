import { redirect } from 'next/navigation';

import { ROTA_INICIAL } from '@/lib/supabase/middleware';

/** A raiz não tem conteúdo: quem está logado vai para "Meu dia" (o proxy manda os demais para /login). */
export default function PaginaInicial() {
  redirect(ROTA_INICIAL);
}
