#!/usr/bin/env node
/**
 * O único caminho para mexer no banco de produção de uma empresa.
 *
 * Existe porque "uma pessoa subir comando do banco para o projeto errado não deve
 * acontecer" (usuário, 21/10/2026). Um `supabase db push` solto vai para o projeto que
 * estiver linkado no terminal — e este repositório costuma estar linkado à KOMUNE. Aqui,
 * o projeto vem de `supabase/empresas.json`, pela empresa que você digita, e nada roda
 * antes de três conferências:
 *
 *   1. o endereço do banco (em `.env.<empresa>`, fora do git) é do projeto daquela
 *      empresa — o código do projeto tem de estar nele;
 *   2. o banco diz que é daquela empresa (`public.empresa_do_banco()`, gravada pela
 *      migração 20261022090000); outra empresa, ou banco com dados e sem identidade,
 *      aborta;
 *   3. a ordem: uma migração só chega a uma empresa depois de estar nas que vêm antes
 *      em `ordem` (a Imova vai na frente; se algo der errado, aparece lá).
 *
 * E pede para digitar o nome da empresa antes de gravar (ou `--confirmar <empresa>`
 * quando não há terminal interativo).
 *
 *   node scripts/publicar-banco.mjs <empresa> conferir [--local]
 *   node scripts/publicar-banco.mjs <empresa> migrar   [--local] [--confirmar <empresa>]
 *   node scripts/publicar-banco.mjs <empresa> semear   [--local] [--confirmar <empresa>]
 *   node scripts/publicar-banco.mjs komune identidade  --confirmar komune   (uma vez, banco que já tem dados)
 *
 * `--local` usa os bancos do `supabase start` (endereços em `empresas.json`), para
 * ensaiar tudo no computador antes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CADASTRO = JSON.parse(readFileSync(join(RAIZ, 'supabase/empresas.json'), 'utf8'));

function parar(mensagem) {
  console.error(`\n✋ ${mensagem}\nNada foi feito.`);
  process.exit(1);
}

function supabase(args) {
  try {
    return execFileSync('supabase', args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const saida = String(e.stdout ?? '');
    let motivo = saida.trim() || String(e.stderr ?? e.message).trim();
    try {
      motivo = JSON.parse(saida.slice(saida.indexOf('{'))).error?.message ?? motivo;
    } catch {
      // Saída que não é JSON: mostra como veio.
    }
    return parar(`A CLI do Supabase recusou (${args.slice(0, 2).join(' ')}): ${motivo}`);
  }
}

/** Lê o `.env.<empresa>` da raiz (fora do git) e devolve o DATABASE_URL dele. */
function enderecoDoBanco(empresa, local) {
  const dados = CADASTRO.empresas[empresa];
  if (local) return dados.local;
  const arquivo = join(RAIZ, `.env.${empresa}`);
  if (!existsSync(arquivo)) {
    parar(`Falta ${arquivo} com DATABASE_URL=<conexão do projeto ${dados.projeto}> (painel do Supabase → Connect → Session pooler).`);
  }
  const linha = readFileSync(arquivo, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
  const url = linha?.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  if (!url) parar(`${arquivo} não tem DATABASE_URL.`);
  if (!url.includes(`postgres.${dados.projeto}@`) && !url.includes(`db.${dados.projeto}.supabase.co`)) {
    parar(`O DATABASE_URL de ${arquivo} não é do projeto ${dados.projeto} (${dados.nome}).`);
  }
  return url;
}

/** Consulta só de leitura. Remoto vai pela API de gestão (sem senha); local, pelo endereço. */
function consultar(empresa, local, sql) {
  const alvo = local
    ? ['--db-url', CADASTRO.empresas[empresa].local]
    : ['--project-ref', CADASTRO.empresas[empresa].projeto];
  const bruto = supabase(['db', 'query', ...alvo, sql, '--output-format', 'json']);
  return JSON.parse(bruto.slice(bruto.indexOf('{'))).rows;
}

/** O Postgres confere tabela e função antes de rodar: primeiro pergunta se existem. */
function existe(empresa, local, expressao) {
  return consultar(empresa, local, `select ${expressao} is not null as existe`)[0]?.existe === true;
}

/** A empresa gravada no banco; null sem identidade; undefined num banco novo, sem a estrutura do CRM. */
function identidade(empresa, local) {
  if (!existe(empresa, local, "to_regprocedure('public.empresa_do_banco()')")) return undefined;
  return consultar(empresa, local, 'select public.empresa_do_banco() as empresa')[0]?.empresa ?? null;
}

/** Banco vazio: sem a tabela de parceiros, ou com ela vazia. */
function bancoVazio(empresa, local) {
  if (!existe(empresa, local, "to_regclass('public.organizations')")) return true;
  return Number(consultar(empresa, local, 'select count(*) as n from public.organizations')[0]?.n ?? 0) === 0;
}

function migracoesAplicadas(empresa, local) {
  if (!existe(empresa, local, "to_regclass('supabase_migrations.schema_migrations')")) return new Set();
  const linhas = consultar(empresa, local, 'select version from supabase_migrations.schema_migrations');
  return new Set(linhas.map((r) => String(r.version)));
}

function migracoesDoRepositorio() {
  return readdirSync(join(RAIZ, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.split('_')[0])
    .sort();
}

/**
 * Roda um arquivo SQL inteiro (vários comandos, blocos `do`) parando no primeiro erro.
 * A CLI do Supabase só roda um comando por vez, e o Mac não tem `psql`: ele vem da
 * mesma imagem do Postgres que o `supabase start` usa, num contêiner descartável.
 * Do contêiner, o 127.0.0.1 do Mac é `host.docker.internal`.
 */
function rodarArquivoSql(url, arquivo) {
  const imagem = process.env.PSQL_IMAGE ?? 'public.ecr.aws/supabase/postgres:17.6.1.171';
  const doConteiner = url.replace('@127.0.0.1:', '@host.docker.internal:');
  try {
    execFileSync(
      'docker',
      [
        'run', '--rm', '-i', '--entrypoint', 'psql', imagem, doConteiner,
        // Tudo ou nada: uma transação só, parando no primeiro erro.
        '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-',
      ],
      { cwd: RAIZ, input: readFileSync(arquivo), stdio: ['pipe', 'inherit', 'inherit'] },
    );
  } catch {
    parar(`O arquivo ${arquivo} parou num erro (acima). Ele roda numa transação só: nada dele ficou gravado.`);
  }
}

async function confirmar(empresa, opcoes) {
  if (opcoes.confirmar) {
    if (opcoes.confirmar !== empresa) parar(`--confirmar ${opcoes.confirmar} não é a empresa ${empresa}.`);
    return;
  }
  if (!process.stdin.isTTY) parar(`Sem terminal interativo: passe --confirmar ${empresa}.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const resposta = (await rl.question(`Para continuar, digite o nome da empresa (${empresa}): `)).trim();
  rl.close();
  if (resposta !== empresa) parar('O nome digitado não confere.');
}

function cabecalho(empresa, local) {
  const dados = CADASTRO.empresas[empresa];
  console.log(`\nEmpresa: ${dados.nome} (${empresa})`);
  console.log(`Banco:   ${local ? `LOCAL ${dados.local.replace(/:[^:@/]+@/, ':***@')}` : `projeto ${dados.projeto}`}`);
}

function exigirIdentidade(empresa, local) {
  const atual = identidade(empresa, local);
  if (atual !== empresa) {
    parar(
      atual
        ? `Este banco diz que é da empresa "${atual}", não da "${empresa}".`
        : `Este banco ainda não tem identidade. Na KOMUNE: "identidade" (uma vez). Na Imova: "semear".`,
    );
  }
  console.log(`Identidade: ✅ o banco diz que é da "${atual}".`);
}

async function principal() {
  const [empresa, comando, ...resto] = process.argv.slice(2);
  const opcoes = { local: resto.includes('--local'), confirmar: resto[resto.indexOf('--confirmar') + 1] };
  if (!resto.includes('--confirmar')) opcoes.confirmar = null;
  if (!CADASTRO.empresas[empresa]) parar(`Empresa "${empresa}" não está em supabase/empresas.json (${Object.keys(CADASTRO.empresas).join(', ')}).`);
  cabecalho(empresa, opcoes.local);

  if (comando === 'conferir') {
    const atual = identidade(empresa, opcoes.local);
    const aplicadas = migracoesAplicadas(empresa, opcoes.local);
    const pendentes = migracoesDoRepositorio().filter((v) => !aplicadas.has(v));
    console.log(`Identidade: ${atual ?? '(sem identidade)'}`);
    const lista = pendentes.length > 8 ? [...pendentes.slice(0, 3), '…', ...pendentes.slice(-3)] : pendentes;
    console.log(`Migrações no banco: ${aplicadas.size}; pendentes do repositório: ${pendentes.length}${pendentes.length ? ` (${lista.join(', ')})` : ''}`);
    return;
  }

  if (comando === 'identidade') {
    if (empresa !== 'komune') parar('Só a KOMUNE grava a identidade por aqui (banco que já existia). A Imova grava no "semear".');
    const atual = identidade(empresa, opcoes.local);
    if (atual === empresa) return console.log('Identidade: já gravada. Nada a fazer.');
    if (atual) parar(`Este banco diz que é da empresa "${atual}".`);
    await confirmar(empresa, opcoes);
    supabase(['db', 'query', '--db-url', enderecoDoBanco(empresa, opcoes.local), `select app.definir_identidade('${empresa}', true)`]);
    return exigirIdentidade(empresa, opcoes.local);
  }

  if (comando === 'migrar') {
    const atual = identidade(empresa, opcoes.local);
    if (atual == null && CADASTRO.empresas[empresa].seed && bancoVazio(empresa, opcoes.local)) {
      console.log(`Identidade: banco novo e vazio da ${empresa}. Recebe a estrutura agora; depois rode "semear".`);
    } else {
      exigirIdentidade(empresa, opcoes.local);
    }
    const aplicadas = migracoesAplicadas(empresa, opcoes.local);
    const pendentes = migracoesDoRepositorio().filter((v) => !aplicadas.has(v));
    if (!pendentes.length) return console.log('Nenhuma migração pendente.');
    const antes = CADASTRO.ordem.slice(0, CADASTRO.ordem.indexOf(empresa));
    for (const outra of antes) {
      const nela = migracoesAplicadas(outra, opcoes.local);
      const faltam = pendentes.filter((v) => !nela.has(v));
      if (faltam.length) parar(`Antes da ${empresa}, estas migrações precisam estar na ${outra}: ${faltam.join(', ')}.`);
    }
    console.log(`Vai aplicar ${pendentes.length} migração(ões): ${pendentes.join(', ')}`);
    await confirmar(empresa, opcoes);
    const url = enderecoDoBanco(empresa, opcoes.local);
    execFileSync('supabase', ['db', 'push', '--db-url', url, '--yes'], { cwd: RAIZ, stdio: 'inherit' });
    if (atual === empresa) exigirIdentidade(empresa, opcoes.local);
    return console.log('✅ Migrações aplicadas.');
  }

  if (comando === 'semear') {
    const seed = CADASTRO.empresas[empresa].seed;
    if (!seed) parar(`A ${empresa} não tem seed de empresa (o banco dela já existia).`);
    const atual = identidade(empresa, opcoes.local);
    if (atual === undefined) parar('Este banco ainda não tem a estrutura do CRM. Rode "migrar" antes.');
    if (atual && atual !== empresa) parar(`Este banco diz que é da empresa "${atual}".`);
    console.log(`Vai rodar ${seed}. Ele começa gravando ou exigindo a identidade "${empresa}".`);
    await confirmar(empresa, opcoes);
    rodarArquivoSql(enderecoDoBanco(empresa, opcoes.local), join(RAIZ, seed));
    exigirIdentidade(empresa, opcoes.local);
    return console.log('✅ Seed aplicado.');
  }

  parar('Comandos: conferir | migrar | semear | identidade (só KOMUNE).');
}

await principal();
