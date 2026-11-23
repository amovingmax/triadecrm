// =============================================================================
// TRIADE — `voip-push`: a ligação pelo WhatsApp toca na tela de chamada do iPhone.
//
// Quem chama é o banco (gatilho `wa_chamadas_cutucar_aparelhos`, pelo pg_net), a cada
// vez que uma ligação recebida entra em "tocando" ou sai dele. O pedido traz só o id da
// ligação; O QUE mandar e PARA QUEM sai do banco (`public.voip_a_enviar`), pelo estado
// da ligação naquele instante, e cada aparelho recebe cada aviso uma vez só. Por isso a
// função não precisa de segredo de quem chama (verify_jwt = false): repetir o pedido,
// ou mandar o id de uma ligação qualquer, não faz tocar nada que já não devesse tocar.
//
// A Apple: chave de avisos da conta (`apns_chave_p8`, `apns_chave_id`,
// `apns_equipe_id`, no ambiente ou no Vault) e o tópico `app.triade.ios.voip`.
// Guia: docs/operacao/ligacao-whatsapp.md, "A ligação no app".
// =============================================================================

import {
  enviarAvisoDeChamada,
  jwtEmUso,
  topicoDeVoz,
  type AvisoDeChamada,
  type ResultadoDaApple,
} from '../_compartilhado/apns.ts';
import { erro, exigirMetodo, json, preflight, registrar } from '../_compartilhado/http.ts';
import { rpcServico } from '../_compartilhado/postgrest.ts';
import { segredo, SegredoAusente } from '../_compartilhado/segredos.ts';

const ID_DO_APP = Deno.env.get('TRIADE_APP_ID_IOS') ?? 'app.triade.ios';
const URL_BASE = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Envio = {
  voip_token: string;
  sandbox: boolean;
  evento: 'tocar' | 'parar';
  convite?: string;
  empresa_nome?: string;
};
type AEnviar = {
  chamada_id?: string;
  quem?: string;
  empresa?: string;
  caminho?: string | null;
  motivo?: string | null;
  envios: Envio[];
};

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return metodo;

  let chamadaId = '';
  try {
    const corpo = (await req.json()) as { chamada_id?: unknown };
    chamadaId = typeof corpo.chamada_id === 'string' ? corpo.chamada_id : '';
  } catch (e) {
    return erro(400, 'json_invalido', 'O pedido não é um JSON válido.', e);
  }
  if (!UUID.test(chamadaId)) {
    return erro(400, 'pedido_invalido', 'Pedido sem a ligação.');
  }

  let aEnviar: AEnviar;
  try {
    aEnviar = await rpcServico<AEnviar>('voip_a_enviar', { p_chamada_id: chamadaId });
  } catch (e) {
    return erro(500, 'falha_ao_ler', 'Não consegui ler a ligação.', e, { chamada: chamadaId });
  }
  const envios = aEnviar.envios ?? [];
  if (envios.length === 0) return json({ ok: true, enviados: 0 });

  let jwt: string;
  try {
    const [p8, chaveId, equipeId] = await Promise.all([
      segredo('apns_chave_p8'),
      segredo('apns_chave_id'),
      segredo('apns_equipe_id'),
    ]);
    jwt = await jwtEmUso({ p8, chaveId: chaveId.trim(), equipeId: equipeId.trim() });
  } catch (e) {
    // Sem a chave nada toca: fica anotado em cada envio, para a gestão ver o porquê.
    await anotar(
      chamadaId,
      envios.map((en) => ({ envio: en, r: { status: 0, motivo: 'sem_chave_da_apple' } })),
    );
    if (e instanceof SegredoAusente) {
      return erro(503, 'integracao_nao_configurada', 'A chave de avisos da Apple não está configurada.', e, {
        segredo_faltando: e.nome,
      });
    }
    return erro(500, 'chave_invalida', 'A chave de avisos da Apple não pôde ser lida.', e);
  }

  const topico = topicoDeVoz(ID_DO_APP);
  const resultados = await Promise.all(
    envios.map(async (en) => {
      const aviso: AvisoDeChamada =
        en.evento === 'tocar'
          ? {
              evento: 'tocar',
              chamada: chamadaId,
              quem: aEnviar.quem ?? 'Cliente',
              empresa: aEnviar.empresa ?? 'imova',
              empresaNome: en.empresa_nome ?? 'Imova',
              caminho: aEnviar.caminho ?? null,
              convite: en.convite ?? '',
              funcao: `${URL_BASE}/functions/v1/wa-chamada-app`,
            }
          : { evento: 'parar', chamada: chamadaId, motivo: aEnviar.motivo ?? null };
      const r = await enviarAvisoDeChamada({ token: en.voip_token, sandbox: en.sandbox, topico, jwt, aviso });
      return { envio: en, r };
    }),
  );
  await anotar(chamadaId, resultados);

  const recusados = resultados.filter((x) => x.r.status !== 200);
  if (recusados.length > 0) {
    registrar('aviso', {
      funcao: 'voip-push',
      chamada: chamadaId,
      recusados: recusados.map((x) => ({ evento: x.envio.evento, status: x.r.status, motivo: x.r.motivo })),
    });
  }
  return json({ ok: true, enviados: resultados.length - recusados.length, recusados: recusados.length });
});

async function anotar(chamadaId: string, lista: { envio: Envio; r: ResultadoDaApple }[]): Promise<void> {
  try {
    await rpcServico('voip_resultado', {
      p_resultados: lista.map(({ envio, r }) => ({
        chamada_id: chamadaId,
        voip_token: envio.voip_token,
        evento: envio.evento,
        status: r.status,
        motivo: r.motivo,
      })),
    });
  } catch (e) {
    registrar('erro', { funcao: 'voip-push', chamada: chamadaId, anotar: (e as Error).message });
  }
}
