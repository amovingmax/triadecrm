#!/usr/bin/env node
// =============================================================================
// O CELULAR DO CLIENTE, SIMULADO — não vai para produção, não é deploy.
//
// Para testar a ligação pelo WhatsApp com as próprias mãos no local, sem a Meta: uma
// página com os botões do cliente (ligar, permitir, atender, desligar) e WebRTC de
// verdade. Ela faz o papel do WhatsApp e, junto com `meta-graph-duble.mjs`, o da Meta:
// assina os webhooks e lê o que o CRM pediu à "Graph API".
//
//   node supabase/functions/_dubles/meta-graph-duble.mjs servir 8790
//   node supabase/functions/_dubles/cliente-de-ligacao.mjs [porta]     (padrão: 3050)
//
// A mensagem do cliente entra direto no banco local, porque o robô de entrada não roda
// aqui. Pelo mesmo motivo o pedido de permissão ficaria "na fila": este simulador o marca
// como enviado quando o cliente responde.
// =============================================================================
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const PORTA = Number(process.argv[2] ?? 3050);
const HOOK = process.env.WEBHOOK_LOCAL ?? 'http://127.0.0.1:56321/functions/v1/wa-webhook';
const META = process.env.DUBLE_DA_META ?? 'http://127.0.0.1:8790';
const SEGREDO = process.env.META_WA_APP_SECRET ?? 'segredo-de-teste';
const BANCO = process.env.BANCO_LOCAL ?? 'supabase_db_imova-crm-local';
const NUMERO_DA_EMPRESA = '5584994058888';
const CLIENTE = process.env.CLIENTE ?? '5584999000111';
const NOME = process.env.NOME_DO_CLIENTE ?? 'Carla Teste';
const CONTATOS = [{ profile: { name: NOME }, wa_id: CLIENTE }];

const agora = () => String(Math.floor(Date.now() / 1000));
const sql = (q) =>
  execFileSync('docker', ['exec', BANCO, 'psql', '-U', 'postgres', '-tA', '-c', q]).toString().trim();

async function webhook(campo, valor) {
  const corpo = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: campo,
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '1234567890', display_phone_number: NUMERO_DA_EMPRESA },
              ...valor,
            },
          },
        ],
      },
    ],
  });
  const assinatura = 'sha256=' + createHmac('sha256', SEGREDO).update(corpo).digest('hex');
  const r = await fetch(HOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': assinatura },
    body: corpo,
  });
  if (!r.ok) throw new Error(`webhook ${campo}: ${r.status} ${await r.text()}`);
}

// A ligação em andamento, como o WhatsApp do cliente a veria.
let linha = null;
let lidos = 0;

function terminou(status) {
  const l = linha;
  if (!l || l.estado === 'fim') return Promise.resolve();
  l.estado = 'fim';
  l.motivo = status;
  const fim = Math.floor(Date.now() / 1000);
  const atendida = l.inicio !== null;
  const base =
    l.direcao === 'USER_INITIATED'
      ? { from: CLIENTE, to: NUMERO_DA_EMPRESA }
      : { from: NUMERO_DA_EMPRESA, to: CLIENTE, biz_opaque_callback_data: l.opaco };
  return webhook('calls', {
    contacts: CONTATOS,
    calls: [
      {
        id: l.id,
        ...base,
        event: 'terminate',
        direction: l.direcao,
        timestamp: String(fim),
        status: 'COMPLETED',
        ...(atendida
          ? { start_time: String(l.inicio), end_time: String(fim), duration: fim - l.inicio }
          : {}),
      },
    ],
  });
}

