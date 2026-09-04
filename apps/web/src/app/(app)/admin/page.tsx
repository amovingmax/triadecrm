import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { AreaRestrita } from '@/components/admin/area-restrita';
import { TelaAdmin } from '@/components/admin/tela-admin';
import { abaDaUrl, catalogoDaUrl, lgpdDaUrl } from '@/components/admin/tipos';

export const metadata: Metadata = { title: 'Admin' };

/**
 * Administração (PRD §7.9): pessoas, catálogos e ferramentas de LGPD.
 *
 * A rota exige sessão, mas NÃO redireciona quem não é admin nem gestor: quem chega
 * aqui sem o papel vê uma tela que explica o que existe nesta parte e a quem pedir
 * (RF-ADM-01). Mandar para /sem-permissao trataria a curiosidade de um SDR como um
 * erro, e a Admin aparece na navegação só para os dois papéis mesmo.
 *
 * A autorização de verdade continua no Postgres: `audit_log` e `allowed_users` só
 * abrem para admin, `pii_access_log` para admin e gestor, e a escrita de catálogo
 * exige `app.is_manager()`. A tela apenas evita oferecer botão que o banco recusaria.
 */
export default async function PaginaAdmin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sessao, params] = await Promise.all([requireSession(), searchParams]);

  if (sessao.papel !== 'admin' && sessao.papel !== 'gestor') {
    return <AreaRestrita papel={sessao.papel} />;
  }

  const aba = abaDaUrl(params.aba);

  return (
    <TelaAdmin
      sessao={sessao}
      abaInicial={aba}
      catalogoInicial={catalogoDaUrl(aba, params.secao)}
      lgpdInicial={lgpdDaUrl(aba, params.secao)}
    />
  );
}
