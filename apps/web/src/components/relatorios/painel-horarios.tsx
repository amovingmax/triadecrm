'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { carregarHorarios, chaveDoRelatorio } from './dados';
import { formatarInteiro, formatarPercentual, rotuloDaSuperficie } from './formatos';
import { QuadroPainel, TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { NumeroComBarra, SemDado } from './tabela';
import type { Coluna, DefinicaoPainel, LinhaHorario } from './tipos';

/**
 * Eficiência por faixa de horário e canal (RF-REL-06): a que horas a porta abre.
 *
 * Faixas de duas horas no fuso de Natal, como o banco agrupa. É o relatório mais
 * exposto a conclusão apressada: com poucas dezenas de toques, uma faixa com 2 de 2
 * mostra 100% e não quer dizer nada. Por isso a taxa vem sempre acompanhada do
 * denominador na própria linha, e a tira de "melhor faixa" só considera faixas com
 * pelo menos 5 portas batidas — abaixo disso ela diz que ainda não há base.
 */
const MINIMO_PARA_COMPARAR = 5;

export function PainelHorarios({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('horarios', periodo),
    queryFn: () => carregarHorarios(periodo),
  });

  const linhas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const maiorToques = useMemo(
    () => linhas.reduce((maior, linha) => Math.max(maior, linha.toques), 0),
    [linhas],
  );

  const resumo = useMemo(() => {
    const soma = (pega: (linha: LinhaHorario) => number) =>
      linhas.reduce((total, linha) => total + pega(linha), 0);
    const batidas = soma((l) => l.portas_batidas);
    const abertas = soma((l) => l.portas_abertas);

    // Melhor faixa: soma dos canais dentro da mesma faixa, e só com base suficiente.
    const porFaixa = new Map<string, { batidas: number; abertas: number }>();
    for (const linha of linhas) {
      const atual = porFaixa.get(linha.faixa) ?? { batidas: 0, abertas: 0 };
      atual.batidas += linha.portas_batidas;
      atual.abertas += linha.portas_abertas;
      porFaixa.set(linha.faixa, atual);
    }
    const candidatas = [...porFaixa.entries()]
      .filter(([, valores]) => valores.batidas >= MINIMO_PARA_COMPARAR)
      .sort((a, b) => b[1].abertas / b[1].batidas - a[1].abertas / a[1].batidas);
    const melhor = candidatas[0];

    return [
      {
        chave: 'faixas',
        rotulo: 'Faixas com toque',
        valor: formatarInteiro(porFaixa.size),
        apoio: 'blocos de duas horas',
      },
      {
        chave: 'toques',
        rotulo: 'Toques',
        valor: formatarInteiro(soma((l) => l.toques)),
        apoio: 'interações registradas',
      },
      {
        chave: 'batidas',
        rotulo: 'Portas batidas',
        valor: formatarInteiro(batidas),
        apoio: 'tentativas que contam',
      },
      {
        chave: 'abertas',
        rotulo: 'Portas abertas',
        valor: formatarInteiro(abertas),
        apoio: 'a pessoa respondeu',
      },
      {
        chave: 'abertura',
        rotulo: 'Abertura geral',
        valor: batidas > 0 ? (formatarPercentual((abertas * 100) / batidas) ?? '0,0%') : 'n/d',
        apoio: 'no período escolhido',
      },
      {
        chave: 'melhor',
        rotulo: 'Melhor faixa',
        valor: melhor ? melhor[0] : 'n/d',
        apoio: melhor
          ? `${formatarPercentual((melhor[1].abertas * 100) / melhor[1].batidas)} em ${formatarInteiro(melhor[1].batidas)} portas`
          : `nenhuma faixa chegou a ${MINIMO_PARA_COMPARAR} portas batidas`,
        ajuda: `Só entram faixas com pelo menos ${MINIMO_PARA_COMPARAR} portas batidas no período.`,
      },
    ];
  }, [linhas]);

  const colunas: readonly Coluna<LinhaHorario>[] = useMemo(
    () => [
      // A faixa é a própria faixa de grupo da tabela; no arquivo ela volta a ser
      // coluna, para a planilha poder ordenar por horário.
      { chave: 'faixa', rotulo: 'Faixa', soNoCsv: true, texto: (l) => l.faixa },
      {
        chave: 'superficie',
        rotulo: 'Canal',
        fixa: true,
        texto: (l) => rotuloDaSuperficie(l.superficie),
        celula: (l) => <span className="font-medium">{rotuloDaSuperficie(l.superficie)}</span>,
      },
      {
        chave: 'toques',
        rotulo: 'Toques',
        ajuda: 'Todas as interações registradas na faixa, inclusive as que não contam como porta.',
        numero: true,
        texto: (l) => formatarInteiro(l.toques),
        celula: (l) => (
          <NumeroComBarra texto={formatarInteiro(l.toques)} valor={l.toques} maximo={maiorToques} />
        ),
      },
      {
        chave: 'batidas',
        rotulo: 'Batidas',
        numero: true,
        texto: (l) => formatarInteiro(l.portas_batidas),
      },
      {
        chave: 'abertas',
        rotulo: 'Abertas',
        numero: true,
        texto: (l) => formatarInteiro(l.portas_abertas),
      },
      {
        chave: 'taxa',
        rotulo: 'Abertura',
        ajuda: 'Portas abertas divididas por portas batidas nesta faixa e neste canal.',
        numero: true,
        texto: (l) => formatarPercentual(l.taxa_abertura) ?? '',
        celula: (l) => {
          const taxa = formatarPercentual(l.taxa_abertura);
          if (taxa === null) return <SemDado motivo="nenhuma porta batida nesta faixa" />;
          return (
            <span
              className={l.portas_batidas < MINIMO_PARA_COMPARAR ? 'text-muted-foreground' : undefined}
              title={
                l.portas_batidas < MINIMO_PARA_COMPARAR
                  ? `Só ${l.portas_batidas} portas batidas: pouca base para tirar conclusão.`
                  : undefined
              }
            >
              {taxa}
            </span>
          );
        },
      },
    ],
    [maiorToques],
  );

  return (
    <QuadroPainel
      painel={painel}
      periodo={periodo}
      consulta={consulta}
      colunas={colunas}
      linhas={linhas}
      chaveDaLinha={(linha) => `${linha.hora_inicio}-${linha.superficie}`}
      grupoDaLinha={(linha) => `${linha.faixa} (fuso de Natal)`}
      colunasNoEsqueleto={5}
      resumo={<TirasDeResumo itens={resumo} />}
      vazio={{
        titulo: 'Nenhum toque registrado no período',
        texto:
          'Esta leitura sai das interações registradas. Registre os contatos do dia em Registrar e a faixa de horário aparece aqui.',
      }}
      nota={
        <>
          Taxa em cinza é taxa com menos de {MINIMO_PARA_COMPARAR} portas batidas: existe, está
          certa, e não serve para decidir horário. O canal WhatsApp só vai refletir resposta de
          verdade quando a API oficial estiver ligada: hoje ele conta o que a pessoa registrou na
          mão, e por isso a abertura dele fica baixa perto de visita e reunião.
        </>
      }
    />
  );
}
