/**
 * Fotografa TODAS as telas do CRM nas duas larguras e nos dois temas, e mede cada uma.
 *
 * Combinações: 4 rotas × 2 larguras (1440×900 desktop, 390×844 o celular da Heloísa)
 * × 2 temas (dark, light) = 16 PNGs, em deviceScaleFactor 2.
 * Nome do arquivo: <rota>-<largura>-<tema>.png, com a rota sem barras.
 *
 * Junto sai `medidas.json`: contraste WCAG do texto principal, do secundário e de cada
 * cor da escala térmica contra o fundo em que ela aparece; altura dos alvos de toque; e
 * se houve rolagem horizontal (scrollWidth > clientWidth) — o que só importa em 390px.
 *
 * Uso:
 *   node apps/web/scripts/fotografar-tudo.mjs [--saida <pasta>] [--base <url>] [--email <e-mail>]
 *
 * A sessão é gerada na hora por `sessao-dev.mjs` (login por senha num usuário de
 * desenvolvimento do banco LOCAL). /login é capturado num contexto SEM sessão.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';

import { abrirContexto, irEEsperar, medirNaPagina } from './captura.mjs';
import { CAMINHO_SESSAO, gravarSessaoDev } from './sessao-dev.mjs';

const PASTA_PADRAO =
  '/private/tmp/claude-501/-Users-matheusrondon-Documents-Tr-ade/100e691f-f496-474e-82ae-8abafc7b0062/scratchpad/fotos';

const TAMANHOS = [
  { largura: 1440, altura: 900, apelido: 'desktop' },
  { largura: 390, altura: 844, apelido: 'celular' },
];

const TEMAS = ['dark', 'light'];

/** Pega um id real de organização no banco local, para a ficha do parceiro. */
function idDeParceiroReal() {
  const sql =
    "select o.id || '|' || o.name from public.organizations o " +
    'join public.deals d on d.organization_id = o.id ' +
    'where o.phone_e164 is not null group by o.id, o.name ' +
    'order by count(d.id) desc, o.name limit 1;';
  const saida = execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_komune-crm', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
  const [id, nome] = saida.split('|');
  if (!id) throw new Error('Não achei nenhuma organização em public.organizations.');
  return { id, nome };
}

/** `/parceiros/abc-123` → `parceiros-abc-123`; `/` → `raiz`. */
function nomeDeArquivo(rota) {
  const limpo = rota.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
  return limpo || 'raiz';
}

async function principal() {
  const argv = process.argv.slice(2);
  const opcao = (nome, padrao) => {
    const i = argv.indexOf(nome);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
  };
  const pasta = resolve(opcao('--saida', PASTA_PADRAO));
  const base = opcao('--base', 'http://localhost:3000');
  const email = opcao('--email', 'heloisa.dev@komune.app.br');

  mkdirSync(pasta, { recursive: true });

  const sessao = await gravarSessaoDev(email);
  const parceiro = idDeParceiroReal();

  const ROTAS = [
    {
      rota: '/login',
      descricao: 'entrada, sem sessão',
      autenticada: false,
      // A escada térmica desenha as cinco cores de uma vez; é o sinal de que a tela pintou.
      esperar: '[role="img"][aria-label*="Escala térmica"]',
    },
    {
      rota: '/parceiros',
      descricao: 'lista da base de parceiros (dado real do banco local)',
      autenticada: true,
      // Dado de verdade na tela: um link para a ficha de uma organização.
      esperar: 'a[href^="/parceiros/"]',
    },
    {
      rota: `/parceiros/${parceiro.id}`,
      descricao: `ficha do parceiro "${parceiro.nome}"`,
      autenticada: true,
      esperar: 'h1',
    },
    {
      rota: '/radar',
      descricao: 'módulo em construção (D4)',
      autenticada: true,
      esperar: 'h1',
    },
  ];

  const navegador = await chromium.launch();
  const paginas = [];
  const arquivos = [];
  const falhas = [];

  try {
    for (const tamanho of TAMANHOS) {
      for (const tema of TEMAS) {
        const contexto = await abrirContexto(navegador, {
          largura: tamanho.largura,
          altura: tamanho.altura,
          tema,
          storageState: CAMINHO_SESSAO,
        });
        const contextoSemSessao = await abrirContexto(navegador, {
          largura: tamanho.largura,
          altura: tamanho.altura,
          tema,
          storageState: null,
        });

        for (const alvo of ROTAS) {
          const arquivo = join(
            pasta,
            `${nomeDeArquivo(alvo.rota)}-${tamanho.largura}-${tema}.png`,
          );
          const pagina = await (alvo.autenticada ? contexto : contextoSemSessao).newPage();
          try {
            const ida = await irEEsperar(pagina, new URL(alvo.rota, base).toString(), {
              seletorDeDado: alvo.esperar,
            });

            // Honestidade: se o proxy redirecionou, a foto NÃO é da tela pedida.
            const caminhoFinal = new URL(ida.url).pathname;
            const redirecionou = caminhoFinal !== alvo.rota;

            await pagina.screenshot({ path: arquivo, fullPage: false });
            const medidas = await pagina.evaluate(medirNaPagina);

            arquivos.push(arquivo);
            paginas.push({
              arquivo,
              rota: alvo.rota,
              descricao: alvo.descricao,
              url_final: ida.url,
              redirecionou,
              status_http: ida.status,
              largura: tamanho.largura,
              altura: tamanho.altura,
              dispositivo: tamanho.apelido,
              tema,
              ...medidas,
            });
            if (redirecionou) {
              falhas.push({
                rota: alvo.rota,
                largura: tamanho.largura,
                tema,
                motivo: `o proxy redirecionou para ${caminhoFinal}`,
              });
            }
          } catch (erro) {
            falhas.push({
              rota: alvo.rota,
              largura: tamanho.largura,
              tema,
              motivo: erro instanceof Error ? erro.message : String(erro),
            });
          } finally {
            await pagina.close();
          }
        }

        await contexto.close();
        await contextoSemSessao.close();
      }
    }
  } finally {
    await navegador.close();
  }

  const medidas = {
    gerado_em: new Date().toISOString(),
    base,
    sessao: { email: sessao.email, cookies: sessao.nomesDeCookie, arquivo: sessao.caminho },
    parceiro_fotografado: parceiro,
    combinacoes: {
      rotas: ROTAS.map((r) => r.rota),
      larguras: TAMANHOS.map((t) => `${t.largura}x${t.altura} (${t.apelido})`),
      temas: TEMAS,
    },
    falhas,
    paginas,
  };

  const caminhoMedidas = join(pasta, 'medidas.json');
  writeFileSync(caminhoMedidas, JSON.stringify(medidas, null, 2));

  console.log(JSON.stringify({ pasta, arquivos, medidas: caminhoMedidas, falhas }, null, 2));
}

await principal();
