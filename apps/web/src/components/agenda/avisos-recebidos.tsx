'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

import { diaDoInstante, horaEmNatal, rotuloDiaCurto, rotuloSemanaCurto, type Dia } from './tipos';

/**
 * "Fulano marcou um compromisso na sua agenda."
 *
 * Os avisos de `public.agenda_avisos` que ainda não foram vistos: nascem quando
 * gestor ou admin marca uma reunião ou visita para alguém que acompanha
 * (`reuniao_marcar_na_agenda`, `visita_marcar`). A RLS devolve também os avisos
 * que a própria pessoa MANDOU (é como quem marcou sabe que o outro viu), então o
 * filtro por `dono_id` é explícito.
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

async function buscarAvisos(usuarioId: string): Promise<Aviso[]> {
  const supabase = createClient();
  const { data: linhas, error } = await supabase
    .from('agenda_avisos')
    .select(
      'id, tipo, titulo, quando, marcado_por, reunioes(estado, inicio), tasks(status, due_at)',
    )
    .eq('dono_id', usuarioId)
    .is('visto_em', null)
    .order('quando');
  if (error || !linhas) return [];

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

  const quem = await supabase
    .from('team_directory')
    .select('id, full_name')
    .in('id', [...new Set(data.map((a) => a.marcado_por))]);
  const nomes = new Map((quem.data ?? []).map((p) => [p.id, p.full_name] as const));

  return data.map((a) => ({
    id: a.id,
    tipo: a.tipo === 'visita' ? 'visita' : 'reuniao',
    titulo: a.titulo,
    quando: a.quando,
    quemMarcou: nomes.get(a.marcado_por) ?? 'Alguém da equipe',
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
  /** Na Agenda, troca o dia sem sair da tela; fora dela, o item vira link. */
  aoIrParaDia?: (dia: Dia) => void;
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
    onSettled: () => void cliente.invalidateQueries({ queryKey: chaveDosAvisos(usuarioId) }),
  });

  const avisos = consulta.data ?? [];
  if (avisos.length === 0) return null;

  const quemMarcou = [...new Set(avisos.map((a) => a.quemMarcou))];
  const titulo =
    quemMarcou.length === 1
      ? `${quemMarcou[0]} marcou ${avisos.length === 1 ? 'um compromisso' : `${avisos.length} compromissos`} na sua agenda`
      : `${avisos.length} compromissos novos na sua agenda, marcados pela equipe`;

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
              <span className="text-sm font-medium">{a.titulo}</span>
              <span className="numerico text-xs text-muted-foreground">
                {a.tipo === 'visita' ? 'Visita' : 'Reunião'} · {quandoCurto(a.quando)}
                {quemMarcou.length > 1 ? ` · por ${a.quemMarcou}` : ''}
              </span>
            </>
          );
          const classe =
            'flex w-full flex-col items-start gap-0.5 rounded-lg bg-muted/45 px-4 py-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50';
          return (
            <li key={a.id}>
              {aoIrParaDia ? (
                <button type="button" className={classe} onClick={() => aoIrParaDia(dia)}>
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
