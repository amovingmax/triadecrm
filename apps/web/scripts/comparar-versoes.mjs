/**
 * Compara duas versões do CRM tela a tela: a prova de que uma mudança não alterou o
 * que já existia.
 *
 * Abre as mesmas telas nas duas versões, como gestor e como SDR, no PC (1440×900) e no
 * celular (390×844, toque), e guarda de cada uma: endereço final, status, título, texto
 * do <main>, itens visíveis do menu, erros de JavaScript, avisos do console, respostas
 * com erro (>= 400) e uma foto da janela. Depois compara A (a referência) com B.
 *
 * Diferença de endereço, status, menu ou erro novo em B reprova (código de saída 1).
 * Diferença de texto ou de foto entra no relatório para conferir: relógio ("há 8 h"),
 * o lote (abrir reserva o próximo contato) e a conversa aberta (abrir marca como lida)
 * mudam o banco entre uma visita e outra. Por isso as duas versões são visitadas
 * intercaladas, tela a tela, no mesmo banco local.
 *
 * Uso (de apps/web), com dois builds de produção no ar:
 *   node scripts/comparar-versoes.mjs lado-a-lado --a http://localhost:3200 --b http://localhost:3201 \
 *     [--saida <pasta>] [--papel gestor|sdr] [--tela pc|celular]
 *   node scripts/comparar-versoes.mjs comparar <pastaA> <pastaB> [--saida <pasta>]
 *
 * Para guardar só a fotografia de uma versão (linha de base), passe --a e omita --b.
 * Bases em `localhost`, que é o domínio dos cookies de `sessao-dev.mjs`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';

import { idsDeTeste } from './banco-local.mjs';
import { criarSessaoDev } from './sessao-dev.mjs';

const PAPEIS = {
  gestor: 'gestor.teste@teste.local',
  sdr: 'sdr.teste@teste.local',
};

const TELAS = {
  pc: { viewport: { width: 1440, height: 900 }, isMobile: false },
  celular: { viewport: { width: 390, height: 844 }, isMobile: true },
};

/** Fração de pixels diferentes a partir da qual a foto entra no relatório. */
const LIMIAR_FOTO = 0.005;

function rotas() {
  const { fichas, lotes, conversas } = idsDeTeste();
  return [
    '/meu-dia',
    '/agenda',
    '/conversas',
    '/conversas?ver=todas',
    '/conversas?aba=consultoria',
    '/conversas?aba=clientes',
    '/conversas?aba=automaticas',
    ...conversas.map((id) => `/conversas?org=${id}`),
    '/envios',
    '/funis',
    '/importar',
    '/ligar',
    ...lotes.map((id) => `/ligar/${id}`),
    '/metas',
    '/parceiros',
    ...fichas.map((id) => `/parceiros/${id}`),
    '/parceiros/excluidos',
    '/registrar',
    '/relatorios',
    '/revisao',
    '/admin',
  ];
}

/** `/conversas?aba=clientes` → `conversas_aba-clientes`. */
const nomeDaFoto = (papel, tela, rota) =>
  `${papel}-${tela}-${rota.replace(/^\//, '').replace(/[/?=&]/g, (c) => (c === '/' ? '_' : '-'))}.png`;

/** Tira do texto o que muda com o relógio, para o relógio não virar diferença. */
const semRelogio = (texto) =>
  texto
    .replace(/há \d+\s*(s|seg|min|minutos?|h|horas?|d|dias?)\b/gi, 'há ⏱')
    .replace(/\b\d{1,2}:\d{2}\b/g, '⏱')
    .replace(/\b\d+\s*(s|min|h)\s+atrás\b/gi, '⏱ atrás');

