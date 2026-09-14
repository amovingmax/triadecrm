#!/usr/bin/env node
// =============================================================================
// DUBLÊ DA GRAPH API DA META — não vai para produção, não é deploy.
//
// Não existe credencial da Meta neste repositório, e não é para existir. Este
// arquivo é o outro lado do fio enquanto o outro lado não pode ser chamado:
// responde como a Cloud API responde, INCLUSIVE COM OS ERROS DELA, para que o
// worker-wa seja exercitado contra um interlocutor de verdade — com token
// conferido, formato conferido e os códigos que mandam o worker desistir ou
// tentar de novo.
//
// A pasta começa com "_": a CLI do Supabase não a trata como função e ela
// nunca sobe para a nuvem.
//
// O que implementa (Cloud API; aceita qualquer versão /vNN.N/ no caminho — v26.0 é a padrão do worker):
//   POST /vNN.N/<phone_number_id>/messages   envio de texto, template e áudio
//   GET  /vNN.N/<media_id>                   metadados da mídia (url temporária)
//   GET  /midia/<media_id>                   os bytes (a url acima aponta para cá)
//   GET  /vNN.N/<phone_number_id>            dados do número (nome, qualidade, status)
//   POST /vNN.N/<phone_number_id>/register   registro do número na Cloud API (PIN)
//   GET  /vNN.N/<waba_id>/message_templates  modelos da conta (paginado; filtro name)
//   POST /vNN.N/<waba_id>/message_templates  cria modelo (parameter_format NAMED)
//   POST /vNN.N/<waba_id>/subscribed_apps    assina o app nos webhooks da conta
//   POST /vNN.N/<app_id>/subscriptions       webhook do app (token do app no corpo)
//   GET  /_enviadas                          o que o dublê recebeu (só para teste)
//   GET  /_conta                             modelos, números e assinaturas (só teste)
//   POST /_cenario                           ajusta números e as recusas de webhook
//                                            ({numeros, recusarAssinaturaDoApp, recusarOverrideDaWaba})
//   POST /_zerar                             esquece tudo (só para teste)
//
// OS NÚMEROS DO DUBLÊ
//   1234567890  já registrado: platform_type CLOUD_API, status CONNECTED
//   5550001     conectado mas nunca registrado: PENDING / NOT_APPLICABLE
//   PIN "000000" no registro devolve 133005 (PIN errado).
//
// OS MODELOS DO DUBLÊ imitam as recusas de criação que o worker precisa ler:
//   nome+idioma repetidos         → 100 / subcode 2388024 (já existe)
//   corpo começa/termina com {{x}} → 100 / subcode 2388299
//   nome começando com "rejeitar_" → criado com status REJECTED
//   nome começando com "aprovar_"  → criado com status APPROVED
//
// COMO SE PEDE UM ERRO
// -----------------------------------------------------------------------------
// Sem truque de header: o dublê olha o NÚMERO do destinatário, porque é assim
// que um teste fica legível ("mandar para +5584900000131047 devolve 131047").
// Um número que termine em `-<código>` conhecido dispara aquele erro:
//
//   ...131047  → fora da janela de 24 h (re-engagement)      → não retentar
//   ...131049  → limite de marketing por usuário             → retentar depois
//   ...131026  → número não tem WhatsApp                     → não retentar
//   ...132001  → template não existe / não aprovado          → não retentar
//   ...131056  → pares em excesso (rate limit)               → retentar
//   ...80007   → rate limit da aplicação                     → retentar
//   ...500     → erro interno da Meta (5xx cru)              → retentar
//
// Token errado devolve 190 (OAuthException) em qualquer rota, como a Meta faz.
//
// Uso:
//   node supabase/functions/_dubles/meta-graph-duble.mjs servir [porta]
//
// Variáveis:
//   META_WA_ACCESS_TOKEN  — o token que o dublê exige (padrão: "token-de-teste")
//   META_WA_APP_SECRET    — o segredo do app em <app_id>|<segredo> (padrão: "segredo-de-teste")
// =============================================================================

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const TOKEN = process.env.META_WA_ACCESS_TOKEN ?? 'token-de-teste';
const SEGREDO_DO_APP = process.env.META_WA_APP_SECRET ?? 'segredo-de-teste';

