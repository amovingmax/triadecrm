'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';

import { cn } from '@/lib/utils';
import { RevelarLista, useRevelarLinha } from '@/components/movimento';
import { EtiquetaEtapa } from '@/components/funis/etapa';
import { MudarEtapa } from '@/components/funis/mudar-etapa';
import type { TipoDeParceria } from '@/components/conversas/tipos';

import { BotaoConsultoria } from './consultoria-botoes';

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
 * A etapa e a Consultoria na linha (14/10/2026): o seletor de etapa (a folha do
 * Funis) e o botão que manda o parceiro para a aba Consultoria de Conversas. Pelo
 * mesmo caminho da saudação: sem provedor, a coluna volta a ser só a etiqueta.
 */
export type AcoesNaTabela = {
  /** `null` para quem não marca Consultoria (o SDR): a etapa muda, a marca não aparece. */
  consultoria: {
    /** Quem tem a marca, e a tag dele (Imova; na KOMUNE, sempre nula). */
    naConsultoria: ReadonlyMap<string, TipoDeParceria | null>;
    /** `nome` vai junto para o diálogo da tag dizer de quem é. */
    marcar: (id: string, sim: boolean, nome: string) => void;
  } | null;
  aoMudarEtapa: () => void;
};

const ContextoDasAcoes = createContext<AcoesNaTabela | null>(null);

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
 * larguras declaradas valerem, o nome fica com a sobra e as colunas secundárias
 * entram por degrau de largura (responsável no `xl`, próxima ação no `2xl`). Desde o
 * protótipo responsivo (24/11/2026) ela só aparece a partir de 1024px; abaixo disso
 * a lista é de cartões. Sem rolagem lateral, o cabeçalho fica preso ao rolar a página
 * e a coluna fixa do nome, que servia à rolagem lateral, saiu.
 *
 * Sem ordenação por coluna: a ordem vem do servidor (relevância da busca, depois nome)
 * e vale para as 5.000 linhas. Ordenar só as 50 da página mentiria sobre o resto.
 */

/** Só o modelo básico: filtro, ordenação e paginação acontecem no Postgres. */
const recursos = tableFeatures({});
const coluna = createColumnHelper<typeof recursos, LinhaParceiro>();

/**
 * Largura e visibilidade por coluna, compartilhadas pelo cabeçalho e pela célula.
 * As larguras só valem porque a tabela é `table-fixed`. Em 1024px o contêiner tem
 * ~890px: 224 + 224 + 208 deixam ~230px para o nome, que trunca com `title`.
 */