async function abrirContexto(navegador, tela, storageState) {
  const contexto = await navegador.newContext({
    viewport: TELAS[tela].viewport,
    isMobile: TELAS[tela].isMobile,
    hasTouch: TELAS[tela].isMobile,
    colorScheme: 'dark',
    locale: 'pt-BR',
    timezoneId: 'America/Fortaleza',
    storageState,
  });
  const pagina = await contexto.newPage();
  const vigia = { atual: null };
  pagina.on('console', (m) => {
    if (vigia.atual && (m.type() === 'error' || m.type() === 'warning')) {
      vigia.atual.console.push(`${m.type()}: ${m.text().slice(0, 300)}`);
    }
  });
  pagina.on('pageerror', (e) => vigia.atual?.erros.push(String(e).slice(0, 300)));
  pagina.on('response', (r) => {
    const url = r.url();
    if (!vigia.atual || r.status() < 400 || url.includes('favicon')) return;
    vigia.atual.falhas.push(`${r.status()} ${r.request().method()} ${url.replace(/^https?:\/\/[^/]+/, '').slice(0, 160)}`);
  });
  return { contexto, pagina, vigia };
}

async function fotografar(aberto, base, papel, tela, rota, pastaFotos) {
  const { pagina, vigia } = aberto;
  const item = { papel, tela, rota, console: [], erros: [], falhas: [] };
  vigia.atual = item;
  const t0 = Date.now();
  try {
    const resposta = await pagina.goto(base + rota, { timeout: 60_000 });
    item.status = resposta?.status() ?? null;
    await pagina.locator('main').first().waitFor({ timeout: 15_000 }).catch(() => {});
    await pagina.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await pagina
      .waitForFunction(() => !document.querySelector('main [aria-busy="true"]'), null, { timeout: 20_000 })
      .catch(() => item.erros.push('(ainda carregando depois de 20 s)'));
    const agoraNao = pagina.getByRole('button', { name: 'Agora não' });
    if (await agoraNao.isVisible().catch(() => false)) await agoraNao.click().catch(() => {});
    await pagina.waitForTimeout(800);

    const url = new URL(pagina.url());
    item.final = url.pathname + url.search;
    item.titulo = await pagina.title();
    item.texto = await pagina.evaluate(() =>
      (document.querySelector('main')?.innerText ?? document.body.innerText).replace(/[ \t]+/g, ' ').trim(),
    );
    item.menu = await pagina.evaluate(() =>
      [...document.querySelectorAll('nav a[href]')]
        .filter((a) => a.offsetParent !== null)
        .map((a) => `${a.getAttribute('href')}=${a.innerText.replace(/\s+/g, ' ').trim()}`)
        .join(' | '),
    );
    item.foto = nomeDaFoto(papel, tela, rota);
    await pagina.screenshot({ path: join(pastaFotos, item.foto), animations: 'disabled', caret: 'hide' });
  } catch (e) {
    item.erros.push(`(falhou ao abrir) ${String(e).slice(0, 200)}`);
  }
  item.ms = Date.now() - t0;
  vigia.atual = null;
  return item;
}

/** Visita as telas em uma ou duas versões, intercaladas, e grava cada captura na sua pasta. */
async function capturar(bases, pastas, filtro) {
  const lista = rotas();
  const navegador = await chromium.launch({ channel: 'chrome', headless: true });
  const capturas = bases.map((base) => ({ base, quando: new Date().toISOString(), itens: [] }));
  for (const pasta of pastas) mkdirSync(join(pasta, 'fotos'), { recursive: true });

  try {
    for (const [papel, email] of Object.entries(PAPEIS).filter(([p]) => !filtro.papel || p === filtro.papel)) {
      const { storageState } = await criarSessaoDev(email);
      for (const tela of Object.keys(TELAS).filter((t) => !filtro.tela || t === filtro.tela)) {
        const abertos = await Promise.all(bases.map(() => abrirContexto(navegador, tela, storageState)));
        try {
          for (const rota of lista) {
            for (let i = 0; i < bases.length; i += 1) {
              const item = await fotografar(abertos[i], bases[i], papel, tela, rota, join(pastas[i], 'fotos'));
              capturas[i].itens.push(item);
            }
            console.error(`${papel} ${tela} ${rota}`);
          }
        } finally {
          await Promise.all(abertos.map(({ contexto }) => contexto.close()));
        }
      }
    }
  } finally {
    await navegador.close();
  }

  capturas.forEach((captura, i) => writeFileSync(join(pastas[i], 'captura.json'), JSON.stringify(captura, null, 1)));
  return capturas;
}

