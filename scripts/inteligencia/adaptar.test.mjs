// Testes da cópia do protótipo para o CRM. Rodar: node --test scripts/inteligencia/
// (o `pnpm test` do site também roda, por `pagina-pronta.test.ts`).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import {
  adaptarParaOCrm,
  BIBLIOTECAS_CONHECIDAS,
  carimbar,
  CHAVE_DO_TEMA_DO_CRM,
  dataDaPagina,
  ErroDaCopia,
  fixarBibliotecas,
  foraDosScripts,
  ligarOVoltar,
  mencoesLiberadas,
  PONTE_DO_CRM,
  porAFaixaDaData,
  porAPonte,
  problemasDaPagina,
  problemasDeIntegridade,
  rastrosDePortais,
  ROTA_INICIAL_DO_CRM,
  seguirOTemaDoCrm,
} from './adaptar.mjs';

const ECHARTS = 'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';

/** Uma casca no jeito do modelo.html do protótipo, já montada (sem os marcadores). */
const CASCA = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<script>
(function(){ var h = document.documentElement, t = null, r = null;
  try { t = localStorage.getItem("intel-tema"); r = localStorage.getItem("intel-trilho"); } catch(e) {}
  h.dataset.theme = t || "dark";
})();
</script>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"></script>
<style>.voltar{display:flex}</style>
</head>
<body>
<div class="foot-acoes">
  <a class="voltar" href="#" onclick="return false" title="No CRM, volta para a tela de onde veio"><span>← Voltar ao CRM</span></a>
  <a class="voltar-lista" href="#nossos">Voltar à lista</a>
</div>
<script>/* ---- js/00-base.js ---- */
const D = {"imoveis":[{"codigo":"TE0001"}]};
const modelo = \`<a class="voltar" href="\${destino}">volta</a>\`;
const corpo = "<body class='x'>";
</script>
</body>
</html>`;

describe('ligarOVoltar', () => {
  it('troca o link morto do "Voltar ao CRM" pela tela inicial do CRM', () => {
    const { html, trocados } = ligarOVoltar(CASCA);
    assert.equal(trocados, 1);
    assert.match(
      html,
      /<a class="voltar" href="\/meu-dia" title="Volta para a tela inicial do CRM">/,
    );
    assert.doesNotMatch(html, /onclick="return false"/);
  });

  it('não mexe no "Voltar à lista" nem no HTML que o JavaScript monta', () => {
    const { html } = ligarOVoltar(CASCA);
    assert.match(html, /<a class="voltar-lista" href="#nossos">/);
    assert.ok(html.includes('<a class="voltar" href="${destino}">volta</a>'));
  });
});

describe('seguirOTemaDoCrm', () => {
  it('sem escolha na página, segue o tema guardado pelo CRM', () => {
    const { html, trocado } = seguirOTemaDoCrm(CASCA);
    assert.equal(trocado, true);
    assert.ok(
      html.includes(
        't = (localStorage.getItem("intel-tema") || localStorage.getItem("komune-crm-tema"));',
      ),
    );
  });

  it('se o script do tema mudou, devolve a página igual', () => {
    const semTema = CASCA.replace('localStorage.getItem("intel-tema")', 'null');
    assert.deepEqual(seguirOTemaDoCrm(semTema), { html: semTema, trocado: false });
  });
});

describe('problemasDaPagina', () => {
  it('a casca montada, com tudo dentro e só CDN de fora, pode ir', () => {
    assert.deepEqual(problemasDaPagina(CASCA), []);
  });

  it('recusa a página que não foi montada', () => {
    const crua = CASCA.replace(
      'const D = {"imoveis":[{"codigo":"TE0001"}]};',
      'const D = /*__DADOS__*/null;',
    );
    assert.match(problemasDaPagina(crua).join(' '), /__DADOS__/);
  });

  it('recusa dados, código ou estilo em arquivo separado (o porteiro não guarda .json, .js nem .css)', () => {
    const comArquivos = CASCA.replace(
      '</head>',
      '<script src="js/00-base.js"></script><link rel="stylesheet" href="css/01.css"></head>',
    ).replace('const D =', 'fetch("dados/precos.json"); const D =');
    const problemas = problemasDaPagina(comArquivos);
    assert.equal(problemas.length, 3, problemas.join('\n'));
  });
});

