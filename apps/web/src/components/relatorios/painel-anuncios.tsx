'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { carregarAnuncios, type LinhaAnuncio } from './dados-imova';
import { chaveDoRelatorio } from './dados';
import { LinkNoTexto } from './estados';
import { formatarInteiro, formatarPercentual } from './formatos';
import { diaEHora, precoDoAnuncio } from './formatos-imova';
import { QuadroPainel, TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { NumeroComBarra, SemDado } from './tabela';
import type { Coluna, DefinicaoPainel } from './tipos';

/**
 * Cliques e contatos de cada anúncio da Imova (06/11/2026).
 *
 * "Clique" é a visualização do anúncio no ZAP, no Viva Real e na OLX; "contato" é o
 * que o Canal Pro conta (formulário, ver telefone, WhatsApp). Os dois vêm do
 * relatório do Canal Pro, que só traz o total acumulado: cada importação vira uma
 * foto no banco, e o número do período é a diferença entre duas fotos. Sem foto
 * antes do começo do período não dá para saber quanto foi do período, e a célula
 * diz isso em vez de mostrar o total como se fosse dele.
 */

const SEM_FOTO = 'precisa de uma importação do relatório do Canal Pro antes do começo do período';

function numeroOuSemDado(valor: number | null, maximo: number, motivo: string) {
  if (valor === null) return <SemDado motivo={motivo} />;
  return <NumeroComBarra texto={formatarInteiro(valor)} valor={valor} maximo={maximo} />;
}

function colunas(maxVis: number, maxCon: number): readonly Coluna<LinhaAnuncio>[] {
  return [
    {
      chave: 'anuncio',
      rotulo: 'Anúncio',
      fixa: true,
      texto: (l) => (l.titulo ? `${l.codigo} · ${l.titulo}` : l.codigo),
      celula: (l) => (
        <span className="flex min-w-[11rem] max-w-[18rem] flex-col">
          <span className="font-medium">{l.codigo}</span>
          {l.titulo && l.titulo !== l.codigo ? (
            <span className="truncate text-xs text-muted-foreground" title={l.titulo}>
              {l.titulo}
            </span>
          ) : null}
          {l.onde === 'Canal Pro' ? (
            <span className="text-xs text-muted-foreground">só no Canal Pro</span>
          ) : null}
        </span>
      ),
    },
    {
      chave: 'situacao',
      rotulo: 'Situação',
      texto: (l) => l.situacao ?? '',
    },
    {
      chave: 'visualizacoes_periodo',
      rotulo: 'Cliques no período',
      numero: true,
      ajuda: 'Visualizações do anúncio nos portais entre o começo e o fim do período (diferença entre duas importações do relatório do Canal Pro).',
      texto: (l) => (l.visualizacoes_periodo === null ? '' : String(l.visualizacoes_periodo)),
      celula: (l) => numeroOuSemDado(l.visualizacoes_periodo, maxVis, SEM_FOTO),
    },
    {
      chave: 'visualizacoes',
      rotulo: 'Cliques no total',
      numero: true,
      ajuda: 'Visualizações desde que o anúncio foi criado nos portais, pelo último relatório do Canal Pro do período.',
      texto: (l) => (l.visualizacoes === null ? '' : String(l.visualizacoes)),
      celula: (l) =>
        l.visualizacoes === null ? (
          <SemDado motivo="o anúncio não está no relatório do Canal Pro" />
        ) : (
          <span className="numerico">{formatarInteiro(l.visualizacoes)}</span>
        ),
    },
    {
      chave: 'contatos_periodo',
      rotulo: 'Contatos no período',
      numero: true,
      ajuda: 'Contatos que o Canal Pro contou no período: formulário, ver telefone e WhatsApp.',
      texto: (l) => (l.contatos_periodo === null ? '' : String(l.contatos_periodo)),
      celula: (l) => numeroOuSemDado(l.contatos_periodo, maxCon, SEM_FOTO),
    },
    {
      chave: 'contatos',
      rotulo: 'Contatos no total',
      numero: true,
      texto: (l) => (l.contatos === null ? '' : String(l.contatos)),
      celula: (l) =>
        l.contatos === null ? (
          <SemDado motivo="o anúncio não está no relatório do Canal Pro" />
        ) : (
          <span className="numerico">{formatarInteiro(l.contatos)}</span>
        ),
    },
    {
      chave: 'taxa',
      rotulo: 'Contato por clique',
      numero: true,
      ajuda: 'De cada 100 pessoas que abriram o anúncio, quantas entraram em contato (no total).',
      texto: (l) => formatarPercentual(l.taxa_de_contato) ?? '',
      celula: (l) =>
        l.taxa_de_contato === null ? (
          <SemDado motivo="sem clique, não há taxa" />
        ) : (
          <span className="numerico">{formatarPercentual(l.taxa_de_contato)}</span>
        ),
    },
    {
      chave: 'conversas',
      rotulo: 'Conversas',
      numero: true,
      ajuda: 'Conversas do WhatsApp no período que citaram o código do anúncio, em que a leitura da IA achou este imóvel de interesse, que vieram de um lead do portal para ele ou em que a IA marcou visita nele.',
      texto: (l) => String(l.conversas),
    },
    {
      chave: 'visitas',
      rotulo: 'Visitas',
      numero: true,
      ajuda: 'Visitas marcadas no período para este imóvel ou nas conversas dele.',
      texto: (l) => String(l.visitas),
    },
    {
      chave: 'bairro',
      rotulo: 'Bairro',
      classe: 'hidden md:table-cell',
      texto: (l) => l.bairro ?? '',
    },
    {
      chave: 'preco',
      rotulo: 'Preço',
      classe: 'hidden md:table-cell',
      texto: (l) => precoDoAnuncio(l.preco_venda, l.preco_aluguel),
    },
  ];
}

function soma(linhas: readonly LinhaAnuncio[], campo: 'visualizacoes_periodo' | 'contatos_periodo') {
  const com = linhas.filter((l) => l[campo] !== null);
  return com.length === 0 ? null : com.reduce((s, l) => s + (l[campo] ?? 0), 0);
}

export function PainelAnuncios({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('anuncios', periodo),
    queryFn: () => carregarAnuncios(periodo),
  });
  const linhas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const maxVis = Math.max(0, ...linhas.map((l) => l.visualizacoes_periodo ?? 0));
  const maxCon = Math.max(0, ...linhas.map((l) => l.contatos_periodo ?? 0));
  const ultimaFoto = linhas.reduce<string | null>(
    (m, l) => (l.foto_em && (!m || l.foto_em > m) ? l.foto_em : m),
    null,
  );
  const cliquesNoPeriodo = soma(linhas, 'visualizacoes_periodo');
  const contatosNoPeriodo = soma(linhas, 'contatos_periodo');

  return (
    <QuadroPainel
      painel={painel}
      periodo={periodo}
      consulta={consulta}
      colunas={colunas(maxVis, maxCon)}
      linhas={linhas}
      chaveDaLinha={(l) => l.codigo}
      resumo={
        consulta.data ? (
          <TirasDeResumo
            colunas={4}
            itens={[
              {
                chave: 'cliques',
                rotulo: 'Cliques no período',
                valor: cliquesNoPeriodo === null ? '—' : formatarInteiro(cliquesNoPeriodo),
                apoio:
                  cliquesNoPeriodo === null
                    ? 'aparece a partir da 2ª importação'
                    : 'ZAP, Viva Real e OLX',
              },
              {
                chave: 'contatos',
                rotulo: 'Contatos no período',
                valor: contatosNoPeriodo === null ? '—' : formatarInteiro(contatosNoPeriodo),
                apoio: 'pelo relatório do Canal Pro',
              },
              {
                chave: 'conversas',
                rotulo: 'Conversas no CRM',
                valor: formatarInteiro(linhas.reduce((s, l) => s + l.conversas, 0)),
                apoio: 'que citaram um anúncio',
              },
              {
                chave: 'visitas',
                rotulo: 'Visitas',
                valor: formatarInteiro(linhas.reduce((s, l) => s + l.visitas, 0)),
                apoio: 'marcadas para um anúncio',
              },
            ]}
          />
        ) : null
      }
      vazio={{
        titulo: 'Nenhum anúncio para medir',
        texto: 'Os anúncios aparecem aqui quando existem na aba Anúncios ou no relatório do Canal Pro importado nela.',
        acao: { href: '/anuncios', rotulo: 'Abrir Anúncios' },
      }}
      nota={
        <>
          Cliques e contatos vêm do relatório do Canal Pro, que a gestão importa na{' '}
          <LinkNoTexto href="/anuncios">aba Anúncios</LinkNoTexto> (“Atualizar do Canal Pro”)
          {ultimaFoto ? `; o último que mudou algum número é de ${diaEHora(ultimaFoto)}` : ''}. O
          Grupo OLX não tem outro jeito de dar esses números, então eles ficam tão atualizados
          quanto a última importação. O número do período é a diferença entre duas importações:
          importe uma vez por semana para ver o crescimento. Uma conversa que cita dois anúncios
          conta nos dois.
        </>
      }
    />
  );
}
