#!/usr/bin/env node
/**
 * Liga e desliga a ligação pelo WhatsApp da Imova: a chamada no número, na Meta, e a chave
 * `whatsapp.ligacao` no CRM. As duas andam juntas: liga a Meta antes do CRM e desliga o CRM
 * antes da Meta, para a tela nunca oferecer um botão que a Meta recusaria.
 *
 * `ligar` e `janela` deixam o botão de ligar para a Imova escondido dos clientes
 * (`DISABLE_ALL`): só a equipe liga. `abrir` (03/11/2026) mostra o botão aos clientes, com o
 * horário de atendimento, os feriados e o pedido de retorno; `fechar` volta a só a equipe.
 *
 *   node scripts/ligacao-whatsapp.mjs estado     (só lê)
 *   node scripts/ligacao-whatsapp.mjs ligar      (só a equipe liga; fica até alguém desligar)
 *   node scripts/ligacao-whatsapp.mjs abrir      (os clientes também ligam, no horário)
 *   node scripts/ligacao-whatsapp.mjs abrir --ver (mostra o que seria enviado, e não muda nada)
 *   node scripts/ligacao-whatsapp.mjs fechar     (volta a só a equipe ligar)
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

/**
 * O horário de atendimento por ligação (decisão de 30/10/2026, "por enquanto"): de segunda a
 * sexta, das 8h às 19h, no fuso de Natal. Fora dele o WhatsApp não oferece a ligação e mostra
 * ao cliente o próximo horário, com a opção de mandar mensagem ou pedir retorno.
 */
const DIAS_DE_ATENDIMENTO = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const ABRE = '0800';
const FECHA = '1900';
/**
 * A Meta não diz se aceita todo fuso do IANA. Fortaleza é o do projeto; Recife e São Paulo
 * estão na mesma hora o ano inteiro (sem horário de verão desde 2019), e entram só se a
 * Meta recusar o anterior.
 */
const FUSOS = ['America/Fortaleza', 'America/Recife', 'America/Sao_Paulo'];
/** A Meta guarda até 20 feriados. */
const TETO_DE_FERIADOS = 20;

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

const SO_VER = args.includes('--ver');

if (!['estado', 'ligar', 'abrir', 'fechar', 'desligar', 'janela'].includes(acao)) {
  parar('Use: node scripts/ligacao-whatsapp.mjs estado | ligar | abrir [--ver] | fechar | desligar | janela');
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

/** "2026-11-20" → "20/11/2026". */
const dataBr = (iso) => iso.split('-').reverse().join('/');

/** Hoje em Natal, "AAAA-MM-DD". */
function hojeEmNatal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
}

/**
 * Os feriados que caem de segunda a sexta, de hoje em diante, da tabela do CRM (nacionais,
 * do RN e de Natal, com os pontos facultativos, como o CRM já trata). Fim de semana já está
 * fechado pelo horário e não gasta vaga das 20.
 */
async function feriadosDaSemana() {
  const linhas = await doCrm(
    `holidays?select=date,name&date=gte.${hojeEmNatal()}&order=date&limit=60`,
  );
  const vistos = new Set();
  const dias = [];
  for (const f of linhas) {
    const semana = new Date(`${f.date}T12:00:00Z`).getUTCDay();
    if (semana === 0 || semana === 6 || vistos.has(f.date)) continue;
    vistos.add(f.date);
    dias.push(f);
  }
  return dias.slice(0, TETO_DE_FERIADOS);
}

function chamadaAberta(fuso, feriados) {
  return {
    calling: {
      status: 'ENABLED',
      call_icon_visibility: 'DEFAULT',
      callback_permission_status: 'ENABLED',
      call_hours: {
        status: 'ENABLED',
        timezone_id: fuso,
        weekly_operating_hours: DIAS_DE_ATENDIMENTO.map((day_of_week) => ({
          day_of_week,
          open_time: ABRE,
          close_time: FECHA,
        })),
        holiday_schedule: feriados.map((f) => ({ date: f.date, start_time: '0000', end_time: '2359' })),
      },
    },
  };
}