/** Códigos que o dublê sabe simular, pelo sufixo do número do destinatário. */
const ERROS = {
  131047: {
    http: 400,
    message:
      'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
    type: 'OAuthException',
    subcode: 2018278,
    details: 'Re-engagement message',
  },
  131049: {
    http: 400,
    message: 'This message was not delivered to maintain healthy ecosystem engagement.',
    type: 'OAuthException',
    subcode: 2593082,
    details: 'Meta chose not to deliver this marketing message',
  },
  131026: {
    http: 400,
    message: 'Message Undeliverable.',
    type: 'OAuthException',
    subcode: 2655012,
    details: 'Receiver is incapable of receiving this message',
  },
  132001: {
    http: 400,
    message: 'Template name does not exist in the translation',
    type: 'OAuthException',
    subcode: 2494010,
    details: 'template name (x) does not exist in pt_BR',
  },
  131056: {
    http: 400,
    message: '(#131056) (Business Account, Consumer Account) pair rate limit hit',
    type: 'OAuthException',
    subcode: 2494055,
    details: 'Too many messages sent from this phone number to the same recipient',
  },
  80007: {
    http: 400,
    message: '(#80007) Rate limit issues',
    type: 'OAuthException',
    subcode: 2494055,
    details: 'Business Account rate limit hit',
  },
};

// O "banco" do dublê.
const enviadas = [];
const midias = new Map();

/** Estado da conta: números, modelos e assinaturas. `_zerar` volta a isto. */
function contaInicial() {
  return {
    numeros: {
      1234567890: {
        id: '1234567890',
        display_phone_number: '+55 84 99999-0000',
        verified_name: 'Komune',
        quality_rating: 'GREEN',
        code_verification_status: 'VERIFIED',
        name_status: 'APPROVED',
        status: 'CONNECTED',
        platform_type: 'CLOUD_API',
        throughput: { level: 'STANDARD' },
      },
      5550001: {
        id: '5550001',
        display_phone_number: '+55 84 98888-0001',
        verified_name: 'Komune',
        quality_rating: 'UNKNOWN',
        code_verification_status: 'VERIFIED',
        name_status: 'APPROVED',
        status: 'PENDING',
        platform_type: 'NOT_APPLICABLE',
        throughput: { level: 'NOT_APPLICABLE' },
      },
    },
    /** Por WABA: lista de modelos. */
    modelos: {},
    registros: [],
    assinaturasDaWaba: [],
    assinaturasDoApp: [],
    recusarAssinaturaDoApp: false,
    recusarOverrideDaWaba: false,
  };
}
let conta = contaInicial();
let proximoIdDeModelo = 900000;
midias.set('midia-de-teste', {
  mime_type: 'audio/ogg; codecs=opus',
  bytes: Buffer.from('OggS' + '0'.repeat(60), 'utf8'),
});

function responder(res, status, corpo, tipo = 'application/json; charset=utf-8') {
  const texto = typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo);
  res.writeHead(status, { 'Content-Type': tipo });
  res.end(texto);
}

function erroDaGraph(res, código) {
  const e = ERROS[código];
  responder(res, e.http, {
    error: {
      message: e.message,
      type: e.type,
      code: Number(código),
      error_data: { messaging_product: 'whatsapp', details: e.details },
      error_subcode: e.subcode,
      fbtrace_id: 'DUBLE' + randomUUID().slice(0, 8),
    },
  });
}

function semToken(res) {
  responder(res, 401, {
    error: {
      message: 'Invalid OAuth access token - Cannot parse access token',
      type: 'OAuthException',
      code: 190,
      fbtrace_id: 'DUBLE' + randomUUID().slice(0, 8),
    },
  });
}

function erroDeParametro(res, message, subcode, userTitle, userMsg) {
  responder(res, 400, {
    error: {
      message,
      type: 'OAuthException',
      code: 100,
      error_subcode: subcode,
      is_transient: false,
      error_user_title: userTitle,
      error_user_msg: userMsg,
      fbtrace_id: 'DUBLE' + randomUUID().slice(0, 8),
    },
  });
}

/** Lê o corpo inteiro: JSON ou formulário, conforme o Content-Type. */
function lerCorpo(req) {
  return new Promise((resolva) => {
    let cru = '';
    req.on('data', (p) => {
      cru += p;
    });
    req.on('end', () => {
      const tipo = String(req.headers['content-type'] ?? '');
      if (tipo.includes('application/x-www-form-urlencoded')) {
        return resolva(Object.fromEntries(new URLSearchParams(cru)));
      }
      try {
        resolva(JSON.parse(cru || '{}'));
      } catch {
        resolva(null);
      }
    });
  });
}

