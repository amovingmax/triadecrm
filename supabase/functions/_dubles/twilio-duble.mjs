#!/usr/bin/env node
// =============================================================================
// DUBLÊ DO TWILIO — não vai para produção, não é deploy, não liga para ninguém.
//
// Faz o papel do Twilio nas duas portas de voz do Triade, com a assinatura
// `X-Twilio-Signature` de verdade, para que `voz-twiml` e `voz-status` sejam
// testadas de ponta a ponta sem conta, sem número e sem custo.
//
// Uso:
//   node supabase/functions/_dubles/twilio-duble.mjs twiml  <ligacao> <user_id> [perna-mãe]
//   node supabase/functions/_dubles/twilio-duble.mjs estado <ligacao> <perna-mãe> <estado> [duração] [perna-filha]
//   node supabase/functions/_dubles/twilio-duble.mjs falso  <ligacao> <perna-mãe> <estado>
//
// `estado` é o CallStatus do Twilio: initiated | ringing | in-progress |
// completed | busy | no-answer | failed | canceled.
// `falso` manda o mesmo aviso com a assinatura errada: tem de voltar 403.
//
// Ambiente (os mesmos valores que as funções leem; nunca versionados):
//   TWILIO_AUTH_TOKEN            — o segredo que assina
//   TWILIO_TWIML_URL             — padrão http://127.0.0.1:54321/functions/v1/voz-twiml
//   TWILIO_STATUS_CALLBACK_URL   — padrão http://127.0.0.1:54321/functions/v1/voz-status
// =============================================================================

import { createHmac } from 'node:crypto';

const TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';
const URL_TWIML = process.env.TWILIO_TWIML_URL ?? 'http://127.0.0.1:54321/functions/v1/voz-twiml';
const URL_ESTADO =
  process.env.TWILIO_STATUS_CALLBACK_URL ?? 'http://127.0.0.1:54321/functions/v1/voz-status';

function assinar(url, parametros) {
  const base = Object.keys(parametros)
    .sort()
    .reduce((b, nome) => b + nome + parametros[nome], url);
  return createHmac('sha1', TOKEN).update(base).digest('base64');
}

async function enviar(url, parametros, assinatura) {
  const resposta = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': assinatura,
    },
    body: new URLSearchParams(parametros).toString(),
  });
  console.log(resposta.status, (await resposta.text()) || '(sem corpo)');
  return resposta.status;
}

const [comando, ...args] = process.argv.slice(2);
if (!TOKEN) {
  console.error('Defina TWILIO_AUTH_TOKEN (o mesmo valor de teste que as funções leem).');
  process.exit(2);
}

if (comando === 'twiml') {
  const [ligacao, userId, perna = 'CAduble' + Date.now()] = args;
  const parametros = {
    AccountSid: 'ACduble',
    ApplicationSid: 'APduble',
    CallSid: perna,
    CallStatus: 'ringing',
    Direction: 'inbound',
    From: `client:crm_${userId}`,
    Caller: `client:crm_${userId}`,
    To: '',
    ligacao,
  };
  console.log('perna-mãe:', perna);
  await enviar(URL_TWIML, parametros, assinar(URL_TWIML, parametros));
} else if (comando === 'estado' || comando === 'falso') {
  const [ligacao, pernaMae, estado, duracao, pernaFilha = 'CAfilha' + pernaMae.slice(-8)] = args;
  const url = `${URL_ESTADO}?ligacao=${ligacao}`;
  const parametros = {
    AccountSid: 'ACduble',
    CallSid: pernaFilha,
    ParentCallSid: pernaMae,
    CallStatus: estado,
    Timestamp: new Date().toUTCString(),
    ...(duracao ? { CallDuration: String(duracao) } : {}),
  };
  const assinatura =
    comando === 'falso' ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' : assinar(url, parametros);
  await enviar(url, parametros, assinatura);
} else {
  console.error('Comandos: twiml | estado | falso. Veja o cabeçalho deste arquivo.');
  process.exit(2);
}
