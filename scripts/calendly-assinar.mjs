#!/usr/bin/env node
/**
 * Liga o Calendly da Imova ao CRM: cria, no Calendly, a assinatura do webhook que avisa a Edge
 * Function `calendly-webhook` a cada agendamento e cancelamento. O Calendly não tem tela para
 * isso: só a API (developer.calendly.com, "Create Webhook Subscription"), que desde 06/11/2026
 * funciona também no plano grátis.
 *
 *   node scripts/calendly-assinar.mjs estado    (só lê: a conta, a assinatura e se a função está no ar)
 *   node scripts/calendly-assinar.mjs assinar   (escolhe a chave, grava na função e cria a assinatura)
 *   node scripts/calendly-assinar.mjs trocar    (chave nova sem perder aviso no meio)
 *   node scripts/calendly-assinar.mjs remover   (apaga a assinatura: o Calendly para de avisar)
 *
 * O token pessoal do Calendly (Integrações → API e webhooks → Personal access tokens, com
 * users:read, webhooks:read, webhooks:write e scheduled_events:write) vem de CALENDLY_TOKEN, no ambiente ou no
 * `.env.imova` (`--env <arquivo>` para outro). O script não grava o token em lugar nenhum; o worker
 * da Imova usa o mesmo token para cancelar no Calendly, gravado à parte nos segredos do Fly.
 *
 * A CHAVE DE ASSINATURA nunca aparece na tela nem na linha de comando: nasce aqui, vai para os
 * Secrets da função por um arquivo temporário só do usuário (`supabase secrets set --env-file`,
 * com o login da CLI) e vai ao Calendly no corpo do POST. Passo a passo em docs/operacao/calendly.md.
 */
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.CALENDLY_API_DE_TESTE ?? 'https://api.calendly.com';
const EVENTOS = ['invitee.created', 'invitee.canceled'];
const SEGREDO = 'CALENDLY_WEBHOOK_SIGNING_KEY';
const SEGREDO_ANTERIOR = 'CALENDLY_WEBHOOK_SIGNING_KEY_ANTERIOR';

const args = process.argv.slice(2);
const acao = args[0];