async function mostrarEstado() {
  const meta = await graph('settings');
  const [linha] = await doCrm('app_settings?select=value,updated_at&key=eq.whatsapp.ligacao');
  const c = meta.calling ?? {};
  const naMeta = c.status === 'ENABLED';
  const noCrm = linha?.value?.ativa === true;
  const quando = linha?.updated_at
    ? new Date(linha.updated_at).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })
    : '?';
  const aberta = naMeta && c.call_icon_visibility === 'DEFAULT';
  console.log(`Meta: ${naMeta ? 'ligada' : 'desligada'}, ${aberta ? 'os clientes também ligam' : 'botão dos clientes escondido'}.`);
  console.log(`CRM:  ${noCrm ? 'ligado' : 'desligado'} (última mudança: ${quando}).`);
  const h = c.call_hours;
  if (h?.status === 'ENABLED') {
    const dias = (h.weekly_operating_hours ?? [])
      .map((d) => `${d.day_of_week.slice(0, 3).toLowerCase()} ${d.open_time}–${d.close_time}`)
      .join(', ');
    console.log(`Horário: ${dias} (${h.timezone_id ?? 'fuso?'}).`);
    const feriados = (h.holiday_schedule ?? []).map((f) => f.date).sort();
    if (feriados.length > 0) {
      console.log(`Feriados na Meta: ${feriados.length}, de ${dataBr(feriados[0])} a ${dataBr(feriados.at(-1))}.`);
      const faltam = (Date.parse(feriados.at(-1)) - Date.now()) / 86_400_000;
      if (faltam < 60) console.log('ATENÇÃO: os feriados acabam em menos de 60 dias. Rode "abrir" de novo para renovar.');
    } else if (aberta) {
      console.log('ATENÇÃO: nenhum feriado na Meta. Rode "abrir" de novo para gravar os do CRM.');
    }
  } else {
    console.log('Horário: sem horário de atendimento (a Meta trata como 24 horas).');
  }
  console.log(`Pedido de retorno depois de o cliente ligar: ${c.callback_permission_status === 'ENABLED' ? 'ligado' : 'desligado'}.`);
  if (naMeta !== noCrm) console.log('ATENÇÃO: Meta e CRM estão diferentes. Rode "ligar" ou "desligar" para acertar.');
}

/**
 * Abre para os clientes. O CRM liga antes da Meta, ao contrário de `ligar`: aqui o que importa
 * é a ligação que entra, e com o CRM desligado ela ficaria gravada como perdida sem tocar.
 */
async function abrirParaClientes() {
  const feriados = await feriadosDaSemana();
  if (SO_VER) {
    console.log('Só olhando: nada será mudado.\n');
    console.log(JSON.stringify(chamadaAberta(FUSOS[0], feriados), null, 2));
    console.log(`\nFeriados que fecham a ligação (${feriados.length}):`);
    for (const f of feriados) console.log(`  ${dataBr(f.date)}  ${f.name}`);
    return;
  }
  if (feriados.length === 0) throw new Error('não achei feriado nenhum no CRM; confira a tabela antes de abrir');

  await chaveDoCrmLigada(true);
  console.log('CRM: ligado.');
  let usado = null;
  let ultimoErro = null;
  for (const fuso of FUSOS) {
    try {
      await graph('settings', chamadaAberta(fuso, feriados));
      usado = fuso;
      break;
    } catch (e) {
      ultimoErro = e;
      // Só o fuso recusado vale outra tentativa; qualquer outro erro para aqui.
      if (!/time.?zone/i.test(e.message)) break;
    }
  }
  if (!usado) throw ultimoErro;
  console.log(`Meta: aberta para os clientes, seg–sex ${ABRE.slice(0, 2)}h–${FECHA.slice(0, 2)}h (${usado}).`);
  console.log(`Feriados fechados: ${feriados.length}, até ${dataBr(feriados.at(-1).date)}.`);
  console.log('Pedido de retorno: ligado (o WhatsApp pergunta ao cliente, depois de ligar, se a Imova pode ligar de volta).');
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
  if (acao === 'abrir') {
    await abrirParaClientes();
    if (!SO_VER) {
      console.log('\nA Meta avisa que o celular do cliente pode levar até 7 dias para mostrar o botão;');
      console.log('abrir os dados da Imova no WhatsApp atualiza na hora. Para voltar: "fechar".');
      console.log('Só toca com o CRM aberto no navegador. Confira com "estado".');
    }
    process.exit(0);
  }
  if (acao === 'fechar') {
    await graph('settings', chamada('ENABLED'));
    console.log('Meta: os clientes não ligam mais; a equipe continua ligando.');
    process.exit(0);
  }
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
