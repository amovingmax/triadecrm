/**
 * Sessão autenticada de desenvolvimento para os scripts de captura de tela.
 *
 * Por que existe: o CRM entra por Supabase Auth com Google, e o proxy (`src/proxy.ts`)
 * manda para /login qualquer requisição sem sessão. Para fotografar as telas internas é
 * preciso uma sessão DE VERDADE — os mesmos cookies que o @supabase/ssr grava no
 * navegador. Nada aqui afrouxa RLS, política de acesso ou o proxy: o roteiro é
 * exatamente "definir uma senha num usuário de desenvolvimento e entrar com ela".
 *
 * Roteiro:
 *   1. lê a stack LOCAL (`supabase status -o json`) — URL, anon key e service_role;
 *   2. com a service_role, define uma senha no usuário de desenvolvimento escolhido
 *      (API de admin, `updateUserById`) — só no banco local, nunca em produção;
 *   3. entra com e-mail e senha por um `createServerClient` do @supabase/ssr ligado a um
 *      cofre de cookies em memória. Quem grava os cookies é a própria biblioteca que o app
 *      usa, então o nome (`sb-127-auth-token`, fatiado em `.0`, `.1`…) e o formato saem
 *      corretos por construção, sem adivinhação;
 *   4. salva `apps/web/scripts/.sessao-dev.json` no formato `storageState` do Playwright.
 *
 * Uso: node apps/web/scripts/sessao-dev.mjs [email]
 * O arquivo gerado é credencial de sessão e está no .gitignore.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** Onde o storageState é gravado (consumido por fotografar-tudo.mjs). */
export const CAMINHO_SESSAO = resolve(AQUI, '.sessao-dev.json');

/** Usuário de desenvolvimento padrão: a Heloísa é quem usa o CRM no campo. */
const EMAIL_PADRAO = 'heloisa.dev@komune.app.br';

/** Senha efêmera, só para a stack local. */
const SENHA = 'komune-dev-foto-2026';

/** URL do app rodando em desenvolvimento; é o domínio dos cookies. */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * Chaves da stack LOCAL do Supabase.
 *
 * Não usa o `.env` da raiz de propósito: lá estão as chaves do projeto REMOTO
 * (`toqdjcajyrowutunczhr.supabase.co`), que não valem em 127.0.0.1:54321. A fonte da
 * verdade do que está rodando na máquina é o próprio CLI.
 */
export function lerStackLocal() {
  const daEnv = {
    url: process.env.SUPABASE_URL_LOCAL,
    anon: process.env.SUPABASE_ANON_KEY_LOCAL,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL,
  };
  if (daEnv.url && daEnv.anon && daEnv.service) {
    return { url: daEnv.url, anon: daEnv.anon, service: daEnv.service, origem: 'env' };
  }

  const bruto = execFileSync('supabase', ['status', '-o', 'json'], {
    cwd: resolve(AQUI, '../../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const status = JSON.parse(bruto);
  return {
    url: status.API_URL,
    anon: status.ANON_KEY,
    service: status.SERVICE_ROLE_KEY,
    origem: 'supabase status',
  };
}

/** Cofre de cookies em memória, no formato que o @supabase/ssr espera. */
function cofreDeCookies() {
  const mapa = new Map();
  return {
    mapa,
    getAll: () => [...mapa.values()].map(({ name, value }) => ({ name, value })),
    setAll: (aGravar) => {
      for (const { name, value, options } of aGravar) {
        if (!value) mapa.delete(name);
        else mapa.set(name, { name, value, options: options ?? {} });
      }
    },
  };
}

/** Traduz os cookies do @supabase/ssr para o `storageState` do Playwright. */
function paraStorageState(cofre, appUrl) {
  const { hostname } = new URL(appUrl);
  const agora = Math.floor(Date.now() / 1000);

  const cookies = [...cofre.mapa.values()].map(({ name, value, options }) => ({
    name,
    value,
    domain: hostname,
    path: options.path ?? '/',
    // `maxAge` vem em segundos a partir de agora; sem ele o cookie é de sessão (-1).
    expires: typeof options.maxAge === 'number' ? agora + options.maxAge : agora + 60 * 60 * 8,
    httpOnly: false, // o @supabase/ssr grava pelo navegador também; o app lê nos dois lados.
    secure: false, // http://localhost
    sameSite: 'Lax',
  }));

  return { cookies, origins: [] };
}

/** Faz login de verdade e devolve o storageState + dados da sessão. */
export async function criarSessaoDev(email = EMAIL_PADRAO) {
  const stack = lerStackLocal();
  if (!stack.url || !stack.service) {
    throw new Error(
      'Não achei a stack local do Supabase. Rode `supabase start` ou exporte ' +
        'SUPABASE_URL_LOCAL / SUPABASE_ANON_KEY_LOCAL / SUPABASE_SERVICE_ROLE_KEY_LOCAL.',
    );
  }

  // 1. Admin: acha o usuário de desenvolvimento e define a senha efêmera.
  const admin = createClient(stack.url, stack.service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: lista, error: erroLista } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (erroLista) throw new Error(`admin.listUsers falhou: ${erroLista.message}`);

  const usuario = lista.users.find((u) => u.email === email);
  if (!usuario) {
    const disponiveis = lista.users.map((u) => u.email).join(', ');
    throw new Error(`Usuário ${email} não existe no banco local. Existem: ${disponiveis}`);
  }

  const { error: erroSenha } = await admin.auth.admin.updateUserById(usuario.id, {
    password: SENHA,
    email_confirm: true,
  });
  if (erroSenha) throw new Error(`admin.updateUserById falhou: ${erroSenha.message}`);

  // 2. Login por senha, com o MESMO cliente que o app usa para gravar cookies.
  const cofre = cofreDeCookies();
  const supabase = createServerClient(stack.url, stack.anon, { cookies: cofre });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: SENHA });
  if (error) throw new Error(`signInWithPassword falhou: ${error.message}`);
  if (!data.session) throw new Error('Login sem sessão devolvida.');

  if (cofre.mapa.size === 0) {
    throw new Error('O @supabase/ssr não gravou nenhum cookie — storageState sairia vazio.');
  }

  const papel = data.session.user.app_metadata?.app_role ?? '(sem app_role no JWT)';
  return {
    storageState: paraStorageState(cofre, APP_URL),
    email,
    papel,
    nomesDeCookie: [...cofre.mapa.keys()],
  };
}

/** Gera o arquivo e devolve o caminho. */
export async function gravarSessaoDev(email = EMAIL_PADRAO) {
  const sessao = await criarSessaoDev(email);
  writeFileSync(CAMINHO_SESSAO, JSON.stringify(sessao.storageState, null, 2));
  return { ...sessao, caminho: CAMINHO_SESSAO };
}

/** Lê um storageState já gravado (ou null quando ainda não existe). */
export function lerSessaoDev() {
  try {
    return JSON.parse(readFileSync(CAMINHO_SESSAO, 'utf8'));
  } catch {
    return null;
  }
}

// Execução direta: node apps/web/scripts/sessao-dev.mjs [email]
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const sessao = await gravarSessaoDev(process.argv[2] ?? EMAIL_PADRAO);
  console.log(
    JSON.stringify(
      {
        arquivo: sessao.caminho,
        email: sessao.email,
        papel: sessao.papel,
        cookies: sessao.nomesDeCookie,
      },
      null,
      2,
    ),
  );
}