/** Conta os pixels diferentes de duas fotos, num canvas do próprio navegador. */
async function compararFotos(pagina, caminhoA, caminhoB) {
  const comoDado = (caminho) => `data:image/png;base64,${readFileSync(caminho).toString('base64')}`;
  return pagina.evaluate(
    async ({ a, b }) => {
      const carregar = (src) =>
        new Promise((ok, erro) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = () => erro(new Error('foto ilegível'));
          img.src = src;
        });
      const [ia, ib] = await Promise.all([carregar(a), carregar(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { razao: 1, tamanhoDiferente: true };
      const { width: w, height: h } = ia;
      const ler = (img) => {
        const ctx = new OffscreenCanvas(w, h).getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h);
      };
      const da = ler(ia).data;
      const marcada = ler(ib);
      const db = marcada.data;
      let diferentes = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        if (d > 24) {
          diferentes += 1;
          db[i] = 255;
          db[i + 1] = 0;
          db[i + 2] = 64;
        } else {
          db[i] *= 0.3;
          db[i + 1] *= 0.3;
          db[i + 2] *= 0.3;
        }
      }
      if (diferentes === 0) return { razao: 0 };
      const tela = new OffscreenCanvas(w, h);
      tela.getContext('2d').putImageData(marcada, 0, 0);
      const bytes = new Uint8Array(await (await tela.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let binario = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { razao: diferentes / (w * h), marcada: btoa(binario) };
    },
    { a: comoDado(caminhoA), b: comoDado(caminhoB) },
  );
}

/** Linhas que existem só de um lado, depois de tirar o relógio. */
function linhasDiferentes(textoA = '', textoB = '') {
  const a = new Set(semRelogio(textoA).split('\n'));
  const b = new Set(semRelogio(textoB).split('\n'));
  return {
    soA: [...a].filter((l) => l && !b.has(l)).slice(0, 4),
    soB: [...b].filter((l) => l && !a.has(l)).slice(0, 4),
  };
}

async function comparar(pastaA, pastaB, pastaSaida) {
  const A = JSON.parse(readFileSync(join(pastaA, 'captura.json'), 'utf8'));
  const B = JSON.parse(readFileSync(join(pastaB, 'captura.json'), 'utf8'));
  const chave = (i) => `${i.papel}|${i.tela}|${i.rota}`;
  const deB = new Map(B.itens.map((i) => [chave(i), i]));
  mkdirSync(join(pastaSaida, 'diferencas'), { recursive: true });

  const navegador = await chromium.launch({ channel: 'chrome', headless: true });
  const pagina = await navegador.newPage();
  await pagina.setContent('<!doctype html><title>comparar</title>');

  const linhas = [];
  let reprovadas = 0;
  let paraConferir = 0;
  try {
    for (const a of A.itens) {
      const b = deB.get(chave(a));
      const motivos = [];
      const conferir = [];
      if (!b) {
        motivos.push('tela ausente em B');
      } else {
        if (a.final !== b.final) motivos.push(`endereço: ${a.final} → ${b.final}`);
        if (a.status !== b.status) motivos.push(`status: ${a.status} → ${b.status}`);
        if (a.menu !== b.menu) motivos.push('menu diferente');
        const novos = (lista, deA) => lista.filter((x) => !deA.includes(x));
        const erros = [...novos(b.erros, a.erros), ...novos(b.falhas, a.falhas), ...novos(b.console, a.console)];
        if (erros.length) motivos.push(`erro novo: ${erros.slice(0, 2).join(' / ')}`);
        if (a.titulo !== b.titulo) conferir.push(`título: "${a.titulo}" → "${b.titulo}"`);
        const { soA, soB } = linhasDiferentes(a.texto, b.texto);
        if (soA.length || soB.length) conferir.push(`texto: −[${soA.join(' ¦ ')}] +[${soB.join(' ¦ ')}]`);
        if (a.foto && b.foto) {
          const { razao, marcada, tamanhoDiferente } = await compararFotos(
            pagina,
            join(pastaA, 'fotos', a.foto),
            join(pastaB, 'fotos', b.foto),
          );
          if (razao > LIMIAR_FOTO) {
            conferir.push(`foto: ${tamanhoDiferente ? 'tamanho diferente' : `${(razao * 100).toFixed(1)}% dos pixels`}`);
            if (marcada) writeFileSync(join(pastaSaida, 'diferencas', b.foto), Buffer.from(marcada, 'base64'));
          }
        }
      }
      if (motivos.length) reprovadas += 1;
      else if (conferir.length) paraConferir += 1;
      if (motivos.length || conferir.length) {
        const cel = (s) => s.replace(/\|/g, '/').replace(/\n/g, ' ');
        linhas.push(
          `| ${a.papel} | ${a.tela} | \`${a.rota}\` | ${motivos.length ? '❌ ' + cel(motivos.join('; ')) : '—'} | ${cel(conferir.join('; ')) || '—'} |`,
        );
      }
    }
  } finally {
    await navegador.close();
  }

  const total = A.itens.length;
  const relatorio = [
    `# Comparação de versões`,
    '',
    `A (referência): ${A.base}, ${A.quando}  `,
    `B: ${B.base}, ${B.quando}`,
    '',
    `**${total} telas.** Iguais: ${total - reprovadas - paraConferir}. Para conferir (texto ou foto): ${paraConferir}. ` +
      `Reprovadas (endereço, status, menu ou erro novo): ${reprovadas}.`,
    '',
    ...(linhas.length
      ? ['| Papel | Tela | Rota | Reprova | Conferir |', '|---|---|---|---|---|', ...linhas]
      : ['Nenhuma diferença.']),
    '',
    `Fotos com diferença (vermelho = pixel que mudou): ${join(pastaSaida, 'diferencas')}`,
    '',
  ].join('\n');
  writeFileSync(join(pastaSaida, 'relatorio.md'), relatorio);
  console.log(relatorio);
  return reprovadas;
}

async function principal() {
  const [comando, ...argv] = process.argv.slice(2);
  const opcao = (nome, padrao = null) => {
    const i = argv.indexOf(nome);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
  };
  const quando = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const saida = resolve(opcao('--saida', join(homedir(), 'triadecrm-capturas', quando)));
  const filtro = { papel: opcao('--papel'), tela: opcao('--tela') };

  if (comando === 'lado-a-lado') {
    const a = opcao('--a');
    const b = opcao('--b');
    if (!a) throw new Error('Informe --a <url> (e --b <url> para comparar).');
    const bases = [a, b].filter(Boolean).map((u) => u.replace(/\/$/, ''));
    const pastas = bases.length === 2 ? [join(saida, 'A'), join(saida, 'B')] : [saida];
    await capturar(bases, pastas, filtro);
    if (bases.length === 2) process.exitCode = (await comparar(pastas[0], pastas[1], saida)) ? 1 : 0;
    console.error(`\nGravado em ${saida}`);
  } else if (comando === 'comparar') {
    const [pastaA, pastaB] = argv.filter((x) => !x.startsWith('--') && x !== opcao('--saida'));
    if (!pastaA || !pastaB) throw new Error('Uso: comparar <pastaA> <pastaB> [--saida <pasta>]');
    process.exitCode = (await comparar(resolve(pastaA), resolve(pastaB), saida)) ? 1 : 0;
  } else {
    throw new Error('Comandos: lado-a-lado --a <url> [--b <url>] | comparar <pastaA> <pastaB>');
  }
}

await principal();
