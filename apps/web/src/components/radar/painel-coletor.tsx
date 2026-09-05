'use client';

import { useQuery } from '@tanstack/react-query';
import { RadioTower, RotateCw, Unplug } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatarDataHora, formatarNumero } from '@/components/parceiros/formatos';

import { buscarColetasRecentes, buscarSaudeDaEsteira, mensagemDoErro } from './dados';
import { ROTULO_DA_FILA, ROTULO_DO_LOTE, type BatidaDeWorker, type LoteDeColeta } from './tipos';

/**
 * O estado do coletor (RF-RAD, RF-ADM-07).
 *
 * Este painel existe para separar duas coisas que, sem ele, desenham exatamente a
 * mesma tela: "não há nada para revisar hoje" e "o coletor está desligado desde
 * ontem". A primeira é um dia tranquilo. A segunda é um problema — e um problema
 * que ninguém descobre olhando uma fila vazia.
 *
 * Quem responde é o banco: `esteira_saude()` devolve a última batida de cada
 * worker (`worker_heartbeats`, atualizada a cada 20 s pelo coletor) e o veredito
 * `vivo`, que é batida nos últimos 2 minutos. A tela não recalcula esse veredito:
 * o relógio que vale é o do Postgres, não o do navegador de quem está olhando.
 *
 * Sem cor cromática em nenhum estado: verde e vermelho aqui significariam
 * temperatura, e não há temperatura nenhuma para ler na saúde de um robô. O sinal
 * é o ponto cheio contra o ponto vazado, mais a frase.
 */
export function PainelDoColetor() {
  const saude = useQuery({
    queryKey: ['radar', 'esteira', 'saude'],
    queryFn: buscarSaudeDaEsteira,
    // A batida chega a cada 20 s; conferir a cada 20 s mantém a tela honesta sem
    // transformar o Radar aberto numa fonte de tráfego.
    refetchInterval: 20_000,
  });
  const coletas = useQuery({
    queryKey: ['radar', 'esteira', 'coletas'],
    queryFn: () => buscarColetasRecentes(3),
    refetchInterval: 20_000,
  });

  if (saude.isPending) return <EsqueletoDoPainel />;

  if (saude.isError) {
    return (
      <Moldura
        icone={<RotateCw className="size-4" aria-hidden="true" />}
        titulo="Não deu para saber se o coletor está de pé"
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          {mensagemDoErro(saude.error)} Isso não diz nada sobre a coleta em si: ela pode estar
          rodando normalmente. Tente de novo e, se continuar, avise no grupo do time.
        </p>
        <Button
          variant="outline"
          onClick={() => void saude.refetch()}
          className="toque h-11 self-start md:h-9"
        >
          <RotateCw aria-hidden="true" />
          Tentar de novo
        </Button>
      </Moldura>
    );
  }

  // `null` = o papel não lê a saúde da esteira (leitura, financeiro). Não é falha.
  if (saude.data === null) {
    return (
      <Moldura
        icone={<Unplug className="size-4" aria-hidden="true" />}
        titulo="O estado do coletor não faz parte do seu acesso"
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          A fila de revisão abaixo continua valendo. Quem acompanha o robô é quem trabalha a base.
        </p>
      </Moldura>
    );
  }

  const coletor = saude.data.workers.find((w) => w.worker === 'ingest') ?? null;
  const vivo = coletor?.vivo ?? false;
  const emFila = saude.data.filas
    .filter((f) => f.fila !== 'ingest_dlq')
    .reduce((total, f) => total + f.na_fila, 0);
  const mortas = saude.data.filas.find((f) => f.fila === 'ingest_dlq')?.na_fila ?? 0;

  return (
    <section
      aria-labelledby="radar-coletor"
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-hairline bg-muted/40 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <span
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground"
            aria-hidden="true"
          >
            {vivo ? <RadioTower className="size-4" /> : <Unplug className="size-4" />}
          </span>
          <div className="min-w-0">
            <h2 id="radar-coletor" className="font-heading text-sm font-medium">
              {tituloDoColetor(coletor, saude.data.lotes_rodando)}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {explicacaoDoColetor(coletor, saude.data.lotes_rodando, emFila)}
            </p>
          </div>
        </div>

        <span
          className="pilula flex shrink-0 items-center gap-2 px-3 py-1 text-xs"
          aria-label={vivo ? 'Coletor de pé' : 'Coletor parado'}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full',
              vivo ? 'bg-foreground' : 'border border-muted-foreground/60 bg-transparent',
            )}
          />
          {vivo ? 'De pé' : 'Parado'}
        </span>
      </div>

      {coletor ? (
        <>
          {/* No celular a tela é da fila de revisão, não da máquina: fica a batida,
              que é o número que decide se dá para confiar na fila, e nada mais. */}
          <p className="border-t border-hairline pt-3 text-xs text-muted-foreground md:hidden">
            Última batida <span className="numerico">{duracaoEmPortugues(coletor.ha_segundos).numero}</span>{' '}
            {duracaoEmPortugues(coletor.ha_segundos).unidade} atrás, na versão{' '}
            <span className="numerico">{coletor.versao ?? '—'}</span>.
          </p>
          <div className="hidden md:block">
            <FichaDoColetor batida={coletor} />
          </div>
        </>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
        {[...saude.data.filas].sort(naOrdemDaEsteira).map((fila) => {
          const rotulo = ROTULO_DA_FILA[fila.fila];
          return (
            <div key={fila.fila} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground" title={rotulo?.explicacao}>
                {rotulo?.nome ?? fila.fila}
              </dt>
              <dd className="numerico text-lg leading-tight font-medium">
                {formatarNumero(fila.na_fila)}
              </dd>
            </div>
          );
        })}
      </dl>

      {mortas > 0 ? (
        <p className="text-sm leading-relaxed text-foreground">
          <span className="numerico">{formatarNumero(mortas)}</span>{' '}
          {mortas === 1 ? 'mensagem parou' : 'mensagens pararam'} com erro depois de todas as
          tentativas. Ninguém tenta de novo sozinho: peça ao Matheus para ler a fila de erro antes
          da próxima coleta.
        </p>
      ) : null}

      {saude.data.registros_por_resolver > 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="numerico">{formatarNumero(saude.data.registros_por_resolver)}</span>{' '}
          {saude.data.registros_por_resolver === 1
            ? 'captura baixada ainda não virou candidato'
            : 'capturas baixadas ainda não viraram candidato'}
          .
        </p>
      ) : null}

      <div className="hidden md:block">
        <UltimasColetas
          lotes={coletas.data ?? []}
          carregando={coletas.isPending}
          erro={coletas.isError}
        />
      </div>

      <p className="hidden text-xs leading-relaxed text-muted-foreground md:block">
        O robô só traz candidato para a fila abaixo. Nada vira parceiro sem alguém decidir, e a
        coleta respeita o robots.txt e o intervalo de cada fonte — quando a fonte barra, o coletor
        para e registra o motivo em vez de tentar outro caminho.
      </p>
    </section>
  );
}

