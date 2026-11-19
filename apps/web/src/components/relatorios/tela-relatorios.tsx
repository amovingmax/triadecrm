'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { PainelLigacoesDoDia } from '@/components/ligacoes-do-dia/painel-do-time';
import { EMPRESA } from '@/lib/empresa';

import { BarraDePeriodo, idDaAba, SeletorDePainel } from './barra-recorte';
import { PainelAtendimento } from './painel-atendimento';
import { PainelBairros } from './painel-bairros';
import { PainelBase } from './painel-base';
import { PainelCategorias } from './painel-categorias';
import { PainelFontes } from './painel-fontes';
import { PainelFunil } from './painel-funil';
import { PainelHorarios } from './painel-horarios';
import { PainelOrigem } from './painel-origem';
import { PainelPessoas } from './painel-pessoas';
import { PainelSemana } from './painel-semana';
import { PainelVendeFunil } from './painel-vende-funil';
import { PainelVendeIA } from './painel-vende-ia';
import { PainelVendeImoveis } from './painel-vende-imoveis';
import { PainelVendeOportunidades } from './painel-vende-oportunidades';
import { PainelVendeVisao } from './painel-vende-visao';
import { periodoValido, urlDoRecorte, type Periodo } from './periodo';
import { PAINEIS, painelUsaPeriodo, type AbrirPainel, type ChavePainel } from './tipos';

/**
 * A tela de Relatórios (RF-REL-01 a RF-REL-11).
 *
 * Sete leituras, um período, e nenhum número calculado aqui: cada painel chama uma
 * função `SECURITY DEFINER` do Postgres e desenha o que ela devolveu (ADR-03). Só um
 * painel fica montado por vez, então trocar de leitura é uma consulta, não sete.
 *
 * O recorte mora na URL (`?painel=funil&periodo=trinta`), por `replaceState`: um link
 * de relatório mandado no grupo abre no mesmo lugar, e voltar sai da tela em vez de
 * desfazer troca por troca.
 *
 * O período inválido (o dia final antes do inicial, enquanto alguém digita) não vai
 * para o banco: a tela guarda o último válido e continua mostrando aquele, com o
 * aviso ao lado do campo.
 */
