'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { carregarFontes, chaveDoRelatorio } from './dados';
import { formatarInteiro, formatarPercentual, rotuloDoTipoDeFonte } from './formatos';
import { QuadroPainel, TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { NumeroComBarra, SemDado } from './tabela';
import type { Coluna, DefinicaoPainel, LinhaFonte } from './tipos';

/**
 * Aproveitamento por fonte, com denominador (RF-REL-11).
 *
 * A série é sempre a mesma e sempre sobre o MESMO denominador: dos alvos que a fonte
 * trouxe no período, quantos tinham contato, quantos foram contatados, responderam,
 * autorizaram e publicaram. Percentual sem denominador é o jeito clássico de a fonte
 * pequena parecer a melhor, então o número absoluto anda ao lado de cada taxa.
 *
 * Os degraus não têm recorte de data de propósito: o alvo coletado no período pode
 * responder semanas depois, e cortá-lo pela data do período apagaria justamente a
 * conversão que a fonte gerou.
 */
export function PainelFontes({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('fontes', periodo),
    queryFn: () => carregarFontes(periodo),
  });

  const linhas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const maiorAlvos = useMemo(
    () => linhas.reduce((maior, linha) => Math.max(maior, linha.alvos), 0),
    [linhas],
  );

  const resumo = useMemo(() => {
    const soma = (pega: (linha: LinhaFonte) => number) =>
      linhas.reduce((total, linha) => total + pega(linha), 0);
    const alvos = soma((l) => l.alvos);
    const taxa = (valor: number) =>
      alvos > 0 ? (formatarPercentual((valor * 100) / alvos) ?? undefined) : undefined;
    const contatados = soma((l) => l.contatados);
    const responderam = soma((l) => l.responderam);
    const autorizaram = soma((l) => l.autorizaram);

    return [
      {
        chave: 'fontes',
        rotulo: 'Fontes com alvo',
        valor: formatarInteiro(linhas.filter((l) => l.alvos > 0).length),
        apoio: `de ${formatarInteiro(linhas.length)} cadastradas`,
      },
      {
        chave: 'alvos',
        rotulo: 'Alvos no período',
        valor: formatarInteiro(alvos),
        apoio: 'entraram na base nas datas escolhidas',
      },
      {
        chave: 'contato',
        rotulo: 'Com contato válido',
        valor: formatarInteiro(soma((l) => l.com_contato_valido)),
        apoio: taxa(soma((l) => l.com_contato_valido)),
      },
      {
        chave: 'contatados',
        rotulo: 'Contatados',
        valor: formatarInteiro(contatados),
        apoio: taxa(contatados),
      },
      {
        chave: 'responderam',
        rotulo: 'Responderam',
        valor: formatarInteiro(responderam),
        apoio: taxa(responderam),
      },
      {
        chave: 'autorizaram',
        rotulo: 'Autorizaram',
        valor: formatarInteiro(autorizaram),
        apoio: taxa(autorizaram),
      },
    ];
  }, [linhas]);

  const colunas: readonly Coluna<LinhaFonte>[] = useMemo(
    () => [
      {
        chave: 'fonte',
        rotulo: 'Fonte',
        fixa: true,
        texto: (l) => l.fonte_nome,
        celula: (l) => <span className="font-medium">{l.fonte_nome}</span>,
      },
      {
        chave: 'tipo',
        rotulo: 'Tipo',
        // Mesma regra da coluna de grupo em Categorias: no celular o número vem antes.
        classe: 'hidden md:table-cell',
        texto: (l) => rotuloDoTipoDeFonte(l.tipo),
      },
      {
        chave: 'alvos',
        rotulo: 'Alvos',
        ajuda: 'Organizações que entraram na base no período por esta fonte. É o denominador.',
        numero: true,
        texto: (l) => formatarInteiro(l.alvos),
        celula: (l) => (
          <NumeroComBarra texto={formatarInteiro(l.alvos)} valor={l.alvos} maximo={maiorAlvos} />
        ),
      },
      {
        chave: 'com_contato',
        rotulo: 'Com contato',
        numero: true,
        texto: (l) => formatarInteiro(l.com_contato_valido),
      },
      {
        chave: 'pct_contato',
        rotulo: '% com contato',
        numero: true,
        texto: (l) => formatarPercentual(l.pct_com_contato) ?? '',
        celula: (l) => formatarPercentual(l.pct_com_contato) ?? <SemDado motivo="nenhum alvo no período" />,
      },
      { chave: 'contatados', rotulo: 'Contatados', numero: true, texto: (l) => formatarInteiro(l.contatados) },
      {
        chave: 'pct_contatados',
        rotulo: '% contatados',
        numero: true,
        texto: (l) => formatarPercentual(l.pct_contatados) ?? '',
        celula: (l) => formatarPercentual(l.pct_contatados) ?? <SemDado motivo="nenhum alvo no período" />,
      },
      { chave: 'responderam', rotulo: 'Responderam', numero: true, texto: (l) => formatarInteiro(l.responderam) },
      {
        chave: 'pct_responderam',
        rotulo: '% responderam',
        numero: true,
        texto: (l) => formatarPercentual(l.pct_responderam) ?? '',
        celula: (l) => formatarPercentual(l.pct_responderam) ?? <SemDado motivo="nenhum alvo no período" />,
      },
      { chave: 'autorizaram', rotulo: 'Autorizaram', numero: true, texto: (l) => formatarInteiro(l.autorizaram) },
      {
        chave: 'pct_autorizaram',
        rotulo: '% autorizaram',
        ajuda: 'Autorização registrada em consent_events: é o que libera o pré-cadastro na Komune.',
        numero: true,
        texto: (l) => formatarPercentual(l.pct_autorizaram) ?? '',
        celula: (l) => formatarPercentual(l.pct_autorizaram) ?? <SemDado motivo="nenhum alvo no período" />,
      },
      { chave: 'publicados', rotulo: 'Publicados', numero: true, texto: (l) => formatarInteiro(l.publicados) },
      {
        chave: 'pct_publicados',
        rotulo: '% publicados',
        numero: true,
        texto: (l) => formatarPercentual(l.pct_publicados) ?? '',
        celula: (l) => formatarPercentual(l.pct_publicados) ?? <SemDado motivo="nenhum alvo no período" />,
      },
    ],
    [maiorAlvos],
  );

  return (
    <QuadroPainel
      painel={painel}
      periodo={periodo}
      consulta={consulta}
      colunas={colunas}
      linhas={linhas}
      chaveDaLinha={(linha) => String(linha.fonte_id)}
      resumo={<TirasDeResumo itens={resumo} />}
      vazio={{
        titulo: 'Nenhuma fonte cadastrada',
        texto: 'O catálogo de fontes vem do seed. Se está vazio, o banco não foi semeado.',
      }}
      nota={
        <>
          As fontes de coleta (Casamentos.com.br, Google Maps, Instagram, Sympla, TeleListas, OLX)
          ficam em zero porque o coletor do Radar ainda não roda: hoje todo alvo da base entrou
          por importação de planilha. Elas continuam listadas de propósito: a linha zerada é o
          lembrete do que falta ligar, e o dia em que o Radar rodar o número aparece aqui sem
          mudar nada nesta tela. O lote de importação (RF-BAS-17) ainda não é coluna aqui: a
          função do banco corta por fonte, não por lote.
        </>
      }
    />
  );
}
