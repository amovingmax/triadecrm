'use client';

import { Fragment, useEffect, useRef, useState } from 'react';

import { BotaoFiltros } from '@/components/ui/botao-filtros';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FolhaFiltros, GrupoDeFiltro } from '@/components/ui/folha-filtros';

import { CampoDeBusca } from './campo-de-busca';
import { EtiquetasDeFiltro, type EtiquetaDeFiltro } from './etiquetas-de-filtro';
import { formatarNumero } from './formatos';
import {
  contarFiltros,
  FILTRO_DE_PERFIL,
  PERFIS_DA_LISTA,
  SITUACOES_DO_CONTATO,
  type Catalogos,
  type FiltrosParceiros,
} from './tipos';

/**
 * Busca e filtros da lista.
 *
 * Protótipo responsivo da Imova (24/11/2026): a busca ocupa a largura toda e os seis
 * filtros (Perfil, Contato, Categoria, Cidade, Etapa, Responsável) moram numa folha,
 * atrás do botão Filtros, que mostra quantos estão ligados. Antes eles eram seis
 * caixas ao lado da busca: no tablet quebravam em três linhas, e no celular a fila
 * era cortada à direita. Os ligados aparecem abaixo da busca como etiquetas que se
 * tiram com um toque, e a barra inteira fica presa no topo ao rolar a lista.
 *
 * Os filtros saem dos catálogos do banco (nada é escrito à mão aqui) e valem na hora
 * em que são tocados: a folha não tem "aplicar", o botão do rodapé só fecha e diz
 * quantos parceiros sobraram.
 */
export function BarraFiltros({
  filtros,
  catalogos,
  total,
  carregando,
  aoMudar,
  aoLimpar,
  aoMedir,
}: {
  filtros: FiltrosParceiros;
  catalogos: Catalogos;
  /** Quantos parceiros o recorte atual devolveu (para o botão da folha). */
  total: number;
  carregando: boolean;
  aoMudar: (parcial: Partial<FiltrosParceiros>) => void;
  aoLimpar: () => void;
  /** A altura da barra presa, para o cabeçalho da tabela parar logo abaixo dela. */
  aoMedir?: (altura: number) => void;
}) {
  const [folhaAberta, setFolhaAberta] = useState(false);
  const barra = useRef<HTMLDivElement>(null);
  const ativos = contarFiltros(filtros);

  useEffect(() => {
    const el = barra.current;
    if (!el || !aoMedir) return;
    const observador = new ResizeObserver(() => aoMedir(el.offsetHeight));
    observador.observe(el);
    return () => observador.disconnect();
  }, [aoMedir]);

  const etiquetas = etiquetasDosFiltros(filtros, catalogos, aoMudar);

  return (
    <>
      {/* Presa logo abaixo do cabeçalho do app (56px no celular, 72px do tablet para
          cima), com o fundo da página translúcido por trás: quem rolou até o
          quadragésimo parceiro continua a um toque da busca. A margem negativa leva
          o fundo até a borda da tela. */}
      <div
        ref={barra}
        className="sticky top-14 z-20 -mx-4 flex flex-col gap-2.5 bg-background/90 px-4 py-2.5 backdrop-blur-md md:top-[72px] md:-mx-5 md:px-5"
      >
        <div className="flex items-center gap-2">
          <CampoDeBusca
            valor={filtros.q}
            aoMudar={(q) => aoMudar({ q })}
            rotulo="Buscar parceiro"
            placeholder="Nome, telefone, @instagram, CNPJ ou bairro"
            dica="Nome, telefone, @instagram, CNPJ ou bairro."
          />
          <BotaoFiltros ligados={ativos} onClick={() => setFolhaAberta(true)} />
        </div>
        <EtiquetasDeFiltro etiquetas={etiquetas} aoLimpar={aoLimpar} />
      </div>

      <FolhaFiltros
        aberta={folhaAberta}
        aoMudar={setFolhaAberta}
        rodape={
          <>
            {ativos > 0 ? (
              <Button variant="outline" className="toque h-11" onClick={aoLimpar}>
                Limpar
              </Button>
            ) : null}
            <Button className="toque h-11" onClick={() => setFolhaAberta(false)}>
              {carregando
                ? 'Ver parceiros'
                : `Ver ${formatarNumero(total)} ${total === 1 ? 'parceiro' : 'parceiros'}`}
            </Button>
          </>
        }
      >
        {/* PRIMEIRO, e não o último: o time faz a captação a partir desta lista, e a
            pergunta da manhã é "para quem eu ligo?". Categoria e cidade recortam o
            QUE; o contato recorta o PRÓXIMO PASSO. O perfil vem antes dele só na
            Imova (Clientes e Parceiros, 23/11/2026); na KOMUNE não aparece. */}
        {FILTRO_DE_PERFIL ? (
          <GrupoOpcoes
            titulo="Perfil"
            valor={filtros.perfil}
            aoMudar={(perfil) => aoMudar({ perfil })}
            opcoes={PERFIS_DA_LISTA.map((p) => ({ ...p }))}
          />
        ) : null}
        <GrupoOpcoes
          titulo="Contato"
          valor={filtros.contato}
          aoMudar={(contato) => aoMudar({ contato })}
          opcoes={SITUACOES_DO_CONTATO.map((c) => ({ valor: c.valor, rotulo: c.rotulo }))}
        />
        <GrupoOpcoes
          titulo="Categoria"
          valor={filtros.categoriaId}
          aoMudar={(categoriaId) => aoMudar({ categoriaId })}
          opcoes={catalogos.categorias.map((c) => ({ valor: c.id, rotulo: c.nome }))}
        />
        <GrupoOpcoes
          titulo="Cidade"
          valor={filtros.cidadeId}
          aoMudar={(cidadeId) => aoMudar({ cidadeId })}
          opcoes={catalogos.cidades.map((c) => ({
            valor: c.id,
            rotulo: c.nome,
            grupo: c.grandeNatal ? 'Grande Natal' : 'Interior',
          }))}
        />
        <GrupoOpcoes
          titulo="Etapa"
          valor={filtros.etapaId}
          aoMudar={(etapaId) => aoMudar({ etapaId })}
          opcoes={catalogos.etapas.map((e) => ({ valor: e.id, rotulo: e.nome, grupo: e.funil }))}
        />
        <GrupoOpcoes
          titulo="Responsável"
          valor={filtros.responsavelId}
          aoMudar={(responsavelId) => aoMudar({ responsavelId })}
          opcoes={catalogos.pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))}
        />
      </FolhaFiltros>
    </>
  );
}

