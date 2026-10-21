#!/usr/bin/env node
/**
 * O único caminho para mexer no banco de produção de uma empresa.
 *
 * Existe porque "uma pessoa subir comando do banco para o projeto errado não deve
 * acontecer" (usuário, 21/10/2026). Um `supabase db push` solto vai para o projeto que
 * estiver linkado no terminal — e este repositório costuma estar linkado à KOMUNE. Aqui,
 * o projeto vem de `supabase/empresas.json`, pela empresa que você digita, e vai para a
 * CLI como `--linked --project-ref <código>`: o código fixo vale por cima do link do
 * terminal, e o acesso é o da conta logada na CLI (sem senha de banco, sem `.env`).
 * Nada roda antes de duas conferências:
 *
 *   1. o banco diz que é daquela empresa (`public.empresa_do_banco()`, gravada pela
 *      migração 20261022090000); outra empresa, ou banco com dados e sem identidade,
 *      aborta;
 *   2. a ordem: uma migração só chega a uma empresa depois de estar nas que vêm antes
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
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CADASTRO = JSON.parse(readFileSync(join(RAIZ, 'supabase/empresas.json'), 'utf8'));
/** A migração que cria `app.identidade` e as funções da trava. */
const MIGRACAO_DA_IDENTIDADE = '20261022090000';

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

/**
 * Para onde a CLI aponta. Remoto: o projeto da empresa pelo código fixo — a CLI só aceita
 * `--project-ref` junto com `--linked`, e aí ele vale por cima do link do terminal
 * (conferido em 21/10/2026). Local: o endereço do `supabase start` daquela empresa.
 */
function alvo(empresa, local) {
  return local
    ? ['--db-url', CADASTRO.empresas[empresa].local]
    : ['--linked', '--project-ref', CADASTRO.empresas[empresa].projeto];
}

/** Consulta só de leitura. */
function consultar(empresa, local, sql) {
  const bruto = supabase(['db', 'query', ...alvo(empresa, local), sql, '--output-format', 'json']);
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
 * Roda um arquivo SQL inteiro (vários comandos, blocos `do`), tudo ou nada.
 *
 * Remoto: `supabase db query -f` pelo projeto da empresa, que roda o arquivo como um
 * bloco só — um erro em qualquer comando desfaz todos (conferido no projeto vazio da
 * Imova em 21/10/2026).
 *
 * Local: a CLI com `--db-url` só roda um comando por vez, e o Mac não tem `psql`: ele vem
 * da mesma imagem do Postgres que o `supabase start` usa, num contêiner descartável.
 * Do contêiner, o 127.0.0.1 do Mac é `host.docker.internal`.
 */
function rodarArquivoSql(empresa, local, arquivo) {
  if (!local) {
    supabase(['db', 'query', ...alvo(empresa, false), '-f', arquivo]);
    return;
  }
  const imagem = process.env.PSQL_IMAGE ?? 'public.ecr.aws/supabase/postgres:17.6.1.171';
  const doConteiner = CADASTRO.empresas[empresa].local.replace('@127.0.0.1:', '@host.docker.internal:');
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
    supabase(['db', 'query', ...alvo(empresa, opcoes.local), `select app.definir_identidade('${empresa}', true)`]);
    return exigirIdentidade(empresa, opcoes.local);
  }

  if (comando === 'migrar') {
    const atual = identidade(empresa, opcoes.local);
    const aplicadas = migracoesAplicadas(empresa, opcoes.local);
    const pendentes = migracoesDoRepositorio().filter((v) => !aplicadas.has(v));
    if (atual == null && CADASTRO.empresas[empresa].seed && bancoVazio(empresa, opcoes.local)) {
      console.log(`Identidade: banco novo e vazio da ${empresa}. Recebe a estrutura agora; depois rode "semear".`);
    } else if (atual === undefined && pendentes.includes(MIGRACAO_DA_IDENTIDADE)) {
      // Banco que já existia antes da trava (a KOMUNE): a função que grava a identidade
      // chega nesta leva. Uma vez só; depois dela, toda migração exige a identidade.
      console.log(`Identidade: banco anterior à trava. Recebe a trava agora; depois rode "identidade".`);
    } else {
      exigirIdentidade(empresa, opcoes.local);
    }
    if (!pendentes.length) return console.log('Nenhuma migração pendente.');
    const antes = CADASTRO.ordem.slice(0, CADASTRO.ordem.indexOf(empresa));
    for (const outra of antes) {
      const nela = migracoesAplicadas(outra, opcoes.local);
      const faltam = pendentes.filter((v) => !nela.has(v));
      if (faltam.length) parar(`Antes da ${empresa}, estas migrações precisam estar na ${outra}: ${faltam.join(', ')}.`);
    }
    console.log(`Vai aplicar ${pendentes.length} migração(ões): ${pendentes.join(', ')}`);
    await confirmar(empresa, opcoes);
    if (aplicadas.size === 0) {
      // Projeto novo: o padrão de permissões igual ao da KOMUNE antes da primeira tabela.
      console.log('Projeto novo: igualando as permissões padrão às da KOMUNE (supabase/empresas/projeto-novo.sql).');
      rodarArquivoSql(empresa, opcoes.local, join(RAIZ, 'supabase/empresas/projeto-novo.sql'));
    }
    // A CLI entra no projeto por um papel temporário (`cli_login_postgres`) que não tem o
    // search_path do `postgres` ("$user", public, extensions). Migração antiga que usa tipo
    // de extensão sem esquema (`citext` na 20260904001401) parava. Aqui a sessão recebe o
    // mesmo search_path com que a KOMUNE foi migrada (medido em 21/10/2026, no projeto da Imova).
    const env = { ...process.env, PGOPTIONS: '-c search_path="$user",public,extensions' };
    execFileSync('supabase', ['db', 'push', ...alvo(empresa, opcoes.local), '--yes'], { cwd: RAIZ, stdio: 'inherit', env });
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
    rodarArquivoSql(empresa, opcoes.local, join(RAIZ, seed));
    exigirIdentidade(empresa, opcoes.local);
    return console.log('✅ Seed aplicado.');
  }

  parar('Comandos: conferir | migrar | semear | identidade (só KOMUNE).');
}

await principal();
