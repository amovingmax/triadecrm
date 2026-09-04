/**
 * Foto de UMA tela do CRM, com ou sem sessão.
 *
 * Uso:
 *   node apps/web/scripts/foto.mjs --rota /parceiros --saida /tmp/p.png
 *   node apps/web/scripts/foto.mjs --rota /login --sem-sessao --largura 390 --altura 844 --tema light
 *
 * Opções:
 *   --rota <caminho>     rota do app (padrão /login). Aceita URL inteira também.
 *   --base <url>         origem do app (padrão http://localhost:3000).
 *   --saida <arquivo>    PNG de saída (padrão ./foto.png).
 *   --largura <px>       padrão 1440.
 *   --altura <px>        padrão 900.
 *   --tema dark|light    padrão dark (o padrão do produto).
 *   --sem-sessao         não usa o storageState (para fotografar /login).
 *   --sessao <arquivo>   storageState alternativo (padrão scripts/.sessao-dev.json).
 *   --esperar <seletor>  espera este seletor ficar visível antes de fotografar.
 *   --completa           fullPage em vez de só a dobra.
 *   --medidas            imprime as medidas (contraste, toque, rolagem) em JSON.
 *
 * Sem storageState válido as rotas internas caem em /login pelo proxy — é o
 * comportamento correto do app, não um defeito do script. Gere a sessão antes:
 *   node apps/web/scripts/sessao-dev.mjs
 */
import { existsSync } from 'node:fs';

import { chromium } from 'playwright';

import { abrirContexto, irEEsperar, medirNaPagina } from './captura.mjs';
import { CAMINHO_SESSAO } from './sessao-dev.mjs';

const AJUDA = `Foto de uma tela do CRM.

  --rota <caminho>     rota do app (padrão /login); aceita URL inteira
  --base <url>         origem do app (padrão http://localhost:3000)
  --saida <arquivo>    PNG de saída (padrão ./foto.png)
  --largura <px>       padrão 1440
  --altura <px>        padrão 900
  --tema dark|light    padrão dark
  --sem-sessao         ignora o storageState (para /login)
  --sessao <arquivo>   storageState alternativo (padrão scripts/.sessao-dev.json)
  --esperar <seletor>  espera o seletor ficar visível antes de fotografar
  --completa           fullPage em vez de só a dobra
  --medidas            imprime contraste, alvos de toque e rolagem em JSON`;

function lerArgumentos(argv) {
  const opcoes = {
    rota: '/login',
    base: 'http://localhost:3000',
    saida: 'foto.png',
    largura: 1440,
    altura: 900,
    tema: 'dark',
    sessao: CAMINHO_SESSAO,
    semSessao: false,
    esperar: null,
    completa: false,
    medidas: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const proximo = () => argv[(i += 1)];
    switch (arg) {
      case '--rota': opcoes.rota = proximo(); break;
      case '--base': opcoes.base = proximo(); break;
      case '--saida': opcoes.saida = proximo(); break;
      case '--largura': opcoes.largura = Number(proximo()); break;
      case '--altura': opcoes.altura = Number(proximo()); break;
      case '--tema': opcoes.tema = proximo(); break;
      case '--sessao': opcoes.sessao = proximo(); break;
      case '--sem-sessao': opcoes.semSessao = true; break;
      case '--esperar': opcoes.esperar = proximo(); break;
      case '--completa': opcoes.completa = true; break;
      case '--medidas': opcoes.medidas = true; break;
      case '--ajuda':
      case '-h':
        console.log(AJUDA);
        process.exit(0);
        break;
      default:
        throw new Error(`Opção desconhecida: ${arg}. Use --ajuda.`);
    }
  }
  if (!['dark', 'light'].includes(opcoes.tema)) {
    throw new Error(`--tema aceita "dark" ou "light" (recebi "${opcoes.tema}").`);
  }
  return opcoes;
}

export async function tirarFoto(opcoes) {
  const url = opcoes.rota.startsWith('http')
    ? opcoes.rota
    : new URL(opcoes.rota, opcoes.base).toString();

  const usarSessao = !opcoes.semSessao && existsSync(opcoes.sessao);
  if (!opcoes.semSessao && !usarSessao) {
    console.warn(
      `[foto] ${opcoes.sessao} não existe — a captura vai sem sessão e o proxy manda para /login. ` +
        'Rode `node apps/web/scripts/sessao-dev.mjs` antes.',
    );
  }

  const navegador = await chromium.launch();
  try {
    const contexto = await abrirContexto(navegador, {
      largura: opcoes.largura,
      altura: opcoes.altura,
      tema: opcoes.tema,
      storageState: usarSessao ? opcoes.sessao : null,
    });
    const pagina = await contexto.newPage();
    const ida = await irEEsperar(pagina, url, { seletorDeDado: opcoes.esperar });
    await pagina.screenshot({ path: opcoes.saida, fullPage: opcoes.completa });
    const medidas = opcoes.medidas ? await pagina.evaluate(medirNaPagina) : null;
    return { arquivo: opcoes.saida, url_final: ida.url, status: ida.status, medidas };
  } finally {
    await navegador.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith('foto.mjs')) {
  const opcoes = lerArgumentos(process.argv.slice(2));
  const resultado = await tirarFoto(opcoes);
  console.log(JSON.stringify(resultado, null, 2));
}
