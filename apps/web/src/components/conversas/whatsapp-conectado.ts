import { createClient } from '@/lib/supabase/server';

/**
 * O número da KOMUNE está conectado à Cloud API? (`whatsapp.envio.numero_padrao`,
 * gravado por `public.wa_numero_configurar`, migração 20260914100000.)
 *
 * Lido no servidor para a ficha decidir, antes de desenhar, se o botão de
 * WhatsApp abre a conversa no CRM ou o `wa.me`. Erro de leitura conta como "não
 * conectado": o pior que acontece é oferecer o caminho antigo.
 */
export async function whatsappConectado(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'whatsapp.envio')
    .maybeSingle();
  const valor = data?.value;
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const numero = (valor as Record<string, unknown>)['numero_padrao'];
  return typeof numero === 'string' && numero.trim() !== '';
}
