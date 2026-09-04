'use client';

import Link from 'next/link';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';

import { cn } from '@/lib/utils';
import { RevelarLista, useRevelarLinha } from '@/components/movimento';
import { BarraTermica, ChipTemperatura, DiasSemContato } from '@/components/temperatura';

import { formatarLocal, formatarProximaAcao, formatarTelefone } from './formatos';
import type { LinhaParceiro } from './tipos';

/**
 * A lista de parceiros no desktop.
 *
 * Densidade alta de propósito: sem cartão em volta, a tabela vive direto sobre a base
 * Ocean Breeze e as linhas são separadas por HAIRLINE translúcida (`border-hairline`,
 * branco a 8% no escuro, preto a 8% no claro), nunca por borda cheia: borda cheia numa
 * tabela desta densidade vira grade e cansa. O que carrega significado é a BARRA TÉRMICA
 * na borda esquerda (cor = temperatura calculada pelo banco, PRD §5.6) ao lado dos DIAS
 * SEM CONTATO em IBM Plex Mono com tabular-nums. Cor diz o calor, número diz o quanto
 * está parado.
 *
 * A tabela cabe na tela em vez de sangrar para fora dela: `table-fixed` faz as
 * larguras declaradas valerem (sem isso o layout automático segue o max-content e o
 * conteúdo estoura), e as colunas secundárias entram por degrau de largura. Como o
 * contêiner é 256px mais estreito que o viewport (a lateral), cada breakpoint do
 * Tailwind sobe um nível: categoria no `lg`, bairro e cidade no `xl`, o resto no `2xl`.
 * Nome e dias sem contato nunca somem: são o par que carrega a leitura de relance.
 *
 * A coluna do nome continua fixa na rolagem horizontal, para o `2xl` e para o zoom:
 * é o nome que responde "de quem é esta linha?" quando o resto some para a esquerda.
 * A sombra nas bordas do contêiner avisa que ainda há coluna fora da tela, e é 100%
 * CSS (`background-attachment`), sem ouvinte de scroll, que o plano de design proíbe.
 *
 * Sem ordenação por coluna: a ordem vem do servidor (relevância da busca, depois nome)
 * e vale para as 5.000 linhas. Ordenar só as 50 da página mentiria sobre o resto.
 */

/** Só o modelo básico: filtro, ordenação e paginação acontecem no Postgres. */
const recursos = tableFeatures({});
const coluna = createColumnHelper<typeof recursos, LinhaParceiro>();

/**
 * Largura e visibilidade por coluna, compartilhadas pelo cabeçalho e pela célula.
 * As larguras só valem porque a tabela é `table-fixed`; os breakpoints sobem um
 * degrau porque medem o viewport, e o contêiner tem 256px a menos que ele.
 */
const CLASSES: Record<string, string> = {
  nome: 'w-[clamp(13rem,20vw,20rem)]',
  dias: 'w-28',
  temperatura: 'w-32',
  telefone: 'w-40',
  categoria: 'hidden w-52 lg:table-cell',
  local: 'hidden w-44 xl:table-cell',
  responsavel: 'hidden w-36 2xl:table-cell',
  etapa: 'hidden w-40 2xl:table-cell',
  proxima: 'hidden w-32 2xl:table-cell',
};

/**
 * Aviso de que ainda há coluna fora da tela, sem ouvinte de scroll (proibido pelo
 * plano de design): quatro camadas de fundo, duas presas ao conteúdo (`local`, que
 * some no início e no fim da rolagem) e duas presas ao contêiner (`scroll`), que só
 * aparecem quando as primeiras saem de baixo delas. Cores em tokens, para valer nos
 * dois temas.
 */
const SOMBRA_DE_ROLAGEM: React.CSSProperties = {
  backgroundImage: [
    'linear-gradient(to right, var(--background), transparent)',
    'linear-gradient(to left, var(--background), transparent)',
    'linear-gradient(to right, color-mix(in oklab, var(--foreground) 10%, transparent), transparent)',
    'linear-gradient(to left, color-mix(in oklab, var(--foreground) 10%, transparent), transparent)',
  ].join(', '),
  backgroundPosition: 'left center, right center, left center, right center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '2rem 100%, 2rem 100%, 0.75rem 100%, 0.75rem 100%',
  backgroundAttachment: 'local, local, scroll, scroll',
};

