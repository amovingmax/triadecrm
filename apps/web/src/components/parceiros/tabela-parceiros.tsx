'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';

import { cn } from '@/lib/utils';
import { RevelarLista, useRevelarLinha } from '@/components/movimento';
import { EtiquetaEtapa } from '@/components/funis/etapa';

import { formatarLocal, formatarTelefone } from './formatos';
import { ProximaAcao } from './proxima-acao';
import { BotaoSaudacao } from './saudacao-botoes';
import type { LinhaParceiro } from './tipos';
import { UltimoContato } from './ultimo-contato';

/**
 * A saudação na tabela (07/10/2026): a caixa de marcar ao lado do nome e o botão
 * de mandar ao lado do WhatsApp. Chega por contexto porque as colunas são
 * declaradas uma vez, fora do componente, e as células não recebem prop.
 * Sem provedor (quem não manda saudação), nenhuma das duas coisas aparece.
 */
export type SaudacaoNaTabela = {
  escolhidos: ReadonlySet<string>;
  alternar: (id: string) => void;
  marcarVarios: (ids: readonly string[], marcar: boolean) => void;
  /** As linhas da página que podem ser marcadas: as que têm WhatsApp. */
  marcaveis: readonly string[];
  pedidos: ReadonlySet<string>;
  ocupado: boolean;
  pedirUm: (id: string) => void;
};

const ContextoDaSaudacao = createContext<SaudacaoNaTabela | null>(null);

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
  // w-52 desde 07/10/2026: o botão da saudação mora ao lado do número.
  telefone: 'w-52',
  // A etapa é SEMPRE visível desde 28/09/2026: ela herdou o lugar da coluna
  // "Temperatura" (ADR-16). w-44 e não w-40 porque o nome mais longo do catálogo
  // — "Apresentação realizada" — não pode nascer truncado.
  etapa: 'w-44',
  responsavel: 'hidden w-36 2xl:table-cell',
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
    header: () => <CabecalhoNome />,
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
    cell: ({ row }) => <CelulaWhatsapp linha={row.original} />,
  }),
  // A ETAPA NO LUGAR DA TEMPERATURA (28/09/2026, ADR-16). Até hoje esta posição
  // — a única que a tabela mostra em toda largura — era a coluna "Temperatura",
  // e a etapa só aparecia a partir do `xl`. Rafael: "o fato de só o lead
  // responder e ele já virar morno não faz sentido e tá errado". As 12 etapas do
  // funil apareciam aqui como três cores; agora aparecem como as 12 que são.
  coluna.accessor('stage', {
    id: 'etapa',
    header: 'Etapa',
    cell: ({ getValue }) => <EtiquetaEtapa etapa={getValue()} />,
  }),
  coluna.accessor('owner', {
    id: 'responsavel',
    header: 'Responsável',
    cell: ({ getValue }) => <Texto valor={getValue()} />,
  }),
  coluna.accessor('next_action_at', {
    id: 'proxima',
    header: 'Próxima ação',
    cell: ({ getValue }) => <CelulaProximaAcao iso={getValue()} />,
  }),
]);

export function TabelaParceiros({
  linhas,
  saudacao = null,
}: {
  linhas: LinhaParceiro[];
  saudacao?: SaudacaoNaTabela | null;
}) {
  const tabela = useTable({ features: recursos, columns: colunas, data: linhas });

  return (
    <ContextoDaSaudacao.Provider value={saudacao}>
      <RevelarLista>
        <ColunasEscondidas />

        {/* O contêiner rola na horizontal; a página nunca rola.
          E ele é um CARTÃO (29/09/2026, Design System): a tabela ficava direto
          sobre a página, com as linhas encostando na borda da tela. No desenho
          novo a página é cinza e a tabela é conteúdo, logo mora no branco.
          `px-1` em vez de padding cheio porque as células já têm o seu, e um
          padding duplo empurraria a primeira coluna para o meio do cartão. */}
        <div
          className="sombra-base relative w-full overflow-x-auto rounded-xl bg-card px-1 py-1"
          style={SOMBRA_DE_ROLAGEM}
        >
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
                          'sticky left-0 z-20 border-r border-hairline bg-card pl-4',
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
                          'sticky left-0 z-10 border-r border-hairline bg-card p-0 group-hover/linha:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]',
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
    </ContextoDaSaudacao.Provider>
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
      Responsável e próxima ação estão na ficha de cada parceiro.
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
  const saudacao = useContext(ContextoDaSaudacao);

  return (
    <div className="relative flex h-14 items-center">
      {saudacao ? (
        <CaixaDeMarcar
          marcada={saudacao.escolhidos.has(linha.id)}
          habilitada={Boolean(linha.phone)}
          rotulo={linha.phone ? `Marcar ${linha.name}` : `${linha.name} não tem WhatsApp`}
          aoMudar={() => saudacao.alternar(linha.id)}
        />
      ) : null}
      <Link
        href={`/parceiros/${linha.id}`}
        className={cn(
          'flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg py-1.5 pr-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          saudacao ? 'pl-2' : 'pl-4',
        )}
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

/** "Parceiro", e a caixa que marca as linhas com WhatsApp desta página. */
function CabecalhoNome() {
  const saudacao = useContext(ContextoDaSaudacao);
  if (!saudacao) return 'Parceiro';
  const marcadas = saudacao.marcaveis.filter((id) => saudacao.escolhidos.has(id)).length;
  const todas = saudacao.marcaveis.length > 0 && marcadas === saudacao.marcaveis.length;
  return (
    <span className="flex items-center">
      <CaixaDeMarcar
        marcada={todas}
        meia={marcadas > 0 && !todas}
        habilitada={saudacao.marcaveis.length > 0}
        rotulo="Marcar todos desta página que têm WhatsApp"
        aoMudar={() => saudacao.marcarVarios(saudacao.marcaveis, !todas)}
        noCabecalho
      />
      <span className="pl-2">Parceiro</span>
    </span>
  );
}

function CaixaDeMarcar({
  marcada,
  meia = false,
  habilitada,
  rotulo,
  aoMudar,
  noCabecalho = false,
}: {
  marcada: boolean;
  meia?: boolean;
  habilitada: boolean;
  rotulo: string;
  aoMudar: () => void;
  noCabecalho?: boolean;
}) {
  return (
    // O alvo é o rótulo inteiro (44px de altura), não só a caixa de 16px.
    <label
      className={cn(
        'flex shrink-0 items-center justify-center',
        noCabecalho ? 'h-9 w-6' : 'h-14 w-8 pl-3',
        habilitada ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
      )}
      title={rotulo}
    >
      <input
        type="checkbox"
        checked={marcada}
        ref={(el) => {
          if (el) el.indeterminate = meia;
        }}
        disabled={!habilitada}
        onChange={aoMudar}
        aria-label={rotulo}
        className="size-4 accent-[var(--foreground)]"
      />
    </label>
  );
}

/** O número e, para quem manda, o botão da saudação ao lado. */
function CelulaWhatsapp({ linha }: { linha: LinhaParceiro }) {
  const saudacao = useContext(ContextoDaSaudacao);
  if (!linha.phone) return <Vazio />;
  return (
    <span className="flex items-center gap-1">
      <span className="numerico text-[0.8125rem]">{formatarTelefone(linha.phone)}</span>
      {saudacao ? (
        <BotaoSaudacao
          nome={linha.name}
          pedido={saudacao.pedidos.has(linha.id)}
          ocupado={saudacao.ocupado}
          aoPedir={() => saudacao.pedirUm(linha.id)}
        />
      ) : null}
    </span>
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
