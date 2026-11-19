// O que muda na página pronta do protótipo de Inteligência de mercado para ela rodar
// dentro do CRM (18/11/2026). Funções puras, sem disco: quem lê e grava é o
// `copiar-prototipo.mjs`, e quem confere é o `adaptar.test.mjs` (node --test, chamado
// também pelo `pnpm test` do site, em `pagina-pronta.test.ts`).
//
// O protótipo não é editado: ele continua abrindo sozinho no localhost, e a cópia do
// CRM sai daqui. Cada mudança é procurada por padrão, e não por texto exato, porque o
// redesenho ainda está mexendo nas telas. O que for indispensável e não for achado
// derruba a cópia com uma mensagem que diz o quê; o resto vira aviso.
//
// Como a página chega ao navegador (revisão de 18/11/2026): ela NÃO mora em public/.
// O script grava `apps/web/privado/inteligencia/painel.html.gz` (fora do git), e a rota
// `/inteligencia/painel` confere login, papel e perfil no banco antes de entregar, com
// uma Content-Security-Policy `sandbox` (a página vira origem opaca e não lê cookie nem
// localStorage do CRM). Por isso a cópia leva uma "ponte" para o localStorage e o tema.

/** A tela inicial do CRM (`ROTA_INICIAL`, em apps/web/src/lib/supabase/middleware.ts). */
export const ROTA_INICIAL_DO_CRM = '/meu-dia';

/** A chave em que o CRM guarda o tema escolhido (`components/tema/provedor-tema.tsx`). */
export const CHAVE_DO_TEMA_DO_CRM = 'komune-crm-tema';

/**
 * Onde a página pronta fica no site, a partir de `apps/web` (a mesma conta de
 * `pagina-pronta.ts` do site, que um teste confere). Fora de `public/`: nada ali é
 * entregue sem passar pela rota que confere o acesso.
 */
export const CAMINHO_DA_PAGINA_PRONTA_NO_SITE = 'privado/inteligencia/painel.html.gz';

/** Acima disto, avisa: no 4G a página já demora alguns segundos. */
export const TAMANHO_PARA_AVISAR = 12 * 1024 * 1024;

/** Os marcadores que o `montar.mjs` troca. Se sobrou um, a página não foi montada. */
const MARCADORES_DO_MONTAR = ['/*__DADOS__*/null', '/*__CSS__*/', '<!--__JS__-->'];

/**
 * As bibliotecas de fora que a página pode carregar, cada uma presa ao hash do arquivo
 * (Subresource Integrity). Se a CDN trocar o arquivo, o navegador recusa e a biblioteca
 * não roda. Hashes conferidos em 18/11/2026 contra o que as próprias CDNs publicam
 * (API do cdnjs e data.jsdelivr.com).
 *
 * Biblioteca nova ou versão nova no protótipo: a cópia para com a mensagem do que falta.
 * Para calcular: `curl -sL <endereço> | openssl dgst -sha384 -binary | openssl base64 -A`,
 * e confira com o hash que a CDN publica antes de pôr aqui. As origens precisam também
 * estar na política da rota (`ORIGENS_DE_SCRIPT` em `inteligencia/cabecalhos.ts`).
 */
export const BIBLIOTECAS_CONHECIDAS = Object.freeze({
  'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js':
    'sha384-Mx5lkUEQPM1pOJCwFtUICyX45KNojXbkWdYhkKUKsbv391mavbfoAmONbzkgYPzR',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js':
    'sha384-NElt3Op+9NBMCYaef5HxeJmU4Xeard/Lku8ek6hoPTvYkQPh3zLIrJP7KiRocsxO',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css':
    'sha384-c6Rcwz4e4CITMbu/NBmnNS8yN2sC3cUElMEMfP3vqqKFp7GOYaaBBCqmaWBjmkjb',
});

/**
 * A única folha de estilo de fora sem hash: o Google Fonts monta o CSS conforme o
 * navegador, e o hash mudaria a cada um. É só CSS (não roda código) e a política da
 * rota só deixa estilo e fonte virem de lá.
 */
const ESTILO_SEM_HASH = /^https:\/\/fonts\.googleapis\.com\/css2?\?/i;

export class ErroDaCopia extends Error {}