const CLASSES: Record<string, string> = {
  // O nome carrega DUAS linhas: o nome e, embaixo, categoria · bairro, cidade. Sem
  // largura declarada desde 24/11/2026: é a coluna que fica com a sobra, e as outras
  // têm a medida do que mostram.
  nome: '',
  // A tag do desfecho mais longa do catálogo ("Pediu contato no WhatsApp") e a
  // linha de baixo (canal · quando · tentativa · quem); o que passar trunca, com a
  // frase inteira no `title`.
  dias: 'w-56',
  // A etapa (botão que abre a folha de mover) e, ao lado, a marca de Parceiro.
  etapa: 'w-56',
  // O responsável entra a partir do `xl` (protótipo responsivo, 24/11/2026; antes
  // só no `2xl`): em 1280 a tabela já tem folga para ele.
  responsavel: 'hidden w-32 xl:table-cell',
  // O número e o botão da saudação ao lado.
  telefone: 'w-52',
  proxima: 'hidden w-32 2xl:table-cell',
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
  // A ETAPA NO LUGAR DA TEMPERATURA (28/09/2026, ADR-16): as 12 etapas do funil
  // aparecem como as 12 que são, e não como três cores. Logo depois do contato desde
  // o protótipo responsivo (24/11/2026): o que o contato deu e onde o negócio está
  // são lidos juntos.
  coluna.accessor('stage', {
    id: 'etapa',
    header: 'Etapa',
    cell: ({ row }) => <CelulaEtapa linha={row.original} />,
  }),
  coluna.accessor('owner', {
    id: 'responsavel',
    header: 'Responsável',
    cell: ({ getValue }) => <Texto valor={getValue()} />,
  }),
  // Por onde o contato acontece, com o botão da saudação ao lado. A tabela cabe na
  // largura desde 24/11/2026, então a última coluna não nasce mais cortada.
  coluna.accessor('phone', {
    id: 'telefone',
    header: 'WhatsApp',
    cell: ({ row }) => <CelulaWhatsapp linha={row.original} />,
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
  acoes = null,
}: {
  linhas: LinhaParceiro[];
  saudacao?: SaudacaoNaTabela | null;
  acoes?: AcoesNaTabela | null;
}) {
  const tabela = useTable({ features: recursos, columns: colunas, data: linhas });

  return (
    <ContextoDasAcoes.Provider value={acoes}>
      <ContextoDaSaudacao.Provider value={saudacao}>
        <RevelarLista>
          <ColunasEscondidas />

          {/* Um CARTÃO (29/09/2026, Design System): a página é cinza e a tabela é
          conteúdo, logo mora no branco.

          `overflow-x-clip`, e não `auto` (protótipo responsivo, 24/11/2026): um
          contêiner que rola vira o dono do `sticky`, e o cabeçalho deixava de ficar
          preso ao rolar a página. A tabela só aparece a partir de 1024px e as
          colunas secundárias entram por degrau de largura, então ela cabe sem rolar
          de lado. */}
          <div className="sombra-base relative w-full overflow-x-clip rounded-xl bg-card px-3 py-1">
            <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
              <thead>
                {tabela.getHeaderGroups().map((grupo) => (
                  <tr key={grupo.id}>
                    {grupo.headers.map((cabecalho) => (
                      <th
                        key={cabecalho.id}
                        scope="col"
                        className={cn(
                          // `truncate` é rede de segurança da troca de fonte: com
                          // `table-fixed` um rótulo que crescesse sangraria por cima
                          // da coluna vizinha.
                          'h-12 truncate border-b border-border bg-card px-3 text-left align-middle text-xs font-semibold text-muted-foreground',
                          // CABEÇALHO PRESO: para logo abaixo do cabeçalho do app (72px)
                          // e da barra de busca, que também é presa e cresce quando há
                          // etiquetas de filtro (a tela mede e passa a altura).
                          'sticky top-[calc(4.5rem+var(--barra-da-lista,4rem))] z-10',
                          cabecalho.column.id === 'nome' && 'pl-1',
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
                          // 60px: em cima o que importa, embaixo o contexto, e as
                          // células de uma linha só (WhatsApp, etapa) centralizam na
                          // mesma altura.
                          'h-[60px] border-b border-hairline px-3 align-middle whitespace-nowrap group-last/linha:border-b-0',
                          celula.column.id === 'nome' && 'p-0',
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
    </ContextoDasAcoes.Provider>
  );
}

/**
 * Nenhuma coluna some em silêncio.
 *
 * As colunas secundárias entram por degrau de largura, e numa tela de 1024px (o
 * tablet deitado) responsável e próxima ação simplesmente não estão lá. Sem este
 * aviso a pessoa conclui que o dado não existe, e não que ele está a um clique de
 * distância. O texto é escolhido por CSS, no mesmo degrau em que a coluna some.
 */
function ColunasEscondidas() {
  return (
    <p className="pb-2 text-xs text-muted-foreground 2xl:hidden">
      <span className="xl:hidden">Responsável e próxima ação estão na ficha de cada parceiro.</span>
      <span className="hidden xl:inline">A próxima ação está na ficha de cada parceiro.</span>
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
      className={cn('group/linha transition-colors hover:bg-muted/50', revelar.className)}
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
    <div className="relative flex h-[60px] items-center">
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
          saudacao ? 'pl-1' : 'pl-3',
        )}
      >
        <span className="truncate font-semibold" title={linha.name}>
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
      />
      <span className="pl-1">Parceiro</span>
    </span>
  );
}

/**
 * A caixa de marcar com 40px de área de toque (o rótulo inteiro), e não só a caixa
 * de 18px. Também serve aos cartões do tablet (`lista-cartoes.tsx`).
 */
export function CaixaDeMarcar({
  marcada,
  meia = false,
  habilitada,
  rotulo,
  aoMudar,
}: {
  marcada: boolean;
  meia?: boolean;
  habilitada: boolean;
  rotulo: string;
  aoMudar: () => void;
}) {
  return (
    <label
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg',
        habilitada ? 'cursor-pointer hover:bg-muted/60' : 'cursor-not-allowed opacity-40',
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
        className="size-[18px] accent-[var(--primary)]"
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
          className="size-9"
        />
      ) : null}
    </span>
  );
}

/**
 * A etapa como botão (abre a folha de mover do Funis) e, ao lado, a Consultoria.
 * Sem negócio não há o que mover: fica a etiqueta "Sem etapa".
 */
function CelulaEtapa({ linha }: { linha: LinhaParceiro }) {
  const acoes = useContext(ContextoDasAcoes);
  if (!acoes) return <EtiquetaEtapa etapa={linha.stage} />;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {linha.stage ? (
        <MudarEtapa
          organizacaoId={linha.id}
          nome={linha.name}
          etapa={linha.stage}
          aoMudar={acoes.aoMudarEtapa}
          className="h-8 min-w-0 shrink px-2.5"
        />
      ) : (
        <EtiquetaEtapa etapa={null} className="min-w-0 shrink" />
      )}
      {acoes.consultoria ? (
        <BotaoConsultoria
          nome={linha.name}
          marcado={acoes.consultoria.naConsultoria.has(linha.id)}
          tag={acoes.consultoria.naConsultoria.get(linha.id) ?? null}
          aoMudar={(sim) => acoes.consultoria?.marcar(linha.id, sim, linha.name)}
          className={acoes.consultoria.naConsultoria.has(linha.id) ? 'h-8' : 'size-8'}
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
