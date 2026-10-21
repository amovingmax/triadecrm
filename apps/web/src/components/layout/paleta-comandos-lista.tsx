'use client';

import { Plus } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { TEMAS } from '@/components/tema/alternador-tema';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { type AppRole } from '@/lib/auth/role';
import { HREF_NOVO_PARCEIRO, navegacaoPara, podeCriarParceiro } from '@/lib/navegacao';

/**
 * Paleta de comandos (⌘K, ou Ctrl+K fora do Mac): ir para qualquer módulo, abrir o
 * cadastro rápido de parceiro e trocar o tema, sem tirar a mão do teclado. No desktop
 * ela substitui o caminho "olhar a lateral, mirar, clicar"; no celular o botão é só
 * a lupa, porque a navegação de campo é a barra inferior.
 *
 * A lista de módulos é a mesma da lateral e já vem filtrada pelo papel.
 *
 * ===========================================================================
 * A DESCRIÇÃO É O ÍNDICE, E AGORA TAMBÉM É TEXTO
 * ===========================================================================
 * Quem busca aqui não digita "Cadências": digita "opt-out", "planilha", "rota",
 * "resumo do dia". Nada disso está nos rótulos, que são treze palavras soltas. O que
 * responde por essas buscas é `item.descricao`, empilhada em `keywords` (o `cmdk`
 * concatena rótulo e palavras-chave antes de pontuar).
 *
 * Isso tinha uma armadilha: a descrição decidia o resultado da busca sem nunca
 * aparecer, então quando uma tela mudava e a frase ficava para trás, o erro não era
 * visível em lugar nenhum — só se manifestava como "digitei 'assistente' e caí no
 * módulo errado". Mostrar a frase sob o rótulo resolve as duas coisas de uma vez: a
 * pessoa lê o que vai encontrar antes de dar Enter, e uma descrição que envelheceu
 * fica à vista de quem abrir a paleta.
 */
export function ListaDaPaleta({
  papel,
  aberta,
  aoMudar,
}: {
  papel: AppRole;
  aberta: boolean;
  aoMudar: (aberta: boolean) => void;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();

  const itens = navegacaoPara(papel);

  /** Fecha antes de navegar: a paleta não pode ficar por cima da tela que ela abriu. */
  const executar = useCallback(
    (acao: () => void) => {
      aoMudar(false);
      acao();
    },
    [aoMudar],
  );

  return (
    <CommandDialog
      open={aberta}
      onOpenChange={aoMudar}
      titulo="Paleta de comandos"
      descricao="Busque um módulo ou uma ação e confirme com Enter."
    >
      <CommandInput placeholder="Buscar módulo ou ação" />
      <CommandList>
        <CommandEmpty>
          Nada com esse nome. Busque pelo módulo (parceiros, funis) ou pelo que você quer fazer
          (registrar, importar planilha, rota).
        </CommandEmpty>

        <CommandGroup heading="Ir para">
          {itens.map((item) => {
            const Icone = item.icone;
            return (
              <CommandItem
                key={item.href}
                // `h-auto` e não só `min-h-*`: o `h-9` do CommandItem é altura
                // fixa e cortaria a segunda linha em vez de deixar a linha crescer.
                className="group h-auto min-h-11 items-start py-2 md:min-h-9"
                value={item.rotulo}
                keywords={[item.href.replace('/', ''), item.descricao]}
                onSelect={() => executar(() => router.push(item.href))}
              >
                <Icone className="mt-0.5" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span>{item.rotulo}</span>
                  {/* Duas linhas no máximo: a lista tem treze itens e um teto de
                      rolagem, e um parágrafo por linha faria caber três módulos na
                      primeira tela. A frase inteira continua em `keywords`, então
                      o que ficou fora da vista não sai da busca.

                      A linha selecionada sobe para `accent-foreground`: sobre o
                      `bg-accent` do escuro (#3f3f46) o esmaecido para em 4,07:1,
                      abaixo dos 4,5:1 exigidos a 12px, e é justamente a linha que
                      a pessoa está lendo. Fora da seleção o esmaecido tem folga
                      (5,81:1 no escuro, 5,15:1 no claro) e a hierarquia continua
                      no tamanho: 12px contra os 14px do rótulo. */}
                  <span className="line-clamp-2 text-xs leading-snug text-muted-foreground group-data-[selected=true]:text-accent-foreground">
                    {item.descricao}
                  </span>
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {podeCriarParceiro(papel) ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Ações">
              <CommandItem
                className="min-h-11 md:min-h-0"
                value="Novo parceiro"
                keywords={['cadastrar', 'criar', 'organizacao', 'fornecedor', 'contato']}
                onSelect={() => executar(() => router.push(HREF_NOVO_PARCEIRO))}
              >
                <Plus aria-hidden="true" />
                <span>Novo parceiro</span>
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />
        <CommandGroup heading="Aparência">
          {TEMAS.map(({ valor, rotulo, icone: Icone }) => (
            <CommandItem
              key={valor}
              className="min-h-11 md:min-h-0"
              value={`Tema ${rotulo}`}
              keywords={['tema', 'cor', 'claro', 'escuro', 'noite']}
              onSelect={() => executar(() => setTheme(valor))}
            >
              <Icone aria-hidden="true" />
              <span>Tema {rotulo.toLowerCase()}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
