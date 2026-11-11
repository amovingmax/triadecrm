'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, CircleCheck, Info, Timer } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { hojeEmNatal } from '@/components/agenda/tipos';

import { buscarPrimeiraResposta, mensagemDoErro } from './consultas';
import {
  ESPERAS_A_MOSTRAR,
  fraseDaEspera,
  fraseDaRegua,
  fraseDoAlvo,
  fraseSemRespondidas,
  fraseSemResponsavel,
  haQuanto,
  horaDoExpediente,
  linkDaLista,
  medianaEmTexto,
  noExpediente,
  rotuloDoDia,
  tomDoTempo,
  type EsperaAgora,
  type GrupoDaEquipe,
  type PrimeiraResposta,
  type ReguaDaResposta,
  type TomDaResposta,
} from './primeira-resposta';

/**
 * "Primeira resposta" no Meu dia novo da Imova (módulo `meuDiaNovo`, 11/11/2026),
 * logo abaixo de "Seu dia em números". O pedido: "Uma meta de 'primeira resposta'
 * no Meu dia", porque o cliente esperava 73 min no expediente e ninguém era
 * cobrado por isso.
 *
 *   Esperando agora   quantas conversas da pessoa esperam a resposta do time, a
 *                     mais antiga, e cada uma com o link para a conversa
 *   Hoje              a mediana do tempo da primeira resposta de cada espera
 *                     respondida hoje, em minutos de expediente, e "X de Y em até
 *                     15 min", na cor do ritmo
 *   Equipe            (admin e gestor) o mesmo por pessoa, mais as sem responsável
 *
 * A conta é do banco (`public.meu_dia_primeira_resposta`), que também confere quem
 * pode ver o dia de quem. Relê a cada minuto: espera é coisa que muda sozinha.
 */
export function BlocoPrimeiraResposta({
  pessoa,
  doProprio,
  usuarioId,
  selecionaveis,
  aoVerPessoa,
}: {
  /** De quem é o dia (o mesmo do seletor). */
  pessoa: string;
  doProprio: boolean;
  /** Quem entrou: na equipe, a linha dele se chama "Você". */
  usuarioId: string;
  /** Quem está no seletor: só essas linhas da equipe abrem o dia da pessoa. */
  selecionaveis: readonly string[];
  aoVerPessoa: (id: string) => void;
}) {
  const leitura = useQuery({
    queryKey: ['meu-dia', 'primeira-resposta', pessoa],
    queryFn: () => buscarPrimeiraResposta(doProprio ? undefined : pessoa, hojeEmNatal()),
    refetchInterval: 60_000,
  });

  if (leitura.isPending) return <Esqueleto />;
  if (leitura.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        A primeira resposta não carregou. {mensagemDoErro(leitura.error)}
      </p>
    );
  }

  const dados = leitura.data;
  const diaDeAgora = hojeEmNatal(dados.agora ? new Date(dados.agora) : new Date());
  const rotulo = rotuloDoDia(dados.dia, diaDeAgora);
  const hoje = rotulo === 'Hoje';

  return (
    <section
      aria-labelledby="primeira-resposta"
      className="sombra-base overflow-hidden rounded-xl bg-card"
    >
      <div className="flex items-start gap-3.5 px-4 pt-4 sm:px-5">
        <span
          aria-hidden="true"
          className="flex size-9.5 shrink-0 items-center justify-center rounded-[11px] bg-menta-fundo text-menta-texto"
        >
          <Timer className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="primeira-resposta" className="font-heading text-lg leading-snug font-semibold">
            Primeira resposta
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{fraseDaRegua(dados.regua)}</p>
        </div>
      </div>

      <div className="mt-3 grid border-t sm:grid-cols-2 sm:divide-x">
        <EsperandoAgora dados={dados} doProprio={doProprio} />
        <Hoje dados={dados} hoje={hoje} rotulo={rotulo} />
      </div>

      {dados.equipe ? (
        <Equipe
          dados={dados}
          equipe={dados.equipe}
          usuarioId={usuarioId}
          selecionaveis={selecionaveis}
          aoVerPessoa={aoVerPessoa}
          rotulo={rotulo}
        />
      ) : null}

      <ComoEContado regua={dados.regua} />
    </section>
  );
}

