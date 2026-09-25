/**
 * `workers wa --conectar` — O NÚMERO DA KOMUNE, DE PONTA A PONTA (RF-CON-01; ADR-06).
 *
 * Desde 14/09 o número da empresa fica SÓ na Cloud API (sem Coexistence), com
 * conexão direta na Meta, e o worker-wa roda na nuvem. Ligar um número assim
 * são seis passos espalhados por três painéis da Meta; este comando os faz em
 * sequência, uma vez, e sai. Cada passo imprime UMA linha: ✓ quando está
 * certo, ✗ com o que fazer quando não está.
 *
 *   1. Lê o número na Meta (nome, qualidade, status, plataforma).
 *   2. Registra na Cloud API — só se ainda não estiver registrado. O registro
 *      tem limite de 10 tentativas em 72 h por número (erro 133016), então o
 *      comando não tenta "por garantia": confere antes.
 *   3. Assina o app nos webhooks da conta (WABA).
 *   4. Aponta o webhook do app para a Edge Function `wa-webhook`.
 *   5. Grava o número no CRM (`public.wa_numero_configurar`).
 *   6. Manda os modelos para aprovação e sincroniza o status.
 *
 * IDEMPOTENTE: rodar de novo num número já conectado só confere e regrava.
 *
 * Nenhum segredo é impresso: nem o token, nem o segredo do app, nem o PIN, nem
 * o token de verificação do webhook.
 */
import { configurarNumero } from './ponte';
import { fraseDoResumo, sincronizarModelos } from './modelos-meta';

import type { ClienteDaGraph, FalhaDaGraph } from './graph';
import type { ResultadoDaSincronizacao } from './modelos-meta';
import type { ClienteDoBanco } from './ponte';
import type { WorkerEnv } from '../lib/env';
import type { Logger } from '../lib/log';

export interface ConfigDaConexao {
  phoneNumberId: string;
  wabaId: string;
  appId: string;
  appSecret: string;
  verifyToken: string;
  pin: string | null;
  callbackUrl: string;
}

/** Onde a Meta entrega: `WA_WEBHOOK_URL`, ou a Edge Function do próprio projeto. */
export function urlDoWebhook(
  env: Pick<WorkerEnv<'wa'>, 'WA_WEBHOOK_URL' | 'SUPABASE_URL'>,
): string {
  return env.WA_WEBHOOK_URL ?? `${env.SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/wa-webhook`;
}

/**
 * O que `--conectar` exige, conferido antes de tocar em qualquer coisa. O zod
 * não exige estas variáveis porque o laço normal do worker-wa não precisa
 * delas — e barrar a subida do envio por falta do segredo do app seria errado.
 */
export function configDaConexao(
  env: WorkerEnv<'wa'>,
): { ok: true; config: ConfigDaConexao } | { ok: false; faltando: string[] } {
  const faltando: string[] = [];
  if (!env.META_WA_BUSINESS_ACCOUNT_ID)
    faltando.push('META_WA_BUSINESS_ACCOUNT_ID — o id da conta do WhatsApp Business (WABA)');
  if (!env.META_APP_ID) faltando.push('META_APP_ID — o id do app da Meta (painel do app)');
  if (!env.META_WA_APP_SECRET)
    faltando.push('META_WA_APP_SECRET — o segredo do app (Configurações → Básico)');
  if (!env.META_WA_VERIFY_TOKEN)
    faltando.push(
      'META_WA_VERIFY_TOKEN — o token de verificação do webhook (o mesmo gravado na Edge Function wa-webhook)',
    );
  if (faltando.length > 0) return { ok: false, faltando };
  return {
    ok: true,
    config: {
      phoneNumberId: env.META_WA_PHONE_NUMBER_ID,
      wabaId: env.META_WA_BUSINESS_ACCOUNT_ID as string,
      appId: env.META_APP_ID as string,
      appSecret: env.META_WA_APP_SECRET as string,
      verifyToken: env.META_WA_VERIFY_TOKEN as string,
      pin: env.META_WA_PIN ?? null,
      callbackUrl: urlDoWebhook(env),
    },
  };
}

// ---------------------------------------------------------------------------
// O número na Meta
// ---------------------------------------------------------------------------

/**
 * Os campos de webhook de que a Fase 3 depende, além de `messages`.
 *
 * NÃO SE ASSINAM POR `subscribed_apps`. `POST /{waba}/subscribed_apps` assina a
 * APP na WABA e aceita só `override_callback_uri` e `verify_token`; QUAIS
 * campos ela recebe é configuração do painel do app (WhatsApp → Configuração →
 * Webhooks). `POST /{app-id}/subscriptions` aceita `fields`, e é por isso que
 * eles vão lá — mas a referência da Graph recusa esse endpoint para WhatsApp
 * (está escrito no passo 4, e o dublê reproduz a recusa). Quando a recusa
 * acontece, o `--conectar` diz, pelo nome, o que ficou faltando assinar à mão:
 * um passo verde que não assinou nada seria pior que passo nenhum.
 */
