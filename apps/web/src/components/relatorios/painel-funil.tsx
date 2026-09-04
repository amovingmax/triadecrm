'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { BarraTermica, ChipTemperatura, definicaoTemperatura } from '@/components/temperatura';

import { carregarFunil, chaveDoRelatorio } from './dados';
import { formatarDecimal, formatarInteiro, formatarPercentual } from './formatos';
import { QuadroPainel, TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { NumeroComBarra, SemDado } from './tabela';
import type { Coluna, DefinicaoPainel, LinhaFunil } from './tipos';

/**
 * Funil por etapa e conversão (RF-REL-02 e RF-REL-04).
 *
 * Duas leituras convivem na mesma tabela e é preciso não confundi-las:
 *
 * - "Agora" é uma FOTO: quantos negócios estão parados naquela etapa neste instante,
 *   independentemente de quando nasceram.
 * - "Chegaram até" e as duas conversões são de COORTE: a base são os negócios que
 *   NASCERAM no período, e conta-se quantos deles já alcançaram aquela etapa ou
 *   qualquer etapa adiante. É por isso que a conversão nunca passa de 100% mesmo
 *   quando o registro de contato pula etapas, o que acontece o tempo todo aqui.
 *
 * Perdido, opt-out e nutrição ficam fora da linha do funil e voltam do banco com
 * conversão nula: elas não são degrau de nada, e somá-las inventaria conversão.
 */
export function PainelFunil({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('funil', periodo),
    queryFn: () => carregarFunil(periodo),
  });

  const linhas = useMemo(() => consulta.data ?? [], [consulta.data]);

  const maiorAgora = useMemo(
    () => linhas.reduce((maior, linha) => Math.max(maior, linha.negocios_agora), 0),
    [linhas],
  );

  const resumo = useMemo(() => {
    const soma = (pega: (linha: LinhaFunil) => number) =>
      linhas.reduce((total, linha) => total + pega(linha), 0);

    // A coorte é por funil e vem repetida em toda linha dele: somar as linhas
    // multiplicaria o mesmo número por quantas etapas o funil tem.
    const coortePorFunil = new Map<number, number>();
    for (const linha of linhas) coortePorFunil.set(linha.funil_id, linha.coorte);
    const coorte = [...coortePorFunil.values()].reduce((total, valor) => total + valor, 0);

    return [
      {
        chave: 'agora',
        rotulo: 'Negócios na base',
        valor: formatarInteiro(soma((l) => l.negocios_agora)),
        apoio: 'em todos os funis, agora',
      },
      {
        chave: 'linha',
        rotulo: 'Em etapa do funil',
        valor: formatarInteiro(soma((l) => (l.na_linha_do_funil ? l.negocios_agora : 0))),
        apoio: 'fora perda, opt-out e nutrição',
      },
      {
        chave: 'parados',
        rotulo: 'Parados além do SLA',
        valor: formatarInteiro(soma((l) => l.negocios_parados)),
        apoio: 'sem toque no prazo da etapa',
      },
      {
        chave: 'entradas',
        rotulo: 'Entradas no período',
        valor: formatarInteiro(soma((l) => l.entradas_no_periodo)),
        apoio: 'mudanças de etapa registradas',
      },
      {
        chave: 'coorte',
        rotulo: 'Nasceram no período',
        valor: formatarInteiro(coorte),
        apoio: 'a coorte das conversões',
      },
      {
        chave: 'ganhos',
        rotulo: 'Publicados',
        valor: formatarInteiro(soma((l) => (l.is_ganho ? l.negocios_agora : 0))),
        apoio: 'etapa de ganho, agora',
      },
    ];
  }, [linhas]);

  const colunas: readonly Coluna<LinhaFunil>[] = useMemo(
    () => [
      {
        chave: 'etapa',
        rotulo: 'Etapa',
        fixa: true,
        texto: (l) => l.etapa_nome,
        celula: (l) => (
          // `min-w-0` no flex e `truncate` no nome: sem os dois, no celular a coluna
          // corta o nome no seco, sem reticências (a caixa flex não é texto em linha,
          // então o `truncate` de fora não alcança ela).
          <span className="flex min-w-0 items-center gap-2.5">
            <BarraTermica temperatura={l.temperatura} semRotulo className="h-5" />
            <span className="truncate font-medium">{l.etapa_nome}</span>
          </span>
        ),
      },
      {
        chave: 'temperatura',
        rotulo: 'Temperatura',
        texto: (l) => definicaoTemperatura(l.temperatura).rotulo,
        celula: (l) => <ChipTemperatura temperatura={l.temperatura} />,
      },
      {
        chave: 'agora',
        rotulo: 'Agora',
        ajuda: 'Negócios parados nesta etapa neste momento (foto, não depende do período).',
        numero: true,
        texto: (l) => formatarInteiro(l.negocios_agora),
        celula: (l) => (
          <NumeroComBarra
            texto={formatarInteiro(l.negocios_agora)}
            valor={l.negocios_agora}
            maximo={maiorAgora}
          />
        ),
      },
      {
        chave: 'parados',
        rotulo: 'Parados',
        ajuda: 'Dos que estão aqui, quantos passaram do SLA da etapa sem nenhum toque.',
        numero: true,
        texto: (l) => formatarInteiro(l.negocios_parados),
      },
      {
        chave: 'sla',
        rotulo: 'SLA (h)',
        ajuda: 'Prazo da etapa, em horas, definido no funil.',
        numero: true,
        texto: (l) => (l.sla_horas === null ? '' : formatarInteiro(l.sla_horas)),
        celula: (l) => (l.sla_horas === null ? <SemDado motivo="etapa sem prazo" /> : formatarInteiro(l.sla_horas)),
      },
      {
        chave: 'entradas',
        rotulo: 'Entradas',
        ajuda: 'Quantas vezes um negócio entrou nesta etapa dentro do período.',
        numero: true,
        texto: (l) => formatarInteiro(l.entradas_no_periodo),
      },
      {
        chave: 'chegaram',
        rotulo: 'Chegaram até',
        ajuda:
          'Da coorte nascida no período, quantos alcançaram esta etapa ou qualquer etapa adiante dela.',
        numero: true,
        texto: (l) => formatarInteiro(l.chegaram_ate),
      },
      {
        chave: 'conversao_etapa',
        rotulo: 'Conv. da etapa',
        ajuda: 'Quantos por cento dos que chegaram à etapa anterior chegaram até esta.',
        numero: true,
        texto: (l) => formatarPercentual(l.conversao_etapa) ?? '',
        celula: (l) => {
          const texto = formatarPercentual(l.conversao_etapa);
          if (texto === null) {
            return <SemDado motivo={l.na_linha_do_funil ? 'primeira etapa do funil' : 'fora da linha do funil'} />;
          }
          return texto;
        },
      },
      {
        chave: 'conversao_acumulada',
        rotulo: 'Acumulada',
        ajuda: 'Quantos por cento da coorte inteira chegaram até esta etapa.',
        numero: true,
        texto: (l) => formatarPercentual(l.conversao_acumulada) ?? '',
        celula: (l) => {
          const texto = formatarPercentual(l.conversao_acumulada);
          if (texto === null) return <SemDado motivo="sem coorte no período" />;
          return (
            <NumeroComBarra texto={texto} valor={Number(l.conversao_acumulada)} maximo={100} />
          );
        },
      },
      {
        chave: 'mediana',
        rotulo: 'Mediana (d)',
        ajuda: 'Metade dos negócios sai da etapa em menos que isto, em dias.',
        numero: true,
        texto: (l) => formatarDecimal(l.mediana_dias_na_etapa) ?? '',
        celula: (l) => formatarDecimal(l.mediana_dias_na_etapa) ?? <SemDado motivo="ninguém saiu desta etapa ainda" />,
      },
      {
        chave: 'p75',
        rotulo: 'p75 (d)',
        ajuda: 'Três em cada quatro negócios saem da etapa em menos que isto, em dias.',
        numero: true,
        texto: (l) => formatarDecimal(l.p75_dias_na_etapa) ?? '',
        celula: (l) => formatarDecimal(l.p75_dias_na_etapa) ?? <SemDado motivo="ninguém saiu desta etapa ainda" />,
      },
    ],
    [maiorAgora],
  );

  return (
    <QuadroPainel
      painel={painel}
      periodo={periodo}
      consulta={consulta}
      colunas={colunas}
      linhas={linhas}
      chaveDaLinha={(linha) => String(linha.etapa_id)}
      grupoDaLinha={(linha) => linha.funil_nome}
      destaqueDaLinha={(linha) => linha.is_ganho}
      resumo={<TirasDeResumo itens={resumo} />}
      vazio={{
        titulo: 'Nenhum funil configurado',
        texto:
          'O banco não devolveu etapa nenhuma. Confira em Administração se os funis do seed foram criados.',
      }}
      nota={
        <>
          Duas coisas do RF-REL-02 e do RF-REL-04 ainda não cabem nesta tabela porque não
          existem no banco: o corte por canal do primeiro contato, que depende do WhatsApp
          oficial estar ligado, e os motivos de perda com as objeções mais citadas, que
          dependem de uma consulta própria sobre <span className="numerico">lost_reasons</span>.
          Enquanto isso, as colunas de conversão já saem da coorte real do período.
        </>
      }
    />
  );
}
