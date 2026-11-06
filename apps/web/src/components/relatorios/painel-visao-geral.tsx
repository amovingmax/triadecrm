'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';

import { carregarVisaoGeral, porcento, type VisaoGeral } from './dados-imova';
import { chaveDoRelatorio, mensagemDoErro } from './dados';
import { ErroDoRelatorio, EsqueletoRelatorio, NotaDeAlcance } from './estados';
import { formatarInteiro, formatarMinutos, formatarPercentual } from './formatos';
import { diaEHora, haQuanto } from './formatos-imova';
import { TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { BarraProporcao } from './tabela';
import type { ChavePainel, DefinicaoPainel } from './tipos';

/**
 * A visão geral da Imova (06/11/2026): o período em números e o que cobrar hoje.
 *
 * Pedido do usuário: "indicadores interessantes para maior organização e maior
 * potencial de venda". Organização é o que está parado AGORA (cliente esperando
 * resposta, cliente quente sem próximo passo, próxima ação vencida, visita sem
 * desfecho); potencial de venda é o funil dos clientes, as objeções, o que os
 * clientes procuram e onde falta imóvel para o que eles procuram.
 */
export function PainelVisaoGeral({
  painel,
  periodo,
  aoAbrirPainel,
}: {
  painel: DefinicaoPainel;
  periodo: Periodo;
  /** Troca de leitura sem sair da tela ("ver a lista" leva a Clientes quentes). */
  aoAbrirPainel: (chave: ChavePainel) => void;
}) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('visao', periodo),
    queryFn: () => carregarVisaoGeral(periodo),
  });

  return (
    <section className="flex flex-col gap-6" aria-labelledby="titulo-visao">
      <header>
        <h2 id="titulo-visao" className="font-heading text-lg font-semibold tracking-tight">
          {painel.titulo}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{painel.descricao}</p>
      </header>

      {consulta.isPending ? (
        <EsqueletoRelatorio colunas={4} linhas={6} />
      ) : consulta.isError ? (
        <ErroDoRelatorio causa={mensagemDoErro(consulta.error)} aoTentar={() => void consulta.refetch()} />
      ) : (
        <Conteudo dados={consulta.data} aoAbrirPainel={aoAbrirPainel} />
      )}
    </section>
  );
}