/** Host, versão e o que a instância já fez desde que subiu. */
function FichaDoColetor({ batida }: { batida: BatidaDeWorker }) {
  const desde = duracaoEmPortugues(batida.ha_segundos);

  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-3 text-xs">
      <Dado rotulo="Última batida">
        <span className="numerico">{desde.numero}</span> {desde.unidade} atrás
      </Dado>
      <Dado rotulo="Máquina">{batida.host ?? 'não informada'}</Dado>
      <Dado rotulo="Versão">
        <span className="numerico">{batida.versao ?? '—'}</span>
      </Dado>
      <Dado rotulo="Mensagens tratadas">
        <span className="numerico">{formatarNumero(batida.processados)}</span>
      </Dado>
      <Dado rotulo="Falhas">
        <span className="numerico">{formatarNumero(batida.falhas)}</span>
      </Dado>
    </dl>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

function UltimasColetas({
  lotes,
  carregando,
  erro,
}: {
  lotes: LoteDeColeta[];
  carregando: boolean;
  erro: boolean;
}) {
  if (carregando) {
    return (
      <div className="border-t border-hairline pt-3">
        <Skeleton className="h-3.5 w-56" />
      </div>
    );
  }
  if (erro) {
    return (
      <p className="border-t border-hairline pt-3 text-xs text-muted-foreground">
        A lista das últimas coletas não carregou. O painel acima continua valendo.
      </p>
    );
  }
  if (lotes.length === 0) {
    return (
      <p className="border-t border-hairline pt-3 text-xs text-muted-foreground">
        Nenhuma coleta foi rodada nesta base ainda.
      </p>
    );
  }

  return (
    <div className="border-t border-hairline pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">Últimas coletas</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {lotes.map((lote) => (
          <li key={lote.id} className="text-xs leading-relaxed">
            <span className="text-foreground">{lote.rotulo}</span>
            <span className="text-muted-foreground">
              {' · '}
              {ROTULO_DO_LOTE[lote.status]}
              {lote.candidatos !== null ? (
                <>
                  {' · '}
                  <span className="numerico">{formatarNumero(lote.candidatos)}</span>{' '}
                  {lote.candidatos === 1 ? 'candidato' : 'candidatos'}
                </>
              ) : null}
              {lote.terminou_em ? (
                <>
                  {' · '}
                  <span className="numerico">{formatarDataHora(lote.terminou_em)}</span>
                </>
              ) : null}
            </span>
            {lote.erro ? <p className="mt-0.5 text-muted-foreground">{lote.erro}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Moldura({
  icone,
  titulo,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex max-w-3xl gap-3 rounded-lg border border-hairline bg-muted/40 p-4">
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground"
        aria-hidden="true"
      >
        {icone}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 className="font-heading text-sm font-medium">{titulo}</h2>
        {children}
      </div>
    </section>
  );
}

function EsqueletoDoPainel() {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-hairline bg-muted/40 p-4"
    >
      <span className="sr-only">Carregando o estado do coletor.</span>
      <div className="flex items-start gap-3">
        <Skeleton className="size-8 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-3.5 w-full max-w-md" />
        </div>
        <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-10" />
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ordem e frases
// ---------------------------------------------------------------------------

/**
 * As filas na ordem da esteira, e não em ordem alfabética (que é como o banco as
 * devolve, e que começaria por "Parou com erro"). Quem lê precisa ver o caminho
 * do trabalho: planejar → buscar → resolver, e só então o que ficou pelo caminho.
 */
export const ORDEM_DAS_FILAS = ['ingest_jobs', 'ingest_pages', 'ingest_records', 'ingest_dlq'];

export function naOrdemDaEsteira(a: { fila: string }, b: { fila: string }): number {
  const posicao = (nome: string) => {
    const i = ORDEM_DAS_FILAS.indexOf(nome);
    return i < 0 ? ORDEM_DAS_FILAS.length : i;
  };
  return posicao(a.fila) - posicao(b.fila);
}

function tituloDoColetor(coletor: BatidaDeWorker | null, lotesRodando: number): string {
  if (!coletor) return 'O coletor ainda não rodou nesta base';
  if (!coletor.vivo) return 'O coletor está parado';
  if (coletor.status === 'degradado') return 'O coletor está de pé, com falhas na volta';
  return lotesRodando > 0 ? 'O coletor está coletando agora' : 'O coletor está de pé, sem trabalho';
}

function explicacaoDoColetor(
  coletor: BatidaDeWorker | null,
  lotesRodando: number,
  emFila: number,
): string {
  if (!coletor) {
    return 'Nenhuma batida de ponto chegou até agora. O robô roda na máquina dedicada e só coleta quando alguém o liga; enquanto isso, o que você achar na mão entra pela mesma fila de revisão.';
  }

  const desde = duracaoEmPortugues(coletor.ha_segundos);
  if (!coletor.vivo) {
    return `A última batida foi ${desde.numero} ${desde.unidade} atrás, e o esperado é uma a cada 20 segundos. A fila abaixo pode estar vazia por isso, e não por falta de alvo: avise o Matheus.`;
  }
  if (coletor.status === 'degradado') {
    return 'Ele continua trabalhando, mas alguma mensagem falhou na última volta. Confira a fila de erro antes de contar com a coleta de hoje.';
  }
  if (lotesRodando > 0) {
    return `${lotesRodando === 1 ? 'Uma coleta em andamento' : `${lotesRodando} coletas em andamento`}, ${emFila === 0 ? 'sem nada esperando na esteira' : `com ${emFila} na esteira`}. O que ele trouxer aparece na fila abaixo.`;
  }
  return 'Ligado e com as filas vazias: nenhuma coleta pendente agora. A fila abaixo é o que já foi trazido e ainda espera decisão.';
}

/**
 * "há 4 s", "há 12 min", "há 3 h", "há 2 d" — em dois pedaços, porque só o dígito
 * vai para a IBM Plex Mono (mono serve para alinhar número, não para vestir frase).
 */
export function duracaoEmPortugues(segundos: number): { numero: number; unidade: string } {
  const s = Math.max(0, Math.floor(segundos));
  if (s < 60) return { numero: s, unidade: s === 1 ? 'segundo' : 'segundos' };
  const minutos = Math.floor(s / 60);
  if (minutos < 60) return { numero: minutos, unidade: minutos === 1 ? 'minuto' : 'minutos' };
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return { numero: horas, unidade: horas === 1 ? 'hora' : 'horas' };
  const dias = Math.floor(horas / 24);
  return { numero: dias, unidade: dias === 1 ? 'dia' : 'dias' };
}
