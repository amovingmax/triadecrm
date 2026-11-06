'use client';

import { useMemo } from 'react';
import { Copy, Trophy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { carregarMensagens, type LinhaMensagem } from './dados-imova';
import { chaveDoRelatorio } from './dados';
import { formatarInteiro, formatarPercentual } from './formatos';
import {
  MINIMO_PARA_O_RANKING,
  ROTULO_DO_TIPO_DE_MODELO,
  aQueMaisFuncionou,
  diaEHora,
} from './formatos-imova';
import { QuadroPainel } from './painel';
import type { Periodo } from './periodo';
import { BarraProporcao, SemDado } from './tabela';
import type { Coluna, DefinicaoPainel } from './tipos';

/**
 * As mensagens que mais funcionam na Imova (06/11/2026).
 *
 * Decisão do usuário: positivo é o cliente responder em até 24 h E estar Interessado
 * ou Muito interessado nesse momento. Conta como "modelo" o modelo aprovado na Meta,
 * a resposta rápida (casada pelo texto, porque o atalho só cola o texto) e o texto que
 * o time manda igual para três pessoas ou mais. O ranking e as taxas vêm do banco
 * (`relatorio_imova_mensagens`); aqui só se escolhe o destaque e se desenha.
 */

function Taxa({ taxa, parte, todo }: { taxa: number | null; parte: number; todo: number }) {
  if (taxa === null) return <SemDado motivo="nenhum envio completou 24 horas" />;
  return (
    <span className="ml-auto flex w-24 flex-col items-end gap-1" title={`${parte} de ${todo}`}>
      <span className="numerico">{formatarPercentual(taxa)}</span>
      <BarraProporcao valor={taxa} maximo={100} />
    </span>
  );
}

const COLUNAS: readonly Coluna<LinhaMensagem>[] = [
  {
    chave: 'mensagem',
    rotulo: 'Mensagem',
    fixa: true,
    texto: (l) => l.texto,
    celula: (l) => (
      <span className="flex min-w-[14rem] max-w-[26rem] flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">
          {ROTULO_DO_TIPO_DE_MODELO[l.tipo]}
          {l.nome ? ` · ${l.nome}` : ''}
        </span>
        <span className="line-clamp-2 text-sm" title={l.texto}>
          {l.texto}
        </span>
      </span>
    ),
  },
  { chave: 'tipo', rotulo: 'Tipo', soNoCsv: true, texto: (l) => ROTULO_DO_TIPO_DE_MODELO[l.tipo] },
  { chave: 'nome', rotulo: 'Nome', soNoCsv: true, texto: (l) => l.nome ?? '' },
  {
    chave: 'envios',
    rotulo: 'Envios',
    numero: true,
    texto: (l) => String(l.envios),
  },
  {
    chave: 'conversas',
    rotulo: 'Pessoas',
    numero: true,
    ajuda: 'Quantas pessoas diferentes receberam. As taxas contam a primeira vez de cada uma.',
    texto: (l) => String(l.conversas),
  },
  {
    chave: 'positiva',
    rotulo: 'Respondeu e se interessou',
    numero: true,
    ajuda:
      'O resultado positivo: o cliente respondeu em até 24 h e, nesse momento, estava Interessado ou Muito interessado. Conta só envios que já completaram 24 h.',
    texto: (l) => formatarPercentual(l.taxa_positiva) ?? '',
    celula: (l) => <Taxa taxa={l.taxa_positiva} parte={l.interessaram} todo={l.maduros} />,
  },
  {
    chave: 'resposta',
    rotulo: 'Respondeu em 24 h',
    numero: true,
    texto: (l) => formatarPercentual(l.taxa_resposta) ?? '',
    celula: (l) => <Taxa taxa={l.taxa_resposta} parte={l.responderam} todo={l.maduros} />,
  },
  {
    chave: 'visita',
    rotulo: 'Visita em 7 dias',
    numero: true,
    ajuda: 'Clientes que marcaram visita até 7 dias depois de receber a mensagem.',
    texto: (l) => formatarPercentual(l.taxa_visita) ?? '',
    celula: (l) => <Taxa taxa={l.taxa_visita} parte={l.visitas} todo={l.maduros} />,
  },
  {
    chave: 'maduros',
    rotulo: 'Envios com 24 h',
    soNoCsv: true,
    texto: (l) => String(l.maduros),
  },
  {
    chave: 'ultimo',
    rotulo: 'Último envio',
    classe: 'hidden md:table-cell',
    texto: (l) => diaEHora(l.ultimo_envio),
  },
];

function Destaque({ linha }: { linha: LinhaMensagem }) {
  return (
    <section className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-4" aria-label="A mensagem que mais funcionou">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Trophy className="size-4 text-quente-texto" aria-hidden="true" />A que mais funcionou no período
        </h3>
        <Button
          variant="outline"
          className="toque h-11 md:h-8"
          onClick={() => {
            void navigator.clipboard
              .writeText(linha.texto)
              .then(() => toast.success('Texto copiado.'))
              .catch(() => toast.error('Não deu para copiar. Selecione o texto e copie.'));
          }}
        >
          <Copy aria-hidden="true" />
          Copiar o texto
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {ROTULO_DO_TIPO_DE_MODELO[linha.tipo]}
        {linha.nome ? ` · ${linha.nome}` : ''}
      </p>
      <blockquote className="border-l-2 border-hairline pl-3 text-sm whitespace-pre-line">{linha.texto}</blockquote>
      <p className="text-sm">
        <span className="numerico font-medium">{formatarPercentual(linha.taxa_positiva)}</span> responderam e
        ficaram interessados ({formatarInteiro(linha.interessaram)} de {formatarInteiro(linha.maduros)}).{' '}
        <span className="text-muted-foreground">
          {formatarPercentual(linha.taxa_resposta)} responderam em 24 h e{' '}
          {formatarPercentual(linha.taxa_visita)} marcaram visita em 7 dias.
        </span>
      </p>
    </section>
  );
}

export function PainelMensagens({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('mensagens', periodo),
    queryFn: () => carregarMensagens(periodo),
  });
  const linhas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const melhor = useMemo(() => aQueMaisFuncionou(linhas), [linhas]);

  return (
    <QuadroPainel
      painel={painel}
      periodo={periodo}
      consulta={consulta}
      colunas={COLUNAS}
      linhas={linhas}
      chaveDaLinha={(l) => l.chave}
      destaqueDaLinha={(l) => l.chave === melhor?.chave}
      resumo={
        consulta.data && linhas.length > 0 ? (
          melhor ? (
            <Destaque linha={melhor} />
          ) : (
            <p className={cn('sombra-base rounded-xl bg-card p-4 text-sm text-muted-foreground')}>
              Ainda não dá para apontar a melhor: nenhuma mensagem tem {MINIMO_PARA_O_RANKING} envios com
              24 h e pelo menos um cliente interessado. A tabela abaixo já mostra o que existe.
            </p>
          )
        ) : null
      }
      vazio={{
        titulo: 'Nenhuma mensagem repetida no período',
        texto:
          'Aparecem aqui os modelos aprovados, as respostas rápidas (/atalho) e os textos que o time mandou igual para três pessoas ou mais. Mensagem escrita uma vez só não é modelo.',
      }}
      nota={
        <>
          A taxa conta só a primeira vez que cada pessoa recebeu a mensagem, e só depois de 24 h
          (antes disso ela ainda pode responder). O nome do cliente e a assinatura de quem enviou são
          ignorados na comparação: “Olá, Maria” e “Olá, João” são o mesmo texto. As respostas da IA
          que atende ficam no painel dela. Com poucos envios, uma resposta muda muito a taxa: o
          destaque só considera mensagens com {MINIMO_PARA_O_RANKING} envios ou mais.
        </>
      }
    />
  );
}