// O que o CRM pediu à "Graph API".
async function vigiar() {
  try {
    const { chamadas } = await (await fetch(`${META}/_chamadas`)).json();
    if (chamadas.length < lidos) lidos = 0;
    for (let i = lidos; i < chamadas.length; i++) {
      const c = chamadas[i];
      if (c.action === 'connect') {
        // O dublê numera a chamada pela posição na lista.
        linha = {
          id: `wacid.DUBLE.${i + 1}`,
          direcao: 'BUSINESS_INITIATED',
          estado: 'tocando_aqui',
          oferta: c.session.sdp,
          resposta: null,
          opaco: c.biz_opaque_callback_data,
          inicio: null,
          tocouEm: Date.now(),
        };
        await webhook('calls', {
          statuses: [
            {
              id: linha.id,
              type: 'call',
              status: 'RINGING',
              timestamp: agora(),
              recipient_id: CLIENTE,
              biz_opaque_callback_data: linha.opaco,
            },
          ],
        });
      } else if (linha && c.call_id === linha.id) {
        if (c.action === 'pre_accept' || c.action === 'accept') {
          linha.resposta = c.session.sdp;
          if (c.action === 'accept') {
            linha.estado = 'em_ligacao';
            linha.inicio = Math.floor(Date.now() / 1000);
          }
        } else if (c.action === 'terminate' || c.action === 'reject') {
          await terminou('A Imova desligou');
        }
      }
    }
    lidos = chamadas.length;
    // A Meta dá até 60 s para atender.
    if (linha && ['tocando_la', 'tocando_aqui'].includes(linha.estado) && Date.now() - linha.tocouEm > 60_000) {
      await terminou('Não atendida');
    }
  } catch (e) {
    console.error('vigia:', e.message);
  }
  setTimeout(vigiar, 400);
}

function responder(res, status, corpo, tipo = 'application/json') {
  res.writeHead(status, { 'content-type': tipo, 'cache-control': 'no-store' });
  res.end(tipo === 'application/json' ? JSON.stringify(corpo) : corpo);
}

const ACOES = {
  async mensagem({ texto }) {
    let conversa = sql(`select id from public.conversations where peer_phone_e164 = '+${CLIENTE}'`);
    if (!conversa) {
      conversa = sql(
        `insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, status)
         values ('whatsapp', '+${NUMERO_DA_EMPRESA}', '+${CLIENTE}', '${NOME}', 'aguardando_nos') returning id`,
      ).split('\n')[0];
    }
    const seguro = String(texto ?? 'Oi!').replaceAll("'", "''");
    sql(
      `insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin, wa_message_id)
       values ('${conversa}', 'in', 'text', 'received', '${seguro}', 'system', 'crm', 'wamid.LOCAL.${Date.now()}')`,
    );
    return { conversa };
  },
  async ligar({ sdp }) {
    linha = {
      id: `wacid.LOCAL.${Date.now()}`,
      direcao: 'USER_INITIATED',
      estado: 'tocando_la',
      oferta: null,
      resposta: null,
      opaco: null,
      inicio: null,
      tocouEm: Date.now(),
    };
    await webhook('calls', {
      contacts: CONTATOS,
      calls: [
        {
          id: linha.id,
          from: CLIENTE,
          to: NUMERO_DA_EMPRESA,
          event: 'connect',
          direction: 'USER_INITIATED',
          timestamp: agora(),
          session: { sdp_type: 'offer', sdp },
        },
      ],
    });
    return {};
  },
  async atender({ sdp }) {
    await webhook('calls', {
      contacts: CONTATOS,
      calls: [
        {
          id: linha.id,
          from: NUMERO_DA_EMPRESA,
          to: CLIENTE,
          event: 'connect',
          direction: 'BUSINESS_INITIATED',
          biz_opaque_callback_data: linha.opaco,
          timestamp: agora(),
          session: { sdp_type: 'answer', sdp },
        },
      ],
    });
    await webhook('calls', {
      statuses: [
        {
          id: linha.id,
          type: 'call',
          status: 'ACCEPTED',
          timestamp: agora(),
          recipient_id: CLIENTE,
          biz_opaque_callback_data: linha.opaco,
        },
      ],
    });
    linha.estado = 'em_ligacao';
    linha.inicio = Math.floor(Date.now() / 1000);
    return {};
  },
  async recusar() {
    await webhook('calls', {
      statuses: [
        {
          id: linha.id,
          type: 'call',
          status: 'REJECTED',
          timestamp: agora(),
          recipient_id: CLIENTE,
          biz_opaque_callback_data: linha.opaco,
        },
      ],
    });
    await terminou('Você recusou');
    return {};
  },
  async desligar() {
    await terminou('Você desligou');
    return {};
  },
  async permissao({ resposta, permanente }) {
    // O robô não roda aqui: o pedido que estava na fila conta como enviado.
    sql(
      `update public.messages set status = 'sent', sent_at = now(), wa_message_id = 'wamid.LOCAL.PEDIDO.' || id
        where status = 'queued' and template_params ->> 'permissao_de_ligar' = 'true'
          and conversation_id in (select id from public.conversations where peer_phone_e164 = '+${CLIENTE}')`,
    );
    await webhook('messages', {
      contacts: CONTATOS,
      messages: [
        {
          id: `wamid.PERM.${Date.now()}`,
          from: CLIENTE,
          timestamp: agora(),
          type: 'interactive',
          interactive: {
            type: 'call_permission_reply',
            call_permission_reply:
              resposta === 'accept'
                ? {
                    response: 'accept',
                    is_permanent: Boolean(permanente),
                    ...(permanente
                      ? {}
                      : { expiration_timestamp: String(Math.floor(Date.now() / 1000) + 7 * 86400) }),
                    response_source: 'user_action',
                  }
                : { response: 'reject', response_source: 'user_action' },
          },
        },
      ],
    });
    return {};
  },
};

