import { AppShell } from '@/components/layout/app-shell';
import { requireSession } from '@/lib/auth/session';

/** Área autenticada: exige sessão (o proxy já barra antes; aqui é a segunda camada) e monta a casca. */
export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sessao = await requireSession();
  return <AppShell sessao={sessao}>{children}</AppShell>;
}
