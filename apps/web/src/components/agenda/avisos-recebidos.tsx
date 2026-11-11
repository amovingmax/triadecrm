'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CalendarCheck, Check, TriangleAlert } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

import {
  diaDoInstante,
  horaEmNatal,
  PELO_CALENDLY,
  rotuloDiaCurto,
  rotuloSemanaCurto,
  tituloDosAvisos,
  type Dia,
} from './tipos';

/**
 * "Fulano marcou um compromisso na sua agenda."
 *
 * Os avisos de `public.agenda_avisos` que ainda não foram vistos: nascem quando
 * gestor ou admin marca uma reunião ou visita para alguém que acompanha
 * (`reuniao_marcar_na_agenda`, `visita_marcar`), e, só na Imova, quando um cliente
 * marca pelo link do Calendly (`calendly_receber`: `origem = 'calendly'`, sem
 * `marcado_por`, e às vezes com um `detalhe` — o conflito de horário ou a
 * remarcação). A RLS devolve também os avisos que a própria pessoa MANDOU (é como
 * quem marcou sabe que o outro viu), então o filtro por `dono_id` é explícito.
 *
 * Aparece no topo da Agenda e do Meu dia, e some quando a pessoa diz que viu —
 * aviso que não sai nunca vira papel de parede — ou quando o compromisso deixou de
 * existir (cancelado, remarcado, já feito). Silêncio quando não há nenhum.
 */
type Aviso = {
  id: string;
  tipo: 'reuniao' | 'visita';
  titulo: string;
  quando: string;
  quemMarcou: string;
  /** Uma frase a mais: com o que o horário conflita, ou de quando foi remarcado. */
  detalhe: string | null;
  /** A reunião (ou a tarefa) do aviso: o cartão que a Agenda destaca ao tocar. */
  alvo: string | null;
};

const ESTADOS_VIVOS = ['a_confirmar', 'marcada', 'confirmada'];

/**
 * O PostgREST devolve a ponta "um" de uma chave estrangeira como objeto; os tipos
 * gerados às vezes a descrevem como lista. Aceita as duas formas.
 */
function umSo(valor: unknown): unknown {
  return Array.isArray(valor) ? (valor[0] ?? null) : (valor ?? null);
}

export function chaveDosAvisos(usuarioId: string) {
  return ['agenda', 'avisos', usuarioId] as const;
}

const COLUNAS =
  'id, tipo, titulo, quando, marcado_por, origem, detalhe, task_id, reuniao_id, reunioes(estado, inicio), tasks(status, due_at)';
/**
 * Sem `origem` e `detalhe`: o banco que ainda não recebeu a migração 20261110180000.
 * O site sobe junto nas duas empresas e o banco, uma de cada vez; sem esta volta, o
 * aviso de quem recebe um compromisso sumiria nesse intervalo.
 */
const COLUNAS_ANTES_DO_CALENDLY =
  'id, tipo, titulo, quando, marcado_por, task_id, reuniao_id, reunioes(estado, inicio), tasks(status, due_at)';

type LinhaDoAviso = {
  id: string;
  tipo: string;
  titulo: string;
  quando: string;
  marcado_por: string | null;
  origem: string;
  detalhe: string | null;
  task_id: string | null;
  reuniao_id: string | null;
  reunioes: unknown;
  tasks: unknown;
};

async function lerLinhas(usuarioId: string): Promise<LinhaDoAviso[]> {
  const supabase = createClient();
  const consulta = (colunas: string) =>
    supabase
      .from('agenda_avisos')
      .select(colunas)
      .eq('dono_id', usuarioId)
      .is('visto_em', null)
      .order('quando');
  const nova = await consulta(COLUNAS);
  if (!nova.error) return (nova.data ?? []) as unknown as LinhaDoAviso[];
  // 42703 = coluna que não existe.
  if (nova.error.code !== '42703') return [];
  const antiga = await consulta(COLUNAS_ANTES_DO_CALENDLY);
  if (antiga.error || !antiga.data) return [];
  return (antiga.data as unknown as Omit<LinhaDoAviso, 'origem' | 'detalhe'>[]).map((l) => ({
    ...l,
    origem: 'equipe',
    detalhe: null,
  }));
}

