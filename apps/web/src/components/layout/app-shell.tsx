import { PilhaDeAvisos } from '@/components/avisos/pilha-de-avisos';
import { ProvedorDeAvisos } from '@/components/avisos/provedor-avisos';
import { BottomNav } from '@/components/layout/bottom-nav';
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { ProvedorDoSoftphone } from '@/components/ligacao/voz-provedor';
import { TransicaoPagina } from '@/components/movimento';
import { type Sessao } from '@/lib/auth/session';
import { type ContagemDasFilas } from '@/lib/filas-do-menu';
import { podeCriarParceiro } from '@/lib/navegacao';

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
 *
 * `ProvedorDeAvisos` envolve a casca inteira porque o aviso de resposta vale em
 * qualquer tela: é ele que mantém vivo o número ao lado de Conversas e que avisa
 * quem está no funil de que alguém respondeu (`components/avisos`). Os cartões
 * "Nova mensagem" saem por `PilhaDeAvisos`, no canto de cima.
 *
 * `ProvedorDoSoftphone` também envolve tudo, pelo mesmo motivo: a ligação feita pelo
 * navegador tem de sobreviver à troca de tela, e o painel dela fica no canto de baixo
 * (`components/ligacao/voz-provedor.tsx`). Com a telefonia desligada ele não desenha nada.
 */
export function AppShell({
  sessao,
  filas,
  children,
}: {
  sessao: Sessao;
  /** Quanto trabalho está parado em cada fila que o menu conta (`lib/filas-do-menu.ts`). */
  filas: ContagemDasFilas;
  children: React.ReactNode;
}) {
  return (
    <ProvedorDeAvisos usuarioId={sessao.id} papel={sessao.papel}>
      <ProvedorDoSoftphone podeLigar={podeCriarParceiro(sessao.papel)}>
        <div className="flex min-h-dvh bg-background">
          <Sidebar papel={sessao.papel} filas={filas} />

          <div className="flex min-w-0 flex-1 flex-col">
            <Header sessao={sessao} />

            <main
              id="conteudo"
              className="flex-1 px-4 pt-4 pb-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior)+1rem)] md:px-5 md:pt-3 md:pb-8"
            >
              {/* Coluna centralizada com teto: cada tela ainda escolhe a própria medida de
              leitura, mas nenhuma fica grudada na barra lateral com um terço de vazio
              à direita, e nenhuma tabela se estica por 2500px num monitor ultrawide. */}
              {/* 1400px e não 1440 (Tríade Design System): o sistema desenha num
              quadro de 1440 com 20px de margem de cada lado, e o conteúdo que
              sobra é exatamente 1400. */}
              <div className="mx-auto w-full max-w-[1400px]">
                <TransicaoPagina>{children}</TransicaoPagina>
              </div>
            </main>
          </div>

          <BottomNav papel={sessao.papel} filas={filas} />
          <PilhaDeAvisos />
        </div>
      </ProvedorDoSoftphone>
    </ProvedorDeAvisos>
  );
}
