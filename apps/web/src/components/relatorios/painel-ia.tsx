'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';

import {
  carregarRelatorioDaIa,
  linkDaConversa,
  porcento,
  type NotaDaJuiza,
  type RelatorioDaIa,
} from './dados-imova';
import { chaveDoRelatorio, mensagemDoErro } from './dados';
import { ErroDoRelatorio, EsqueletoRelatorio, LinkNoTexto, NotaDeAlcance, VazioDoRelatorio } from './estados';
import { formatarInteiro, formatarPercentual } from './formatos';
import { formatarDolar, formatarNota, formatarSegundos, rotuloDaSemana, soDia } from './formatos-imova';
import { TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { BarraProporcao } from './tabela';
import type { DefinicaoPainel } from './tipos';

/**
 * A IA que atende da Imova, semana a semana (06/11/2026).
 *
 * Pedido do usuário: saber "se cada vez mais ela está deixando mais pessoas
 * interessadas, está tirando dúvidas melhores, entregando informações interessantes,
 * quantas reuniões conseguiu marcar". Duas fontes, lado a lado:
 *   - o que o CRM mede sozinho: respostas, visitas, passagens para corretor, se o
 *     cliente continuou a conversa, o Boa/Corrigir de quem acompanha e a atitude
 *     antes e depois da IA;
 *   - a IA juíza: uma vez por dia o Haiku lê cada conversa que a IA atendeu na
 *     véspera e dá nota de 1 a 5 para tirou a dúvida, informação útil e cliente
 *     satisfeito, com o porquê.
 */
export function PainelIa({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('ia', periodo),
    queryFn: () => carregarRelatorioDaIa(periodo),
  });

  return (
    <section className="flex flex-col gap-6" aria-labelledby="titulo-ia">
      <header>
        <h2 id="titulo-ia" className="font-heading text-lg font-semibold tracking-tight">
          {painel.titulo}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{painel.descricao}</p>
      </header>

      {consulta.isPending ? (
        <EsqueletoRelatorio colunas={4} linhas={6} />
      ) : consulta.isError ? (
        <ErroDoRelatorio causa={mensagemDoErro(consulta.error)} aoTentar={() => void consulta.refetch()} />
      ) : (
        <Conteudo dados={consulta.data} />
      )}
    </section>
  );
}