const colunas = coluna.columns([
  coluna.accessor('name', {
    id: 'nome',
    header: 'Parceiro',
    cell: ({ row }) => <CelulaNome linha={row.original} />,
  }),
  coluna.accessor('days_since_contact', {
    id: 'dias',
    header: 'Sem contato',
    cell: ({ getValue }) => <DiasSemContato dias={getValue()} />,
  }),
  // Coluna própria, SEMPRE visível, e não um degrau `2xl:table-cell`: cinco matizes
  // num traço de 3px não sobrevivem a deuteranopia (no claro o par quente/cliente mede
  // 1,35:1 entre si), então o rótulo textual é o reforço que não depende de matiz. Se
  // entrasse junto de responsável e etapa, sumiria justamente no notebook de 1280px,
  // que é onde a lista é lida.
  coluna.accessor('temperature', {
    id: 'temperatura',
    header: 'Temperatura',
    cell: ({ getValue }) => <ChipTemperatura temperatura={getValue()} />,
  }),
  coluna.accessor('primary_category', {
    id: 'categoria',
    header: 'Categoria',
    cell: ({ getValue }) => <Texto valor={getValue()} />,
  }),
  coluna.display({
    id: 'local',
    header: 'Bairro e cidade',
    cell: ({ row }) => (
      <Texto valor={formatarLocal(row.original.neighborhood, row.original.city) || null} />
    ),
  }),
  coluna.accessor('phone', {
    id: 'telefone',
    header: 'WhatsApp',
    cell: ({ getValue }) => {
      const valor = getValue();
      if (!valor) return <Vazio />;
      return <span className="numerico text-[0.8125rem]">{formatarTelefone(valor)}</span>;
    },
  }),
  coluna.accessor('owner', {
    id: 'responsavel',
    header: 'Responsável',
    cell: ({ getValue }) => <Texto valor={getValue()} />,
  }),
  coluna.accessor('stage', {
    id: 'etapa',
    header: 'Etapa',
    cell: ({ getValue }) => <Texto valor={getValue()} />,
  }),
  coluna.accessor('next_action_at', {
    id: 'proxima',
    header: 'Próxima ação',
    cell: ({ getValue }) => <CelulaProximaAcao iso={getValue()} />,
  }),
]);

