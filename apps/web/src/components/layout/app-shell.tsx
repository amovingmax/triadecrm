import { BottomNav } from '@/components/layout/bottom-nav';
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { type Sessao } from '@/lib/auth/session';

/**
 * Casca da área autenticada, responsiva e mobile-first (PRD §8):
 * desktop = sidebar + cabeçalho; celular = cabeçalho + barra inferior com menu "Mais".
 */
export function AppShell({ sessao, children }: { sessao: Sessao; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar papel={sessao.papel} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header sessao={sessao} />
        <main
          id="conteudo"
          className="flex-1 px-4 pt-4 pb-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior)+1rem)] md:px-8 md:pt-6 md:pb-8"
        >
          {children}
        </main>
      </div>
      <BottomNav papel={sessao.papel} />
    </div>
  );
}