/** A cor de cada degrau: as do ritmo do Meu dia, mais o vermelho de alerta. */
const COR_DO_TEXTO: Record<TomDaResposta, string> = {
  dentro: 'text-primary',
  perto: 'text-menta-texto',
  fora: 'text-destructive-texto',
  neutro: 'text-muted-foreground',
};

const COR_DO_PONTO: Record<TomDaResposta, string> = {
  dentro: 'bg-primary',
  perto: 'bg-menta',
  fora: 'bg-destructive',
  neutro: 'bg-foreground/30',
};

const NOME_DO_TOM: Record<TomDaResposta, string> = {
  dentro: 'dentro do alvo',
  perto: 'passou do alvo',
  fora: 'passou da hora de a gestão entrar',
  neutro: '',
};

function EsperandoAgora({ dados, doProprio }: { dados: PrimeiraResposta; doProprio: boolean }) {
  const [todas, setTodas] = useState(false);
  const { pessoa, regua, agora } = dados;
  const maisAntiga = pessoa.itens[0] ?? null;
  const frase = fraseDaEspera(pessoa.esperando, maisAntiga?.desde ?? null, agora);
  const semDono = fraseSemResponsavel(pessoa.semResponsavel, pessoa.esperando);
  const tom = tomDoTempo(maisAntiga?.minutos ?? null, regua);
  const visiveis = todas ? pessoa.itens : pessoa.itens.slice(0, ESPERAS_A_MOSTRAR);
  const escondidas = pessoa.itens.length - visiveis.length;
  // O banco manda até 20; o resto só em Conversas.
  const foraDaLista = pessoa.esperando - pessoa.itens.length;

  return (
    <div className="flex min-w-0 flex-col gap-2 px-4 py-4 sm:px-5">
      <h3 className="text-sm text-muted-foreground">Esperando agora</h3>
      {frase === null ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-primary">
          <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
          Ninguém esperando resposta agora.
        </p>
      ) : (
        <>
          <p className={cn('text-[15px] font-semibold', COR_DO_TEXTO[tom])}>
            <span className="numerico">{frase}</span>
          </p>
          {semDono ? <p className="text-xs text-muted-foreground">{semDono}</p> : null}
          <ul className="-mx-2 flex flex-col">
            {visiveis.map((espera) => (
              <LinhaDaEspera key={espera.conversaId} espera={espera} regua={regua} agora={agora} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {escondidas > 0 ? (
              <button
                type="button"
                onClick={() => setTodas(true)}
                className="toque inline-flex min-h-11 cursor-pointer items-center gap-1 font-semibold text-foreground/80 hover:text-foreground sm:min-h-8"
              >
                Mostrar mais <span className="numerico">{escondidas}</span>
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
            ) : null}
            <Link
              href={linkDaLista(pessoa.id, doProprio)}
              className="toque inline-flex min-h-11 items-center text-muted-foreground underline underline-offset-4 hover:text-foreground sm:min-h-8"
            >
              {foraDaLista > 0 ? `Ver as outras ${foraDaLista} em Conversas` : 'Abrir Conversas'}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function LinhaDaEspera({
  espera,
  regua,
  agora,
}: {
  espera: EsperaAgora;
  regua: ReguaDaResposta;
  agora: string;
}) {
  const tom = tomDoTempo(espera.minutos, regua);
  const expediente = noExpediente(espera, agora);
  const quanto = haQuanto(espera.desde, agora);
  return (
    <li>
      <Link
        href={espera.caminho}
        aria-label={`${espera.nome}, esperando ${quanto}${expediente ? `, ${expediente}` : ''}. ${NOME_DO_TOM[tom]}. Abrir a conversa.`}
        className="toque flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', COR_DO_PONTO[tom])}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{espera.nome}</span>
          {espera.semResponsavel || expediente ? (
            <span className="truncate text-xs text-muted-foreground">
              {[espera.semResponsavel ? 'sem responsável' : null, expediente]
                .filter(Boolean)
                .join(' · ')}
            </span>
          ) : null}
        </span>
        <span className={cn('numerico shrink-0 text-[13px]', COR_DO_TEXTO[tom])}>{quanto}</span>
      </Link>
    </li>
  );
}

function Hoje({ dados, hoje, rotulo }: { dados: PrimeiraResposta; hoje: boolean; rotulo: string }) {
  const { pessoa, regua } = dados;
  const mediana = medianaEmTexto(pessoa.medianaMin);
  const tom = tomDoTempo(pessoa.medianaMin, regua);
  const alvo = fraseDoAlvo(pessoa, regua);
  const fracao =
    pessoa.respondidas > 0 ? Math.round((pessoa.noAlvo / pessoa.respondidas) * 100) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-2 border-t px-4 py-4 sm:border-t-0 sm:px-5">
      <h3 className="text-sm text-muted-foreground">{rotulo}</h3>
      {mediana === null || alvo === null ? (
        <p className="text-sm text-muted-foreground">
          {fraseSemRespondidas(pessoa.esperando, hoje)}
        </p>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <span
              className={cn(
                'numerico text-[34px] leading-none font-medium tracking-[-0.03em]',
                COR_DO_TEXTO[tom],
              )}
            >
              {mediana}
            </span>
            <span className="text-sm text-muted-foreground">de mediana</span>
          </p>
          <span
            role="progressbar"
            aria-valuenow={fracao}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${alvo}. Mediana de ${mediana}, ${NOME_DO_TOM[tom]}.`}
            className="mt-1 block h-1.5 rounded-full bg-muted"
          >
            <span
              aria-hidden="true"
              className={cn('block h-full rounded-full', COR_DO_PONTO[tom])}
              style={{ width: `${fracao}%` }}
            />
          </span>
          <p className={cn('text-[13px] font-semibold', COR_DO_TEXTO[tom])}>
            <span className="numerico">{alvo}</span>
          </p>
        </>
      )}
    </div>
  );
}

/**
 * A versão da equipe, para admin e gestor: uma linha por pessoa que ele acompanha
 * (`lib/auth/hierarquia.ts`, conferido no banco), as sem responsável à parte e o
 * total. No celular cada linha quebra em duas: o nome em cima, os números embaixo.
 */
function Equipe({
  dados,
  equipe,
  usuarioId,
  selecionaveis,
  aoVerPessoa,
  rotulo,
}: {
  dados: PrimeiraResposta;
  equipe: NonNullable<PrimeiraResposta['equipe']>;
  usuarioId: string;
  selecionaveis: readonly string[];
  aoVerPessoa: (id: string) => void;
  rotulo: string;
}) {
  const sem = equipe.semResponsavel;
  const mostrarSem = sem.esperando > 0 || sem.respondidas > 0;
  const total = equipe.total;
  const alvoDoTotal = fraseDoAlvo(total, dados.regua);
  const medianaDoTotal = medianaEmTexto(total.medianaMin);

  return (
    <div className="border-t px-4 py-4 sm:px-5">
      <h3 className="text-sm font-semibold">Equipe</h3>
      <p className="text-xs text-muted-foreground">
        Quem espera agora e as respostas {rotulo === 'Hoje' ? 'de hoje' : rotulo.toLowerCase()}, por
        quem atende.
      </p>
      <ul className="mt-2 flex flex-col divide-y">
        {equipe.pessoas.map((pessoa) => {
          const nome = pessoa.id === usuarioId ? 'Você' : pessoa.nome;
          const podeAbrir = selecionaveis.includes(pessoa.id);
          return (
            <LinhaDaEquipe
              key={pessoa.id}
              nome={
                podeAbrir ? (
                  <button
                    type="button"
                    onClick={() => aoVerPessoa(pessoa.id)}
                    className="toque cursor-pointer truncate text-left underline-offset-4 hover:underline"
                    title={`Ver o dia de ${nome}`}
                  >
                    {nome}
                  </button>
                ) : (
                  <span className="truncate">{nome}</span>
                )
              }
              grupo={pessoa}
              dados={dados}
            />
          );
        })}
        {mostrarSem ? (
          <LinhaDaEquipe
            nome={<span className="truncate italic">Sem responsável</span>}
            grupo={sem}
            dados={dados}
          />
        ) : null}
      </ul>
      {total.esperando > 0 || total.respondidas > 0 ? (
        <p className="mt-2 border-t pt-2.5 text-[13px] text-muted-foreground">
          <span className="font-semibold text-foreground">Equipe:</span>{' '}
          <span className="numerico">
            {[
              total.esperando > 0 ? `${total.esperando} esperando` : 'ninguém esperando',
              medianaDoTotal ? `mediana ${medianaDoTotal}` : null,
              alvoDoTotal,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function LinhaDaEquipe({
  nome,
  grupo,
  dados,
}: {
  nome: React.ReactNode;
  grupo: GrupoDaEquipe;
  dados: PrimeiraResposta;
}) {
  const tomDaEspera = tomDoTempo(grupo.maisAntigaMin, dados.regua);
  const tomDaMediana = tomDoTempo(grupo.medianaMin, dados.regua);
  const mediana = medianaEmTexto(grupo.medianaMin);
  const alvo = fraseDoAlvo(grupo, dados.regua);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-0.5 py-2.5 text-sm">
      <span className="flex min-w-0 flex-1 basis-32 font-medium">{nome}</span>
      <span
        className={cn(
          'numerico text-[13px]',
          grupo.esperando > 0 ? COR_DO_TEXTO[tomDaEspera] : 'text-muted-foreground',
        )}
      >
        {fraseDaEspera(grupo.esperando, grupo.maisAntiga, dados.agora) ?? 'ninguém esperando'}
      </span>
      <span
        className={cn(
          'numerico text-[13px]',
          mediana ? COR_DO_TEXTO[tomDaMediana] : 'text-muted-foreground',
        )}
      >
        {mediana && alvo ? `mediana ${mediana} · ${alvo}` : 'sem respostas'}
      </span>
    </li>
  );
}

function ComoEContado({ regua }: { regua: ReguaDaResposta }) {
  return (
    <details className="border-t px-4 py-1 text-xs text-muted-foreground sm:px-5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 sm:min-h-9">
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="underline underline-offset-4">Como é contado</span>
      </summary>
      <ul className="mb-3 flex list-disc flex-col gap-1 pl-5">
        <li>
          A espera começa na primeira mensagem do cliente que ninguém respondeu e termina na
          primeira resposta de alguém do time ou da IA que atende. Modelo, mensagem automática e
          mensagem que não saiu não contam como resposta; reação do cliente não abre espera.
        </li>
        <li>
          O tempo é contado só no expediente, das {horaDoExpediente(regua.inicio)} às{' '}
          {horaDoExpediente(regua.fim)} dos dias úteis: a mensagem das 22h começa a contar às{' '}
          {horaDoExpediente(regua.inicio)}. Em &quot;Esperando agora&quot;, o &quot;há&quot; é o
          relógio, como o cliente sente.
        </li>
        <li>
          Cor: até {regua.alvoMin} min, dentro do alvo; até {regua.gestaoMin} min, passou do alvo;
          depois disso, passou da hora de a gestão entrar.
        </li>
        <li>
          Contam as conversas de quem atende e as sem responsável (quem atendia saiu da empresa, ou
          não atende), que aparecem para todos. Conversa concluída, bloqueada, de quem pediu para
          sair e as de teste da IA ficam de fora.
        </li>
        <li>
          É uma régua diferente da &quot;Primeira resposta&quot; dos Relatórios, que mede uma vez
          por cliente novo, em horas de relógio.
        </li>
      </ul>
    </details>
  );
}

function Esqueleto() {
  return (
    <div aria-busy="true" aria-live="polite" className="sombra-base rounded-xl bg-card p-4 sm:p-5">
      <span className="sr-only">Carregando a primeira resposta.</span>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