export function TabelaParceiros({ linhas }: { linhas: LinhaParceiro[] }) {
  const tabela = useTable({ features: recursos, columns: colunas, data: linhas });

  return (
    <RevelarLista>
      {/* O contêiner rola na horizontal; a página nunca rola. */}
      <div className="relative w-full overflow-x-auto" style={SOMBRA_DE_ROLAGEM}>
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            {tabela.getHeaderGroups().map((grupo) => (
              <tr key={grupo.id} className="border-b border-hairline">
                {grupo.headers.map((cabecalho) => (
                  <th
                    key={cabecalho.id}
                    scope="col"
                    className={cn(
                      // `truncate` é rede de segurança da troca de fonte: Poppins é
                      // mais larga que a Geist anterior, e com `table-fixed` um
                      // rótulo que crescesse sangraria por cima da coluna vizinha.
                      'h-9 truncate px-3 text-left align-middle text-xs font-medium text-muted-foreground',
                      cabecalho.column.id === 'nome' &&
                        'sticky left-0 z-20 border-r border-hairline bg-background pl-4',
                      CLASSES[cabecalho.column.id],
                    )}
                  >
                    {cabecalho.isPlaceholder ? null : <tabela.FlexRender header={cabecalho} />}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {tabela.getRowModel().rows.map((linha, indice) => (
              <Linha key={linha.id} indice={indice}>
                {linha.getAllCells().map((celula) => (
                  <td
                    key={celula.id}
                    className={cn(
                      'h-9 px-3 align-middle whitespace-nowrap',
                      celula.column.id === 'nome' &&
                        // Fundo opaco para o conteúdo passar por baixo, e o mesmo
                        // resultado do hover da linha (muted a 50% sobre o fundo).
                        'sticky left-0 z-10 border-r border-hairline bg-background p-0 group-hover/linha:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]',
                      CLASSES[celula.column.id],
                    )}
                  >
                    <tabela.FlexRender cell={celula} />
                  </td>
                ))}
              </Linha>
            ))}
          </tbody>
        </table>
      </div>

      <ColunasEscondidas />
    </RevelarLista>
  );
}

/**
 * Nenhuma coluna some em silêncio.
 *
 * As colunas secundárias entram por degrau de largura, e numa tela de 1280px (o
 * notebook do time) responsável, etapa e próxima ação simplesmente não estão lá.
 * Sem este aviso a pessoa conclui que o dado não existe, e não que ele está a um
 * clique de distância. O texto é escolhido por CSS, no mesmo degrau em que a coluna
 * desaparece, então não há medição de largura nem ouvinte de resize.
 */
function ColunasEscondidas() {
  return (
    <p className="px-3 py-2 text-xs text-muted-foreground 2xl:hidden">
      Nesta largura de tela,{' '}
      <span className="hidden xl:inline">responsável, etapa e próxima ação</span>
      <span className="hidden lg:inline xl:hidden">
        bairro e cidade, responsável, etapa e próxima ação
      </span>
      <span className="lg:hidden">
        categoria, bairro e cidade, responsável, etapa e próxima ação
      </span>{' '}
      só aparecem na ficha do parceiro. Role a tabela para o lado ou abra a ficha.
    </p>
  );
}

/**
 * A `<tr>` não aceita um componente de movimento em volta, então o escalonamento de
 * entrada vem por classe e delay inline (`useRevelarLinha`), que se desliga sozinho
 * depois da primeira leva e respeita prefers-reduced-motion.
 */
function Linha({ indice, children }: { indice: number; children: React.ReactNode }) {
  const revelar = useRevelarLinha(indice);

  return (
    <tr
      {...revelar}
      className={cn(
        'group/linha border-b border-hairline transition-colors last:border-b-0 hover:bg-muted/50',
        revelar.className,
      )}
    >
      {children}
    </tr>
  );
}

/** Barra térmica + nome, com a linha inteira clicável até a ficha. */
function CelulaNome({ linha }: { linha: LinhaParceiro }) {
  return (
    <div className="relative flex h-9 items-center">
      {/* `semRotulo`: a coluna Temperatura já anuncia o rótulo nesta mesma linha,
          e sem isso o leitor de tela leria a temperatura duas vezes por parceiro. */}
      <BarraTermica
        temperatura={linha.temperature}
        needsAttention={linha.needs_attention}
        posicao="absoluta"
        semRotulo
      />
      <Link
        href={`/parceiros/${linha.id}`}
        className="block min-w-0 flex-1 truncate rounded-lg py-1.5 pr-3 pl-4 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        title={linha.name}
      >
        {linha.name}
      </Link>
    </div>
  );
}

function CelulaProximaAcao({ iso }: { iso: string | null }) {
  const acao = formatarProximaAcao(iso);
  if (!acao) return <Vazio />;

  return (
    <span
      title={acao.detalhe}
      className={cn(
        'text-[0.8125rem] text-muted-foreground',
        acao.numero && 'numerico',
        acao.atrasada && 'font-medium text-foreground',
      )}
    >
      {acao.texto}
    </span>
  );
}

function Texto({ valor }: { valor: string | null }) {
  if (!valor) return <Vazio />;
  return (
    <span className="block truncate text-[0.8125rem]" title={valor}>
      {valor}
    </span>
  );
}

/** Lacuna de dado: um traço curto e discreto, nunca "N/A" nem célula em branco. */
function Vazio() {
  return (
    <span className="text-muted-foreground" aria-label="sem informação">
      -
    </span>
  );
}