describe('carimbar', () => {
  it('põe de onde veio logo depois do doctype, sem fechar o comentário antes da hora', () => {
    const html = carimbar(CASCA, {
      origem: 'pasta--com--traços',
      quando: '2026-11-18T12:00:00.000Z',
    });
    const comentario = html.split('\n')[1];
    assert.match(comentario, /^<!-- Inteligência de mercado da Imova: .* -->$/);
    assert.equal(comentario.slice(4, -3).includes('--'), false);
  });
});

describe('adaptarParaOCrm', () => {
  it('devolve a página pronta para o CRM: volta, tema, bibliotecas, ponte, faixa, metas e carimbo', () => {
    const {
      html,
      avisos,
      voltarTrocados,
      mencoesLiberadas: liberadas,
      atualizadaEm,
    } = adaptarParaOCrm(CASCA, { quando: '2026-11-18T12:00:00.000Z' });
    assert.equal(voltarTrocados, 1);
    assert.deepEqual(avisos, []);
    assert.equal(liberadas, 0);
    assert.equal(atualizadaEm, '18/11/2026 às 09:00');
    assert.ok(html.includes(`href="${ROTA_INICIAL_DO_CRM}"`));
    assert.match(
      html,
      /<meta name="robots" content="noindex, nofollow">\n<meta name="referrer" content="strict-origin-when-cross-origin">\n<style>\.crm-faixa-data/,
    );
    assert.doesNotMatch(html, /inteligencia-mencoes-liberadas/);
    assert.match(html, /^<!doctype html>\n<!-- Inteligência de mercado/);
    assert.deepEqual(problemasDeIntegridade(html), []);
    assert.ok(html.includes('class="crm-faixa-data"'));
    // Os dados continuam dentro da página.
    assert.ok(html.includes('{"imoveis":[{"codigo":"TE0001"}]}'));
  });

  it('biblioteca de fora sem hash conhecido não copia', () => {
    const outra = CASCA.replace(
      '</head>',
      '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script></head>',
    );
    assert.throws(() => adaptarParaOCrm(outra), /sem hash conhecido: https:\/\/cdn\.jsdelivr/);
  });

  it('sem o "Voltar ao CRM", não copia: a pessoa ficaria presa na página', () => {
    const semVoltar = CASCA.replace('class="voltar" href="#"', 'class="sair" href="#"');
    assert.throws(() => adaptarParaOCrm(semVoltar), ErroDaCopia);
  });

  it('página com problema não copia', () => {
    assert.throws(() => adaptarParaOCrm('<html></html>'), ErroDaCopia);
  });
});

