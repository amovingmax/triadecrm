'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { APARENCIA_DO_CANAL, coresDoCanal } from '@/components/conversas/canal-de-chegada-regra';

import { montarLinhasDeCanais, resumirCanais, type LinhaDoPainelDeCanais } from './canais';
import { carregarCanaisDeChegada, chaveDoRelatorio } from './dados';
import { formatarInteiro, formatarPercentual } from './formatos';
import { QuadroPainel, TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { NumeroComBarra, SemDado } from './tabela';
import type { Coluna, DefinicaoPainel } from './tipos';

/**
 * Por onde os clientes chegaram (06/11/2026, só Imova; `public.relatorio_por_canal`).
 *
 * Uma chegada é cada vez que a pessoa PROCUROU a Imova: a primeira mensagem dela,
 * ou a volta depois de 30 dias de silêncio. Conversa aberta por nós (modelo,
 * prospecção) não é chegada e não entra aqui. O período corta pela data da
 * primeira mensagem, no fuso de Natal.
 *
 * A tabela vai pelo canal — o total em cima, os detalhes embaixo ("Placa", e
 * "Foto da placa", "Foto do banner", "Falou da placa") — porque a pergunta começa
 * pelo canal. O detalhe só aparece aqui e ao tocar no chip da conversa: a
 * etiqueta mostra só o canal (decisão do Rafael).
 */
export function PainelCanais({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('canais', periodo),
    queryFn: () => carregarCanaisDeChegada(periodo),
  });

  const brutas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const linhas = useMemo(() => montarLinhasDeCanais(brutas), [brutas]);
  const total = useMemo(() => resumirCanais(brutas), [brutas]);
  const maior = useMemo(
    () => linhas.reduce((m, l) => (l.nivel === 'canal' ? Math.max(m, l.chegadas) : m), 0),
    [linhas],
  );

  const resumo = useMemo(() => {
    const parte = (n: number) =>
      total.chegadas > 0 ? formatarPercentual((n * 100) / total.chegadas) : null;
    return [
      {
        chave: 'chegadas',
        rotulo: 'Chegadas',
        valor: formatarInteiro(total.chegadas),
        apoio: 'vezes que alguém procurou a Imova',
      },
      {
        chave: 'novos',
        rotulo: 'Leads novos',
        valor: formatarInteiro(total.leads_novos),
        apoio: parte(total.leads_novos) ? `${parte(total.leads_novos)} das chegadas` : undefined,
      },
      {
        chave: 'atendidos',
        rotulo: 'Atendidos',
        valor: formatarInteiro(total.atendidos),
        apoio: parte(total.atendidos) ? `${parte(total.atendidos)} das chegadas` : undefined,
      },
      {
        chave: 'visitas',
        rotulo: 'Visitas marcadas',
        valor: formatarInteiro(total.visitas_marcadas),
        apoio: `${formatarInteiro(total.visitas_realizadas)} realizadas`,
      },
      {
        chave: 'ganhos',
        rotulo: 'Ganhos',
        valor: formatarInteiro(total.ganhos),
        apoio: parte(total.ganhos) ? `${parte(total.ganhos)} das chegadas` : undefined,
      },
      {
        chave: 'nao_identificado',
        rotulo: 'Não identificado',
        valor: parte(total.naoIdentificado) ?? '0,0%',
        apoio: `${formatarInteiro(total.naoIdentificado)} sem canal`,
        ajuda:
          'Chegadas em que nem a regra nem a IA acharam sinal do canal, e ninguém corrigiu. Quanto menor, melhor.',
      },
    ];
  }, [total]);

  const colunas: readonly Coluna<LinhaDoPainelDeCanais>[] = useMemo(
    () => [
      {
        chave: 'canal',
        rotulo: 'Canal',
        fixa: true,
        texto: (l) => l.rotuloCompleto,
        celula: (l) => <CelulaDoCanal linha={l} />,
      },
      {
        chave: 'nivel',
        rotulo: 'Linha',
        soNoCsv: true,
        // Na planilha, filtrar "total do canal" evita somar o canal duas vezes.
        texto: (l) => (l.nivel === 'canal' ? 'total do canal' : 'detalhe'),
      },
      {
        chave: 'chegadas',
        rotulo: 'Chegadas',
        ajuda: 'A primeira mensagem da pessoa, ou a volta dela depois de 30 dias de silêncio.',
        numero: true,
        texto: (l) => formatarInteiro(l.chegadas),
        celula: (l) =>
          l.nivel === 'canal' ? (
            <NumeroComBarra texto={formatarInteiro(l.chegadas)} valor={l.chegadas} maximo={maior} />
          ) : (
            formatarInteiro(l.chegadas)
          ),
      },
      {
        chave: 'parte',
        rotulo: '% das chegadas',
        ajuda: 'Na linha "Não identificado", é a parte das chegadas que ficou sem canal.',
        numero: true,
        texto: (l) => formatarPercentual(l.parte) ?? '',
        celula: (l) =>
          formatarPercentual(l.parte) ?? <SemDado motivo="nenhuma chegada no período" />,
      },
      {
        chave: 'leads_novos',
        rotulo: 'Leads novos',
        ajuda: 'Quem não estava na base quando chegou.',
        numero: true,
        texto: (l) => formatarInteiro(l.leads_novos),
      },
      {
        chave: 'ja_na_base',
        rotulo: 'Já na base',
        ajuda: 'Quem já tinha ficha quando chegou: cliente antigo ou proprietário voltando.',
        numero: true,
        classe: 'hidden md:table-cell',
        texto: (l) => formatarInteiro(l.ja_na_base),
      },
      {
        chave: 'sem_ficha',
        rotulo: 'Sem ficha',
        ajuda: 'Conversas que ainda não viraram ficha (ou não podem: suprimidos, estrangeiros).',
        numero: true,
        classe: 'hidden md:table-cell',
        texto: (l) => formatarInteiro(l.sem_ficha),
      },
      {
        chave: 'atendidos',
        rotulo: 'Atendidos',
        ajuda: 'Chegadas que receberam resposta de alguém do time.',
        numero: true,
        texto: (l) => formatarInteiro(l.atendidos),
      },
      {
        chave: 'visitas_marcadas',
        rotulo: 'Visitas marcadas',
        numero: true,
        texto: (l) => formatarInteiro(l.visitas_marcadas),
      },
      {
        chave: 'visitas_realizadas',
        rotulo: 'Visitas realizadas',
        numero: true,
        texto: (l) => formatarInteiro(l.visitas_realizadas),
      },
      {
        chave: 'ganhos',
        rotulo: 'Ganhos',
        numero: true,
        texto: (l) => formatarInteiro(l.ganhos),
      },
      {
        chave: 'foto_da_placa',
        rotulo: 'Foto da placa',
        ajuda: 'Chegadas em que o cliente mandou foto de uma placa da Imova.',
        numero: true,
        texto: (l) => formatarInteiro(l.com_foto_da_placa),
      },
      {
        chave: 'foto_do_banner',
        rotulo: 'Foto do banner',
        ajuda: 'Chegadas em que o cliente mandou foto de um banner da Imova.',
        numero: true,
        texto: (l) => formatarInteiro(l.com_foto_do_banner),
      },
      {
        chave: 'corrigidos',
        rotulo: 'Corrigidos',
        ajuda: 'Chegadas em que alguém do time trocou o canal que a regra ou a IA tinham posto.',
        numero: true,
        classe: 'hidden md:table-cell',
        texto: (l) => formatarInteiro(l.corrigidos),
      },
      // Quem decidiu, por linha, vai só para o arquivo; na tela é a frase do rodapé.
      {
        chave: 'por_regra',
        rotulo: 'Decididos pela regra',
        numero: true,
        soNoCsv: true,
        texto: (l) => formatarInteiro(l.por_regra),
      },
      {
        chave: 'por_ia',
        rotulo: 'Decididos pela IA',
        numero: true,
        soNoCsv: true,
        texto: (l) => formatarInteiro(l.por_ia),
      },
      {
        chave: 'por_gente',
        rotulo: 'Decididos por gente',
        numero: true,
        soNoCsv: true,
        texto: (l) => formatarInteiro(l.por_gente),
      },
    ],
    [maior],
  );

  return (
    <QuadroPainel
      painel={painel}
      periodo={periodo}
      consulta={consulta}
      colunas={colunas}
      linhas={linhas}
      chaveDaLinha={(l) => l.chave}
      destaqueDaLinha={(l) => l.nivel === 'canal'}
      resumo={<TirasDeResumo itens={resumo} />}
      vazio={{
        titulo: 'Ninguém procurou a Imova neste período',
        texto:
          'A chegada nasce na primeira mensagem do cliente (ou na volta dele depois de 30 dias). Amplie o período; conversa aberta pelo time não conta aqui.',
      }}
      nota={
        <>
          <span className="font-medium text-foreground">
            Quem decidiu: {formatarInteiro(total.por_regra)} pela regra ·{' '}
            {formatarInteiro(total.por_ia)} pela IA · {formatarInteiro(total.por_gente)} por gente ·{' '}
            {formatarInteiro(total.corrigidos)} corrigidos.
          </span>{' '}
          Foto da placa em {formatarInteiro(total.com_foto_da_placa)} chegadas e do banner em{' '}
          {formatarInteiro(total.com_foto_do_banner)}; quem mandou foto segue no atendimento normal.
          A chegada pode mudar de canal nas primeiras 24 h, enquanto a regra e a IA leem o começo da
          conversa, e a correção de quem atende vale sempre.
        </>
      }
    />
  );
}

/** O canal com o ícone e a cor dele no total; o detalhe recuado, no cinza. */
function CelulaDoCanal({ linha }: { linha: LinhaDoPainelDeCanais }) {
  if (linha.nivel === 'detalhe') {
    return <span className="pl-6 text-muted-foreground">{linha.rotulo}</span>;
  }
  const Icone = linha.canal ? APARENCIA_DO_CANAL[linha.canal].icone : null;
  return (
    <span className="inline-flex items-center gap-2 font-medium">
      {Icone ? (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full"
          style={linha.canal ? coresDoCanal(linha.canal) : undefined}
        >
          <Icone className="size-3" />
        </span>
      ) : null}
      {linha.rotulo}
    </span>
  );
}
