import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r = await db.from('message_templates').select('*').eq('template_code', 'GEN-ABR-LIVRE').maybeSingle();
const t = r.data;
if (!t) { console.log(r.error?.message); process.exit(0); }
console.log('colunas:', Object.keys(t).join(', '));
console.log('\ncorpo:', JSON.stringify(t.body));
console.log('categoria:', t.category, '| meta_status:', t.meta_status, '| nome na meta:', t.meta_template_name ?? t.meta_name ?? '?');
console.log('variaveis:', JSON.stringify(t.variables));