describe('rastrosDePortais (decisão de 18/11/2026: nada dos portais no CRM)', () => {
  it('o índice FipeZAP pode: não é bloqueio nem menção', () => {
    const comFipe = CASCA.replace(
      'const D =',
      'const S = {"serie":"fipezap","nome":"Índice FipeZAP","fonte":"FipeZAP","obs":"Fipe ZAP e FIPE-ZAP"}; const D =',
    );
    assert.deepEqual(rastrosDePortais(comFipe), {
      bloqueios: [],
      mencoes: 0,
      exemplosDeMencao: [],
    });
    assert.doesNotThrow(() => adaptarParaOCrm(comFipe));
  });

  it('link de anúncio de portal bloqueia a cópia', () => {
    const comLink = CASCA.replace(
      'const D =',
      'const L = "https://www.zapimoveis.com.br/imovel/venda-x"; const M = "olx.com.br/robots.txt"; const D =',
    );
    const { bloqueios } = rastrosDePortais(comLink);
    assert.equal(bloqueios.length, 1);
    assert.match(bloqueios[0], /^2 endereço/);
    assert.throws(() => adaptarParaOCrm(comLink), /portal/);
  });

  it('portal como fonte de dado bloqueia: contagem por fonte e fonte do anúncio', () => {
    const comDado = CASCA.replace(
      'const D = {"imoveis":[{"codigo":"TE0001"}]};',
      'const D = {"cobertura":{"fontes":{"chavesnamao":10,"zap":1,"vivareal":2}},"anuncios":[{"fonte":"olx"}]};',
    );
    const { bloqueios } = rastrosDePortais(comDado);
    assert.equal(bloqueios.length, 1);
    assert.match(bloqueios[0], /^3 dado/);
    assert.throws(() => adaptarParaOCrm(comDado), ErroDaCopia);
  });

  it('o nome do portal no texto também barra (costuma ser dado copiado do portal)', () => {
    const comTexto = CASCA.replace(
      '<span>← Voltar ao CRM</span>',
      '<span>← Voltar ao CRM</span><p>A mesma casa aparece no ZAP, VivaReal e OLX pelo Canal Pro.</p>',
    );
    assert.equal(rastrosDePortais(comTexto).mencoes, 4);
    assert.throws(() => adaptarParaOCrm(comTexto), /--permitir-mencoes-em-texto/);
  });

  it('com --permitir-mencoes-em-texto (alguém leu cada uma), o texto vira aviso e a página registra quantas', () => {
    const comTexto = CASCA.replace(
      '<span>← Voltar ao CRM</span>',
      '<span>← Voltar ao CRM</span><p>Não usamos dados do ZAP.</p>',
    );
    const {
      avisos,
      html,
      mencoesLiberadas: liberadas,
    } = adaptarParaOCrm(comTexto, {
      permitirMencoesEmTexto: true,
    });
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /1 vez/);
    assert.equal(liberadas, 1);
    assert.equal(mencoesLiberadas(html), 1);
    assert.match(html.split('\n')[1], /leu e liberou 1 menção/);
    // O carimbo e a meta não citam portal: a contagem da página continua a mesma.
    assert.equal(rastrosDePortais(html).mencoes, 1);
  });

  it('nomes compostos com "_" ou "-" e qualquer valor depois dos dois-pontos também são dado', () => {
    for (const dado of [
      '{"fonte":"viva_real"}',
      '{"fonte":"zap_imoveis"}',
      '{"origem":"canal_pro"}',
      '{"portal":"grupo_olx"}',
      '{"fontes":{"zap":null}}',
      '{"fontes":{"zap":true}}',
      '{"fontes":{"Viva-Real":3}}',
      '{"fontes":["chavesnamao","olx"]}',
      '{"id":"quintoandar"}',
      '{"fonte":"mercado_livre"}',
    ]) {
      const html = CASCA.replace('const D =', `const X = ${dado}; const D =`);
      assert.equal(rastrosDePortais(html).bloqueios.length, 1, dado);
    }
  });

  it('nomes compostos no texto e os "parecidos" (QuintoAndar, Mercado Livre Imóveis) contam', () => {
    for (const texto of [
      'viva_real',
      'canal-pro',
      'grupo_olx',
      'zap_imoveis',
      'Quinto Andar',
      'Mercado Livre',
    ]) {
      const html = CASCA.replace(
        '<span>← Voltar ao CRM</span>',
        `<span>← Voltar ao CRM</span><p>${texto}</p>`,
      );
      assert.equal(rastrosDePortais(html).mencoes, 1, texto);
    }
    for (const endereco of [
      'https://www.quintoandar.com.br/imovel/1',
      'https://imovel.mercadolivre.com.br/MLB-1',
    ]) {
      const html = CASCA.replace('const D =', `const L = "${endereco}"; const D =`);
      assert.equal(rastrosDePortais(html).bloqueios.length, 1, endereco);
    }
  });

  it('palavras que só parecem portal não contam', () => {
    const html = CASCA.replace(
      'const D =',
      'const X = {"fonte":"chavesnamao","serie":"fipezap","zapata":1,"texto":"olxa zapping"}; const D =',
    );
    assert.deepEqual(rastrosDePortais(html), { bloqueios: [], mencoes: 0, exemplosDeMencao: [] });
  });
});