function Conteudo({ dados, aoAbrirPainel }: { dados: VisaoGeral; aoAbrirPainel: (chave: ChavePainel) => void }) {
  const c = dados.contatos;
  const a = dados.agora;
  const v = dados.visitas;
  const quentes = a.muito_interessados + a.interessados;

  return (
    <>
      <TirasDeResumo
        itens={[
          {
            chave: 'novos',
            rotulo: 'Novos contatos',
            valor: formatarInteiro(c.novos),
            apoio: `${formatarInteiro(c.atendidos)} atendidos`,
            ajuda: 'Pessoas que escreveram para a Imova pela primeira vez no período.',
          },
          {
            chave: 'primeira',
            rotulo: 'Primeira resposta',
            valor: formatarMinutos(c.mediana_primeira_resposta_min),
            apoio: `mediana · ${formatarInteiro(c.em_ate_15_min)} em até 15 min`,
            ajuda: 'Da primeira mensagem do cliente até a primeira resposta de alguém do time ou da IA. Mensagem automática não conta.',
          },
          {
            chave: 'esperando',
            rotulo: 'Esperando resposta',
            valor: formatarInteiro(a.esperando_resposta),
            apoio: `agora · ${formatarInteiro(a.esperando_mais_de_1h)} há mais de 1 h`,
          },
          {
            chave: 'quentes',
            rotulo: 'Clientes quentes',
            valor: formatarInteiro(quentes),
            apoio: `agora · ${formatarInteiro(a.muito_interessados)} muito interessados`,
          },
          {
            chave: 'visitas',
            rotulo: 'Visitas marcadas',
            valor: formatarInteiro(v.marcadas),
            apoio: `${formatarInteiro(v.pela_ia)} pela IA · ${formatarInteiro(v.realizadas)} realizadas`,
          },
          {
            chave: 'fechados',
            rotulo: 'Negócios fechados',
            valor: formatarInteiro(dados.fechados),
            apoio: `${formatarInteiro(dados.perdidos)} perdidos`,
          },
        ]}
      />

      <ParaCobrar dados={dados} aoAbrirPainel={aoAbrirPainel} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Funil dados={dados} />
        <Bloco
          titulo="Visitas"
          subtitulo="As que aconteceram no período (pela data da visita) e as que vêm por aí."
        >
          <ul className="flex flex-col gap-2">
            <Linha rotulo="Realizadas" valor={v.realizadas} maximo={Math.max(v.aconteceram, 1)} />
            <Linha rotulo="O cliente faltou" valor={v.faltaram} maximo={Math.max(v.aconteceram, 1)} />
            <Linha rotulo="Passaram sem desfecho" valor={v.sem_desfecho} maximo={Math.max(v.aconteceram, 1)} />
            <Linha rotulo="Canceladas" valor={v.canceladas} maximo={Math.max(v.aconteceram, 1)} />
          </ul>
          <p className="text-sm">
            Comparecimento:{' '}
            <span className="numerico font-medium">
              {formatarPercentual(porcento(v.realizadas, v.realizadas + v.faltaram)) ?? '—'}
            </span>{' '}
            <span className="text-muted-foreground">
              · {formatarInteiro(v.proximas)} {v.proximas === 1 ? 'visita marcada' : 'visitas marcadas'} daqui para frente
            </span>
          </p>
        </Bloco>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Bloco titulo="O que os clientes procuram" subtitulo={`Pela leitura da IA de ${formatarInteiro(dados.procura.clientes)} clientes que falaram no período.`}>
          {dados.procura.tipos.length === 0 && dados.procura.finalidade.length === 0 ? (
            <p className="text-sm text-muted-foreground">A leitura da IA ainda não achou o que eles procuram.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <ListaDeContagem titulo="Para" itens={dados.procura.finalidade.map((x) => ({ rotulo: x.valor, valor: x.clientes }))} />
              <ListaDeContagem titulo="Tipo de imóvel" itens={dados.procura.tipos.map((x) => ({ rotulo: x.valor, valor: x.clientes }))} />
            </div>
          )}
        </Bloco>
        <Bloco titulo="Objeções mais comuns" subtitulo="Marcadas pelo time ou achadas pela leitura da IA, nas conversas do período.">
          {dados.objecoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma objeção no período.</p>
          ) : (
            <ListaDeContagem itens={dados.objecoes.map((x) => ({ rotulo: x.objecao, valor: x.conversas }))} />
          )}
        </Bloco>
      </div>

      <ProcuraEOferta dados={dados} />

      <Bloco titulo="Anúncios no período" subtitulo="O resumo do painel Anúncios.">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Numero rotulo="No ar pelo CRM" valor={formatarInteiro(dados.anuncios.no_ar)} />
            <Numero rotulo="Cliques" valor={dados.anuncios.visualizacoes_periodo === null ? '—' : formatarInteiro(dados.anuncios.visualizacoes_periodo)} />
            <Numero rotulo="Contatos" valor={dados.anuncios.contatos_periodo === null ? '—' : formatarInteiro(dados.anuncios.contatos_periodo)} />
            <Numero rotulo="Conversas no CRM" valor={formatarInteiro(dados.anuncios.conversas)} />
          </dl>
          <button
            type="button"
            onClick={() => aoAbrirPainel('anuncios')}
            className="toque inline-flex h-11 items-center gap-1 text-sm underline-offset-4 hover:underline md:h-8"
          >
            Ver cada anúncio <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
        {dados.anuncios.visualizacoes_periodo === null ? (
          <p className="text-xs text-muted-foreground">
            Os cliques do período aparecem a partir da segunda importação do relatório do Canal Pro
            {dados.anuncios.ultima_foto ? ` (a última é de ${diaEHora(dados.anuncios.ultima_foto)})` : ''}.
          </p>
        ) : null}
      </Bloco>

      <NotaDeAlcance>
        “Agora” não depende do período: é o retrato deste momento. O resto conta o que aconteceu entre
        as duas datas. A conversa de treino da IA fica fora de tudo.
      </NotaDeAlcance>
    </>
  );
}