function Conteudo({ dados }: { dados: RelatorioDaIa }) {
  const t = dados.totais;
  const avaliadasPeloTime = t.boas + t.corrigidas;

  if (t.respostas === 0) {
    const estado = !dados.ia?.ligada
      ? 'A IA que atende está desligada.'
      : dados.ia.modo === 'treino'
        ? 'A IA que atende está em treino: ela só fala na conversa de treino, que não entra neste relatório.'
        : 'A IA não respondeu nenhum cliente neste período.';
    return (
      <VazioDoRelatorio
        titulo="A IA ainda não atendeu clientes no período"
        texto={
          <>
            {estado}
            {t.no_treino > 0 ? ` No treino ela respondeu ${formatarInteiro(t.no_treino)} vezes.` : ''} Quando
            ela atender clientes, este painel mostra semana a semana o interesse, as notas da IA juíza e as
            visitas.
          </>
        }
        acao={{ href: '/ia', rotulo: 'Abrir a IA que atende' }}
      />
    );
  }

  return (
    <>
      <TirasDeResumo
        itens={[
          {
            chave: 'respostas',
            rotulo: 'Respostas',
            valor: formatarInteiro(t.respostas),
            apoio: `${formatarInteiro(t.conversas)} clientes · mediana ${formatarSegundos(t.mediana_resposta_seg)}`,
          },
          {
            chave: 'visitas',
            rotulo: 'Visitas marcadas',
            valor: formatarInteiro(t.visitas_marcadas),
            apoio: `${formatarInteiro(t.visitas_realizadas)} realizadas · ${formatarInteiro(t.visitas_faltou)} faltaram`,
          },
          {
            chave: 'continuou',
            rotulo: 'Cliente continuou',
            valor: formatarPercentual(porcento(t.continuou, t.maduras)) ?? '—',
            apoio: 'escreveu de novo em até 24 h',
            ajuda: 'Das respostas da IA com mais de 24 h, em quantas o cliente voltou a escrever. Conversa que morre depois da resposta é sinal de resposta ruim ou de dúvida resolvida — a juíza separa os dois.',
          },
          {
            chave: 'passadas',
            rotulo: 'Passou para corretor',
            valor: formatarInteiro(t.passadas),
            apoio: `${formatarInteiro(t.pediram_para_parar)} pediram para parar`,
          },
          {
            chave: 'time',
            rotulo: 'Boa pelo time',
            valor: formatarPercentual(porcento(t.boas, avaliadasPeloTime)) ?? '—',
            apoio: `${formatarInteiro(t.boas)} Boa · ${formatarInteiro(t.corrigidas)} Corrigir`,
          },
          {
            chave: 'custo',
            rotulo: 'Custo da IA',
            valor: formatarDolar(t.custo_usd),
            apoio: 'atender + avaliar, no período',
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Interesse dados={dados} />
        <Juiza dados={dados} />
      </div>

      <Semanas dados={dados} />

      {dados.juiza.piores.length > 0 || dados.juiza.melhores.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <ListaDeNotas
            titulo="Para revisar"
            subtitulo="As conversas com nota 3 ou menos em algum quesito. O que a juíza sugere pode virar instrução no caderno da IA, escrita por alguém do time."
            notas={dados.juiza.piores}
          />
          <ListaDeNotas
            titulo="O que deu certo"
            subtitulo="As conversas com nota 4 ou mais nos três quesitos."
            notas={dados.juiza.melhores}
          />
        </div>
      ) : null}

      <NotaDeAlcance>
        O treino (a conversa do Janio) não entra nos números. A IA juíza avalia, toda manhã, as
        conversas do dia anterior; o dia de hoje aparece amanhã.
        {dados.juiza.ligada ? '' : ' A juíza está desligada: as notas não estão sendo calculadas.'} Para
        ajustar o que a IA sabe, use o caderno na <LinkNoTexto href="/ia">tela da IA que atende</LinkNoTexto>.
      </NotaDeAlcance>
    </>
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

function LinhaDeBarra({ rotulo, valor, maximo, texto }: { rotulo: string; valor: number; maximo: number; texto: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_6rem_4.5rem] items-center gap-3 text-sm">
      <span className="truncate">{rotulo}</span>
      <BarraProporcao valor={valor} maximo={maximo} />
      <span className="numerico text-right text-muted-foreground">{texto}</span>
    </li>
  );
}

function Interesse({ dados }: { dados: RelatorioDaIa }) {
  const i = dados.interesse;
  const comDado = i.conversas - i.sem_dado;
  return (
    <Bloco
      titulo="O cliente ficou mais interessado?"
      subtitulo="A atitude de cada cliente logo antes da primeira resposta da IA no período e a de agora."
    >
      {comDado === 0 ? (
        <p className="text-sm text-muted-foreground">Ainda sem atitude para comparar.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          <LinhaDeBarra rotulo="Subiu" valor={i.subiu} maximo={comDado} texto={`${i.subiu} · ${formatarPercentual(porcento(i.subiu, comDado)) ?? ''}`} />
          <LinhaDeBarra rotulo="Ficou igual" valor={i.igual} maximo={comDado} texto={`${i.igual} · ${formatarPercentual(porcento(i.igual, comDado)) ?? ''}`} />
          <LinhaDeBarra rotulo="Caiu" valor={i.caiu} maximo={comDado} texto={`${i.caiu} · ${formatarPercentual(porcento(i.caiu, comDado)) ?? ''}`} />
        </ul>
      )}
      {i.com_nota > 0 ? (
        <p className="text-sm">
          Nota de interesse da leitura da IA:{' '}
          <span className="numerico font-medium">{formatarInteiro(i.nota_antes)}</span> antes →{' '}
          <span className="numerico font-medium">{formatarInteiro(i.nota_depois)}</span> depois{' '}
          <span className="text-muted-foreground">(média de {formatarInteiro(i.com_nota)} clientes, de 0 a 100)</span>
        </p>
      ) : null}
    </Bloco>
  );
}

function Juiza({ dados }: { dados: RelatorioDaIa }) {
  const j = dados.juiza;
  const quesitos: { rotulo: string; valor: number | null; ajuda: string }[] = [
    { rotulo: 'Tirou a dúvida', valor: j.duvida, ajuda: 'respondeu o que o cliente perguntou' },
    { rotulo: 'Informação útil', valor: j.informacao, ajuda: 'específica e com o próximo passo' },
    { rotulo: 'Cliente satisfeito', valor: j.satisfacao, ajuda: 'pela reação do cliente' },
  ];
  return (
    <Bloco
      titulo="Notas da IA juíza"
      subtitulo={
        j.avaliadas > 0
          ? `Média de ${formatarInteiro(j.avaliadas)} ${j.avaliadas === 1 ? 'dia de atendimento avaliado' : 'dias de atendimento avaliados'}, de 1 a 5.`
          : 'A juíza avalia toda manhã os atendimentos do dia anterior.'
      }
    >
      {j.avaliadas === 0 ? (
        <p className="text-sm text-muted-foreground">
          {j.ligada ? 'Ainda não há atendimento avaliado no período.' : 'A IA juíza está desligada.'}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {quesitos.map((q) => (
              <li key={q.rotulo} className="grid grid-cols-[minmax(0,1fr)_6rem_3rem] items-center gap-3 text-sm" title={q.ajuda}>
                <span className="truncate">{q.rotulo}</span>
                <BarraProporcao valor={q.valor ?? 0} maximo={5} />
                <span className="numerico text-right font-medium">{formatarNota(q.valor)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Pela juíza, o interesse subiu em {formatarInteiro(j.subiu)}, ficou igual em {formatarInteiro(j.igual)} e
            caiu em {formatarInteiro(j.caiu)} atendimentos.
          </p>
        </>
      )}
    </Bloco>
  );
}

function Semanas({ dados }: { dados: RelatorioDaIa }) {
  const semanas = dados.semanas.filter((s) => s.respostas > 0 || s.avaliadas > 0);
  if (semanas.length === 0) return null;
  const celula = 'numerico py-2 text-right';
  return (
    <Bloco
      titulo="Semana a semana"
      subtitulo="É aqui que se vê se ela está melhorando: as taxas e as notas devem subir de uma semana para a outra."
    >
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">Semana</th>
              <th className="py-1.5 text-right font-medium">Respostas</th>
              <th className="py-1.5 text-right font-medium">Clientes</th>
              <th className="py-1.5 text-right font-medium" title="Clientes que voltaram a escrever em 24 h">Continuou</th>
              <th className="py-1.5 text-right font-medium" title="Clientes cuja atitude subiu na semana">Interesse subiu</th>
              <th className="py-1.5 text-right font-medium">Boa pelo time</th>
              <th className="py-1.5 text-right font-medium">Visitas</th>
              <th className="py-1.5 text-right font-medium">Passou</th>
              <th className="py-1.5 text-right font-medium">Dúvida</th>
              <th className="py-1.5 text-right font-medium">Informação</th>
              <th className="py-1.5 text-right font-medium">Satisfação</th>
            </tr>
          </thead>
          <tbody>
            {semanas.map((s) => (
              <tr key={s.semana} className="border-t border-hairline">
                <td className="py-2 whitespace-nowrap">{rotuloDaSemana(s.semana)}</td>
                <td className={celula}>{formatarInteiro(s.respostas)}</td>
                <td className={celula}>{formatarInteiro(s.conversas)}</td>
                <td className={celula}>{formatarPercentual(porcento(s.continuou, s.maduras)) ?? '—'}</td>
                <td className={celula}>{formatarPercentual(porcento(s.interesse_subiu, s.interesse_conversas)) ?? '—'}</td>
                <td className={celula}>{formatarPercentual(porcento(s.boas, s.boas + s.corrigidas)) ?? '—'}</td>
                <td className={celula}>{formatarInteiro(s.visitas)}</td>
                <td className={celula}>{formatarInteiro(s.passadas)}</td>
                <td className={celula}>{formatarNota(s.duvida)}</td>
                <td className={celula}>{formatarNota(s.informacao)}</td>
                <td className={celula}>{formatarNota(s.satisfacao)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Bloco>
  );
}

function Nota({ rotulo, valor }: { rotulo: string; valor: number | null }) {
  return (
    <span className={cn('numerico', valor !== null && valor <= 2 && 'font-medium text-quente-texto')}>
      {rotulo} {valor ?? '—'}
    </span>
  );
}

function ListaDeNotas({ titulo, subtitulo, notas }: { titulo: string; subtitulo: string; notas: NotaDaJuiza[] }) {
  return (
    <Bloco titulo={titulo} subtitulo={subtitulo}>
      {notas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma no período.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {notas.map((n) => (
            <li key={`${n.conversation_id}-${n.dia}`} className="flex flex-col gap-1 py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Link
                  href={linkDaConversa(n.organization_id, n.conversation_id)}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {n.nome}
                </Link>
                <span className="text-xs text-muted-foreground">{soDia(n.dia)}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <Nota rotulo="Dúvida" valor={n.duvida} />
                <Nota rotulo="Informação" valor={n.informacao} />
                <Nota rotulo="Satisfação" valor={n.satisfacao} />
              </div>
              {n.porque ? <p>{n.porque}</p> : null}
              {n.melhorar ? <p className="text-muted-foreground">Melhorar: {n.melhorar}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}
