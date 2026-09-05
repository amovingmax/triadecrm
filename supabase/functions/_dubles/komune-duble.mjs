#!/usr/bin/env node
// =============================================================================
// DUBLÊ DA KOMUNE — não vai para produção, não é deploy, não é contrato.
//
// É o outro lado do telefone enquanto o outro lado não existe: implementa
// `crm-pre-registration` exatamente como docs/operacao/contrato-precadastro.md
// descreve, para que o `komune-push` do Triade seja testado contra um
// interlocutor de verdade — com assinatura conferida, carimbo conferido e
// idempotência de verdade.
//
// Também sabe MANDAR webhook assinado de volta, para exercitar o
// `komune-webhook` do Triade sem depender de ninguém.
//
// A pasta começa com "_": a CLI do Supabase não a trata como função e ela
// nunca sobe para a nuvem.
//
// Uso:
//   node supabase/functions/_dubles/komune-duble.mjs servir [porta]
//   node supabase/functions/_dubles/komune-duble.mjs webhook <url> <json>
//
// Segredos por ambiente (nunca versionados):
//   KOMUNE_PUSH_SECRET     — o que o dublê usa para CONFERIR o que o Triade manda
//   KOMUNE_WEBHOOK_SECRET  — o que o dublê usa para ASSINAR o que manda de volta
// =============================================================================

import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const SEGREDO_ENTRADA = process.env.KOMUNE_PUSH_SECRET ?? '';
const SEGREDO_SAIDA = process.env.KOMUNE_WEBHOOK_SECRET ?? '';
const JANELA = 300;

/** O mesmo esquema do Triade: base = "v1:<carimbo>:<corpo cru>". */
function assinar(segredo, carimbo, corpoCru) {
  return 'v1=' + createHmac('sha256', segredo).update(`v1:${carimbo}:${corpoCru}`).digest('hex');
}