function ParaCobrar({ dados, aoAbrirPainel }: { dados: VisaoGeral; aoAbrirPainel: (chave: ChavePainel) => void }) {
  const a = dados.agora;
  const itens: { chave: string; n: number; texto: ReactNode; acao: ReactNode }[] = [
    {
      chave: 'esperando',
      n: a.esperando_mais_de_1h,
      texto: (
        <>
          esperando resposta há mais de 1 hora
          {a.esperando_desde ? (
            <span className="text-muted-foreground"> · o mais antigo escreveu {haQuanto(a.esperando_desde)}</span>
          ) : null}
        </>
      ),
      acao: <IrPara href="/conversas">Conversas</IrPara>,
    },
    {
      chave: 'sem_passo',
      n: a.quentes_sem_proximo_passo,
      texto: 'clientes quentes sem próximo passo (sem visita e sem próxima ação em dia)',
      acao: <Trocar aoClicar={() => aoAbrirPainel('quentes')}>Ver a lista</Trocar>,
    },
    {
      chave: 'esfriando',
      n: a.esfriando,
      texto: 'esfriando: já quiseram e pararam de responder',
      acao: <IrPara href="/conversas?ordem=interesse">Conversas</IrPara>,
    },
    {
      chave: 'vencidas',
      n: a.proxima_acao_vencida,
      texto: 'próximas ações vencidas nas fichas',
      acao: <IrPara href="/meu-dia">Meu dia</IrPara>,
    },
    {
      chave: 'sem_desfecho',
      n: dados.visitas.sem_desfecho,
      texto: 'visitas do período que já passaram e ninguém disse se aconteceram',
      acao: <IrPara href="/agenda">Agenda</IrPara>,
    },
  ];
  const pendentes = itens.filter((i) => i.n > 0);

  return (
    <Bloco titulo="Para cobrar hoje" subtitulo="O que está parado agora e onde resolver.">
      {pendentes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada parado. Todo cliente quente tem próximo passo e ninguém espera resposta há mais de 1 hora.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {pendentes.map((i) => (
            <li key={i.chave} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
              <span>
                <span className="numerico mr-1.5 font-semibold text-quente-texto">{formatarInteiro(i.n)}</span>
                {i.texto}
              </span>
              {i.acao}
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}

function Funil({ dados }: { dados: VisaoGeral }) {
  const maximo = dados.funil.reduce((m, e) => Math.max(m, e.chegaram), 0);
  return (
    <Bloco titulo="Funil dos clientes" subtitulo="Quantos negócios entraram em cada etapa no período, e quanto da etapa anterior chegou ali.">
      {maximo === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum negócio de cliente mudou de etapa no período.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {dados.funil.map((e, i) => {
            const anterior = i > 0 ? dados.funil[i - 1]?.chegaram ?? 0 : 0;
            const conversao = i > 0 ? porcento(e.chegaram, anterior) : null;
            return (
              <li key={e.etapa} className="grid grid-cols-[minmax(0,1fr)_6rem_6.5rem] items-center gap-3">
                <span className={cn('truncate', e.ganho && 'font-medium')}>{e.etapa}</span>
                <BarraProporcao valor={e.chegaram} maximo={maximo} />
                <span className="numerico text-right whitespace-nowrap text-muted-foreground">
                  {formatarInteiro(e.chegaram)}
                  {conversao !== null ? ` · ${formatarPercentual(Math.min(conversao, 100)) ?? ''}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Bloco>
  );
}

function ProcuraEOferta({ dados }: { dados: VisaoGeral }) {
  const linhas = dados.procura_e_oferta;
  if (linhas.length === 0) return null;
  return (
    <Bloco
      titulo="Procura × oferta por bairro"
      subtitulo="Quantos clientes pediram cada bairro e quantos anúncios a Imova tem no ar nele. Bairro com procura e sem anúncio é onde captar imóvel."
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 font-medium">Bairro</th>
            <th className="py-1.5 text-right font-medium">Clientes procurando</th>
            <th className="py-1.5 text-right font-medium">Anúncios no ar</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const falta = l.procurando > l.anuncios;
            return (
              <tr key={l.bairro} className="border-t border-hairline">
                <td className="py-2">
                  {l.bairro}
                  {falta && l.anuncios === 0 ? (
                    <span className="ml-2 text-xs font-medium text-quente-texto">captar aqui</span>
                  ) : null}
                </td>
                <td className="numerico py-2 text-right">{formatarInteiro(l.procurando)}</td>
                <td className={cn('numerico py-2 text-right', falta && 'text-quente-texto')}>
                  {formatarInteiro(l.anuncios)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Bloco>
  );
}

function Bloco({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <section className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-4">
      <div>
        <h3 className="text-sm font-medium">{titulo}</h3>
        {subtitulo ? <p className="text-xs text-muted-foreground">{subtitulo}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Linha({ rotulo, valor, maximo }: { rotulo: string; valor: number; maximo: number }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-3 text-sm">
      <span className="truncate">{rotulo}</span>
      <BarraProporcao valor={valor} maximo={maximo} />
      <span className="numerico text-right">{formatarInteiro(valor)}</span>
    </li>
  );
}

function ListaDeContagem({ titulo, itens }: { titulo?: string; itens: { rotulo: string; valor: number }[] }) {
  const maximo = itens.reduce((m, x) => Math.max(m, x.valor), 0);
  return (
    <div className="flex flex-col gap-2">
      {titulo ? <p className="text-xs text-muted-foreground">{titulo}</p> : null}
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {itens.map((x) => (
            <li key={x.rotulo} className="grid grid-cols-[minmax(0,1fr)_5rem_2rem] items-center gap-3 text-sm">
              <span className="truncate first-letter:uppercase">{x.rotulo}</span>
              <BarraProporcao valor={x.valor} maximo={maximo} />
              <span className="numerico text-right">{formatarInteiro(x.valor)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="numerico text-lg font-medium">{valor}</dd>
    </div>
  );
}

function IrPara({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="toque inline-flex h-11 items-center gap-1 text-sm underline-offset-4 hover:underline md:h-8">
      {children} <ChevronRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

function Trocar({ aoClicar, children }: { aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className="toque inline-flex h-11 items-center gap-1 text-sm underline-offset-4 hover:underline md:h-8"
    >
      {children} <ChevronRight className="size-4" aria-hidden="true" />
    </button>
  );
}
