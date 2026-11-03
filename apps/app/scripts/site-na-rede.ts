/**
 * O site do Tríade para o celular de teste: um segundo `next dev`, na porta 3100,
 * no endereço deste Mac na rede Wi-Fi, com o Supabase local no mesmo endereço.
 *
 * Por que não o `next dev` de sempre (porta 3000): ele aponta o Supabase para
 * 127.0.0.1, e no celular 127.0.0.1 é o próprio celular. As consultas que a página
 * faz direto ao banco (Realtime, listas) e o cookie de sessão precisam do endereço
 * que o celular alcança. Nada muda em arquivo: as variáveis entram só neste processo,
 * e o `next dev` de sempre continua ligado ao lado, sem conflito (`NEXT_DIST_DIR`
 * próprio, porta própria).
 *
 * `--hostname` com o endereço da rede também é o que o Next aceita como origem dos
 * recursos de desenvolvimento, sem mexer no `allowedDevOrigins` do `next.config.ts`.
 *
 * Uso: `pnpm -C apps/app site` (KOMUNE) ou `pnpm -C apps/app site imova` (a Imova de
 * teste, com o banco local dela em ~/triadecrm-imova-local). As duas usam as mesmas
 * chaves do Supabase local; muda a empresa, a porta do banco e a pasta de saída. Se o
 * Mac tiver mais de uma rede e a escolhida for a errada,
 * `TRIADE_IP_DO_MAC=192.168.0.10 pnpm -C apps/app site`.
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORTA_DO_SITE_NA_REDE } from '../src/ambiente';

/** A porta do Supabase local de cada empresa (o `[api] port` do config.toml de cada uma). */
const EMPRESAS = {
  komune: { portaDoSupabase: 54321 },
  imova: { portaDoSupabase: 56321 },
} as const;
type Empresa = keyof typeof EMPRESAS;

function empresaPedida(valor: string | undefined): Empresa {
  const chave = (valor ?? '').trim() || 'komune';
  if (!(chave in EMPRESAS)) {
    throw new Error(`Empresa "${valor}" não existe. Use ${Object.keys(EMPRESAS).join(' ou ')}.`);
  }
  return chave as Empresa;
}
const REDE_PRIVADA = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function enderecoNaRede(): string {
  const enderecos = Object.entries(networkInterfaces()).flatMap(([placa, lista]) =>
    (lista ?? [])
      .filter((e) => e.family === 'IPv4' && !e.internal && REDE_PRIVADA.test(e.address))
      .map((e) => ({ placa, endereco: e.address })),
  );
  // en0 é o Wi-Fi do Mac; sem ele, a primeira rede privada que aparecer.
  const escolhido = enderecos.find((e) => e.placa === 'en0') ?? enderecos[0];
  if (!escolhido) {
    throw new Error('Este Mac não está em nenhuma rede local. Conecte no mesmo Wi-Fi do celular.');
  }
  return escolhido.endereco;
}

const empresa = empresaPedida(process.argv[2]);
const { portaDoSupabase } = EMPRESAS[empresa];
const ip = process.env.TRIADE_IP_DO_MAC?.trim() || enderecoNaRede();
const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const site = `http://${ip}:${PORTA_DO_SITE_NA_REDE}`;

console.log(
  `Site para o celular (${empresa.toUpperCase()}): ${site} (Supabase em http://${ip}:${portaDoSupabase})`,
);
console.log('No celular, no mesmo Wi-Fi: abra o app pelo Expo Go (pnpm -C apps/app start).');
console.log('Trocou de empresa? No app, saia e entre de novo: a sessão de uma não vale na outra.');

const next = spawn(
  'pnpm',
  ['exec', 'next', 'dev', '--hostname', ip, '--port', String(PORTA_DO_SITE_NA_REDE)],
  {
    cwd: web,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: `http://${ip}:${portaDoSupabase}`,
      NEXT_PUBLIC_APP_URL: site,
      NEXT_PUBLIC_EMPRESA: empresa,
      // Pasta de saída própria (e uma por empresa, porque o Next grava o NEXT_PUBLIC_*
      // no código compilado): o `next dev` de sempre mantém o .next aberto.
      NEXT_DIST_DIR: empresa === 'komune' ? '.next-celular' : `.next-celular-${empresa}`,
    },
  },
);
next.on('exit', (codigo) => process.exit(codigo ?? 0));