export function TelaRelatorios({
  painelInicial,
  periodoInicial,
  semanaInicial,
  podeGerarSemana,
}: {
  painelInicial: ChavePainel;
  periodoInicial: Periodo;
  /** A segunda-feira pedida na URL, quando o link veio do relatório de segunda. */
  semanaInicial: string | null;
  /** Gerar e refazer o relatório da semana: admin e gestor. O SDR lê o que já foi gerado. */
  podeGerarSemana: boolean;
}) {
  const [painel, setPainel] = useState<ChavePainel>(painelInicial);
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);
  const [periodoAplicado, setPeriodoAplicado] = useState<Periodo>(periodoInicial);
  // A semana mora aqui, e não dentro do painel, porque é ela que vai para a URL:
  // o painel avisa qual semana está mostrando e a tela escreve o endereço.
  const [semana, setSemana] = useState<string | null>(semanaInicial);
  // O que a aba de destino abre já escolhido (o imóvel da sugestão da Visão geral).
  const [alvo, setAlvo] = useState<string | null>(null);
  const prefixo = useId();
  // O marco logo acima da barra de abas. A barra GRUDA no topo ao rolar, e um
  // elemento grudado já está "à vista" para o `scrollIntoView`: rolar até ela não
  // levaria a pessoa a lugar nenhum. O marco fica onde a barra mora sem grudar.
  const marco = useRef<HTMLDivElement>(null);
  const barra = useRef<HTMLDivElement>(null);

  /**
   * Leva a pessoa ao começo da leitura: a barra logo abaixo do cabeçalho do app e o
   * painel novo começando ali. `sempre` é a troca por um cartão (o clique foi lá
   * embaixo); sem ele, só rola se a barra estava grudada, isto é, se a pessoa tinha
   * descido. Quem troca de aba lá no alto continua onde está.
   *
   * "Estava grudada" é medido NA HORA DO CLIQUE, antes da troca: o painel novo chega
   * curto (o esqueleto), a página encolhe e a barra desgruda sozinha; medido depois,
   * a tela achava que a pessoa já estava no alto, e o navegador devolvia a rolagem
   * antiga quando os números chegavam (a aba nova abria no meio).
   */
  const irAoComeco = useCallback((sempre: boolean, suave: boolean) => {
    const alvo = marco.current;
    const faixa = barra.current;
    if (!alvo || !faixa) return;
    const topoDaBarra = parseFloat(getComputedStyle(faixa).top) || 0;
    if (!sempre && alvo.getBoundingClientRect().top >= topoDaBarra) return;
    const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() =>
      alvo.scrollIntoView({ behavior: suave && !reduzido ? 'smooth' : 'auto', block: 'start' }),
    );
  }, []);

  const trocarPainel = useCallback(
    (chave: ChavePainel) => {
      // Com a barra grudada, a aba nova abriria no meio da página: ela começa do
      // começo, sem animação (o conteúdo inteiro trocou, não há o que acompanhar).
      irAoComeco(false, false);
      setAlvo(null);
      setPainel(chave);
    },
    [irAoComeco],
  );

  // Trocar de aba por um cartão (o "Ver…" ou a sugestão) leva a pessoa de volta à
  // barra: a aba nova começa no topo, e o clique foi lá embaixo.
  const abrirPainel = useCallback<AbrirPainel>(
    (chave, destino) => {
      irAoComeco(true, true);
      setAlvo(destino ?? null);
      setPainel(chave);
    },
    [irAoComeco],
  );

  const trocarPeriodo = useCallback((novo: Periodo) => {
    setPeriodo(novo);
    if (periodoValido(novo)) setPeriodoAplicado(novo);
  }, []);

  useEffect(() => {
    const alvo = `${window.location.pathname}${urlDoRecorte(
      periodoAplicado,
      painel,
      painel === 'semana' ? semana : null,
    )}`;
    if (alvo !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', alvo);
    }
  }, [painel, periodoAplicado, semana]);

  const definicao = PAINEIS.find((item) => item.chave === painel) ?? PAINEIS[0];

  return (
    // Sem `gap` na coluna: o marco da barra é um filho de altura zero e ganharia um
    // vão só dele. Os respiros vão em cada bloco.
    //
    // `--topo-relatorios`: quanto do alto da tela fica coberto quando a barra gruda
    // (cabeçalho do app + barra de abas + 16px de folga). É a `scroll-margin` certa
    // para quem rola um bloco do painel até o alto (o detalhe do imóvel, por
    // exemplo): com uma folga menor, o começo do bloco para debaixo da barra.
    <div className="flex w-full flex-col [--topo-relatorios:7.25rem] md:[--topo-relatorios:8.5rem]">
      {/* O TOPO COMPACTO (16/11/2026). Trilha e título no degrau do sistema (32px em
          peso leve, igual ao Meu dia: duas telas com o mesmo título em tamanhos
          diferentes é o que faz o produto parecer remendado) e UMA linha curta de
          apoio. A frase de antes ocupava duas linhas para listar o que as abas logo
          abaixo já dizem, e cada painel tem a sua. No celular ela não aparece: lá
          gastava cinco linhas antes do primeiro número. */}
      <header className="flex flex-col">
        <p className="text-xs text-muted-foreground">Início · Relatórios</p>
        <h1 className="mt-1 font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
          Relatórios
        </h1>
        <p className="mt-0.5 hidden max-w-[80ch] text-sm text-muted-foreground md:block">
          {EMPRESA.modulos.relatoriosDaImova
            ? 'Onde está o dinheiro, onde o funil trava e como a IA está melhorando.'
            : 'Onde o funil trava, que categoria secou, que bairro ainda não foi batido. O que está na tela desce em CSV.'}
        </p>
      </header>

      <div ref={marco} aria-hidden="true" className="mt-3 scroll-mt-14 md:mt-4 md:scroll-mt-[72px]" />
      {/* A BARRA DE ABAS GRUDA logo abaixo do cabeçalho do app (56px no celular, 72px
          no computador): numa leitura comprida, trocar de relatório não pede rolar
          até o alto. Ela sai da largura da coluna até a margem do conteúdo
          (`-mx-4`/`-mx-5`) para o fundo dela cobrir o que passa por baixo; o vidro é
          o mesmo do cabeçalho, e a hairline embaixo é o trilho do traço da aba
          ativa. Era um cartão com sombra e a pílula laranja: o controle mais pesado
          da tela, acima de qualquer número. */}
      <div
        ref={barra}
        className="sticky top-14 z-20 -mx-4 bg-background/85 px-4 backdrop-blur-md md:top-[72px] md:-mx-5 md:px-5"
      >
        <div className="border-b border-hairline">
          <SeletorDePainel painel={painel} aoTrocar={trocarPainel} prefixo={prefixo} />
        </div>
      </div>

      {/* O período fica FORA da barra grudada: ele se escolhe uma vez, no alto, e
          grudar mais uma linha comeria a tela do celular. A leitura da semana tem
          recorte próprio (a semana civil), as Ligações do dia o dia, Oportunidades é
          o retrato de agora e o Progresso da IA conta desde que a IA começou: nelas
          a barra de 7/30 dias não mudaria número nenhum, e não aparece. */}
      {painelUsaPeriodo(painel) ? (
        <div className="mt-3">
          <BarraDePeriodo periodo={periodo} aoTrocar={trocarPeriodo} />
        </div>
      ) : null}

      {/* A altura mínima de uma tela: o painel novo chega curto (o esqueleto) e,
          sem ela, a página encolhia na troca, o rodapé subia e a rolagem do navegador
          era cortada; quando os números chegavam, a ancoragem de rolagem do Chrome
          devolvia a pessoa ao meio da página. Com ela, a troca leva sempre ao
          começo da leitura. */}
      <div
        role="tabpanel"
        id={`${prefixo}-painel`}
        aria-labelledby={idDaAba(prefixo, painel)}
        className="mt-5 min-h-[calc(100dvh-8rem)] md:mt-6"
      >
        {definicao ? (
          <Painel
            chave={definicao.chave}
            periodo={periodoAplicado}
            semana={semana}
            aoTrocarSemana={setSemana}
            podeGerarSemana={podeGerarSemana}
            aoAbrirPainel={abrirPainel}
            alvo={alvo}
          />
        ) : null}
      </div>
    </div>
  );
}