describe('fixarBibliotecas e problemasDeIntegridade (as bibliotecas de fora presas ao hash)', () => {
  it('põe integrity e crossorigin nos scripts e estilos conhecidos; deixa o Google Fonts e o preconnect', () => {
    const { html, desconhecidas } = fixarBibliotecas(CASCA);
    assert.deepEqual(desconhecidas, []);
    assert.ok(
      html.includes(
        `<script src="${ECHARTS}" integrity="${BIBLIOTECAS_CONHECIDAS[ECHARTS]}" crossorigin="anonymous">`,
      ),
    );
    assert.ok(
      html.includes(
        `<link rel="stylesheet" href="${LEAFLET_CSS}" integrity="${BIBLIOTECAS_CONHECIDAS[LEAFLET_CSS]}" crossorigin="anonymous">`,
      ),
    );
    assert.ok(
      html.includes(
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap" rel="stylesheet">',
      ),
    );
    assert.ok(
      html.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'),
    );
  });

  it('troca um integrity errado pelo da lista', () => {
    const errado = CASCA.replace(
      `<script src="${ECHARTS}">`,
      `<script integrity="sha384-ERRADO" src="${ECHARTS}" crossorigin="use-credentials">`,
    );
    assert.equal(problemasDeIntegridade(errado).length, 2); // o script e o estilo
    const { html } = fixarBibliotecas(errado);
    assert.deepEqual(problemasDeIntegridade(html), []);
    assert.doesNotMatch(html, /ERRADO|use-credentials/);
  });

  it('a página crua (sem hash) tem problema; a lista conhecida só tem https e sha384', () => {
    assert.equal(problemasDeIntegridade(CASCA).length, 2);
    for (const [endereco, hash] of Object.entries(BIBLIOTECAS_CONHECIDAS)) {
      assert.match(endereco, /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//);
      assert.match(hash, /^sha384-[A-Za-z0-9+/]{64}$/);
    }
  });
});

describe('a ponte do CRM (localStorage e tema na página em sandbox)', () => {
  /** Roda a ponte num "navegador" de mentira; `bloqueado` imita a origem opaca do sandbox. */
  function rodarAPonte({ bloqueado, busca = '' }) {
    const codigo = PONTE_DO_CRM.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const janela = { location: { search: busca }, URLSearchParams };
    Object.defineProperty(janela, 'localStorage', {
      configurable: true,
      enumerable: true,
      get() {
        if (bloqueado) throw new Error('SecurityError: origem opaca');
        return { getItem: () => null, setItem() {}, marca: 'o de verdade' };
      },
    });
    janela.window = janela;
    vm.runInNewContext(codigo, janela);
    return janela;
  }

  it('no sandbox, troca o localStorage por um na memória, com o tema que o CRM mandou', () => {
    const janela = rodarAPonte({ bloqueado: true, busca: '?tema=dark' });
    const ls = janela.localStorage;
    assert.equal(ls.getItem(CHAVE_DO_TEMA_DO_CRM), 'dark');
    assert.equal(ls.getItem('intel-tema'), null);
    ls.setItem('intel-mapa-camadas', '{"a":1}');
    assert.equal(ls.getItem('intel-mapa-camadas'), '{"a":1}');
    assert.equal(ls.length, 2);
    ls.removeItem('intel-mapa-camadas');
    assert.equal(ls.length, 1);
  });

  it('tema que não é claro nem escuro (ou "system") não entra', () => {
    for (const busca of ['?tema=system', '?tema=<x>', '']) {
      assert.equal(
        rodarAPonte({ bloqueado: true, busca }).localStorage.getItem(CHAVE_DO_TEMA_DO_CRM),
        null,
      );
    }
  });

  it('fora do sandbox (o protótipo no localhost), não mexe em nada', () => {
    assert.equal(rodarAPonte({ bloqueado: false }).localStorage.marca, 'o de verdade');
  });

  it('é o primeiro script do <head>, logo depois do <meta charset>', () => {
    const { html, posta } = porAPonte(CASCA);
    assert.equal(posta, true);
    assert.match(html, /<meta charset="utf-8">\n<script>\/\* ponte do CRM/);
    assert.ok(html.indexOf('ponte do CRM') < html.indexOf('intel-tema"); r ='));
  });
});

describe('a faixa com a data da página', () => {
  it('fica logo no começo do <body>, com a data e a hora de Natal', () => {
    const { html, posta } = porAFaixaDaData(CASCA, '2026-11-19T01:05:00.000Z');
    assert.equal(posta, true);
    assert.match(
      html,
      /<body>\n<div class="crm-faixa-data" role="note">Página atualizada em <b>18\/11\/2026 às 22:05<\/b>/,
    );
    // Não entra no HTML que o JavaScript escreve.
    assert.ok(html.includes('const corpo = "<body class=\'x\'>";'));
  });

  it('a data sai no fuso de Natal, com hora de 24 h', () => {
    assert.equal(dataDaPagina('2026-11-18T03:00:00.000Z'), '18/11/2026 às 00:00');
    assert.equal(dataDaPagina('não é data'), 'não é data');
  });
});

describe('foraDosScripts', () => {
  it('não passa o conteúdo dos scripts para a função', () => {
    const vistos = [];
    foraDosScripts('a<script>b</script>c<SCRIPT type="x">d</SCRIPT>e', (parte) => {
      vistos.push(parte);
      return parte.toUpperCase();
    });
    assert.deepEqual(vistos, ['a', 'c', 'e']);
  });
});