async function buscarAvisos(usuarioId: string): Promise<Aviso[]> {
  const supabase = createClient();
  const linhas = await lerLinhas(usuarioId);
  if (linhas.length === 0) return [];

  // O aviso diz o que está de pé AGORA, e não o que foi marcado: reunião cancelada
  // ou remarcada (a remarcação cria outra linha e fecha esta) e visita cancelada ou
  // já feita não aparecem mais. A hora é a atual do compromisso.
  const data = linhas.flatMap((a) => {
    const reuniao = umSo(a.reunioes as unknown) as { estado: string; inicio: string } | null;
    const tarefa = umSo(a.tasks as unknown) as { status: string; due_at: string | null } | null;
    if (reuniao) {
      return ESTADOS_VIVOS.includes(reuniao.estado) ? [{ ...a, quando: reuniao.inicio }] : [];
    }
    if (tarefa) {
      return tarefa.status === 'todo' || tarefa.status === 'doing'
        ? [{ ...a, quando: tarefa.due_at ?? a.quando }]
        : [];
    }
    return [];
  });
  if (data.length === 0) return [];

  const ids = [...new Set(data.flatMap((a) => (a.marcado_por ? [a.marcado_por] : [])))];
  const quem =
    ids.length === 0
      ? { data: [] }
      : await supabase.from('team_directory').select('id, full_name').in('id', ids);
  const nomes = new Map((quem.data ?? []).map((p) => [p.id, p.full_name] as const));

  return data.map((a) => ({
    id: a.id,
    tipo: a.tipo === 'visita' ? 'visita' : 'reuniao',
    titulo: a.titulo,
    quando: a.quando,
    quemMarcou:
      a.origem === 'calendly'
        ? PELO_CALENDLY
        : ((a.marcado_por ? nomes.get(a.marcado_por) : null) ?? 'Alguém da equipe'),
    detalhe: a.detalhe,
    alvo: a.reuniao_id ?? a.task_id,
  }));
}

function quandoCurto(iso: string): string {
  const dia = diaDoInstante(iso);
  return `${rotuloSemanaCurto(dia)}, ${rotuloDiaCurto(dia)} às ${horaEmNatal(iso)}`;
}

export function AvisosRecebidos({
  usuarioId,
  aoIrParaDia,
}: {
  usuarioId: string;
  /**
   * Na Agenda, troca o dia sem sair da tela e destaca o cartão do aviso (`alvo`);
   * fora dela, o item vira link.
   */
  aoIrParaDia?: (dia: Dia, alvo?: string | null) => void;
}) {
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: chaveDosAvisos(usuarioId),
    queryFn: () => buscarAvisos(usuarioId),
    staleTime: 30_000,
  });
  const visto = useMutation({
    mutationFn: async (ids: string[]) => {
      const supabase = createClient();
      await supabase.rpc('agenda_avisos_vistos', { p_ids: ids });
    },
    // Relê a agenda inteira, e não só os avisos: o selo "Novo" dos cartões sai junto.
    onSettled: () => void cliente.invalidateQueries({ queryKey: ['agenda'] }),
  });

  const avisos = consulta.data ?? [];
  if (avisos.length === 0) return null;

  const quemMarcou = [...new Set(avisos.map((a) => a.quemMarcou))];
  const titulo = tituloDosAvisos(avisos);

  return (
    <section
      aria-label="Compromissos marcados para você"
      className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
          <span className="flex size-7 items-center justify-center rounded-full bg-menta text-menta-tinta">
            <BellRing className="size-4" aria-hidden="true" />
          </span>
          {titulo}
        </h2>
        <Button
          variant="outline"
          size="lg"
          className="toque h-11 md:h-9"
          disabled={visto.isPending}
          onClick={() => visto.mutate(avisos.map((a) => a.id))}
        >
          <Check aria-hidden="true" />
          Ok, vi
        </Button>
      </header>
      <ul className="flex flex-col gap-2">
        {avisos.map((a) => {
          const dia = diaDoInstante(a.quando);
          const conteudo = (
            <>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium">{a.titulo}</span>
                {/* De onde veio, no mesmo selo do cartão. */}
                {a.quemMarcou === PELO_CALENDLY ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-menta/15 px-2 py-0.5 text-[11px] font-medium text-foreground">
                    <CalendarCheck className="size-3" aria-hidden="true" />
                    Calendly
                  </span>
                ) : null}
              </span>
              <span className="numerico text-xs text-muted-foreground">
                {a.tipo === 'visita' ? 'Visita' : 'Reunião'} · {quandoCurto(a.quando)}
                {quemMarcou.length > 1 && a.quemMarcou !== PELO_CALENDLY
                  ? ` · por ${a.quemMarcou}`
                  : ''}
              </span>
              {/* Âmbar, como o "Reagendada" do cartão: pede atenção, não é erro. */}
              {a.detalhe ? (
                <span className="flex items-start gap-1 text-xs text-morno-texto">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  {a.detalhe}
                </span>
              ) : null}
            </>
          );
          const classe =
            'flex w-full flex-col items-start gap-0.5 rounded-lg bg-muted/45 px-4 py-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50';
          return (
            <li key={a.id}>
              {aoIrParaDia ? (
                <button type="button" className={classe} onClick={() => aoIrParaDia(dia, a.alvo)}>
                  {conteudo}
                </button>
              ) : (
                <Link href={`/agenda?dia=${dia}`} className={classe}>
                  {conteudo}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
