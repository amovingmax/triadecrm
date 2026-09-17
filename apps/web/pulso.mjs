import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// `app.ia_enfileirar_pulso` é do schema app (só service_role), e o PostgREST só
// alcança `public` — então vai pela casca pública se existir.
const r = await db.rpc('ia_enfileirar_pulso', {});
console.log('enfileirar:', JSON.stringify(r.error ?? r.data));
