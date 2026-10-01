import { createClient } from '@/lib/supabase/client';

/**
 * A sala de reunião de cada pessoa (ADR-15): `profiles.sala_url`.
 *
 * A sala é OPCIONAL para quem marca pela tela: sem a da pessoa e sem a sala
 * padrão da casa (`agenda.reunioes.sala_padrao`), a reunião on-line nasce sem
 * link. Só o robô continua recusando (`sem_sala`), porque ele manda o link ao
 * parceiro na hora. A regra nasceu com a frase "cada pessoa cola o link em
 * Ajustes", mas Ajustes nunca ganhou o campo — e SDR nem entra lá. O campo mora
 * na folha de marcar, onde todo papel que marca chega.
 *
 * Nenhuma permissão nova: `profiles_update` já deixa cada um editar a própria
 * linha, e `app.profiles_guard` só protege papel, status e time.
 */

export type SalaValidada = { ok: true; url: string } | { ok: false; recado: string };

/**
 * O mesmo crivo do banco (`profiles_sala_url_chk`: `^https://[^[:space:]]+$`),
 * dito antes e em português. Quem cola "meet.google.com/abc" ganha o `https://`.
 */
export function validarSala(texto: string): SalaValidada {
  const colado = texto.trim();
  if (colado === '') return { ok: false, recado: 'Cole o link da sala.' };
  if (/\s/.test(colado)) return { ok: false, recado: 'O link não pode ter espaço.' };
  if (/^http:\/\//i.test(colado)) {
    return { ok: false, recado: 'O link precisa começar com https://.' };
  }
  const url = /^https:\/\//i.test(colado) ? colado : `https://${colado}`;
  try {
    const lida = new URL(url);
    if (!lida.hostname.includes('.'))
      return { ok: false, recado: 'Esse link não parece completo.' };
  } catch {
    return { ok: false, recado: 'Esse link não parece completo.' };
  }
  return { ok: true, url };
}

export type SalaDaPessoa = {
  /** A sala que a própria pessoa cadastrou. */
  propria: string | null;
  /** A sala da casa, que vale para quem não tem a própria. */
  padrao: string | null;
};

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

/**
 * A sala de uma pessoa. A de outra só volta para admin e gestor
 * (`profiles_select`); para os demais vem nula, e quem decide é o banco.
 */
export async function lerSala(pessoaId: string): Promise<SalaDaPessoa> {
  const supabase = createClient();
  const [perfil, grade] = await Promise.all([
    supabase.from('profiles').select('sala_url').eq('id', pessoaId).maybeSingle(),
    supabase.from('app_settings').select('value').eq('key', 'agenda.reunioes').maybeSingle(),
  ]);
  if (perfil.error) throw new Error('Não deu para ler a sala de reunião.');
  const valor = (grade.data?.value ?? null) as { sala_padrao?: unknown } | null;
  return {
    propria: textoOuNulo(perfil.data?.sala_url),
    padrao: textoOuNulo(valor?.sala_padrao),
  };
}

/** Grava a sala de quem está logado. O RLS recusa a linha de qualquer outra pessoa. */
export async function salvarMinhaSala(
  usuarioId: string,
  url: string,
): Promise<{ ok: true } | { ok: false }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('profiles')
    .update({ sala_url: url })
    .eq('id', usuarioId)
    .select('id');
  return error || (data ?? []).length === 0 ? { ok: false } : { ok: true };
}
