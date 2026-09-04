import { BottomNav } from '@/components/layout/bottom-nav';
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { TransicaoPagina } from '@/components/movimento';
import { type Sessao } from '@/lib/auth/session';

/**
 * Casca da área autenticada, responsiva e mobile-first (PRD §8):
 * desktop = lateral estreita mais cabeçalho de 56px; celular = cabeçalho mais barra
 * inferior com os 4 módulos do dia e o menu "Mais". A barra inferior tem 64px, e não os
 * 56px do cabeçalho, de propósito: é o mínimo para empilhar ícone e rótulo dentro de um
 * alvo de toque de 44px (docs/design/sistema-visual.md, "Alvos de toque").
 *
 * A troca de rota entra por `TransicaoPagina` (opacidade mais 2px): confirma que a
 * navegação aconteceu quando uma lista dá lugar a outra lista parecida.
 *
 * O espaço acima do conteúdo é o maior da pilha de propósito: é a única fronteira
 * entre dois níveis (casca e página). Com os 20px antigos ele empatava com os 16px
 * que separam irmãos dentro da própria página, e o bloco "Parceiros / 100 parceiros
 * na base" lia como uma segunda faixa do cabeçalho. Três degraus: 24px no celular e
 * 32px no desktop na fronteira, 16px entre irmãos, 8px dentro de um grupo.
 */
export function AppShell({ sessao, children }: { sessao: Sessao; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar papel={sessao.papel} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header sessao={sessao} />

        <main
          id="conteudo"
          className="flex-1 px-4 pt-6 pb-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior)+1rem)] md:px-6 md:pt-8 md:pb-8"
        >
          <TransicaoPagina>{children}</TransicaoPagina>
        </main>
      </div>

      <BottomNav papel={sessao.papel} />
    </div>
  );
}
