/**
 * Leituras no banco LOCAL para os roteiros de captura e medição.
 *
 * Ficha, lote e conversa têm ids que mudam de máquina para máquina; fixá-los no
 * roteiro faz ele quebrar no banco do próximo. Aqui só se LÊ, e só no container da
 * stack local (`supabase start`), nunca no projeto remoto.
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_komune-crm';

/** Roda uma consulta no Postgres local e devolve as linhas (uma coluna, texto). */
export function consultar(sql) {
  const saida = execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return saida.trim().split('\n').filter(Boolean);
}

/** Duas fichas com negócio, o lote mais recente e a conversa mais recente de parceiro. */
export function idsDeTeste() {
  return {
    fichas: consultar(
      'select o.id from public.organizations o join public.deals d on d.organization_id = o.id ' +
        'where o.deleted_at is null and o.phone_e164 is not null ' +
        'group by o.id order by count(d.id) desc, o.id limit 2;',
    ),
    lotes: consultar(
      'select id from public.call_batches where deleted_at is null order by created_at desc limit 1;',
    ),
    conversas: consultar(
      'select organization_id from public.conversations where organization_id is not null ' +
        'order by last_message_at desc nulls last limit 1;',
    ),
  };
}
