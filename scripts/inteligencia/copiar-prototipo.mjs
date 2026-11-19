#!/usr/bin/env node
// Copia a página pronta do protótipo de Inteligência de mercado para o CRM (18/11/2026).
//
// A "opção B" do plano de integração: o protótipo (uma página só, com os dados dentro)
// é entregue pelo próprio CRM. O script grava a página em gzip em
// apps/web/privado/inteligencia/painel.html.gz (fora de public/ e fora do git), e a
// rota /inteligencia/painel confere login, papel, perfil no banco e empresa antes de
// entregar, com a página em sandbox (apps/web/src/app/(inteligencia)/inteligencia/).
//
// Uso:
//   node scripts/inteligencia/copiar-prototipo.mjs --prototipo <pasta do protótipo> [--dados <pasta>]
//       monta a página com o montar.mjs do protótipo (numa pasta temporária: o
//       protótipo não é tocado) e copia;
//   node scripts/inteligencia/copiar-prototipo.mjs --html <index.html já montado>
//       copia uma página que já foi montada.
//   --saida <arquivo>   outro destino. Terminado em .gz, grava em gzip; senão, o HTML
//       puro (só para olhar: a rota do CRM entrega o .gz).
//   --permitir-mencoes-em-texto   o nome de ZAP, VivaReal, OLX, Imovelweb, Canal Pro,
//       QuintoAndar ou Mercado Livre no texto vira aviso em vez de barrar (só depois de
//       ler cada menção; a página registra quantas foram liberadas). Link e dado desses
//       portais barram sempre (decisão do dono, 18/11/2026).
//   A pasta do protótipo também pode vir em INTELIGENCIA_PROTOTIPO.
//
// Depois de copiar: INTELIGENCIA_EXIGIR_PAGINA=1 pnpm -C apps/web test pagina-pronta
// (confere o arquivo copiado). A página é uma foto: cada atualização é copiar de novo e
// publicar o site da Imova de novo, sempre com pedido do dono.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

import { adaptarParaOCrm, CAMINHO_DA_PAGINA_PRONTA_NO_SITE, ErroDaCopia } from './adaptar.mjs';

const RAIZ_DO_REPOSITORIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PASTA_DO_SITE = join(RAIZ_DO_REPOSITORIO, 'apps', 'web');
const SAIDA_PADRAO = join(PASTA_DO_SITE, CAMINHO_DA_PAGINA_PRONTA_NO_SITE);
/** Onde a página morava antes da revisão de 18/11/2026. Nada da Inteligência pode ficar ali. */
const PASTA_PUBLICA_ANTIGA = join(PASTA_DO_SITE, 'public', 'inteligencia');

function sair(mensagem) {
  console.error(`\n✗ ${mensagem}\n`);
  process.exit(1);
}

function lerOpcoes() {
  try {
    const { values } = parseArgs({
      options: {
        prototipo: { type: 'string' },
        dados: { type: 'string' },
        html: { type: 'string' },
        saida: { type: 'string' },
        'permitir-mencoes-em-texto': { type: 'boolean' },
        ajuda: { type: 'boolean', short: 'h' },
      },
      strict: true,
    });
    return values;
  } catch (erro) {
    sair(`${erro.message}\nUse --ajuda para ver como chamar.`);
  }
}

/** Monta a página com o montar.mjs do protótipo, numa pasta temporária. */
function montar(pastaDoPrototipo, pastaDosDados) {
  const montador = join(pastaDoPrototipo, 'montar.mjs');
  if (!existsSync(montador)) sair(`Não achei ${montador}. A pasta do protótipo está certa?`);
  const dados = pastaDosDados ? resolve(pastaDosDados) : join(pastaDoPrototipo, 'dados');
  if (!existsSync(dados)) sair(`Não achei a pasta de dados ${dados}.`);
  const temporaria = mkdtempSync(join(tmpdir(), 'inteligencia-'));
  const saida = join(temporaria, 'index.html');
  try {
    // O montar.mjs só lê o protótipo e grava onde mandamos: a pasta dele não muda.
    execFileSync(process.execPath, [montador, dados, saida], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    return readFileSync(saida, 'utf8');
  } catch (erro) {
    sair(`O montar.mjs falhou: ${erro.message}`);
  } finally {
    rmSync(temporaria, { recursive: true, force: true });
  }
}

function principal() {
  const opcoes = lerOpcoes();
  if (opcoes.ajuda) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .slice(1, 26)
        .map((l) => l.replace(/^\/\/ ?/, ''))
        .join('\n'),
    );
    return;
  }

  if (existsSync(PASTA_PUBLICA_ANTIGA)) {
    sair(
      `A pasta ${relative(RAIZ_DO_REPOSITORIO, PASTA_PUBLICA_ANTIGA)} existe: nada da Inteligência pode morar em public/ (sai sem login ou sem a conferência da rota). Apague a pasta; a página agora vai para ${CAMINHO_DA_PAGINA_PRONTA_NO_SITE}.`,
    );
  }

  const pastaDoPrototipo = opcoes.prototipo ?? process.env.INTELIGENCIA_PROTOTIPO;
  let html;
  let origem;
  if (opcoes.html) {
    const arquivo = resolve(opcoes.html);
    if (!existsSync(arquivo)) sair(`Não achei ${arquivo}.`);
    html = readFileSync(arquivo, 'utf8');
    // Só o nome da pasta e do arquivo: o caminho inteiro da máquina não vai para o site.
    origem = `${basename(dirname(arquivo))}/${basename(arquivo)}, já montado`;
  } else {
    if (!pastaDoPrototipo)
      sair(
        'Diga onde está o protótipo: --prototipo <pasta> (ou INTELIGENCIA_PROTOTIPO), ou passe --html <arquivo montado>.',
      );
    const pasta = resolve(pastaDoPrototipo);
    html = montar(pasta, opcoes.dados);
    origem = `${basename(pasta)}${opcoes.dados ? ` com ${basename(resolve(opcoes.dados))}` : ''}, montado agora`;
  }

  const hashDaOrigem = createHash('sha256').update(html).digest('hex').slice(0, 12);
  let resultado;
  try {
    resultado = adaptarParaOCrm(html, {
      origem: `${origem}, sha256 ${hashDaOrigem}`,
      quando: new Date().toISOString(),
      permitirMencoesEmTexto: Boolean(opcoes['permitir-mencoes-em-texto']),
    });
  } catch (erro) {
    if (erro instanceof ErroDaCopia) sair(erro.message);
    throw erro;
  }

  const saida = resolve(opcoes.saida ?? SAIDA_PADRAO);
  const emGzip = saida.endsWith('.gz');
  const bytes = emGzip
    ? gzipSync(Buffer.from(resultado.html, 'utf8'), { level: 9 })
    : Buffer.from(resultado.html, 'utf8');
  mkdirSync(dirname(saida), { recursive: true });
  writeFileSync(saida, bytes);

  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  console.log(
    `✓ ${relative(process.cwd(), saida) || saida}: ${mb(resultado.tamanho)}${emGzip ? ` (${mb(bytes.length)} em gzip)` : ''}, página de ${resultado.atualizadaEm} (origem ${origem}).`,
  );
  for (const aviso of resultado.avisos) console.log(`! ${aviso}`);
  if (!emGzip)
    console.log('! HTML puro, só para olhar: a rota do CRM entrega o .gz do caminho padrão.');
  console.log(
    'Agora: INTELIGENCIA_EXIGIR_PAGINA=1 pnpm -C apps/web test pagina-pronta (confere o arquivo copiado). Publicar o site da Imova é outro passo, com pedido do dono.',
  );
}

principal();
