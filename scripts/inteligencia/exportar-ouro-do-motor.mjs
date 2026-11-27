// Exporta o TESTE DE OURO do motor das vantagens (19/11/2026): o que o motor do
// protótipo RECEBE (a base B de `montarBase()`) e o que ele DEVOLVE (o dossiê V de
// `ImovaIntel.rodada()`, argumentos-imovel@3), rodando o MESMO js/55-argumentos.js da
// página em Node (vm), do jeito de `ferramentas/gerar-argumentos.mjs`.
//
// O motor em TypeScript (`apps/workers/src/mercado/motor`) recebe a mesma base e tem
// de devolver as mesmas vantagens, imóvel por imóvel (`motor/ouro.test.ts`).
//
// Uso (o protótipo não é editado):
//   node scripts/inteligencia/exportar-ouro-do-motor.mjs [pasta-do-protótipo] [--intermediario arquivo.json]
// Grava:
//   apps/workers/src/mercado/motor/ouro/base.json.gz        a base (sem link, sem coordenada dos anúncios)
//   apps/workers/src/mercado/motor/ouro/vantagens.json.gz   o dossiê de cada imóvel
// Com --intermediario, grava também a saída do motor v3 (candidatos e fatos de região), só para conferir.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '..', '..');
const args = process.argv.slice(2);
const RAIZ =
  args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--intermediario') ??
  join(process.env.HOME ?? '', 'Documents', 'imova-mercado-premium-2026-11-17');
const iInter = args.indexOf('--intermediario');
const INTER = iInter >= 0 ? args[iInter + 1] : null;
const SAIDA = join(REPO, 'apps', 'workers', 'src', 'mercado', 'motor', 'ouro');

/* 1) o D da página: o montar.mjs de sempre, numa pasta temporária */
const tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'imova-ouro-'));
let D;
try {
  const html = join(tmp, 'pagina.html');
  execFileSync(process.execPath, [join(RAIZ, 'montar.mjs'), join(RAIZ, 'dados'), html], {
    cwd: RAIZ,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const pag = readFileSync(html, 'utf8');
  const marca = '/* ---- js/00-base.js ---- */\nconst D = ';
  const i = pag.indexOf(marca);
  if (i < 0) throw new Error('não achei o D em js/00-base.js na página montada');
  const fim = pag.indexOf('\n', i + marca.length);
  D = JSON.parse(pag.slice(i + marca.length, fim).replace(/;\s*$/, ''));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/* 2) os arquivos de lógica, na ordem do gerar-argumentos.mjs */
const ARQUIVOS = [
  'js/00-base.js',
  'js/10-modelo-preco.js',
  'js/15-desconto.js',
  'js/16-comercial.js',
  'js/20-carteira.js',
  'js/25-geo.js',
  'js/45-historico.js',
  'js/55-argumentos.js',
];
const nada = () => {};
const elemento = () => null;
const ctx = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  addEventListener: nada,
  removeEventListener: nada,
  matchMedia: () => ({ matches: false, addEventListener: nada, removeEventListener: nada }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  document: {
    querySelector: elemento,
    querySelectorAll: () => [],
    getElementById: elemento,
    addEventListener: nada,
    documentElement: {
      dataset: {},
      classList: { add: nada, remove: nada, toggle: nada, contains: () => false },
      style: { setProperty: nada },
    },
  },
});
ctx.window = ctx;
for (const f of ARQUIVOS) {
  let codigo = readFileSync(join(RAIZ, f), 'utf8');
  if (f === 'js/00-base.js') codigo = codigo.replace('/*__DADOS__*/null', () => JSON.stringify(D));
  vm.runInContext(codigo, ctx, { filename: f });
}
const init = readFileSync(join(RAIZ, 'js/99-init.js'), 'utf8');
const ini = init.indexOf('function iniciarDados(){');
let prof = 0;
let fimF = -1;
for (let k = init.indexOf('{', ini); k < init.length; k++) {
  if (init[k] === '{') prof++;
  else if (init[k] === '}' && --prof === 0) {
    fimF = k + 1;
    break;
  }
}
if (ini < 0 || fimF < 0) throw new Error('não achei iniciarDados() em js/99-init.js');
vm.runInContext(`${init.slice(ini, fimF)}\niniciarDados();`, ctx, { filename: 'js/99-init.js' });

/* 3) entrada e saída do motor */
const B = JSON.parse(vm.runInContext('JSON.stringify(ImovaIntel.base())', ctx));
const V = JSON.parse(vm.runInContext('JSON.stringify(ImovaIntel.rodada())', ctx));
// O link e a coordenada do anúncio de terceiros não entram em nenhuma conta do motor:
// ficam fora do arquivo (o teste prova que o resultado é o mesmo sem eles).
for (const a of B.anuncios) {
  delete a.url;
  delete a.lat;
  delete a.lng;
}
const gz = (o) => gzipSync(Buffer.from(`${JSON.stringify(o)}\n`), { level: 9 });
writeFileSync(join(SAIDA, 'base.json.gz'), gz(B));
writeFileSync(join(SAIDA, 'vantagens.json.gz'), gz(V));
if (INTER) writeFileSync(INTER, vm.runInContext('JSON.stringify(ImovaIntel.motor())', ctx));
const n = V.imoveis.reduce((s, i) => s + i.vantagens.length, 0);
console.log(
  `base: ${B.anuncios.length} anúncios, ${B.ims.length} unidades da carteira · dossiê: ${V.imoveis.length} imóveis, ${n} vantagens · ${SAIDA}`,
);
