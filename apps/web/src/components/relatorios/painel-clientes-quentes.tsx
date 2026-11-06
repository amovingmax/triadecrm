'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChipDaAtitude } from '@/components/conversas/atitude';
import { ROTULO_ATITUDE, type EtiquetaDeAtitude } from '@/components/conversas/atitude-regra';

import { CHAVE_QUENTES, carregarQuentes, linkDaConversa, type LinhaQuente } from './dados-imova';
import { formatarInteiro } from './formatos';
import { diaEHora, haQuanto, venceu } from './formatos-imova';
import { QuadroPainel, TirasDeResumo } from './painel';
import { hojeEmNatal, type Periodo } from './periodo';
import { BarraProporcao } from './tabela';
import type { Coluna, DefinicaoPainel } from './tipos';

/**
 * Os clientes mais quentes da Imova AGORA (06/11/2026).
 *
 * O calor vem pronto do banco (`relatorio_imova_quentes`): metade a atitude (o que a
 * pessoa fez), metade a nota da leitura da IA (o que ela disse), mais o bônus de quem
 * falou nos últimos dias e de quem tem visita marcada. Aqui só se filtra e se desenha.
 *
 * Não tem período: o calor de hoje é um retrato, e a barra de 7/30 dias não mudaria
 * nada nesta lista.
 */

type Filtro = 'todos' | 'esperando' | 'sem_passo' | 'clientes' | 'proprietarios';

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'esperando', rotulo: 'Esperando resposta' },
  { chave: 'sem_passo', rotulo: 'Sem próximo passo' },
  { chave: 'clientes', rotulo: 'Clientes' },
  { chave: 'proprietarios', rotulo: 'Proprietários' },
];

function semProximoPasso(l: LinhaQuente): boolean {
  return !l.visita_em && (!l.proxima_acao || venceu(l.proxima_acao_em));
}

function passa(l: LinhaQuente, filtro: Filtro): boolean {
  switch (filtro) {
    case 'todos':
      return true;
    case 'esperando':
      return l.esperando_resposta;
    case 'sem_passo':
      return semProximoPasso(l);
    case 'clientes':
      return l.quem !== 'Proprietário';
    case 'proprietarios':
      return l.quem === 'Proprietário';
  }
}

function ehEtiqueta(v: string | null): v is EtiquetaDeAtitude {
  return v !== null && v in ROTULO_ATITUDE;
}

function textoDoProximoPasso(l: LinhaQuente): string {
  if (l.visita_em) return `Visita ${diaEHora(l.visita_em)}`;
  if (!l.proxima_acao) return 'Sem próximo passo';
  const quando = l.proxima_acao_em ? ` (${diaEHora(l.proxima_acao_em)})` : '';
  return `${l.proxima_acao}${quando}`;
}

