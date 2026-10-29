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
 * Uso: `pnpm -C apps/app site`. Se o Mac tiver mais de uma rede e a escolhida for
 * a errada, `TRIADE_IP_DO_MAC=192.168.0.10 pnpm -C apps/app site`.
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORTA_DO_SITE_NA_REDE } from '../src/ambiente';

const PORTA_DO_SUPABASE = 54321;
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

const ip = process.env.TRIADE_IP_DO_MAC?.trim() || enderecoNaRede();
const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const site = `http://${ip}:${PORTA_DO_SITE_NA_REDE}`;

console.log(`Site para o celular: ${site} (Supabase em http://${ip}:${PORTA_DO_SUPABASE})`);
console.log('No celular, no mesmo Wi-Fi: abra o app pelo Expo Go (pnpm -C apps/app start).');

const next = spawn(
  'pnpm',
  ['exec', 'next', 'dev', '--hostname', ip, '--port', String(PORTA_DO_SITE_NA_REDE)],
  {
    cwd: web,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: `http://${ip}:${PORTA_DO_SUPABASE}`,
      NEXT_PUBLIC_APP_URL: site,
      // Pasta de saída própria: o `next dev` de sempre mantém o .next aberto.
      NEXT_DIST_DIR: '.next-celular',
    },
  },
);
next.on('exit', (codigo) => process.exit(codigo ?? 0));