const servidor = createServer((req, res) => {
  const caminho = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && caminho === '/') return responder(res, 200, PAGINA, 'text/html; charset=utf-8');
  if (req.method === 'GET' && caminho === '/estado') {
    return responder(res, 200, linha ?? { estado: 'parado' });
  }
  const acao = ACOES[caminho.slice(1)];
  if (req.method !== 'POST' || !acao) return responder(res, 404, { erro: 'não existe' });
  let cru = '';
  req.on('data', (p) => (cru += p));
  req.on('end', async () => {
    try {
      responder(res, 200, await acao(cru ? JSON.parse(cru) : {}));
    } catch (e) {
      console.error(caminho, e.message);
      responder(res, 500, { erro: e.message });
    }
  });
});

const PAGINA = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Celular do cliente (simulado)</title>
<style>
  :root { color-scheme: light dark; --fundo: #f4f3ef; --cartao: #fff; --texto: #161615; --apagado: #5a5a55; --verde: #0b6b52; --vermelho: #b3261e; --linha: #dcd8cf; }
  @media (prefers-color-scheme: dark) { :root { --fundo: #0d0d0c; --cartao: #1b1b1a; --texto: #f4f4f3; --apagado: #a3a3a2; --verde: #2f9e7e; --vermelho: #d9534c; --linha: #333331; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; background: var(--fundo); color: var(--texto); font: 16px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; padding: 16px; }
  main { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 12px; }
  h1 { margin: 0; font-size: 20px; }
  p { margin: 0; }
  .nota { color: var(--apagado); font-size: 14px; }
  section { background: var(--cartao); border: 1px solid var(--linha); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  h2 { margin: 0; font-size: 15px; }
  button { min-height: 44px; border-radius: 22px; border: 1px solid var(--linha); background: transparent; color: var(--texto); font: inherit; font-weight: 600; padding: 0 16px; cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  .verde { background: var(--verde); border-color: var(--verde); color: #fff; }
  .vermelho { background: var(--vermelho); border-color: var(--vermelho); color: #fff; }
  .linha { display: flex; gap: 8px; flex-wrap: wrap; }
  .linha button { flex: 1 1 140px; }
  #estado { font-size: 18px; font-weight: 600; }
  #medidor { height: 8px; border-radius: 4px; background: var(--linha); overflow: hidden; }
  #nivel { height: 100%; width: 0; background: var(--verde); }
  label { display: flex; gap: 8px; align-items: center; font-size: 14px; color: var(--apagado); }
  input[type=text] { width: 100%; min-height: 44px; border-radius: 10px; border: 1px solid var(--linha); background: transparent; color: inherit; font: inherit; padding: 0 12px; }
</style>
</head>
<body>
<main>
  <h1>Celular do cliente (simulado)</h1>
  <p class="nota">Teste local: faz o papel do WhatsApp de ${NOME}. Nada aqui fala com a Meta.</p>

  <section aria-labelledby="t1">
    <h2 id="t1">Ligação</h2>
    <p id="estado" aria-live="polite">Parado</p>
    <div id="medidor" role="img" aria-label="Volume do que o cliente está ouvindo"><div id="nivel"></div></div>
    <p class="nota">A barra mostra o som que chega ao cliente: fale no CRM e veja ela subir.</p>
    <div class="linha">
      <button id="ligar" class="verde">Ligar para a Imova</button>
      <button id="atender" class="verde" hidden>Atender</button>
      <button id="recusar" hidden>Recusar</button>
      <button id="desligar" class="vermelho" hidden>Desligar</button>
    </div>
    <label><input type="checkbox" id="microfone"> Falar com o meu microfone (use fone, para não dar eco). Sem isso, o cliente manda um tom.</label>
  </section>

  <section aria-labelledby="t2">
    <h2 id="t2">Conversa</h2>
    <label for="texto" style="display:block">Mensagem do cliente</label>
    <input id="texto" type="text" value="Oi! Prefiro falar por ligação, pode ser?">
    <button id="mensagem">Mandar mensagem</button>
    <p class="nota">Abre as 24 h da conversa, sem as quais o CRM não deixa pedir permissão.</p>
  </section>

  <section aria-labelledby="t3">
    <h2 id="t3">Pedido de permissão</h2>
    <p class="nota">Depois de clicar em "Pedir para ligar" no CRM, responda aqui. No WhatsApp real, os nomes das opções são outros.</p>
    <div class="linha">
      <button id="p7" class="verde">Permitir por 7 dias</button>
      <button id="psempre">Sempre permitir</button>
      <button id="pnao">Agora não</button>
    </div>
    <p id="retorno" class="nota" aria-live="polite"></p>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const post = async (acao, corpo) => {
  const r = await fetch('/' + acao, { method: 'POST', body: JSON.stringify(corpo ?? {}) });
  if (!r.ok) throw new Error((await r.json()).erro);
};
let pc = null, fluxo = null, audio = null, ctx = null, analisador = null, dados = null;
let aplicada = false, respondida = false, idAtual = null, preparando = false;

async function novaConexao() {
  ctx = new AudioContext();
  // Sem esperar: em aba de fundo a promessa pode não voltar, e a ligação não sairia.
  ctx.resume().catch(() => {});
  if ($('microfone').checked) {
    fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
  } else {
    const osc = ctx.createOscillator();
    const volume = ctx.createGain();
    volume.gain.value = 0.05;
    const destino = ctx.createMediaStreamDestination();
    osc.connect(volume).connect(destino);
    osc.start();
    fluxo = destino.stream;
  }
  pc = new RTCPeerConnection({ iceServers: [] });
  fluxo.getTracks().forEach((t) => pc.addTrack(t, fluxo));
  pc.ontrack = (e) => {
    audio = new Audio();
    audio.srcObject = e.streams[0];
    audio.play().catch(() => {});
    analisador = ctx.createAnalyser();
    analisador.fftSize = 512;
    dados = new Uint8Array(analisador.fftSize);
    ctx.createMediaStreamSource(e.streams[0]).connect(analisador);
  };
}
async function coletar() {
  if (pc.iceGatheringState !== 'complete') {
    await new Promise((r) => {
      pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && r());
      setTimeout(r, 2500);
    });
  }
  return pc.localDescription.sdp;
}
function fechar() {
  pc?.close(); pc = null;
  fluxo?.getTracks().forEach((t) => t.stop()); fluxo = null;
  if (audio) audio.srcObject = null;
  ctx?.close(); ctx = null; analisador = null;
  $('nivel').style.width = '0';
  aplicada = false; respondida = false;
}
function medir() {
  if (analisador) {
    analisador.getByteTimeDomainData(dados);
    let pico = 0;
    for (const v of dados) pico = Math.max(pico, Math.abs(v - 128));
    $('nivel').style.width = Math.min(100, (pico / 128) * 300) + '%';
  }
  requestAnimationFrame(medir);
}
medir();

const ROTULOS = { parado: 'Parado', tocando_la: 'Chamando a Imova...', tocando_aqui: 'A Imova está ligando', em_ligacao: 'Em ligação' };

async function atualizar() {
  try {
    const l = await (await fetch('/estado')).json();
    if (l.id !== idAtual) { if (idAtual && pc && l.direcao === 'BUSINESS_INITIATED') fechar(); idAtual = l.id; aplicada = false; respondida = false; }
    $('estado').textContent = l.estado === 'fim' ? (l.motivo || 'Ligação encerrada') : (ROTULOS[l.estado] || l.estado);
    const fim = l.estado === 'fim' || l.estado === 'parado';
    $('ligar').hidden = !fim;
    $('atender').hidden = !(l.estado === 'tocando_aqui' && !respondida);
    $('recusar').hidden = !(l.estado === 'tocando_aqui' && !respondida);
    $('desligar').hidden = fim || (l.estado === 'tocando_aqui' && !respondida);
    if (l.direcao === 'USER_INITIATED' && l.resposta && pc && !aplicada) {
      aplicada = true;
      await pc.setRemoteDescription({ type: 'answer', sdp: l.resposta });
    }
    // Enquanto a ligação nasce, o estado ainda é o da anterior: não fechar a conexão nova.
    if (fim && pc && !preparando) fechar();
  } catch (e) { console.error(e); }
  setTimeout(atualizar, 400);
}
atualizar();

const falha = (e) => { $('estado').textContent = 'Não deu certo: ' + e.message; console.error(e); };
$('ligar').onclick = () => (async () => {
  preparando = true;
  await novaConexao();
  await pc.setLocalDescription(await pc.createOffer());
  await post('ligar', { sdp: await coletar() });
})().catch(falha).finally(() => { preparando = false; });
$('atender').onclick = () => (async () => {
  preparando = true;
  respondida = true;
  const l = await (await fetch('/estado')).json();
  await novaConexao();
  await pc.setRemoteDescription({ type: 'offer', sdp: l.oferta });
  await pc.setLocalDescription(await pc.createAnswer());
  await post('atender', { sdp: await coletar() });
})().catch(falha).finally(() => { preparando = false; });
$('recusar').onclick = () => post('recusar');
$('desligar').onclick = () => post('desligar');
const aviso = async (p, frase) => { try { await p; $('retorno').textContent = frase; } catch (e) { $('retorno').textContent = 'Não deu certo: ' + e.message; } };
$('mensagem').onclick = () => aviso(post('mensagem', { texto: $('texto').value }), 'Mensagem enviada. Abra a conversa no CRM.');
$('p7').onclick = () => aviso(post('permissao', { resposta: 'accept', permanente: false }), 'Permitiu por 7 dias.');
$('psempre').onclick = () => aviso(post('permissao', { resposta: 'accept', permanente: true }), 'Permitiu sem prazo.');
$('pnao').onclick = () => aviso(post('permissao', { resposta: 'reject' }), 'Recusou.');
</script>
</body>
</html>`;

servidor.listen(PORTA, '127.0.0.1', async () => {
  console.log(`Celular do cliente em http://127.0.0.1:${PORTA}`);
  // O que já estava no dublê é de outro ensaio: só vale o que chegar daqui em diante.
  try {
    lidos = (await (await fetch(`${META}/_chamadas`)).json()).chamadas.length;
  } catch {
    console.error(`O dublê da Meta não respondeu em ${META}. Suba-o antes de testar.`);
  }
  vigiar();
});