const SCRIPT_INTEIRO = /(<script\b[^>]*>[\s\S]*?<\/script>)/i;

/**
 * Aplica `fn` só ao que está FORA dos `<script>…</script>`. O JavaScript do protótipo
 * monta HTML em texto (`<a class="…" href="${…}">`), e mexer nele quebraria as telas.
 */
export function foraDosScripts(html, fn) {
  const partes = html.split(SCRIPT_INTEIRO);
  return partes.map((parte, i) => (i % 2 === 1 ? parte : fn(parte))).join('');
}

/** Aplica `fn` à tag de abertura de cada `<script>` de verdade (não às que o código escreve). */
function nasAberturasDosScripts(html, fn) {
  const partes = html.split(SCRIPT_INTEIRO);
  return partes
    .map((parte, i) => {
      if (i % 2 === 0) return parte;
      const abertura = parte.match(/^<script\b[^>]*>/i)[0];
      return fn(abertura) + parte.slice(abertura.length);
    })
    .join('');
}

/** O texto que está fora dos scripts, para conferir a marcação da casca. */
function soAMarcacao(html) {
  let fora = '';
  foraDosScripts(html, (parte) => {
    fora += parte;
    return parte;
  });
  return fora;
}

/** As tags de abertura dos `<script>` de verdade (não as que o código escreve em texto). */
function aberturasDosScripts(html) {
  const aberturas = [];
  nasAberturasDosScripts(html, (abertura) => {
    aberturas.push(abertura);
    return abertura;
  });
  return aberturas;
}

/** O conteúdo de dentro dos scripts, para conferir o código. */
function soOsScripts(html) {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
}

