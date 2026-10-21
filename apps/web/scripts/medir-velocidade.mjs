/**
 * Mede o CRM no celular, do jeito que a pessoa usa: tocando no menu e nos cartões.
 *
 * É o percurso usado para medir a etapa de velocidade de 20 e 21/10/2026 (ver o
 * CHANGELOG), agora no repositório. Celular 390×844 com toque, perfil "slow 4G" do
 * Lighthouse (150 ms, 1,6 Mbps de descida, 750 kbps de subida) e processador 4× mais
 * lento. Para cada toque, duas medidas:
 *
 *   - resposta ao toque: o clique até a primeira mudança na tela (o item do menu
 *     acender, o cartão esmaecer ou o conteúdo novo);
 *   - pronto: o clique até o conteúdo da tela nova estar lá.
 *
 * Gestor: Prospectados → abrir ficha → voltar à lista → Conversas → Lotes → abrir o
 * lote → Meu dia. SDR: Lotes → abrir o lote → Meu dia. Nada de telefonia: as chamadas
 * de voz e a montagem de lote são bloqueadas antes de sair.
 *
 * Uso (de apps/web), com builds de produção (`next build` + `next start`), nunca `next dev`:
 *   node scripts/medir-velocidade.mjs --a http://localhost:3200 [--b http://localhost:3201] [--rodadas 4]
 *
 * Com --b, as rodadas alternam A e B, para a máquina pesar igual nas duas. Os tempos
 * valem para comparar na mesma máquina e no mesmo banco local; o banco local tem bem
 * menos dado que a produção.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';

import { idsDeTeste } from './banco-local.mjs';
import { criarSessaoDev } from './sessao-dev.mjs';

const PAPEIS = { gestor: 'gestor.teste@teste.local', sdr: 'sdr.teste@teste.local' };
const REDE_4G = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

async function umaRodada(navegador, base, papel, storageState, lotePreferido) {
  const contexto = await navegador.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    storageState,
    timezoneId: 'America/Fortaleza',
    locale: 'pt-BR',
  });
  const p = await contexto.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e).slice(0, 120)));
  await p.route(/voz-token|iniciar_chamada|voz_abrir_ligacao|montar_lote_avulso/, (r) => r.abort());

  const cdp = await contexto.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.emulateNetworkConditions', REDE_4G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const tipos = new Map();
  let jsBytes = 0;
  cdp.on('Network.responseReceived', (e) => tipos.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => {
    if (tipos.get(e.requestId) === 'Script') jsBytes += e.encodedDataLength;
  });

  const r = {};
  const ocioso = async () => {
    await p.waitForLoadState('networkidle').catch(() => {});
    await p.waitForTimeout(1200);
  };
  const semCarregando = () =>
    p.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'), null, { timeout: 60_000 });

  let t0 = Date.now();
  await p.goto(`${base}/meu-dia`, { waitUntil: 'commit' });
  await p.locator('main h1').first().waitFor({ timeout: 60_000 });
  r['1ª abertura do Meu dia'] = Date.now() - t0;
  await p.waitForLoadState('networkidle').catch(() => {});
  r['código baixado na 1ª abertura (KB)'] = Math.round(jsBytes / 1024);
  const agoraNao = p.getByRole('button', { name: 'Agora não' });
  if (await agoraNao.isVisible().catch(() => false)) await agoraNao.click();
  await ocioso();

  async function tocar(nome, alvo, pronto) {
    await p.evaluate(() => {
      window.__mudou = null;
      const obs = new MutationObserver(() => {
        if (window.__mudou === null) window.__mudou = performance.now();
        obs.disconnect();
      });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
      window.__t0 = performance.now();
    });
    t0 = Date.now();
    await (await alvo()).click();
    await pronto();
    r[`${nome}: pronto`] = Date.now() - t0;
    r[`${nome}: resposta ao toque`] = await p.evaluate(() =>
      window.__mudou === null ? null : Math.round(window.__mudou - window.__t0),
    );
    await ocioso();
  }

  if (papel === 'gestor') {
    const cartao = () => p.locator('main ul li a[href^="/parceiros/"]:visible').first();
    await tocar(
      'Prospectados',
      () => p.locator('a[href="/parceiros"]:visible').last(),
      () => p.waitForURL(/\/parceiros$/, { timeout: 60_000 }).then(() => cartao().waitFor({ timeout: 60_000 })),
    );
    await tocar('abrir ficha', cartao, () =>
      p
        .waitForURL(/\/parceiros\/[0-9a-f-]{36}/, { timeout: 60_000 })
        .then(() => p.locator('main header h1').first().waitFor({ timeout: 60_000 })),
    );
    await tocar(
      'voltar à lista',
      () => p.locator('main a[href="/parceiros"]:visible').first(),
      () => p.waitForURL(/\/parceiros$/).then(() => cartao().waitFor({ timeout: 60_000 })),
    );
    await tocar(
      'Conversas',
      () => p.locator('a[href^="/conversas"]:visible').last(),
      () =>
        p
          .waitForURL(/\/conversas/)
          .then(() => p.locator('main h1, main [role="tablist"]').first().waitFor({ timeout: 60_000 }))
          .then(semCarregando),
    );
  }
  await tocar(
    'Lotes',
    () => p.locator('a[href="/ligar"]:visible').last(),
    () => p.waitForURL(/\/ligar$/, { timeout: 60_000 }).then(() => p.locator('main a[href^="/ligar/"]').first().waitFor({ timeout: 60_000 })),
  );
  await tocar(
    'abrir o lote',
    async () => {
      const preferido = p.locator(`main a[href="/ligar/${lotePreferido}"]`);
      return (await preferido.count()) ? preferido.first() : p.locator('main a[href^="/ligar/"]').first();
    },
    () =>
      p.waitForURL(/\/ligar\/[0-9a-f-]{36}/, { timeout: 60_000 }).then(() =>
        p.waitForFunction(
          () => [...document.querySelectorAll('main button')].some((b) => /Liguei|Ligar|Copiar número/.test(b.textContent)),
          null,
          { timeout: 60_000 },
        ),
      ),
  );
  await tocar(
    'Meu dia de novo',
    () => p.locator('a[href="/meu-dia"]:visible').last(),
    () => p.waitForURL(/\/meu-dia/).then(() => p.locator('main h1').first().waitFor({ timeout: 60_000 })).then(semCarregando),
  );
  r['erros na tela'] = erros.length;
  await contexto.close();
  return r;
}

const mediana = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

async function principal() {
  const argv = process.argv.slice(2);
  const opcao = (nome, padrao = null) => {
    const i = argv.indexOf(nome);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
  };
  const versoes = Object.fromEntries(
    [
      ['A', opcao('--a')],
      ['B', opcao('--b')],
    ].filter(([, url]) => url),
  );
  if (!versoes.A) throw new Error('Informe --a <url> (e --b <url> para comparar).');
  const rodadas = Number(opcao('--rodadas', '4'));
  const quando = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const pasta = resolve(opcao('--saida', join(homedir(), 'triadecrm-medicoes', quando)));
  mkdirSync(pasta, { recursive: true });

  const lote = idsDeTeste().lotes[0];
  const sessoes = {};
  for (const [papel, email] of Object.entries(PAPEIS)) sessoes[papel] = (await criarSessaoDev(email)).storageState;

  const navegador = await chromium.launch({ channel: 'chrome', headless: true });
  const nomes = Object.keys(versoes);
  const res = Object.fromEntries(Object.keys(PAPEIS).map((p) => [p, Object.fromEntries(nomes.map((v) => [v, []]))]));
  try {
    for (let i = 0; i < rodadas; i += 1) {
      for (const papel of Object.keys(PAPEIS)) {
        for (const v of i % 2 ? [...nomes].reverse() : nomes) {
          try {
            res[papel][v].push(await umaRodada(navegador, versoes[v].replace(/\/$/, ''), papel, sessoes[papel], lote));
          } catch (e) {
            console.error(`rodada ${i + 1} ${papel} ${v} falhou: ${String(e).slice(0, 200)}`);
          }
        }
      }
      console.error(`rodada ${i + 1}/${rodadas} feita`);
    }
  } finally {
    await navegador.close();
  }

  const linhas = [`# Velocidade no celular (4G, CPU 4×), medianas em ms`, ''];
  for (const v of nomes) linhas.push(`- ${v}: ${versoes[v]}`);
  linhas.push('');
  for (const papel of Object.keys(PAPEIS)) {
    const chaves = Object.keys(res[papel][nomes[0]][0] ?? {});
    linhas.push(`## ${papel} (${nomes.map((v) => `${res[papel][v].length} rodadas em ${v}`).join(', ')})`, '');
    linhas.push(`| Medida | ${nomes.join(' | ')} |`, `|---|${nomes.map(() => '---').join('|')}|`);
    for (const k of chaves) linhas.push(`| ${k} | ${nomes.map((v) => mediana(res[papel][v].map((r) => r[k])) ?? '—').join(' | ')} |`);
    linhas.push('');
  }
  const markdown = linhas.join('\n');
  writeFileSync(join(pasta, 'velocidade.md'), markdown);
  writeFileSync(join(pasta, 'velocidade.json'), JSON.stringify({ versoes, rodadas, res }, null, 1));
  console.log(markdown);
  console.error(`\nGravado em ${pasta}`);
}

await principal();