function Painel({
  chave,
  periodo,
  semana,
  aoTrocarSemana,
  podeGerarSemana,
  aoAbrirPainel,
  alvo,
}: {
  chave: ChavePainel;
  periodo: Periodo;
  semana: string | null;
  aoTrocarSemana: (semana: string) => void;
  podeGerarSemana: boolean;
  aoAbrirPainel: AbrirPainel;
  alvo: string | null;
}) {
  const painel = PAINEIS.find((item) => item.chave === chave);
  if (!painel) return null;

  switch (chave) {
    // Os da Imova: o "relatório que vende" (09/11/2026).
    case 'visao':
      return <PainelVendeVisao painel={painel} periodo={periodo} aoAbrirPainel={aoAbrirPainel} />;
    case 'origem':
      return <PainelOrigem painel={painel} periodo={periodo} />;
    case 'imoveis':
      return <PainelVendeImoveis painel={painel} periodo={periodo} imovelInicial={alvo} />;
    case 'oportunidades':
      return <PainelVendeOportunidades painel={painel} />;
    case 'funil_equipe':
      return <PainelVendeFunil painel={painel} periodo={periodo} />;
    case 'progresso_ia':
      return <PainelVendeIA painel={painel} />;
    case 'ligacoes':
      return <PainelLigacoesDoDia painel={painel} />;
    case 'atendimento':
      return <PainelAtendimento painel={painel} periodo={periodo} />;
    case 'semana':
      return (
        <PainelSemana
          painel={painel}
          semana={semana}
          aoTrocarSemana={aoTrocarSemana}
          podeGerar={podeGerarSemana}
        />
      );
    case 'funil':
      return <PainelFunil painel={painel} periodo={periodo} />;
    case 'categorias':
      return <PainelCategorias painel={painel} periodo={periodo} />;
    case 'bairros':
      return <PainelBairros painel={painel} periodo={periodo} />;
    case 'pessoas':
      return <PainelPessoas painel={painel} periodo={periodo} />;
    case 'horarios':
      return <PainelHorarios painel={painel} periodo={periodo} />;
    case 'fontes':
      return <PainelFontes painel={painel} periodo={periodo} />;
    case 'base':
      return <PainelBase painel={painel} periodo={periodo} />;
  }
}
