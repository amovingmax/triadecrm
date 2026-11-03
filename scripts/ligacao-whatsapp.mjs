#!/usr/bin/env node
/**
 * Liga e desliga a ligação pelo WhatsApp da Imova: a chamada no número, na Meta, e a chave
 * `whatsapp.ligacao` no CRM. As duas andam juntas: liga a Meta antes do CRM e desliga o CRM
 * antes da Meta, para a tela nunca oferecer um botão que a Meta recusaria.
 *
 * O botão de ligar para a Imova continua escondido dos clientes (`DISABLE_ALL`): aqui só a
 * equipe liga. Abrir para os clientes é outra decisão, com horário de atendimento.
 *
 *   node scripts/ligacao-whatsapp.mjs estado     (só lê)
 *   node scripts/ligacao-whatsapp.mjs ligar      (fica ligado até alguém desligar)
 *   node scripts/ligacao-whatsapp.mjs desligar
 *   node scripts/ligacao-whatsapp.mjs janela     (liga por 30 minutos; Enter ou Ctrl+C desligam antes)
 *
 * Lê o acesso do `.env.imova` (`--env <arquivo>` para outro). Confere que o banco é da Imova
 * antes de mexer em qualquer coisa.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH = process.env.GRAPH_DE_TESTE ?? 'https://graph.facebook.com/v26.0';
const TEMPO_MS = Number(process.env.TEMPO_DE_TESTE ?? 30 * 60 * 1000);
const NUMERO_DA_IMOVA = '1348058288398842';

const args = process.argv.slice(2);
const acao = args[0];
const iEnv = args.indexOf('--env');
const ARQUIVO =
  iEnv >= 0
    ? args[iEnv + 1]
    : [join(RAIZ, '.env.imova'), join(homedir(), 'triadecrm', '.env.imova')].find((f) => existsSync(f));

function parar(frase) {
  console.error(`\n✋ ${frase}\nNada foi feito.`);
  process.exit(1);
}

if (!['estado', 'ligar', 'desligar', 'janela'].includes(acao)) {
  parar('Use: node scripts/ligacao-whatsapp.mjs estado | ligar | desligar | janela');
}
if (!ARQUIVO || !existsSync(ARQUIVO)) parar('Não achei o .env.imova.');

function doArquivo(chave) {
  const linha = readFileSync(ARQUIVO, 'utf8').split('\n').find((l) => l.startsWith(`${chave}=`));
  return linha ? linha.slice(chave.length + 1).trim().replace(/^"|"$/g, '') : '';
}

const token = doArquivo('META_WA_ACCESS_TOKEN');
const urlDoCrm = doArquivo('SUPABASE_URL');
const chaveDoCrm = doArquivo('SUPABASE_SERVICE_ROLE_KEY');
if (!token || doArquivo('META_WA_PHONE_NUMBER_ID') !== NUMERO_DA_IMOVA || !urlDoCrm || !chaveDoCrm) {
  parar('O .env.imova não tem o acesso da Imova.');
}

async function graph(caminho, corpo) {
  const r = await fetch(`${GRAPH}/${NUMERO_DA_IMOVA}/${caminho}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = json.error ?? {};
    throw new Error(`a Meta recusou (erro ${e.code ?? r.status}): ${e.error_data?.details ?? e.message ?? 'sem detalhe'}`);
  }
  return json;
}

const cabecalhos = { apikey: chaveDoCrm, Authorization: `Bearer ${chaveDoCrm}`, 'Content-Type': 'application/json' };

async function doCrm(caminho, metodo = 'GET', corpo) {
  const r = await fetch(`${urlDoCrm}/rest/v1/${caminho}`, {
    method: metodo,
    headers: metodo === 'PATCH' ? { ...cabecalhos, Prefer: 'return=representation' } : cabecalhos,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) throw new Error(`o CRM recusou (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function chaveDoCrmLigada(ativa) {
  const linhas = await doCrm('app_settings?key=eq.whatsapp.ligacao', 'PATCH', { value: { ativa } });
  if (linhas.length !== 1 || linhas[0].value?.ativa !== ativa) throw new Error('a chave do CRM não mudou');
}

const chamada = (status) => ({
  calling: { status, call_icon_visibility: 'DISABLE_ALL', callback_permission_status: 'DISABLED' },
});

async function mostrarEstado() {
  const meta = await graph('settings');
  const [linha] = await doCrm('app_settings?select=value,updated_at&key=eq.whatsapp.ligacao');
  const naMeta = meta.calling?.status === 'ENABLED';
  const noCrm = linha?.value?.ativa === true;
  const quando = linha?.updated_at
    ? new Date(linha.updated_at).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })
    : '?';
  console.log(`Meta: ${naMeta ? 'ligada' : 'desligada'}, botão dos clientes ${meta.calling?.call_icon_visibility === 'DEFAULT' ? 'visível' : 'escondido'}.`);
  console.log(`CRM:  ${noCrm ? 'ligado' : 'desligado'} (última mudança: ${quando}).`);
  if (naMeta !== noCrm) console.log('ATENÇÃO: Meta e CRM estão diferentes. Rode "ligar" ou "desligar" para acertar.');
}

async function ligarTudo() {
  await graph('settings', chamada('ENABLED'));
  console.log('Meta: ligada, com o botão escondido dos clientes.');
  try {
    await chaveDoCrmLigada(true);
  } catch (e) {
    console.error(`Parou: ${e.message}`);
    await desligarTudo();
    process.exit(1);
  }
  console.log('CRM: ligado.');
}

async function desligarTudo() {
  let ok = true;
  try {
    await chaveDoCrmLigada(false);
    console.log('CRM: desligado.');
  } catch (e) {
    ok = false;
    console.error(`ATENÇÃO: não desliguei o CRM (${e.message}).`);
  }
  try {
    await graph('settings', chamada('DISABLED'));
    console.log('Meta: desligada.');
  } catch (e) {
    ok = false;
    console.error(`ATENÇÃO: não desliguei na Meta (${e.message}).`);
  }
  return ok;
}

let empresa;
try {
  empresa = await doCrm('rpc/empresa_do_banco', 'POST', {});
} catch (e) {
  parar(`Não consegui ler o banco: ${e.message}.`);
}
if (empresa !== 'imova') parar(`Este banco é de "${empresa}", não da Imova.`);

try {
  if (acao === 'estado') {
    await mostrarEstado();
    process.exit(0);
  }
  if (acao === 'desligar') process.exit((await desligarTudo()) ? 0 : 1);
  await ligarTudo();
} catch (e) {
  parar(`${e.message}.`);
}

if (acao === 'ligar') {
  console.log('\nLigado para a equipe, sem prazo. Recarregue o CRM para o botão aparecer.');
  process.exit(0);
}

// janela
let encerrando = false;
async function encerrar(motivo, codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  console.log(`\n${motivo}`);
  const ok = await desligarTudo();
  process.exit(ok ? codigo : 1);
}
process.on('SIGINT', () => encerrar('Ctrl+C: desligando.', 130));
const minutos = Math.round(TEMPO_MS / 60000);
console.log(`\nJanela aberta. Deixe este Terminal aberto. Desliga sozinho em ${minutos} minutos.`);
setTimeout(() => encerrar(`Passaram ${minutos} minutos: desligando.`), TEMPO_MS);
const tela = createInterface({ input: process.stdin, output: process.stdout });
await tela.question('Aperte Enter para desligar antes: ');
tela.close();
await encerrar('Desligando.');
