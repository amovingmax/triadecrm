import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r = await db.from('supplier_candidates').select('source_id, phone_e164, instagram_handle, rating, name').limit(500);
const fontes = await db.from('sources').select('id, slug, name');
const nome = new Map((fontes.data ?? []).map((f) => [f.id, f.slug]));
const por = {};
for (const c of r.data ?? []) {
  const k = nome.get(c.source_id) ?? '?';
  por[k] = por[k] ?? { total: 0, tel: 0, insta: 0, nota: 0 };
  por[k].total++;
  if (c.phone_e164) por[k].tel++;
  if (c.instagram_handle) por[k].insta++;
  if (c.rating !== null) por[k].nota++;
}
for (const [k, v] of Object.entries(por)) console.log(`${k.padEnd(20)} total ${String(v.total).padStart(3)} | telefone ${v.tel} | instagram ${v.insta} | nota ${v.nota}`);
