'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { PainelLigacoesDoDia } from '@/components/ligacoes-do-dia/painel-do-time';
import { EMPRESA } from '@/lib/empresa';

import { BarraDePeriodo, SeletorDePainel } from './barra-recorte';
import { PainelAtendimento } from './painel-atendimento';
import { PainelBairros } from './painel-bairros';
import { PainelBase } from './painel-base';
import { PainelCategorias } from './painel-categorias';
import { PainelFontes } from './painel-fontes';
import { PainelFunil } from './painel-funil';
import { PainelHorarios } from './painel-horarios';
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
  const barra = useRef<HTMLDivElement>(null);

  const trocarPainel = useCallback((chave: ChavePainel) => {
    setAlvo(null);
    setPainel(chave);
  }, []);

  // Trocar de aba por um cartão (o "Ver…" ou a sugestão) leva a pessoa de volta à
  // barra: a aba nova começa no topo, e o clique foi lá embaixo.
  const abrirPainel = useCallback<AbrirPainel>((chave, destino) => {
    setAlvo(destino ?? null);
    setPainel(chave);
    requestAnimationFrame(() => barra.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

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
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-1">
        {/* Título no degrau do sistema: 32px em peso leve, com a trilha em
            cima. Igual ao Meu dia — duas telas com o mesmo título em tamanhos
            diferentes é o que faz o produto parecer remendado. */}
        <p className="text-xs text-muted-foreground">Início · Relatórios</p>
        <h1 className="mt-1 font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
          Relatórios
        </h1>
        {/* No celular esta frase gastava cinco linhas antes do primeiro número, e o
            painel logo abaixo já diz o que aquela leitura responde. Ela fica onde há
            espaço para ela. */}
        <p className="hidden max-w-[90ch] text-sm text-muted-foreground md:block">
          {EMPRESA.modulos.relatoriosDaImova
            ? 'Onde está a comissão parada, quem quer cada imóvel e o que falar, onde o funil trava, quem converte na equipe e como a IA está melhorando.'
            : 'Onde o funil trava, que categoria secou, que bairro ainda não foi batido. O que está na tela desce em CSV.'}
        </p>
      </header>

      {/* A barra de recorte vira CARTÃO (29/09/2026): entre dois filetes ela lia
          como divisória, e o que ela é de fato é o controle da tela — o que
          decide todos os números abaixo. */}
      <div ref={barra} className="sombra-base flex scroll-mt-4 flex-col gap-3 rounded-xl bg-card p-4">
        <SeletorDePainel painel={painel} aoTrocar={trocarPainel} />
        {/* A leitura da semana tem recorte próprio (a semana civil) e seletor
            próprio: a barra de 7/30 dias ali não mudaria número nenhum. */}
        {painelUsaPeriodo(painel) ? (
          <BarraDePeriodo periodo={periodo} aoTrocar={trocarPeriodo} />
        ) : null}
      </div>

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
