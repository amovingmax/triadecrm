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
// O que implementa (Cloud API v21.0):
//   POST /v21.0/<phone_number_id>/messages   envio de texto, template e áudio
//   GET  /v21.0/<media_id>                   metadados da mídia (url temporária)
//   GET  /midia/<media_id>                   os bytes (a url acima aponta para cá)
//   GET  /_enviadas                          o que o dublê recebeu (só para teste)
//   POST /_zerar                             esquece tudo (só para teste)
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
// =============================================================================

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const TOKEN = process.env.META_WA_ACCESS_TOKEN ?? 'token-de-teste';

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
      return responder(res, 200, { ok: true });
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

    // POST /v21.0/<phone_number_id>/messages
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

    // GET /v21.0/<media_id> — metadados, com URL temporária.
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