export const CAMPOS_DE_SAUDE_ESPERADOS = [
  'phone_number_quality_update',
  'account_update',
  'business_capability_update',
] as const;

/** Tudo o que o CRM precisa receber da Meta. */
export const CAMPOS_DO_WEBHOOK = ['messages', ...CAMPOS_DE_SAUDE_ESPERADOS] as const;

export const CAMPOS_DO_NUMERO =
  'display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status,platform_type,throughput';

export interface NumeroNaMeta {
  numero: string | null;
  nome: string | null;
  qualidade: string | null;
  verificacao: string | null;
  statusDoNome: string | null;
  /** CONNECTED, PENDING, DISCONNECTED, FLAGGED, RESTRICTED, BANNED… */
  status: string | null;
  /** CLOUD_API, ON_PREMISE, NOT_APPLICABLE (nunca registrado). */
  plataforma: string | null;
  vazao: string | null;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function paraNumeroNaMeta(json: Record<string, unknown>): NumeroNaMeta {
  const vazao =
    typeof json.throughput === 'object' && json.throughput !== null
      ? textoOuNulo((json.throughput as { level?: unknown }).level)
      : null;
  return {
    numero: textoOuNulo(json.display_phone_number),
    nome: textoOuNulo(json.verified_name),
    qualidade: textoOuNulo(json.quality_rating),
    verificacao: textoOuNulo(json.code_verification_status),
    statusDoNome: textoOuNulo(json.name_status),
    status: textoOuNulo(json.status)?.toUpperCase() ?? null,
    plataforma: textoOuNulo(json.platform_type)?.toUpperCase() ?? null,
    vazao,
  };
}

/** Status em que registrar de novo não resolve nada: é caso de WhatsApp Manager. */
const STATUS_SEM_REGISTRO = new Set(['BANNED', 'DELETED', 'MIGRATED']);

/**
 * Precisa registrar? Número que nunca foi registrado aparece como
 * `platform_type: NOT_APPLICABLE` e `status: PENDING`; um que caiu, como
 * `DISCONNECTED`. `CLOUD_API` + `CONNECTED` (ou FLAGGED/RESTRICTED, que são
 * qualidade, não conexão) já está registrado.
 */
export function precisaRegistrar(numero: NumeroNaMeta): boolean {
  if (numero.plataforma !== 'CLOUD_API') return true;
  return numero.status === 'PENDING' || numero.status === 'DISCONNECTED';
}

// ---------------------------------------------------------------------------
// O comando
// ---------------------------------------------------------------------------

export interface ContextoDaConexao {
  cliente: ClienteDoBanco;
  graph: ClienteDaGraph;
  logger: Logger;
  config: ConfigDaConexao;
  /** Uma linha para a pessoa que rodou o comando. Padrão: stdout. */
  escrever?: (linha: string) => void;
  /** Substituível no teste. Padrão: `sincronizarModelos`. */
  sincronizar?: () => Promise<ResultadoDaSincronizacao>;
}

const TOTAL = 6;

function descrever(falha: FalhaDaGraph): string {
  return `${falha.codigo}${falha.subcodigo ? `/${falha.subcodigo}` : ''} — ${falha.mensagem}`;
}

function resumoDoNumero(n: NumeroNaMeta): string {
  return [
    n.numero ?? '(sem número)',
    n.nome ? `"${n.nome}"` : '(sem nome verificado)',
    `qualidade ${n.qualidade ?? '?'}`,
    `${n.plataforma ?? '?'}/${n.status ?? '?'}`,
  ].join(' · ');
}

/** Devolve o código de saída: 0 se todos os passos deram ✓, 1 se algum deu ✗. */
export async function conectarNumero(ctx: ContextoDaConexao): Promise<number> {
  const escrever = ctx.escrever ?? ((linha: string) => process.stdout.write(`${linha}\n`));
  const { config, graph } = ctx;
  let falhou = false;
  const ok = (passo: number, texto: string) => escrever(`✓ ${passo}/${TOTAL} ${texto}`);
  const nao = (passo: number, texto: string, oQueFazer: string) => {
    falhou = true;
    escrever(`✗ ${passo}/${TOTAL} ${texto}\n    → ${oQueFazer}`);
  };

  // 1 · O número na Meta.
  const lido = await graph.ler(config.phoneNumberId, { fields: CAMPOS_DO_NUMERO });
  if (!lido.ok) {
    nao(
      1,
      `Não consegui ler o número ${config.phoneNumberId} na Meta (${descrever(lido)}).`,
      lido.codigo === 'token_meta_invalido'
        ? 'O META_WA_ACCESS_TOKEN está vencido ou errado: gere um token do usuário de sistema com whatsapp_business_messaging e whatsapp_business_management.'
        : 'Confira META_WA_PHONE_NUMBER_ID (WhatsApp Manager → Números de telefone) e se o token tem acesso a essa conta.',
    );
    return 1;
  }
  let numero = paraNumeroNaMeta(lido.json);
  ok(1, `Número na Meta: ${resumoDoNumero(numero)}.`);

  // 2 · O registro na Cloud API.
  if (numero.status !== null && STATUS_SEM_REGISTRO.has(numero.status)) {
    nao(
      2,
      `O número está ${numero.status} na Meta: registrar de novo não resolve.`,
      'Abra o WhatsApp Manager e resolva a situação do número antes de conectar.',
    );
  } else if (!precisaRegistrar(numero)) {
    ok(2, `Já registrado na Cloud API (${numero.plataforma}/${numero.status}): nada a fazer.`);
  } else if (config.pin === null) {
    nao(
      2,
      `O número não está registrado na Cloud API (${numero.plataforma ?? '?'}/${numero.status ?? '?'}) e META_WA_PIN está vazia.`,
      'Defina META_WA_PIN com um PIN de 6 dígitos. É a verificação em duas etapas do número: se ele já tem PIN, use o mesmo; se não tem, este vira o PIN.',
    );
  } else if (!/^\d{6}$/.test(config.pin)) {
    nao(2, 'META_WA_PIN não tem 6 dígitos.', 'O PIN do registro é exatamente 6 dígitos numéricos.');
  } else if (numero.verificacao === 'NOT_VERIFIED') {
    nao(
      2,
      'O número ainda não foi verificado por código (code_verification_status NOT_VERIFIED).',
      'Verifique o número no WhatsApp Manager (SMS ou ligação) e rode de novo. Tentar registrar antes gasta uma das 10 tentativas de 72 h.',
    );
  } else {
    const registro = await graph.publicar(`${config.phoneNumberId}/register`, {
      messaging_product: 'whatsapp',
      pin: config.pin,
    });
    if (registro.ok) {
      const relido = await graph.ler(config.phoneNumberId, { fields: CAMPOS_DO_NUMERO });
      if (relido.ok) numero = paraNumeroNaMeta(relido.json);
      ok(2, `Registrado na Cloud API: agora ${numero.plataforma ?? '?'}/${numero.status ?? '?'}.`);
    } else {
      const oQueFazer =
        registro.codigo === '133005'
          ? 'PIN errado: o número já tem verificação em duas etapas. Use o PIN atual (ou redefina no WhatsApp Manager).'
          : registro.codigo === '133016'
            ? 'Tentativas demais de registro para este número: a Meta bloqueia por até 72 h. Não rode de novo antes disso.'
            : registro.codigo === '133006'
              ? 'O número precisa ser verificado por código antes do registro (WhatsApp Manager).'
              : 'Leia o erro acima; se o número estiver no app WhatsApp Business, ele precisa sair do app antes de ir só para a Cloud API.';
      nao(2, `A Meta recusou o registro (${descrever(registro)}).`, oQueFazer);
    }
  }

  // 3 · O app assinado nos webhooks da conta.
  const assinatura = await graph.publicar(`${config.wabaId}/subscribed_apps`);
  if (assinatura.ok) {
    ok(3, `App assinado nos webhooks da conta ${config.wabaId}.`);
  } else {
    nao(
      3,
      `Não consegui assinar o app nos webhooks da conta (${descrever(assinatura)}).`,
      'Confira META_WA_BUSINESS_ACCOUNT_ID e se o usuário de sistema tem whatsapp_business_management nessa conta.',
    );
  }

  // 4 · O webhook do app apontando para a Edge Function.
  const doApp = await graph.publicar(
    `${config.appId}/subscriptions`,
    {
      access_token: `${config.appId}|${config.appSecret}`,
      object: 'whatsapp_business_account',
      callback_url: config.callbackUrl,
      verify_token: config.verifyToken,
      fields: CAMPOS_DO_WEBHOOK.join(','),
    },
    { formulario: true, semBearer: true },
  );
  if (doApp.ok) {
    ok(4, `Webhook do app apontado para ${config.callbackUrl} (campos ${CAMPOS_DO_WEBHOOK.join(', ')}).`);
  } else {
    // A referência da Graph API diz que `/{app-id}/subscriptions` não aceita
    // WhatsApp ("configure pelo painel do app"). O caminho oficial que sobra
    // por API é o override de callback na própria WABA.
    const override = await graph.publicar(`${config.wabaId}/subscribed_apps`, {
      override_callback_uri: config.callbackUrl,
      verify_token: config.verifyToken,
    });
    if (override.ok) {
      // O override aponta o ENDEREÇO, e nada mais: quais campos chegam nele
      // continua sendo do painel. Dizer só "confira o messages" deixaria o CRM
      // cego para restrição, banimento e mudança de tier sem ninguém perceber
      // — e a cegueira só aparece no dia em que a Meta cortar.
      ok(
        4,
        `Webhook da conta apontado para ${config.callbackUrl} por override na WABA (a assinatura pelo app foi recusada: ${doApp.codigo}). ` +
          `FALTA ASSINAR À MÃO, no painel do app (WhatsApp → Configuração → Webhooks): ${CAMPOS_DO_WEBHOOK.join(', ')}. ` +
          `Sem ${CAMPOS_DE_SAUDE_ESPERADOS.join(', ')} o CRM não fica sabendo de restrição, banimento nem mudança de tier, e o teto da Meta continua nulo.`,
      );
    } else {
      nao(
        4,
        `A Meta não aceitou o webhook em ${config.callbackUrl} (app: ${descrever(doApp)}; override: ${descrever(override)}).`,
        'A Meta faz um GET de verificação na hora: a Edge Function wa-webhook precisa estar publicada e com o segredo META_WA_VERIFY_TOKEN (ou meta_wa_verify_token no Vault) igual ao deste .env. Se a URL não for a do projeto, defina WA_WEBHOOK_URL.',
      );
    }
  }

  // 5 · O número no CRM.
  if (numero.numero === null) {
    nao(
      5,
      'A Meta não devolveu o número (display_phone_number): não há o que gravar no CRM.',
      'Rode de novo depois que o passo 1 mostrar o número.',
    );
  } else {
    try {
      const gravado = await configurarNumero(ctx.cliente, {
        numero: numero.numero,
        phoneNumberId: config.phoneNumberId,
        wabaId: config.wabaId,
        nomeExibicao: numero.nome,
        qualidade: numero.qualidade,
      });
      if (gravado.ok) {
        ok(
          5,
          `Número gravado no CRM: ${gravado.numeroPadrao ?? numero.numero}${gravado.aquecimentoRecomecou ? ' (número novo: o aquecimento do teto de primeiros contatos recomeça hoje)' : ''}.`,
        );
      } else {
        nao(5, 'O banco não confirmou a gravação do número.', 'Veja o log do banco.');
      }
    } catch (erro) {
      nao(
        5,
        `O banco recusou a gravação do número (${erro instanceof Error ? erro.message : String(erro)}).`,
        'Confira se a migração 20260914100000 está aplicada no projeto e se SUPABASE_SERVICE_ROLE_KEY é a do mesmo projeto.',
      );
    }
  }

  // 6 · Os modelos.
  const sincronizar =
    ctx.sincronizar ??
    (() =>
      sincronizarModelos({
        cliente: ctx.cliente,
        graph,
        wabaId: config.wabaId,
        logger: ctx.logger,
      }));
  try {
    const r = await sincronizar();
    if (!r.ok) {
      nao(
        6,
        `Sincronização de modelos parou: ${r.erro} (até ali: ${fraseDoResumo(r.resumo)}).`,
        'Corrija o erro e rode `workers wa --sincronizar-modelos`; o que já foi enviado não é enviado de novo.',
      );
    } else if (r.resumo.falhas > 0) {
      nao(
        6,
        `Modelos: ${fraseDoResumo(r.resumo)}.`,
        'Os que falharam têm o motivo gravado no modelo, no CRM: corrija o texto e rode `workers wa --sincronizar-modelos`.',
      );
    } else {
      ok(
        6,
        `Modelos: ${fraseDoResumo(r.resumo)}.${r.resumo.pendentes > 0 ? ' A Meta costuma revisar em minutos; o worker-wa atualiza o status a cada 30 min.' : ''}`,
      );
    }
  } catch (erro) {
    nao(
      6,
      `Sincronização de modelos quebrou (${erro instanceof Error ? erro.message : String(erro)}).`,
      'Rode `workers wa --sincronizar-modelos` depois de corrigir.',
    );
  }

  escrever(
    falhou
      ? 'Conexão incompleta: resolva os ✗ acima e rode `workers wa --conectar` de novo (é seguro repetir).'
      : 'Número conectado de ponta a ponta.',
  );
  return falhou ? 1 : 0;
}
