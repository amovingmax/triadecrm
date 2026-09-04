'use client';

/**
 * A tela de Funis (RF-FUN-01 a RF-FUN-04, RF-FUN-08).
 *
 * É onde a Heloísa trabalha: cada negócio é uma organização dentro de um funil,
 * parada numa etapa. A tela responde a três perguntas, nesta ordem — qual funil,
 * quais cartões, e o que fazer com este cartão agora.
 *
 * ---------------------------------------------------------------------------
 * O que esta página decide (e o que ela NÃO decide)
 * ---------------------------------------------------------------------------
 * Decide: qual funil está aberto, qual recorte está ligado, o que vai para a URL,
 * quando a folha de mover abre e o que acontece depois que o banco aceita o
 * movimento. Não decide como o cartão se desenha (é `../cartao`), nem como a consulta
 * é cacheada (é `../use-quadro`), nem o que o `move_deal` aceita (é o Postgres).
 *
 * ---------------------------------------------------------------------------
 * Três funis no seletor, dois quadros
 * ---------------------------------------------------------------------------
 * O seletor mostra os três funis que existem no banco. Fornecedor e Produtor abrem
 * quadro. Ativação abre a régua de etapas com a contagem real e a explicação de que
 * ele anda por eventos da plataforma Komune (PRD §6, v1): esconder o funil faria o
 * time procurá-lo, e abrir um quadro de sete colunas onde ninguém pode arrastar nada
 * ensinaria a coisa errada.
 *
 * ---------------------------------------------------------------------------
 * A URL é o estado
 * ---------------------------------------------------------------------------
 * Funil, busca, "meus" e etapa aberta vão para a query string por `replaceState`:
 * sem entrada nova no histórico (voltar tem de sair da tela, não desfazer filtro por
 * filtro) e sem uma ida ao servidor a cada tecla. Assim um link de quadro filtrado
 * pode ser mandado no grupo e volta igual.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { cn } from '@/lib/utils';

import {
  chaveDoQuadro,
  ehFunilDoQuadro,
  FILTROS_QUADRO_PADRAO,
  temRecorteNoQuadro,
  urlDosFiltrosQuadro,
  type FiltrosQuadro,
  type FunilSlug,
} from '../tipos';
import { Quadro, type PedidoDeAbrirMover } from '../quadro';
import { totalDoQuadro, useQuadro } from '../use-quadro';
import { FiltrosDoQuadro, SeletorDeFunil } from './cabecalho-funis';
import { carregarFunisDisponiveis, CHAVE_FUNIS_DISPONIVEIS } from './consultas';
import {
  ErroDoQuadro,
  EsqueletoQuadro,
  PainelDeAtivacao,
  QuadroVazio,
  QuadroVazioPorFiltro,
} from './estados-quadro';
import { FolhaMover, type AlvoDeMovimento } from './folha-mover';
import { descreverRecorte } from './url-dos-funis';
import { useTelaPequena } from './usar-tela-pequena';

export function TelaFunis({ filtrosIniciais }: { filtrosIniciais: FiltrosQuadro }) {
  const pequena = useTelaPequena();
  const cliente = useQueryClient();
  const [filtros, setFiltros] = useState<FiltrosQuadro>(filtrosIniciais);
  const [alvo, setAlvo] = useState<AlvoDeMovimento | null>(null);

  useEffect(() => {
    const alvoUrl = `${window.location.pathname}${urlDosFiltrosQuadro(filtros)}`;
    if (alvoUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', alvoUrl);
    }
  }, [filtros]);

  const funis = useQuery({
    queryKey: CHAVE_FUNIS_DISPONIVEIS,
    queryFn: carregarFunisDisponiveis,
    staleTime: 60 * 60_000,
  });

  const funilAtual = useMemo(
    () => (funis.data ?? []).find((f) => f.slug === filtros.funil) ?? null,
    [funis.data, filtros.funil],
  );

  const quadro = useQuadro(filtros, funilAtual?.id ?? null);
  const abreQuadro = ehFunilDoQuadro(filtros.funil);

  const trocarFunil = useCallback((slug: string) => {
    // Trocar de funil zera o recorte de etapa: id de etapa não atravessa funil.
    setFiltros((atual) => ({ ...atual, funil: slug as FunilSlug, etapaId: null }));
  }, []);

  const total = totalDoQuadro(quadro.data);
  const comRecorte = temRecorteNoQuadro(filtros);

  /** O banco aceitou: o quadro inteiro muda de contagem, então vale recarregar. */
  const aoMover = useCallback(() => {
    void cliente.invalidateQueries({ queryKey: chaveDoQuadro(filtros) });
  }, [cliente, filtros]);

  /**
   * A folha de mover abre por dois caminhos: o botão do cartão (sem destino, a folha
   * pergunta) e o arraste do quadro, que já traz a coluna onde o cartão foi solto.
   */
  const abrirMover = useCallback(({ cartao, etapaAtualId, etapaDestinoId }: PedidoDeAbrirMover) => {
    setAlvo({ cartao, etapaAtualId, etapaDestinoId: etapaDestinoId ?? null });
  }, []);

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Funis</h1>
            <p className="text-sm text-muted-foreground">
              {quadro.isPending || funis.isPending ? (
                'Carregando o quadro...'
              ) : !abreQuadro ? (
                'Este funil anda por eventos da plataforma Komune.'
              ) : (
                <>
                  <span className="numerico">{total}</span>
                  {total === 1 ? ' negócio' : ' negócios'}
                  {comRecorte ? ' no recorte atual' : ` em ${funilAtual?.nome ?? 'este funil'}`}
                </>
              )}
            </p>
          </div>
        </div>

        <SeletorDeFunil
          funis={funis.data ?? []}
          slugAtivo={filtros.funil}
          carregando={funis.isPending}
          aoEscolher={(funil) => trocarFunil(funil.slug)}
        />

        {abreQuadro ? (
          <FiltrosDoQuadro
            q={filtros.q}
            apenasMeus={filtros.apenasMeus}
            aoBuscar={(q) => setFiltros((atual) => ({ ...atual, q }))}
            aoTrocarDono={(apenasMeus) => setFiltros((atual) => ({ ...atual, apenasMeus }))}
          />
        ) : null}
      </header>

      <section
        aria-label="Quadro do funil"
        className={cn(
          'border-t border-hairline pt-4',
          // Enquanto a próxima consulta chega, o quadro anterior fica apagado e sem
          // toque: o que está na tela ainda é o de antes, e a interface não finge.
          quadro.isPlaceholderData && 'pointer-events-none opacity-60',
        )}
      >
        {funis.isError ? (
          <ErroDoQuadro causa={funis.error} aoTentar={() => void funis.refetch()} />
        ) : quadro.isPending || !quadro.data ? (
          <EsqueletoQuadro />
        ) : quadro.isError ? (
          <ErroDoQuadro causa={quadro.error} aoTentar={() => void quadro.refetch()} />
        ) : !abreQuadro ? (
          <PainelDeAtivacao
            etapas={quadro.data.stages}
            nomeDoFunil={funilAtual?.nome ?? quadro.data.pipeline.name}
          />
        ) : total === 0 && comRecorte ? (
          <QuadroVazioPorFiltro
            descricao={descreverRecorte(filtros)}
            aoLimpar={() =>
              setFiltros((atual) => ({ ...FILTROS_QUADRO_PADRAO, funil: atual.funil }))
            }
          />
        ) : total === 0 ? (
          <QuadroVazio nomeDoFunil={funilAtual?.nome ?? quadro.data.pipeline.name} />
        ) : (
          <Quadro
            quadro={quadro.data}
            filtros={filtros}
            funilId={funilAtual?.id ?? 0}
            pequena={pequena}
            aoAbrirMover={abrirMover}
            aoTrocarEtapa={(etapaId) => setFiltros((atual) => ({ ...atual, etapaId }))}
          />
        )}
      </section>

      <FolhaMover
        alvo={alvo}
        etapas={quadro.data?.stages ?? []}
        aoFechar={() => setAlvo(null)}
        aoMover={aoMover}
        aoDesencontro={aoMover}
      />
    </div>
  );
}