function iguaisEmTempoConstante(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // Ainda assim gasta o tempo de uma comparação, para não vazar comprimento.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

// O "banco" do dublê: o que já foi criado, e sob qual chave de idempotência.
const porChaveDeIdempotencia = new Map(); // chave -> { supplier_id, criado_em }
const fornecedores = new Map(); // crm_organization_id -> supplier_id
const recebidos = [];

function responder(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(texto);
}

function servir(porta) {
  if (SEGREDO_ENTRADA.length === 0) {
    console.error('KOMUNE_PUSH_SECRET não está no ambiente. O dublê não sobe sem segredo.');
    process.exit(1);
  }

  const servidor = createServer((req, res) => {
    const partes = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => {
      const corpoCru = Buffer.concat(partes).toString('utf8');
      const url = new URL(req.url, 'http://localhost');

      // Espelho de diagnóstico do teste: o que o dublê recebeu até agora.
      if (req.method === 'GET' && url.pathname === '/_recebidos') {
        return responder(res, 200, { recebidos });
      }
      if (req.method !== 'POST' || url.pathname !== '/crm-pre-registration') {
        return responder(res, 404, { erro: 'rota inexistente' });
      }

      const assinatura = req.headers['x-triade-signature'] ?? null;
      const carimbo = req.headers['x-triade-timestamp'] ?? null;
      const chave = req.headers['idempotency-key'] ?? null;

      if (!assinatura || !carimbo) {
        recebidos.push({ veredito: 'sem_assinatura' });
        return responder(res, 401, { erro: 'assinatura_ausente' });
      }
      const agora = Math.floor(Date.now() / 1000);
      if (!/^\d+$/.test(String(carimbo)) || Math.abs(agora - Number(carimbo)) > JANELA) {
        recebidos.push({ veredito: 'carimbo_fora_da_janela' });
        return responder(res, 401, { erro: 'carimbo_fora_da_janela' });
      }
      if (!iguaisEmTempoConstante(assinar(SEGREDO_ENTRADA, carimbo, corpoCru), assinatura)) {
        recebidos.push({ veredito: 'assinatura_invalida' });
        return responder(res, 401, { erro: 'assinatura_invalida' });
      }
      if (!chave) {
        recebidos.push({ veredito: 'sem_idempotency_key' });
        return responder(res, 400, { erro: 'idempotency_key_ausente' });
      }

      let corpo;
      try {
        corpo = JSON.parse(corpoCru);
      } catch {
        return responder(res, 400, { erro: 'json_invalido' });
      }

      // O que a Komune recusa por contrato, e o Triade nunca deve mandar.
      const perfil = corpo.perfil ?? {};
      const proibidos = [
        'cpf',
        'CPF',
        'pix',
        'chave_pix',
        'conta_bancaria',
        'agencia',
        'banco',
        'cartao',
      ];
      const achado = proibidos.find((k) => Object.hasOwn(perfil, k));
      if (achado || Object.hasOwn(corpo, 'claim_token')) {
        recebidos.push({ veredito: 'campo_proibido', campo: achado ?? 'claim_token' });
        return responder(res, 422, { erro: 'campo_proibido', campo: achado ?? 'claim_token' });
      }
      if (!corpo.pre_registration_id || !corpo.crm_organization_id) {
        return responder(res, 422, { erro: 'campos_obrigatorios_ausentes' });
      }

      // Idempotência de verdade: a mesma chave devolve o MESMO id, e não cria nada.
      const jaVisto = porChaveDeIdempotencia.get(chave);
      if (jaVisto) {
        recebidos.push({ veredito: 'idempotente', chave, supplier_id: jaVisto.supplier_id });
        return responder(res, 200, {
          komune_supplier_id: jaVisto.supplier_id,
          publish_status: 'draft',
          published: false,
          criado: false,
          idempotente: true,
        });
      }

      const idExistente = fornecedores.get(corpo.crm_organization_id);
      const supplierId = idExistente ?? randomUUID();
      fornecedores.set(corpo.crm_organization_id, supplierId);
      porChaveDeIdempotencia.set(chave, {
        supplier_id: supplierId,
        criado_em: new Date().toISOString(),
      });
      recebidos.push({
        veredito: 'criado',
        chave,
        supplier_id: supplierId,
        pre_registration_id: corpo.pre_registration_id,
        tem_hash_do_token: typeof corpo.claim_token_hash === 'string',
        campos_do_perfil: Object.keys(perfil),
      });

      return responder(res, 200, {
        komune_supplier_id: supplierId,
        publish_status: 'draft',
        published: false,
        criado: !idExistente,
        idempotente: false,
      });
    });
  });

  servidor.listen(porta, '0.0.0.0', () => {
    console.log(`dublê da Komune ouvindo em http://0.0.0.0:${porta}/crm-pre-registration`);
  });
}

async function mandarWebhook(destino, corpoJson) {
  if (SEGREDO_SAIDA.length === 0) {
    console.error('KOMUNE_WEBHOOK_SECRET não está no ambiente.');
    process.exit(1);
  }
  const corpoCru = typeof corpoJson === 'string' ? corpoJson : JSON.stringify(corpoJson);
  const carimbo = process.env.CARIMBO ? Number(process.env.CARIMBO) : Math.floor(Date.now() / 1000);
  const entrega = process.env.ENTREGA ?? randomUUID();
  const assinatura = process.env.ASSINATURA_FALSA ?? assinar(SEGREDO_SAIDA, carimbo, corpoCru);

  const cabecalhos = {
    'Content-Type': 'application/json',
    'X-Komune-Delivery': entrega,
  };
  if (process.env.SEM_ASSINATURA !== '1') {
    cabecalhos['X-Komune-Signature'] = assinatura;
    cabecalhos['X-Komune-Timestamp'] = String(carimbo);
  }
  if (process.env.AUTORIZACAO) cabecalhos.Authorization = process.env.AUTORIZACAO;

  const resposta = await fetch(destino, { method: 'POST', headers: cabecalhos, body: corpoCru });
  const texto = await resposta.text();
  console.log(JSON.stringify({ status: resposta.status, entrega, corpo: texto }, null, 2));
  process.exit(resposta.ok ? 0 : 0);
}

const [, , comando, ...resto] = process.argv;
if (comando === 'servir') {
  servir(Number(resto[0] ?? 8787));
} else if (comando === 'webhook') {
  await mandarWebhook(resto[0], resto[1] ?? '{}');
} else {
  console.error('uso: komune-duble.mjs servir [porta] | webhook <url> <json>');
  process.exit(1);
}