function sair(frase) {
  console.error(`\n${frase}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// De onde vêm o token e o projeto
// ---------------------------------------------------------------------------
function lerEnv(arquivo) {
  const valores = {};
  for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) valores[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return valores;
}

function token() {
  if (process.env.CALENDLY_TOKEN) return process.env.CALENDLY_TOKEN.trim();
  const iEnv = args.indexOf('--env');
  const arquivo =
    iEnv >= 0
      ? args[iEnv + 1]
      : [join(RAIZ, '.env.imova'), join(homedir(), 'triadecrm', '.env.imova')].find((f) =>
          existsSync(f),
        );
  const valor = arquivo && existsSync(arquivo) ? lerEnv(arquivo).CALENDLY_TOKEN : undefined;
  if (!valor) {
    sair(
      'Falta o token do Calendly. Crie um em calendly.com → Integrações → API e webhooks → ' +
        'Personal access tokens (com users:read, webhooks:read, webhooks:write e scheduled_events:write) e ponha ' +
        'CALENDLY_TOKEN=... no .env.imova, ou rode com CALENDLY_TOKEN=... na frente do comando.',
    );
  }
  return valor.trim();
}

function projetoDaImova() {
  const empresas = JSON.parse(readFileSync(join(RAIZ, 'supabase', 'empresas.json'), 'utf8'));
  const projeto = empresas.empresas?.imova?.projeto;
  if (!projeto) sair('supabase/empresas.json não tem o projeto da Imova.');
  return projeto;
}

const PROJETO = projetoDaImova();
const URL_DA_FUNCAO =
  process.env.CALENDLY_URL_DE_TESTE ??
  `https://${PROJETO}.supabase.co/functions/v1/calendly-webhook`;

// ---------------------------------------------------------------------------
// Calendly
// ---------------------------------------------------------------------------
let TOKEN;

async function calendly(caminho, opcoes = {}) {
  const resposta = await fetch(caminho.startsWith('http') ? caminho : `${API}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...opcoes.headers,
    },
  });
  if (resposta.status === 204) return null;
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const detalhe = [corpo.title, corpo.message, ...(corpo.details ?? []).map((d) => d.message)]
      .filter(Boolean)
      .join(' · ');
    if (resposta.status === 401) sair(`O Calendly recusou o token (401). ${detalhe}`);
    if (resposta.status === 403) {
      sair(
        `O token não tem permissão para isto (403): crie-o com users:read, webhooks:read, webhooks:write e scheduled_events:write. ${detalhe}`,
      );
    }
    throw new Error(`Calendly ${resposta.status}: ${detalhe || resposta.statusText}`);
  }
  return corpo;
}

async function eu() {
  const { resource } = await calendly('/users/me');
  return {
    uri: resource.uri,
    organizacao: resource.current_organization,
    email: resource.email,
    nome: resource.name,
  };
}

async function assinaturasDaFuncao(quem) {
  const busca = new URLSearchParams({
    organization: quem.organizacao,
    user: quem.uri,
    scope: 'user',
    count: '100',
  });
  const { collection } = await calendly(`/webhook_subscriptions?${busca}`);
  return collection.filter((a) => a.callback_url === URL_DA_FUNCAO);
}

async function criarAssinatura(quem, chave) {
  const { resource } = await calendly('/webhook_subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      url: URL_DA_FUNCAO,
      events: EVENTOS,
      organization: quem.organizacao,
      user: quem.uri,
      scope: 'user',
      signing_key: chave,
    }),
  });
  return resource;
}

async function apagarAssinatura(assinatura) {
  await calendly(assinatura.uri, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Supabase: os Secrets da função, pelo login da CLI
// ---------------------------------------------------------------------------
function supabase(argumentos) {
  const r = spawnSync('supabase', [...argumentos, '--project-ref', PROJETO], { encoding: 'utf8' });
  if (r.error)
    sair(`Não achei a CLI do Supabase (${r.error.message}). Instale e faça supabase login.`);
  if (r.status !== 0) sair(`A CLI do Supabase falhou:\n${(r.stderr || r.stdout).trim()}`);
}

/** Grava segredos sem que o valor passe pela linha de comando (que aparece no `ps`). */
function gravarSegredos(valores) {
  const pasta = mkdtempSync(join(tmpdir(), 'calendly-'));
  const arquivo = join(pasta, 'segredos.env');
  try {
    writeFileSync(
      arquivo,
      Object.entries(valores)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
    supabase(['secrets', 'set', '--env-file', arquivo]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

function apagarSegredo(nome) {
  supabase(['secrets', 'unset', nome]);
}

function chaveNova() {
  return randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// A função está no ar? GET responde 405 quando ela existe (só aceita POST).
// ---------------------------------------------------------------------------
async function funcaoNoAr() {
  try {
    const r = await fetch(URL_DA_FUNCAO, { method: 'GET' });
    return r.status === 405;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// As ações
// ---------------------------------------------------------------------------
async function estado() {
  const quem = await eu();
  console.log(`Conta do Calendly: ${quem.nome} <${quem.email}>`);
  console.log(
    `Função:            ${URL_DA_FUNCAO} — ${(await funcaoNoAr()) ? 'no ar' : 'NÃO responde (publique antes)'}`,
  );
  const assinaturas = await assinaturasDaFuncao(quem);
  if (assinaturas.length === 0) {
    console.log('Assinatura:        nenhuma. Rode `assinar`.');
    return;
  }
  for (const a of assinaturas) {
    console.log(
      `Assinatura:        ${a.state} desde ${a.created_at}, eventos ${a.events.join(', ')}`,
    );
    if (a.state !== 'active') {
      console.log(
        '  O Calendly desliga a assinatura depois de muitas falhas. Confira o log da função e rode `trocar`.',
      );
    }
  }
}

async function assinar() {
  const quem = await eu();
  if (!(await funcaoNoAr())) {
    sair(
      `A função não responde em ${URL_DA_FUNCAO}. Publique antes (supabase functions deploy ` +
        `calendly-webhook --project-ref ${PROJETO}): assinatura que só recebe erro o Calendly desliga.`,
    );
  }
  const existentes = await assinaturasDaFuncao(quem);
  if (existentes.length > 0) {
    sair(
      'Já existe uma assinatura para esta função. Para mudar a chave, use `trocar`; para recomeçar, `remover`.',
    );
  }
  const chave = chaveNova();
  // A chave entra na função ANTES de o Calendly começar a assinar com ela.
  gravarSegredos({ [SEGREDO]: chave });
  const criada = await criarAssinatura(quem, chave);
  console.log(
    `\nPronto: o Calendly de ${quem.email} avisa o CRM da Imova (${criada.events.join(', ')}).`,
  );
  console.log('Faça um agendamento de teste pelo seu link e veja o aviso na Agenda.\n');
}

async function trocar() {
  const quem = await eu();
  const velhas = await assinaturasDaFuncao(quem);
  if (velhas.length === 0) sair('Não há assinatura para trocar. Use `assinar`.');
  const chave = chaveNova();
  // 1. A função passa a aceitar também a chave nova (como "anterior", por enquanto).
  gravarSegredos({ [SEGREDO_ANTERIOR]: chave });
  // 2. A assinatura nova nasce. Até a velha sair, o mesmo agendamento chega duas vezes: a
  //    URI do convidado faz o segundo virar "duplicado", sem nada repetido na agenda.
  await criarAssinatura(quem, chave);
  // 3. A velha sai.
  for (const v of velhas) await apagarAssinatura(v);
  // 4. A nova vira a atual, e a anterior é apagada.
  gravarSegredos({ [SEGREDO]: chave });
  apagarSegredo(SEGREDO_ANTERIOR);
  console.log('\nChave trocada, sem intervalo: a assinatura velha foi apagada e só a nova vale.\n');
}

async function remover() {
  const quem = await eu();
  const assinaturas = await assinaturasDaFuncao(quem);
  if (assinaturas.length === 0) sair('Não há assinatura para remover.');
  for (const a of assinaturas) await apagarAssinatura(a);
  console.log(
    '\nAssinatura apagada: o Calendly parou de avisar o CRM. Os agendamentos já recebidos ficam.\n',
  );
}

const ACOES = { estado, assinar, trocar, remover };
if (!ACOES[acao]) {
  sair(
    'Uso: node scripts/calendly-assinar.mjs estado | assinar | trocar | remover [--env <arquivo>]',
  );
}
TOKEN = token();
ACOES[acao]().catch((e) => sair(e.message));
