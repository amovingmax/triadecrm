import type { Metadata } from 'next';

import { EmConstrucao } from '@/components/em-construcao';
import { requireRole } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Admin' };

/** Só admin e gestor entram aqui (RF-ADM-01); os demais vão para /sem-permissao. */
export default async function PaginaAdmin() {
  await requireRole('admin', 'gestor');
  return (
    <EmConstrucao
      titulo="Admin"
      dia="D1 (parcial)"
      descricao="Papéis e usuários, etapas e SLAs por funil, motivos de perda, modelos de mensagem, feriados e ferramentas LGPD (RF-ADM). No D1 entra só o essencial: papéis e configuração inicial."
    />
  );
}
