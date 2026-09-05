'use client';

import { useCallback, useEffect, useState } from 'react';

import { BarraDePeriodo, SeletorDePainel } from './barra-recorte';
import { PainelBairros } from './painel-bairros';
import { PainelBase } from './painel-base';
import { PainelCategorias } from './painel-categorias';
import { PainelFontes } from './painel-fontes';
import { PainelFunil } from './painel-funil';
import { PainelHorarios } from './painel-horarios';
import { PainelPessoas } from './painel-pessoas';
import { PainelSemana } from './painel-semana';
import { periodoValido, urlDoRecorte, type Periodo } from './periodo';
import { PAINEIS, painelUsaPeriodo, type ChavePainel } from './tipos';

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
}: {
  painelInicial: ChavePainel;
  periodoInicial: Periodo;
  /** A segunda-feira pedida na URL, quando o link veio do relatório de segunda. */
  semanaInicial: string | null;
}) {
  const [painel, setPainel] = useState<ChavePainel>(painelInicial);
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);
  const [periodoAplicado, setPeriodoAplicado] = useState<Periodo>(periodoInicial);
  // A semana mora aqui, e não dentro do painel, porque é ela que vai para a URL:
  // o painel avisa qual semana está mostrando e a tela escreve o endereço.
  const [semana, setSemana] = useState<string | null>(semanaInicial);

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
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Relatórios</h1>
        {/* No celular esta frase gastava cinco linhas antes do primeiro número, e o
            painel logo abaixo já diz o que aquela leitura responde. Ela fica onde há
            espaço para ela. */}
        <p className="hidden max-w-prose text-sm leading-relaxed text-muted-foreground md:block">
          As leituras que mudam decisão: onde o funil trava, que categoria secou, que bairro
          ainda não foi batido, a que horas a porta abre. Todo número sai de uma consulta do
          banco, e o que está na tela desce em CSV.
        </p>
      </header>

      <div className="flex flex-col gap-3 border-y border-hairline py-3">
        <SeletorDePainel painel={painel} aoTrocar={setPainel} />
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
}: {
  chave: ChavePainel;
  periodo: Periodo;
  semana: string | null;
  aoTrocarSemana: (semana: string) => void;
}) {
  const painel = PAINEIS.find((item) => item.chave === chave);
  if (!painel) return null;

  switch (chave) {
    case 'semana':
      return <PainelSemana painel={painel} semana={semana} aoTrocarSemana={aoTrocarSemana} />;
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
