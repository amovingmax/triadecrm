#!/usr/bin/env node
/**
 * Healthcheck dos workers do TRÍADE (ADR-04).
 *
 * Por que não basta "o processo está de pé": o worker roda na máquina do Luiz e consome as filas
 * `pgmq` no Supabase. Um worker vivo mas sem rede, com chave errada ou travado num laço parece
 * saudável para o Docker e está parado para o CRM. Então o healthcheck pergunta ao próprio banco
 * o que a tela do Radar pergunta: "esse worker bateu ponto agora há pouco?"
 * (`public.worker_heartbeats`, escrita por `public.esteira_bater_ponto` — migração 20260904001600).
 *
 * Saudável = existe linha para (worker, instance), `last_beat_at` mais recente que
 * WORKER_HEARTBEAT_MAX_AGE_S e `status` diferente de 'parado'.
 *
 * Uso: node worker-heartbeat.mjs <ingest|wa|ai>
 * Saída: 0 saudável · 1 não saudável (o Docker marca o contêiner como unhealthy).
 *
 * Só usa o Node 22 da própria imagem dos workers: sem dependências, sem instalar nada.
 */

const WORKERS = ['ingest', 'wa', 'ai'];

function falhar(mensagem) {
  process.stderr.write(`${mensagem}\n`);
  process.exit(1);
}

const worker = process.argv[2] ?? process.env.WORKER_NAME ?? '';
if (!WORKERS.includes(worker)) {
  falhar(`healthcheck: informe o worker (${WORKERS.join(' | ')}); recebido: "${worker}"`);
}

const instancia = process.env.WORKER_INSTANCE?.trim() || 'default';
const idadeMaximaS = Number(process.env.WORKER_HEARTBEAT_MAX_AGE_S ?? 600);
const timeoutMs = Number(process.env.WORKER_HEALTHCHECK_TIMEOUT_MS ?? 8000);

if (!Number.isFinite(idadeMaximaS) || idadeMaximaS <= 0) {
  falhar(
    `healthcheck: WORKER_HEARTBEAT_MAX_AGE_S inválido: "${process.env.WORKER_HEARTBEAT_MAX_AGE_S}"`,
  );
}

const supabaseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!supabaseUrl || !chave) {
  falhar(
    'healthcheck: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias (veja .env.example).',
  );
}

const url =
  `${supabaseUrl}/rest/v1/worker_heartbeats` +
  `?select=worker,instance,status,last_beat_at,processed_total,failed_total` +
  `&worker=eq.${encodeURIComponent(worker)}` +
  `&instance=eq.${encodeURIComponent(instancia)}` +
  `&limit=1`;

let resposta;
try {
  resposta = await fetch(url, {
    headers: {
      apikey: chave,
      authorization: `Bearer ${chave}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
} catch (erro) {
  const motivo = erro instanceof Error ? erro.message : String(erro);
  falhar(`healthcheck ${worker}: não consegui falar com o Supabase (${supabaseUrl}): ${motivo}`);
}

if (!resposta.ok) {
  const corpo = (await resposta.text().catch(() => '')).slice(0, 300);
  const dica =
    resposta.status === 404 || corpo.includes('PGRST205')
      ? ' — a tabela worker_heartbeats não existe nesse projeto: as migrações não foram aplicadas.'
      : resposta.status === 401 || resposta.status === 403
        ? ' — chave recusada: confira SUPABASE_SERVICE_ROLE_KEY.'
        : '';
  falhar(`healthcheck ${worker}: Supabase respondeu ${resposta.status}${dica} ${corpo}`);
}

/** @type {Array<{status?: string, last_beat_at?: string, processed_total?: number, failed_total?: number}>} */
const linhas = await resposta.json();
const batida = linhas[0];
if (!batida?.last_beat_at) {
  falhar(
    `healthcheck ${worker}: nenhuma batida de ponto para (worker=${worker}, instance=${instancia}). ` +
      'O worker subiu mas ainda não escreveu em worker_heartbeats.',
  );
}

const idadeS = Math.round((Date.now() - new Date(batida.last_beat_at).getTime()) / 1000);
if (!Number.isFinite(idadeS)) {
  falhar(`healthcheck ${worker}: last_beat_at ilegível: "${batida.last_beat_at}"`);
}
if (idadeS > idadeMaximaS) {
  falhar(
    `healthcheck ${worker}: última batida há ${idadeS}s (limite ${idadeMaximaS}s). ` +
      'O processo está de pé mas parou de trabalhar.',
  );
}
if (batida.status === 'parado') {
  falhar(`healthcheck ${worker}: o próprio worker se declarou "parado" (há ${idadeS}s).`);
}

process.stdout.write(
  `ok ${worker}/${instancia}: batida há ${idadeS}s, status=${batida.status ?? 'ok'}, ` +
    `processados=${batida.processed_total ?? 0}, falhas=${batida.failed_total ?? 0}\n`,
);