/** As etiquetas dos filtros ligados, na ordem da folha. */
function etiquetasDosFiltros(
  f: FiltrosParceiros,
  catalogos: Catalogos,
  aoMudar: (parcial: Partial<FiltrosParceiros>) => void,
): EtiquetaDeFiltro[] {
  const lista: EtiquetaDeFiltro[] = [];
  const incluir = (
    chave: string,
    titulo: string,
    nome: string | undefined,
    tirar: Partial<FiltrosParceiros>,
  ) => {
    if (nome) lista.push({ chave, rotulo: `${titulo}: ${nome}`, aoTirar: () => aoMudar(tirar) });
  };
  if (FILTRO_DE_PERFIL && f.perfil)
    incluir('perfil', 'Perfil', PERFIS_DA_LISTA.find((p) => p.valor === f.perfil)?.rotulo, {
      perfil: null,
    });
  if (f.contato)
    incluir('contato', 'Contato', SITUACOES_DO_CONTATO.find((c) => c.valor === f.contato)?.rotulo, {
      contato: null,
    });
  if (f.categoriaId !== null)
    incluir(
      'categoria',
      'Categoria',
      catalogos.categorias.find((c) => c.id === f.categoriaId)?.nome,
      {
        categoriaId: null,
      },
    );
  if (f.cidadeId !== null)
    incluir('cidade', 'Cidade', catalogos.cidades.find((c) => c.id === f.cidadeId)?.nome, {
      cidadeId: null,
    });
  if (f.etapaId !== null)
    incluir('etapa', 'Etapa', catalogos.etapas.find((e) => e.id === f.etapaId)?.nome, {
      etapaId: null,
    });
  if (f.responsavelId !== null)
    incluir(
      'responsavel',
      'Responsável',
      catalogos.pessoas.find((p) => p.id === f.responsavelId)?.nome,
      {
        responsavelId: null,
      },
    );
  return lista;
}

type Opcao<T> = { valor: T; rotulo: string; grupo?: string };

/**
 * Um filtro na folha: as opções como fichas, uma escolhida por vez. Tocar na ficha
 * ligada a desliga (volta a "tudo"). Os catálogos agrupados (cidades por região,
 * etapas por funil, perfis por tag) ganham o nome do grupo antes das fichas dele, na
 * ordem em que o banco os mandou.
 */
function GrupoOpcoes<T extends string | number>({
  titulo,
  valor,
  opcoes,
  aoMudar,
}: {
  titulo: string;
  valor: T | null;
  opcoes: Opcao<T>[];
  aoMudar: (v: T | null) => void;
}) {
  if (opcoes.length === 0) return null;
  return (
    <GrupoDeFiltro titulo={titulo}>
      {opcoes.map((o, i) => {
        const novoGrupo = o.grupo !== undefined && o.grupo !== opcoes[i - 1]?.grupo;
        return (
          <Fragment key={String(o.valor)}>
            {novoGrupo ? (
              <p className="basis-full pt-1 text-xs font-medium text-muted-foreground">{o.grupo}</p>
            ) : null}
            <Chip
              ativo={valor === o.valor}
              onClick={() => aoMudar(valor === o.valor ? null : o.valor)}
            >
              {o.rotulo}
            </Chip>
          </Fragment>
        );
      })}
    </GrupoDeFiltro>
  );
}
