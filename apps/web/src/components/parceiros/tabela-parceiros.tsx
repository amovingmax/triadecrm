'use client';

import Link from 'next/link';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';

import { cn } from '@/lib/utils';
import { RevelarLista, useRevelarLinha } from '@/components/movimento';
import { BarraTermica, ChipTemperatura } from '@/components/temperatura';

import { formatarLocal, formatarTelefone } from './formatos';
import { ProximaAcao } from './proxima-acao';
import type { LinhaParceiro } from './tipos';
import { UltimoContato } from './ultimo-contato';

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
 *
 * O peso horizontal foi medido em 1440 e reequilibrado: `categoria` tinha 206px de
 * caixa útil para um conteúdo que pede até 383px (20 das 25 linhas visíveis cortadas),
 * enquanto sobrava folga nas colunas de largura fixa. Como a tabela é `table-fixed` e
 * `w-full`, o navegador distribui a sobra PROPORCIONALMENTE às larguras declaradas, e
 * era daí que vinha o ar: 1072px declarados em 1184px de contêiner inflavam tudo em
 * 10%. Subindo `categoria` de w-52 para w-72 a sobra cai para 16px, a caixa útil da
 * categoria vai de 206px para ~268px e o corte quase desaparece; o que encolhe são as
 * colunas que estavam sobrando, não as que cortavam.
 */
const CLASSES: Record<string, string> = {
  // O nome passou a carregar DUAS linhas: o nome e, embaixo, categoria · bairro,
  // cidade — que antes eram duas colunas próprias somando ~450px de largura
  // declarada. Juntar as três num lugar só é o que devolveu espaço ao WhatsApp,
  // que ficava cortado na borda direita a 1425px: justamente o dado que o time usa
  // para FAZER o contato, e a última coisa da linha.
  nome: 'w-[clamp(15rem,24vw,22rem)]',
  // A tag do desfecho mais longa do catálogo ("Pediu contato no WhatsApp") e a
  // linha de baixo (canal · quando · tentativa · quem) cabem em 240px sem cortar.
  dias: 'w-60',
  telefone: 'w-44',
  // w-36 e não w-40: sem `esfriando` o chip mede 42px; com, 127px. Os 144px cobrem
  // o pior caso — o sinal de esfriamento não pode nascer truncado.
  temperatura: 'w-36',
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
  // O que o último contato DEU, e não só há quantos dias. Ver `ultimo-contato.tsx`.
  coluna.accessor('last_contact_at', {
    id: 'dias',
    header: 'Último contato',
    cell: ({ row }) => <UltimoContato linha={row.original} />,
  }),
  // Terceira, e não última: é por onde o contato acontece. Antes vinha depois de
  // categoria e bairro, e a 1425px já nascia cortado pela borda do contêiner.
  coluna.accessor('phone', {
    id: 'telefone',
    header: 'WhatsApp',
    cell: ({ getValue }) => {
      const valor = getValue();
      if (!valor) return <Vazio />;
      return <span className="numerico text-[0.8125rem]">{formatarTelefone(valor)}</span>;
    },
  }),
  // Coluna própria, SEMPRE visível: cinco matizes num traço de 3px não sobrevivem a
  // deuteranopia (no claro o par quente/cliente mede 1,35:1 entre si), então o
  // rótulo textual é o reforço que não depende de matiz.
  coluna.accessor('temperature', {
    id: 'temperatura',
    header: 'Temperatura',
    cell: ({ row }) => (
      <ChipTemperatura
        temperatura={row.original.temperature}
        esfriando={row.original.needs_attention}
      />
    ),
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
      <ColunasEscondidas />

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
                      // 56px e não 36px. A tabela nasceu para uma linha por célula, e
                      // a tag do contato com a linha de baixo ficava espremida rente ao
                      // topo. Agora TODA linha tem a mesma anatomia — em cima o que
                      // importa, embaixo o contexto —, e as células de uma linha só
                      // (WhatsApp, temperatura) centralizam nessa mesma altura.
                      'h-14 px-3 align-middle whitespace-nowrap',
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
 *
 * Fica ACIMA da tabela, e não abaixo: embaixo ele nascia em y=2163 num documento de
 * 2283px, ou seja, para descobrir que existe uma coluna "Próxima ação" era preciso
 * passar pelas 50 linhas. E não manda mais "rolar a tabela para o lado": abaixo do
 * `2xl` as colunas escondidas estão em `display:none`, o contêiner não rola (medido:
 * scrollWidth 1184 = clientWidth 1184 em 1440px) e rolar nunca as traria de volta.
 */
function ColunasEscondidas() {
  return (
    <p className="pb-2 text-xs text-muted-foreground 2xl:hidden">
      Nesta largura de tela, responsável, etapa e próxima ação só aparecem na ficha do
      parceiro.
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

/**
 * Barra térmica, nome e — embaixo — do que é e onde fica.
 *
 * A segunda linha junta o que antes eram duas colunas (categoria e bairro/cidade).
 * Continuam sendo contexto, não identificação: ficam em 12px, na tinta secundária,
 * e truncam primeiro. O nome é o que responde "de quem é esta linha?".
 */
function CelulaNome({ linha }: { linha: LinhaParceiro }) {
  const onde = formatarLocal(linha.neighborhood, linha.city);
  const contexto = [linha.primary_category, onde].filter(Boolean).join(' · ');

  return (
    <div className="relative flex h-14 items-center">
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
        className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg py-1.5 pr-3 pl-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="truncate font-medium" title={linha.name}>
          {linha.name}
        </span>
        {contexto ? (
          <span className="truncate text-xs text-muted-foreground" title={contexto}>
            {contexto}
          </span>
        ) : null}
      </Link>
    </div>
  );
}

function CelulaProximaAcao({ iso }: { iso: string | null }) {
  if (!iso) return <Vazio />;
  return <ProximaAcao iso={iso} className="text-[0.8125rem] text-muted-foreground" />;
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