const COLUNAS: readonly Coluna<LinhaQuente>[] = [
  {
    chave: 'nome',
    rotulo: 'Cliente',
    fixa: true,
    texto: (l) => l.nome,
    celula: (l) => (
      <span className="flex min-w-[10rem] flex-col">
        <Link
          href={linkDaConversa(l.organization_id, l.conversation_id)}
          className="font-medium underline-offset-4 hover:underline"
        >
          {l.nome}
        </Link>
        <span className="text-xs text-muted-foreground">{l.quem}</span>
      </span>
    ),
  },
  {
    chave: 'quem',
    rotulo: 'Tipo',
    soNoCsv: true,
    texto: (l) => l.quem,
  },
  {
    chave: 'calor',
    rotulo: 'Calor',
    numero: true,
    ajuda:
      'De 0 a 100: metade a atitude (o que a pessoa fez), metade a nota da leitura da IA (o que ela disse), mais um bônus por ter falado nos últimos dias e por ter visita marcada.',
    texto: (l) => String(l.calor),
    celula: (l) => (
      <span className="ml-auto flex w-20 flex-col items-end gap-1">
        <span className="numerico font-medium">{l.calor}</span>
        <BarraProporcao valor={l.calor} maximo={100} />
      </span>
    ),
  },
  {
    chave: 'atitude',
    rotulo: 'Atitude',
    texto: (l) => (ehEtiqueta(l.atitude) ? ROTULO_ATITUDE[l.atitude] : ''),
    celula: (l) =>
      ehEtiqueta(l.atitude) ? (
        <ChipDaAtitude
          atitude={{
            etiqueta: l.atitude,
            antesDeEsfriar: ehEtiqueta(l.antes_de_esfriar) ? l.antes_de_esfriar : null,
            motivo: null,
            desde: l.atitude_desde ?? '',
            marcada: null,
            objecoes: [],
          }}
        />
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  {
    chave: 'nota_ia',
    rotulo: 'Nota da IA',
    numero: true,
    ajuda: 'O interesse que a leitura da IA viu na conversa, de 0 a 100. Passe o mouse para ver o porquê.',
    texto: (l) => (l.nota_ia === null ? '' : String(l.nota_ia)),
    celula: (l) =>
      l.nota_ia === null ? (
        <span className="text-xs text-muted-foreground">—</span>
      ) : (
        <span className="numerico" title={l.motivo_ia ?? undefined}>
          {l.nota_ia}
        </span>
      ),
  },
  {
    chave: 'motivo_ia',
    rotulo: 'Por que (IA)',
    soNoCsv: true,
    texto: (l) => l.motivo_ia ?? '',
  },
  {
    chave: 'procura',
    rotulo: 'Procura',
    texto: (l) => [l.procura, l.imovel_de_interesse ? `interesse: ${l.imovel_de_interesse}` : null]
      .filter(Boolean)
      .join(' · '),
    // A célula da tabela não quebra linha (`whitespace-nowrap`); aqui quebra, em
    // até duas linhas, para a procura longa não invadir a coluna do lado.
    celula: (l) => (
      <span className="block w-[15rem] text-sm whitespace-normal">
        <span className="line-clamp-2" title={l.procura ?? undefined}>
          {l.procura ?? <span className="text-muted-foreground">—</span>}
        </span>
        {l.imovel_de_interesse ? (
          <span className="block truncate text-xs text-muted-foreground" title={l.imovel_de_interesse}>
            {l.imovel_de_interesse}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    chave: 'objecoes',
    rotulo: 'Objeção',
    texto: (l) => l.objecoes.join(', '),
  },
  {
    chave: 'ultima',
    rotulo: 'Última mensagem',
    texto: (l) => `${diaEHora(l.ultima_do_cliente)}${l.esperando_resposta ? ' (esperando resposta)' : ''}`,
    celula: (l) => (
      <span className="flex flex-col whitespace-nowrap">
        <span>{haQuanto(l.ultima_do_cliente)}</span>
        {l.esperando_resposta ? (
          <span className="text-xs font-medium text-quente-texto">esperando resposta</span>
        ) : null}
      </span>
    ),
  },
  {
    chave: 'responsavel',
    rotulo: 'Quem atende',
    texto: (l) => l.responsavel ?? '',
  },
  {
    chave: 'proximo',
    rotulo: 'Próximo passo',
    texto: textoDoProximoPasso,
    // Vermelho só onde há o que cobrar: a falta de passo, ou a palavra "venceu".
    // Pintar a frase inteira deixava quase toda linha vermelha, e o alerta sumia.
    celula: (l) => {
      const vencida = !l.visita_em && Boolean(l.proxima_acao) && venceu(l.proxima_acao_em);
      return (
        <span
          className={cn(
            'block w-[16rem] text-sm whitespace-normal',
            !l.visita_em && !l.proxima_acao && 'font-medium text-quente-texto',
          )}
        >
          <span className="line-clamp-2" title={textoDoProximoPasso(l)}>
            {textoDoProximoPasso(l)}
          </span>
          {vencida ? <span className="text-xs font-medium text-quente-texto">venceu</span> : null}
        </span>
      );
    },
  },
  {
    chave: 'etapa',
    rotulo: 'Etapa',
    classe: 'hidden md:table-cell',
    texto: (l) => l.etapa ?? '',
  },
];

export function PainelClientesQuentes({ painel }: { painel: DefinicaoPainel }) {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const consulta = useQuery({ queryKey: CHAVE_QUENTES, queryFn: carregarQuentes });

  const todas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const linhas = useMemo(() => todas.filter((l) => passa(l, filtro)), [todas, filtro]);
  // O nome do arquivo leva o dia de hoje: a lista é um retrato.
  const hoje = hojeEmNatal();
  const periodo: Periodo = { chave: 'personalizado', de: hoje, ate: hoje };

  return (
    <QuadroPainel
      painel={painel}
      periodo={periodo}
      consulta={consulta}
      colunas={COLUNAS}
      linhas={linhas}
      chaveDaLinha={(l) => l.conversation_id}
      destaqueDaLinha={(l) => l.esperando_resposta && l.calor >= 70}
      resumo={
        consulta.data ? (
          <div className="flex flex-col gap-3">
            <TirasDeResumo
              colunas={4}
              itens={[
                {
                  chave: 'na_lista',
                  rotulo: 'Na lista',
                  valor: formatarInteiro(todas.length),
                  apoio: 'quem escreveu e ainda pode comprar ou alugar',
                },
                {
                  chave: 'muito',
                  rotulo: 'Muito interessados',
                  valor: formatarInteiro(todas.filter((l) => l.atitude === 'muito_interessado').length),
                },
                {
                  chave: 'esperando',
                  rotulo: 'Esperando resposta',
                  valor: formatarInteiro(todas.filter((l) => l.esperando_resposta).length),
                  apoio: 'a última mensagem é do cliente',
                },
                {
                  chave: 'sem_passo',
                  rotulo: 'Sem próximo passo',
                  valor: formatarInteiro(todas.filter(semProximoPasso).length),
                  apoio: 'sem visita e sem próxima ação em dia',
                },
              ]}
            />
            <div role="group" aria-label="Filtrar a lista" className="flex flex-wrap gap-1.5">
              {FILTROS.map((f) => (
                <Button
                  key={f.chave}
                  variant={filtro === f.chave ? 'secondary' : 'ghost'}
                  aria-pressed={filtro === f.chave}
                  onClick={() => setFiltro(f.chave)}
                  className="toque h-11 px-3 md:h-8"
                >
                  {f.rotulo}
                  {f.chave !== 'todos' ? (
                    <span className="numerico text-xs text-muted-foreground">
                      {todas.filter((l) => passa(l, f.chave)).length}
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>
          </div>
        ) : null
      }
      vazio={
        todas.length > 0
          ? { titulo: 'Ninguém neste filtro', texto: 'Troque o filtro acima para ver o resto da lista.' }
          : {
              titulo: 'Ainda não há cliente quente',
              texto:
                'A lista se forma sozinha com quem escreve para a Imova: a atitude é calculada a cada minuto e a leitura da IA em poucos minutos depois da conversa.',
              acao: { href: '/conversas', rotulo: 'Abrir Conversas' },
            }
      }
      nota={
        <>
          Ficam fora da lista quem está sem interesse ou pediu para não ser contatado, quem já fechou
          ou perdeu o negócio, as conversas concluídas e a conversa de treino da IA. A linha em
          destaque é cliente quente esperando resposta.
        </>
      }
    />
  );
}