/** Os campos pedidos em `fields=` (sem `fields`, a Meta devolve só o id). */
function filtrarCampos(objeto, fields) {
  if (!fields) return { id: objeto.id };
  const saida = {};
  for (const campo of fields.split(',').map((c) => c.trim())) {
    if (campo in objeto) saida[campo] = objeto[campo];
  }
  saida.id = objeto.id;
  return saida;
}

function tokenOk(req) {
  const cabecalho = req.headers.authorization ?? '';
  return cabecalho === `Bearer ${TOKEN}`;
}

/** O sufixo do número escolhe o erro. `+5584900000131047` → 131047. */
function erroPedidoPeloNumero(numero) {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  for (const código of Object.keys(ERROS)) {
    if (digitos.endsWith(código)) return Number(código);
  }
  if (digitos.endsWith('500')) return 500;
  return null;
}

function servir(porta) {
  const servidor = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const caminho = url.pathname;

    if (req.method === 'GET' && caminho === '/_enviadas') {
      return responder(res, 200, { enviadas });
    }
    if (req.method === 'POST' && caminho === '/_zerar') {
      enviadas.length = 0;
      conta = contaInicial();
      return responder(res, 200, { ok: true });
    }
    if (req.method === 'GET' && caminho === '/_conta') {
      return responder(res, 200, conta);
    }
    if (req.method === 'POST' && caminho === '/_cenario') {
      lerCorpo(req).then((corpo) => {
        if (corpo?.numeros) {
          for (const [id, dados] of Object.entries(corpo.numeros)) {
            conta.numeros[id] = { ...(conta.numeros[id] ?? { id }), ...dados, id };
          }
        }
        if (typeof corpo?.recusarAssinaturaDoApp === 'boolean') {
          conta.recusarAssinaturaDoApp = corpo.recusarAssinaturaDoApp;
        }
        if (typeof corpo?.recusarOverrideDaWaba === 'boolean') {
          conta.recusarOverrideDaWaba = corpo.recusarOverrideDaWaba;
        }
        responder(res, 200, { ok: true });
      });
      return undefined;
    }

    // POST /vNN.N/<app_id>/subscriptions — o token do APP vai no corpo, não no
    // cabeçalho. Sem bearer do usuário de sistema.
    const assinaturaDoApp = caminho.match(/^\/v\d+\.\d+\/([^/]+)\/subscriptions$/);
    if (req.method === 'POST' && assinaturaDoApp) {
      lerCorpo(req).then((corpo) => {
        const appId = assinaturaDoApp[1];
        if (corpo?.access_token !== `${appId}|${SEGREDO_DO_APP}`) return semToken(res);
        if (conta.recusarAssinaturaDoApp) {
          return responder(res, 400, {
            error: {
              message:
                '(#100) Webhooks for WhatsApp is not supported. WhatsApp webhooks must be configured using the App Dashboard.',
              type: 'OAuthException',
              code: 100,
              fbtrace_id: 'DUBLE' + randomUUID().slice(0, 8),
            },
          });
        }
        if (!corpo.object || !corpo.callback_url || !corpo.verify_token) {
          return responder(res, 400, {
            error: { message: '(#100) Missing parameter', type: 'OAuthException', code: 100 },
          });
        }
        conta.assinaturasDoApp.push({
          app_id: appId,
          object: corpo.object,
          callback_url: corpo.callback_url,
          fields: corpo.fields,
          // O verify_token não é guardado: segredo não vai para `_conta`.
        });
        return responder(res, 200, { success: true });
      });
      return undefined;
    }

    // Os bytes da mídia. É para cá que a `url` dos metadados aponta, e a Meta
    // exige o mesmo bearer aqui — motivo pelo qual o worker não pode
    // simplesmente repassar essa URL para outro processo.
    const bytesDeMidia = caminho.match(/^\/midia\/(.+)$/);
    if (req.method === 'GET' && bytesDeMidia) {
      if (!tokenOk(req)) return semToken(res);
      const m = midias.get(bytesDeMidia[1]);
      if (!m)
        return responder(res, 404, { error: { message: 'Unsupported get request.', code: 100 } });
      return responder(res, 200, m.bytes, m.mime_type);
    }

    if (!tokenOk(req)) return semToken(res);

    // POST /vNN.N/<phone_number_id>/messages
    const envio = caminho.match(/^\/v\d+\.\d+\/([^/]+)\/messages$/);
    if (req.method === 'POST' && envio) {
      let cru = '';
      req.on('data', (p) => {
        cru += p;
      });
      req.on('end', () => {
        let corpo;
        try {
          corpo = JSON.parse(cru || '{}');
        } catch {
          return responder(res, 400, {
            error: { message: 'Malformed JSON', type: 'GraphMethodException', code: 100 },
          });
        }
        if (corpo.messaging_product !== 'whatsapp') {
          return responder(res, 400, {
            error: {
              message: '(#100) Param messaging_product must be whatsapp',
              type: 'OAuthException',
              code: 100,
            },
          });
        }
        const código = erroPedidoPeloNumero(corpo.to);
        if (código === 500) {
          return responder(res, 500, {
            error: { message: 'An unknown error occurred', type: 'OAuthException', code: 1 },
          });
        }
        if (código !== null) return erroDaGraph(res, código);

        const wamid = `wamid.DUBLE${randomUUID().replace(/-/g, '').slice(0, 20)}`;
        enviadas.push({ phone_number_id: envio[1], em: new Date().toISOString(), corpo, wamid });
        return responder(res, 200, {
          messaging_product: 'whatsapp',
          contacts: [{ input: corpo.to, wa_id: String(corpo.to).replace(/\D/g, '') }],
          messages: [{ id: wamid, message_status: 'accepted' }],
        });
      });
      return undefined;
    }

    // GET/POST /vNN.N/<waba_id>/message_templates
    const modelos = caminho.match(/^\/v\d+\.\d+\/([^/]+)\/message_templates$/);
    if (modelos && req.method === 'GET') {
      const lista = conta.modelos[modelos[1]] ?? [];
      const nome = url.searchParams.get('name');
      const filtrados = nome ? lista.filter((m) => m.name.includes(nome)) : lista;
      const limite = Math.max(1, Number(url.searchParams.get('limit') ?? 25));
      const inicio = Number(url.searchParams.get('after') ?? 0);
      const pagina = filtrados.slice(inicio, inicio + limite);
      const fields = url.searchParams.get('fields');
      const temMais = inicio + limite < filtrados.length;
      const paging = {
        cursors: { before: String(inicio), after: String(inicio + pagina.length) },
      };
      if (temMais) {
        paging.next = `http://127.0.0.1:${porta}${caminho}?limit=${limite}&after=${inicio + pagina.length}`;
      }
      return responder(res, 200, {
        data: pagina.map((m) => filtrarCampos(m, fields)),
        paging,
      });
    }
    if (modelos && req.method === 'POST') {
      lerCorpo(req).then((corpo) => {
        const wabaId = modelos[1];
        const lista = (conta.modelos[wabaId] ??= []);
        const corpoDoModelo = (corpo?.components ?? []).find(
          (c) => String(c.type).toUpperCase() === 'BODY',
        );
        if (!corpo?.name || !corpo?.language || !corpo?.category || !corpoDoModelo?.text) {
          return responder(res, 400, {
            error: { message: '(#100) Invalid parameter', type: 'OAuthException', code: 100 },
          });
        }
        if (lista.some((m) => m.name === corpo.name && m.language === corpo.language)) {
          return erroDeParametro(
            res,
            'Invalid parameter',
            2388024,
            'Content in This Language Already Exists',
            `Content for ${corpo.language} already exists for this template name.`,
          );
        }
        const texto = String(corpoDoModelo.text).trim();
        if (/^\{\{/.test(texto) || /\}\}$/.test(texto)) {
          return erroDeParametro(
            res,
            'Invalid parameter',
            2388299,
            'Leading or Trailing Params Not Allowed',
            "Variables can't be at the start or end of the template.",
          );
        }
        const status = corpo.name.startsWith('rejeitar_')
          ? 'REJECTED'
          : corpo.name.startsWith('aprovar_')
            ? 'APPROVED'
            : 'PENDING';
        const modelo = {
          id: String((proximoIdDeModelo += 1)),
          name: corpo.name,
          language: corpo.language,
          category: String(corpo.category).toUpperCase(),
          status,
          parameter_format: corpo.parameter_format ?? 'POSITIONAL',
          components: corpo.components,
          rejected_reason: status === 'REJECTED' ? 'PROMOTIONAL' : 'NONE',
        };
        lista.push(modelo);
        return responder(res, 200, { id: modelo.id, status, category: modelo.category });
      });
      return undefined;
    }

    // POST /vNN.N/<phone_number_id>/register
    const registro = caminho.match(/^\/v\d+\.\d+\/([^/]+)\/register$/);
    if (req.method === 'POST' && registro) {
      lerCorpo(req).then((corpo) => {
        const numero = conta.numeros[registro[1]];
        if (!numero) {
          return responder(res, 400, {
            error: {
              message: 'Unsupported post request.',
              type: 'GraphMethodException',
              code: 100,
            },
          });
        }
        if (corpo?.messaging_product !== 'whatsapp' || !/^\d{6}$/.test(String(corpo?.pin ?? ''))) {
          return responder(res, 400, {
            error: { message: '(#100) Invalid parameter', type: 'OAuthException', code: 100 },
          });
        }
        if (corpo.pin === '000000') {
          return responder(res, 400, {
            error: {
              message: 'Two step verification PIN Mismatch',
              type: 'OAuthException',
              code: 133005,
              fbtrace_id: 'DUBLE' + randomUUID().slice(0, 8),
            },
          });
        }
        conta.registros.push({ phone_number_id: registro[1], em: new Date().toISOString() });
        numero.platform_type = 'CLOUD_API';
        numero.status = 'CONNECTED';
        return responder(res, 200, { success: true });
      });
      return undefined;
    }

    // POST /vNN.N/<waba_id>/subscribed_apps (com ou sem override de callback)
    const assinaturaDaWaba = caminho.match(/^\/v\d+\.\d+\/([^/]+)\/subscribed_apps$/);
    if (req.method === 'POST' && assinaturaDaWaba) {
      lerCorpo(req).then((corpo) => {
        if (corpo?.override_callback_uri && conta.recusarOverrideDaWaba) {
          // A Meta faz o GET de verificação na hora; se o callback não devolve o
          // desafio, a resposta é esta.
          return responder(res, 400, {
            error: {
              message:
                '(#2200) Callback verification failed with the following errors: HTTP Status Code = 401',
              type: 'OAuthException',
              code: 2200,
              fbtrace_id: 'DUBLE' + randomUUID().slice(0, 8),
            },
          });
        }
        conta.assinaturasDaWaba.push({
          waba_id: assinaturaDaWaba[1],
          override_callback_uri: corpo?.override_callback_uri ?? null,
        });
        return responder(res, 200, { success: true });
      });
      return undefined;
    }

    // GET /vNN.N/<phone_number_id> — os dados do número, só os campos pedidos.
    const numero = caminho.match(/^\/v\d+\.\d+\/([^/]+)$/);
    if (req.method === 'GET' && numero && conta.numeros[numero[1]]) {
      return responder(
        res,
        200,
        filtrarCampos(conta.numeros[numero[1]], url.searchParams.get('fields')),
      );
    }

    // GET /vNN.N/<media_id> — metadados, com URL temporária.
    const midia = caminho.match(/^\/v\d+\.\d+\/([^/]+)$/);
    if (req.method === 'GET' && midia) {
      const m = midias.get(midia[1]);
      if (!m) {
        return responder(res, 404, {
          error: { message: 'Unsupported get request.', type: 'GraphMethodException', code: 100 },
        });
      }
      return responder(res, 200, {
        messaging_product: 'whatsapp',
        url: `http://127.0.0.1:${porta}/midia/${midia[1]}`,
        mime_type: m.mime_type,
        sha256: 'duble',
        file_size: m.bytes.length,
        id: midia[1],
      });
    }

    return responder(res, 404, {
      error: { message: 'Unsupported request', type: 'GraphMethodException', code: 100 },
    });
  });

  servidor.listen(porta, '127.0.0.1', () => {
    process.stdout.write(`dublê da Graph API ouvindo em http://127.0.0.1:${porta}\n`);
  });
  return servidor;
}

const [comando, portaBruta] = process.argv.slice(2);
if (comando === 'servir') {
  servir(Number(portaBruta ?? 8788));
} else {
  process.stderr.write('Uso: node meta-graph-duble.mjs servir [porta]\n');
  process.exit(2);
}