const escaparAtributo = (valor) => String(valor).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escaparTexto = (valor) =>
  String(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** O valor de um atributo numa tag de abertura, ou null. */
function atributo(tag, nome) {
  const m = tag.match(new RegExp(`\\s${nome}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/** A tag sem os atributos da lista (para regravá-los do nosso jeito). */
function semAtributos(tag, nomes) {
  return tag.replace(
    new RegExp(
      `\\s(?:${nomes.join('|')})(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?(?=[\\s/>])`,
      'gi',
    ),
    '',
  );
}

/** `<a class="voltar …">` da casca (e só ele: `voltar-lista` é outro botão). */
const LINK_VOLTAR = /<a\b([^>]*?)\bclass\s*=\s*"([^"]*)"([^>]*)>/gi;
const temClasseVoltar = (classes) => /(?:^|\s)voltar(?:\s|$)/.test(classes);

/**
 * O "← Voltar ao CRM" do protótipo é um link morto (`href="#"` com
 * `onclick="return false"`). No CRM ele leva à tela inicial, na mesma aba.
 */
export function ligarOVoltar(html, rotaInicial = ROTA_INICIAL_DO_CRM) {
  let trocados = 0;
  const novo = foraDosScripts(html, (parte) =>
    parte.replace(LINK_VOLTAR, (tag, antes, classes, depois) => {
      if (!temClasseVoltar(classes)) return tag;
      trocados += 1;
      const resto = `${antes} ${depois}`
        .replace(/\s(?:href|onclick|title|target)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return `<a class="${classes}" href="${escaparAtributo(rotaInicial)}" title="Volta para a tela inicial do CRM"${resto ? ` ${resto}` : ''}>`;
    }),
  );
  return { html: novo, trocados };
}

/**
 * O tema: sem escolha salva na própria página, ela segue a escolha feita no CRM
 * (claro ou escuro; "sistema" continua sendo o sistema). Procura a leitura de
 * `intel-tema` no script do `<head>`, que roda antes da primeira pintura. Na rota do
 * CRM a página não lê o localStorage do CRM (sandbox): a escolha chega pelo
 * endereço (`?tema=`) e a ponte a guarda sob a mesma chave (`ponteDoCrm`).
 */
export function seguirOTemaDoCrm(html) {
  const fimDoHead = html.search(/<\/head>/i);
  if (fimDoHead < 0) return { html, trocado: false };
  const head = html.slice(0, fimDoHead);
  const leitura = /localStorage\.getItem\(\s*(["'])intel-tema\1\s*\)/;
  if (!leitura.test(head)) return { html, trocado: false };
  const novoHead = head.replace(
    leitura,
    (achado) => `(${achado} || localStorage.getItem("${CHAVE_DO_TEMA_DO_CRM}"))`,
  );
  return { html: novoHead + html.slice(fimDoHead), trocado: true };
}

/**
 * Prende cada biblioteca de fora ao hash conhecido (`integrity` + `crossorigin`).
 * Devolve também o que não foi reconhecido: script ou estilo de fora sem hash na
 * lista derruba a cópia.
 */
export function fixarBibliotecas(html, conhecidas = BIBLIOTECAS_CONHECIDAS) {
  const desconhecidas = [];
  const comHash = (tag, endereco) => {
    const hash = conhecidas[endereco];
    if (!hash) {
      desconhecidas.push(endereco);
      return tag;
    }
    const limpa = semAtributos(tag, ['integrity', 'crossorigin']);
    return limpa.replace(/\s*\/?>$/, (fim) => ` integrity="${hash}" crossorigin="anonymous"${fim}`);
  };
  let novo = nasAberturasDosScripts(html, (abertura) => {
    const src = atributo(abertura, 'src');
    return src && /^https?:\/\//i.test(src) ? comHash(abertura, src) : abertura;
  });
  novo = foraDosScripts(novo, (parte) =>
    parte.replace(/<link\b[^>]*>/gi, (tag) => {
      const rel = (atributo(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
      const href = atributo(tag, 'href');
      if (!href || !/^https?:\/\//i.test(href)) return tag;
      if (!rel.some((r) => ['stylesheet', 'preload', 'modulepreload'].includes(r))) return tag;
      if (rel.includes('stylesheet') && ESTILO_SEM_HASH.test(href)) return tag;
      return comHash(tag, href);
    }),
  );
  return { html: novo, desconhecidas };
}

/**
 * Confere, na página já adaptada, que todo script e estilo de fora está preso ao hash
 * da lista. Lista vazia = pode.
 */
export function problemasDeIntegridade(html, conhecidas = BIBLIOTECAS_CONHECIDAS) {
  const problemas = [];
  for (const abertura of aberturasDosScripts(html)) {
    const src = atributo(abertura, 'src');
    if (!src) continue;
    if (!/^https:\/\//i.test(src)) continue; // problemasDaPagina já reclama
    if (!conhecidas[src]) problemas.push(`script de fora sem hash conhecido: ${src}`);
    else if (atributo(abertura, 'integrity') !== conhecidas[src])
      problemas.push(`script de fora sem o integrity certo: ${src}`);
    else if (atributo(abertura, 'crossorigin') !== 'anonymous')
      problemas.push(`script de fora sem crossorigin="anonymous": ${src}`);
  }
  for (const m of soAMarcacao(html).matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (atributo(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = atributo(tag, 'href') ?? '';
    if (!rel.includes('stylesheet') || !/^https:\/\//i.test(href) || ESTILO_SEM_HASH.test(href))
      continue;
    if (atributo(tag, 'integrity') !== conhecidas[href] || !conhecidas[href])
      problemas.push(`estilo de fora sem o integrity certo: ${href}`);
  }
  return problemas;
}

/**
 * A ponte, o primeiro script do `<head>`. A rota do CRM entrega a página com
 * `sandbox` (origem opaca): ali `localStorage` lança erro e a página perderia o tema e
 * as camadas do mapa. A ponte troca o localStorage por um guardado na memória da aba
 * (some ao recarregar) e põe nele o tema que o CRM mandou pelo endereço (`?tema=`).
 * Fora do sandbox (o protótipo no localhost) ela não faz nada.
 */
export const PONTE_DO_CRM = `<script>/* ponte do CRM: localStorage e tema na página em sandbox (scripts/inteligencia/adaptar.mjs) */
(function () {
  try { window.localStorage.getItem("ponte-do-crm"); return; } catch (e) {}
  var guardado = {}, tema = null;
  try { tema = new URLSearchParams(window.location.search).get("tema"); } catch (e) {}
  if (tema === "dark" || tema === "light") guardado["${CHAVE_DO_TEMA_DO_CRM}"] = tema;
  var tem = function (k) { return Object.prototype.hasOwnProperty.call(guardado, k); };
  var memoria = {
    getItem: function (k) { k = String(k); return tem(k) ? guardado[k] : null; },
    setItem: function (k, v) { guardado[String(k)] = String(v); },
    removeItem: function (k) { delete guardado[String(k)]; },
    clear: function () { guardado = {}; },
    key: function (i) { var c = Object.keys(guardado); return i < c.length ? c[i] : null; }
  };
  Object.defineProperty(memoria, "length", { get: function () { return Object.keys(guardado).length; } });
  try { Object.defineProperty(window, "localStorage", { value: memoria, configurable: true }); } catch (e) {}
})();
</script>`;

/** Põe a ponte antes de qualquer outro script: logo depois do `<meta charset>` (ou do `<head>`). */
export function porAPonte(html) {
  const fimDoHead = html.search(/<\/head>/i);
  if (fimDoHead < 0) return { html, posta: false };
  const head = html.slice(0, fimDoHead);
  const charset = head.match(/<meta\b[^>]*\bcharset\s*=[^>]*>/i);
  const abertura = head.match(/<head\b[^>]*>/i);
  const ancora = charset ?? abertura;
  if (!ancora) return { html, posta: false };
  const ponto = (ancora.index ?? 0) + ancora[0].length;
  return { html: `${html.slice(0, ponto)}\n${PONTE_DO_CRM}${html.slice(ponto)}`, posta: true };
}

/** A data e a hora no fuso de Natal, como a tela mostra (18/11/2026 às 14:32). */
export function dataDaPagina(quando) {
  const data = new Date(quando);
  if (Number.isNaN(data.getTime())) return String(quando);
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Fortaleza',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(data)
      .map((p) => [p.type, p.value]),
  );
  return `${partes.day}/${partes.month}/${partes.year} às ${partes.hour}:${partes.minute}`;
}

/**
 * A faixa no alto da página com a data em que ela foi atualizada. A página é uma foto:
 * a coleta de segunda e quinta no servidor só aparece aqui depois de uma cópia nova e
 * de uma publicação nova, e quem abre precisa saber de quando é o que está vendo.
 */
export function porAFaixaDaData(html, quando) {
  const faixa =
    `\n<div class="crm-faixa-data" role="note">Página atualizada em <b>${escaparTexto(dataDaPagina(quando))}</b> (horário de Natal). ` +
    'Ela não muda sozinha: a coleta de segunda e quinta só aparece aqui quando a página é atualizada e publicada de novo.</div>';
  let posta = false;
  const novo = foraDosScripts(html, (parte) =>
    posta
      ? parte
      : parte.replace(/<body\b[^>]*>/i, (tag) => {
          posta = true;
          return tag + faixa;
        }),
  );
  return { html: novo, posta };
}

const ESTILO_DA_FAIXA =
  '<style>.crm-faixa-data{margin:0;padding:6px 16px;text-align:center;' +
  'font:500 12px/1.45 var(--f-ui,system-ui,-apple-system,"Segoe UI",sans-serif);' +
  'color:var(--text-2,#4b5563);background:var(--panel-2,#f3f4f6);' +
  'box-shadow:inset 0 -1px 0 var(--line,rgba(0,0,0,.08))}' +
  '.crm-faixa-data b{font-weight:600;color:var(--text,inherit)}</style>\n';

/** Quantas menções de portal em texto alguém leu e liberou ao copiar (0 = nenhuma). */
export function mencoesLiberadas(html) {
  const m = html.match(/<meta\s+name="inteligencia-mencoes-liberadas"\s+content="(\d+)"\s*>/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Metas e estilo do `<head>`: fora dos buscadores; nos links para fora, o outro site
 * recebe só a origem; o estilo da faixa da data; e, quando alguém liberou menções de
 * portal em texto, quantas foram (o teste do site confere esse número).
 */
export function marcarOHead(html, { mencoesLiberadas: liberadas = 0 } = {}) {
  const metas =
    '<meta name="robots" content="noindex, nofollow">\n' +
    '<meta name="referrer" content="strict-origin-when-cross-origin">\n' +
    (liberadas > 0
      ? `<meta name="inteligencia-mencoes-liberadas" content="${Number(liberadas)}">\n`
      : '') +
    ESTILO_DA_FAIXA;
  const fimDoHead = html.search(/<\/head>/i);
  if (fimDoHead < 0)
    throw new ErroDaCopia(
      'A página não tem </head>: não parece a casca do protótipo (modelo.html).',
    );
  return html.slice(0, fimDoHead) + metas + html.slice(fimDoHead);
}

/** Um comentário logo depois do doctype, para quem abrir o arquivo saber de onde veio. */
export function carimbar(html, { origem, quando, mencoesLiberadas: liberadas = 0 }) {
  // Um "--" dentro do comentário o fecharia antes da hora.
  const texto = (
    `Inteligência de mercado da Imova: cópia do protótipo (${origem}) para o CRM, ` +
    `feita por scripts/inteligencia/copiar-prototipo.mjs em ${quando}. ` +
    (liberadas > 0
      ? `Quem copiou leu e liberou ${liberadas} menção(ões) de portal proibido em texto (opção permitir menções em texto). `
      : '') +
    'Não edite aqui: edite o protótipo e rode o script de novo.'
  ).replace(/-{2,}/g, '—');
  return html.replace(/^(\s*<!doctype html[^>]*>)/i, (doctype) => `${doctype}\n<!-- ${texto} -->`);
}

/**
 * Confere o que a página precisa ter para ser publicada no CRM. Devolve a lista de
 * problemas (vazia = pode). A rota do CRM entrega um arquivo só: código, estilo ou
 * dado em arquivo separado não chegaria (e não pode morar em public/, onde sairia
 * sem login).
 */
export function problemasDaPagina(html) {
  const problemas = [];
  if (!/^\s*<!doctype html/i.test(html)) problemas.push('não começa com <!doctype html>.');
  for (const marcador of MARCADORES_DO_MONTAR) {
    if (html.includes(marcador))
      problemas.push(
        `o marcador ${marcador} continua lá: a página não foi montada (node montar.mjs).`,
      );
  }
  const marcacao = soAMarcacao(html);
  for (const abertura of aberturasDosScripts(html)) {
    const src = atributo(abertura, 'src');
    if (src !== null && !/^https:\/\//i.test(src))
      problemas.push(`script em arquivo separado (${src}): tudo tem de estar dentro do HTML.`);
  }
  for (const m of marcacao.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>/gi)) {
    if (!/^(?:https:\/\/|data:)/i.test(m[1]))
      problemas.push(`arquivo separado no <link> (${m[1]}): tudo tem de estar dentro do HTML.`);
  }
  for (const m of soOsScripts(html).matchAll(/\bfetch\(\s*(["'`])([^"'`]*)\1/g)) {
    if (!/^https:\/\//i.test(m[2]))
      problemas.push(
        `o código busca um arquivo do próprio site (${m[2]}): os dados têm de estar dentro do HTML.`,
      );
  }
  return problemas;
}

/**
 * Os portais com que a Imova não pode ter associação nenhuma (decisão do dono na
 * entrevista de 18/11/2026: zero chance de banimento no Canal Pro; "Canal Pro, ZAP,
 * VivaReal, OLX ou parecidos"). Nada coletado deles vai para o CRM. O índice FipeZAP
 * (planilha pública da Fipe) pode, e por isso o "ZAP" logo depois de "Fipe" não conta.
 *
 * "Parecidos": QuintoAndar e Mercado Livre Imóveis entram por cautela (revisão de
 * 18/11/2026). Se o dono disser que não, é só tirar daqui e dos testes.
 *
 * Entre as palavras de um nome composto vale espaço, "_" ou "-" ("viva_real",
 * "canal-pro", "zap_imoveis"), porque o "_" derruba o \b.
 */
const SEP = '[\\s_-]?';
const DOMINIOS_PROIBIDOS =
  /\b(?:[a-z0-9-]+\.)*(?:(?:zapimoveis|vivareal|imovelweb|grupozap|canalpro|quintoandar)\.com(?:\.br)?|olx\.com\.br|imovel\.mercadolivre\.com\.br)\b/gi;
const SLUG_DE_PORTAL =
  `(?:zap(?:${SEP}im[oó]veis)?|viva${SEP}real|olx|imovelweb|canal${SEP}pro|grupo${SEP}(?:zap|olx)` +
  `|quinto${SEP}andar|mercado${SEP}livre(?:${SEP}im[oó]veis)?)`;
/**
 * Um portal como DADO: uma palavra JSON que é só o nome do portal, como chave
 * (`"zap":1`, `"vivareal":null`) ou como valor (`"fonte":"olx"`, `["zap","olx"]`).
 */
const PORTAL_COMO_DADO = new RegExp(`(?<=[\\[{,:]\\s*)"${SLUG_DE_PORTAL}"(?=\\s*[:,\\]}])`, 'gi');
/** O nome do portal num texto (análise, conselho de onde anunciar). */
const PORTAL_NO_TEXTO = new RegExp(
  `\\b(?:Canal${SEP}Pro|Grupo${SEP}ZAP|Grupo${SEP}OLX|ZAP${SEP}Im[oó]veis|Viva${SEP}Real|OLX|Imovelweb` +
    `|Quinto${SEP}Andar|Mercado${SEP}Livre)\\b|(?<!fipe[\\s_-]?)\\bZAP\\b`,
  'gi',
);

function exemplos(html, padrao, quantos = 3) {
  const achados = [];
  for (const m of html.matchAll(padrao)) {
    const i = m.index ?? 0;
    achados.push(
      html
        .slice(Math.max(0, i - 40), i + m[0].length + 40)
        .replace(/\\u003c/g, '<')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    if (achados.length >= quantos) break;
  }
  return achados;
}

const contar = (html, padrao) => [...html.matchAll(padrao)].length;

/**
 * Rastros dos portais proibidos na página. `bloqueios` impede a cópia: endereço de
 * portal (link para anúncio, robots.txt lido, termos abertos) ou portal como dado.
 * `mencoes` é o nome no texto, que também barra, a não ser que alguém tenha lido
 * cada uma e liberado.
 */
export function rastrosDePortais(html) {
  const bloqueios = [];
  const dominios = contar(html, DOMINIOS_PROIBIDOS);
  if (dominios)
    bloqueios.push(
      `${dominios} endereço(s) de portal proibido (ZAP, VivaReal, OLX, Imovelweb, Canal Pro, QuintoAndar, Mercado Livre Imóveis). Ex.: ${exemplos(html, DOMINIOS_PROIBIDOS).join(' | ')}`,
    );
  const comoDado = contar(html, PORTAL_COMO_DADO);
  if (comoDado)
    bloqueios.push(
      `${comoDado} dado(s) com portal proibido como fonte. Ex.: ${exemplos(html, PORTAL_COMO_DADO).join(' | ')}`,
    );
  const mencoes = contar(html, PORTAL_NO_TEXTO);
  return {
    bloqueios,
    mencoes,
    exemplosDeMencao: mencoes ? exemplos(html, PORTAL_NO_TEXTO) : [],
  };
}

/**
 * A página do protótipo, pronta para o CRM. Lança `ErroDaCopia` quando falta algo
 * indispensável; `avisos` é o que dá para publicar mesmo assim, mas alguém precisa
 * saber.
 */
/**
 * O fundo do mapa (decisão de 19/11/2026, com a liberdade dada pelo dono): a página roda em
 * `sandbox`, sem origem, e por isso os pedidos de ladrilho ao OpenStreetMap sairiam sem
 * Referer, o que a política de uso do OSM não aceita. Na cópia do CRM o mapa fica sem
 * fundo: cada ladrilho vira um GIF transparente de 1 px, dentro da página (nenhum pedido
 * sai). Contornos, costa, pontos e balões continuam; a atribuição continua citando o OSM,
 * porque os contornos vêm de dados dele (ODbL), guardados no protótipo.
 */
export const LADRILHO_TRANSPARENTE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const LADRILHOS_DO_OSM = /https:\/\/(?:[a-c]\.|\{s\}\.)?tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/g;

export function semFundoDoMapa(html) {
  let trocados = 0;
  const pronto = html.replace(LADRILHOS_DO_OSM, () => {
    trocados++;
    return LADRILHO_TRANSPARENTE;
  });
  return { html: pronto, trocados };
}

export function adaptarParaOCrm(
  html,
  {
    origem = 'protótipo',
    quando = new Date().toISOString(),
    rotaInicial = ROTA_INICIAL_DO_CRM,
    permitirMencoesEmTexto = false,
  } = {},
) {
  const problemas = problemasDaPagina(html);
  if (problemas.length)
    throw new ErroDaCopia(`A página não pode ir para o CRM:\n- ${problemas.join('\n- ')}`);

  const portais = rastrosDePortais(html);
  if (portais.bloqueios.length)
    throw new ErroDaCopia(
      'A página tem dados de portal com que a Imova não pode ter associação (decisão de 18/11/2026). ' +
        `Limpe os dados do protótipo e monte de novo:\n- ${portais.bloqueios.join('\n- ')}`,
    );

  // O nome no texto costuma ser dado copiado do portal ("a mesma casa aparece no ZAP
  // por R$ …"). Por isso também barra, a não ser que alguém tenha lido cada menção e
  // dito que é só texto (`--permitir-mencoes-em-texto`). Aí vira aviso, e o número
  // fica gravado na página (meta e carimbo) para o teste do site conferir.
  const avisos = [];
  let liberadas = 0;
  if (portais.mencoes) {
    const texto = `O nome de um portal proibido aparece ${portais.mencoes} vez(es) em texto. Ex.: ${portais.exemplosDeMencao.join(' | ')}`;
    if (!permitirMencoesEmTexto)
      throw new ErroDaCopia(
        `${texto}\nLimpe os dados do protótipo. Se cada menção for só texto (nenhum dado vindo do portal), rode de novo com --permitir-mencoes-em-texto.`,
      );
    liberadas = portais.mencoes;
    avisos.push(`${texto} (liberadas por quem copiou; a página registra o número.)`);
  }
  const voltar = ligarOVoltar(html, rotaInicial);
  if (voltar.trocados === 0) {
    throw new ErroDaCopia(
      'Não achei o "Voltar ao CRM" (um <a class="voltar"> na casca, fora dos scripts). Sem ele a pessoa fica presa na página: ponha o link de volta no protótipo ou ajuste ligarOVoltar().',
    );
  }
  const tema = seguirOTemaDoCrm(voltar.html);
  if (!tema.trocado)
    avisos.push(
      'O script do tema mudou: a página não segue o tema do CRM (abre no tema do sistema).',
    );

  const bibliotecas = fixarBibliotecas(tema.html);
  if (bibliotecas.desconhecidas.length)
    throw new ErroDaCopia(
      `A página carrega de fora algo sem hash conhecido: ${bibliotecas.desconhecidas.join(', ')}.\n` +
        'Ponha o endereço e o hash em BIBLIOTECAS_CONHECIDAS (scripts/inteligencia/adaptar.mjs), ' +
        'conferindo o hash com o que a CDN publica, e a origem na política da rota (inteligencia/cabecalhos.ts).',
    );

  const mapa = semFundoDoMapa(bibliotecas.html);
  const ponte = porAPonte(mapa.html);
  if (!ponte.posta) throw new ErroDaCopia('Não achei o <head> para pôr a ponte do CRM.');
  const faixa = porAFaixaDaData(marcarOHead(ponte.html, { mencoesLiberadas: liberadas }), quando);
  if (!faixa.posta)
    throw new ErroDaCopia('Não achei o <body> para pôr a faixa com a data da página.');

  const pronto = carimbar(faixa.html, { origem, quando, mencoesLiberadas: liberadas });
  const finais = [...problemasDaPagina(pronto), ...problemasDeIntegridade(pronto)];
  if (/tile\.openstreetmap\.org/i.test(pronto))
    finais.push('a página ainda pede ladrilhos ao OpenStreetMap (sem Referer, por causa do sandbox): ajuste semFundoDoMapa().');
  if (finais.length)
    throw new ErroDaCopia(`A página adaptada saiu com problema:\n- ${finais.join('\n- ')}`);

  const tamanho = Buffer.byteLength(pronto, 'utf8');
  if (tamanho > TAMANHO_PARA_AVISAR)
    avisos.push(
      `A página tem ${(tamanho / 1024 / 1024).toFixed(1)} MB: no celular, no 4G, vai demorar.`,
    );
  return {
    html: pronto,
    avisos,
    tamanho,
    voltarTrocados: voltar.trocados,
    ladrilhosTrocados: mapa.trocados,
    mencoesLiberadas: liberadas,
    atualizadaEm: dataDaPagina(quando),
  };
}
