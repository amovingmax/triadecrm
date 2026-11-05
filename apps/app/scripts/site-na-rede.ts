/**
 * Os sites do Tríade para o celular de teste: um `next dev` por empresa, KOMUNE na
 * porta 3100 e Imova na 3101, no endereço deste Mac na rede, cada um com o Supabase
 * local da sua empresa no mesmo endereço.
 *
 * Por que não o `next dev` de sempre (porta 3000): ele aponta o Supabase para
 * 127.0.0.1, e no celular 127.0.0.1 é o próprio celular. As consultas que a página
 * faz direto ao banco (Realtime, listas) e o cookie de sessão precisam do endereço
 * que o celular alcança. Nada muda em arquivo: as variáveis entram só nestes
 * processos, e o `next dev` de sempre continua ligado ao lado, sem conflito
 * (`NEXT_DIST_DIR` e porta próprios).
 *
 * AS DUAS JUNTAS, para a troca de empresa funcionar como no ar: cada site conhece o
 * endereço do outro (`NEXT_PUBLIC_EMPRESAS_LINKS`) e pergunta a ele se a pessoa também
 * entra lá, com uma assinatura (`SEGREDO_ENTRE_EMPRESAS`, sorteado a cada vez que o
 * script liga e que só estes dois processos conhecem). Os usuários de teste existem
 * nos dois bancos, então o botão de trocar aparece.
 *
 * O BANCO DA IMOVA PELO NOME DO MAC (`MacBook-Air-de-A.local`). Os dois sites ficam no
 * mesmo endereço, e o navegador guarda cookie por endereço, não por porta. O cookie de
 * sessão do Supabase leva no nome o primeiro pedaço do endereço do banco: com o número
 * nas duas empresas, a Imova lia o login da KOMUNE e entrava com um usuário que não
 * existe no banco dela (medido em 03/11/2026). Com o nome `.local` (mDNS, que o iPhone
 * também enxerga), cada empresa guarda o seu login, como no ar, onde cada uma tem o seu
 * endereço. A KOMUNE continua pelo número.
 *
 * `--hostname` com o endereço da rede também é o que o Next aceita como origem dos
 * recursos de desenvolvimento, sem mexer no `allowedDevOrigins` do `next.config.ts`.
 *
 * Uso: `pnpm -C apps/app site` (as duas), ou `pnpm -C apps/app site komune` /
 * `site imova` (só uma, sem o botão de trocar). Se o Mac tiver mais de uma rede e a
 * escolhida for a errada, `TRIADE_IP_DO_MAC=192.168.0.10 pnpm -C apps/app site`.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORTAS_NA_REDE } from '../src/ambiente';

/** A porta do Supabase local de cada empresa (o `[api] port` do config.toml de cada uma). */
const SUPABASE_LOCAL = { komune: 54321, imova: 56321 } as const;
type Empresa = keyof typeof SUPABASE_LOCAL;
const TODAS = Object.keys(SUPABASE_LOCAL) as Empresa[];

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

/** O nome do Mac na rede local (mDNS). `TRIADE_NOME_DO_MAC` troca, se precisar. */
function nomeDoMac(): string {
  const pedido = process.env.TRIADE_NOME_DO_MAC?.trim();
  if (pedido) return pedido;
  return `${execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim()}.local`;
}

function empresasPedidas(valor: string | undefined): Empresa[] {
  const chave = (valor ?? '').trim();
  if (!chave) return TODAS;
  if (!(chave in SUPABASE_LOCAL)) {
    throw new Error(
      `Empresa "${valor}" não existe. Use ${TODAS.join(' ou ')}, ou nada para as duas.`,
    );
  }
  return [chave as Empresa];
}

const empresas = empresasPedidas(process.argv[2]);
const ip = process.env.TRIADE_IP_DO_MAC?.trim() || enderecoNaRede();
const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const enderecoDe = (empresa: Empresa) => `http://${ip}:${PORTAS_NA_REDE[empresa]}`;
const bancoDe = (empresa: Empresa) =>
  `http://${empresa === 'komune' ? ip : nomeDoMac()}:${SUPABASE_LOCAL[empresa]}`;
const links = empresas.map((e) => `${e}=${enderecoDe(e)}`).join(';');
const segredo = randomBytes(32).toString('hex');

for (const empresa of empresas) {
  console.log(
    `${empresa.toUpperCase().padEnd(6)} ${enderecoDe(empresa)} (Supabase em ${bancoDe(empresa)})`,
  );
}
console.log('No celular, no mesmo Wi-Fi: abra o app pelo Expo Go (pnpm -C apps/app start).');
if (empresas.length > 1) {
  console.log('No login do app, escolha a empresa; depois ele abre na última em que você entrou.');
}

const processos: ChildProcess[] = empresas.map((empresa) => {
  const filho = spawn(
    'pnpm',
    ['exec', 'next', 'dev', '--hostname', ip, '--port', String(PORTAS_NA_REDE[empresa])],
    {
      cwd: web,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NEXT_PUBLIC_EMPRESA: empresa,
        NEXT_PUBLIC_SUPABASE_URL: bancoDe(empresa),
        NEXT_PUBLIC_APP_URL: enderecoDe(empresa),
        ...(empresas.length > 1
          ? { NEXT_PUBLIC_EMPRESAS_LINKS: links, SEGREDO_ENTRE_EMPRESAS: segredo }
          : {}),
        // Pasta de saída própria, uma por empresa (o Next grava o NEXT_PUBLIC_* no código
        // compilado): o `next dev` de sempre mantém o .next aberto.
        NEXT_DIST_DIR: `.next-celular-${empresa}`,
      },
    },
  );
  // As linhas de cada site saem com o nome da empresa na frente.
  const prefixo = `[${empresa}] `;
  for (const fluxo of [filho.stdout, filho.stderr]) {
    let resto = '';
    fluxo?.on('data', (pedaco: Buffer) => {
      const linhas = (resto + pedaco.toString()).split('\n');
      resto = linhas.pop() ?? '';
      for (const linha of linhas) if (linha.trim()) console.log(prefixo + linha);
    });
  }
  filho.on('exit', (codigo) => {
    console.log(`${prefixo}parou (código ${codigo ?? 0}).`);
    for (const outro of processos) if (outro !== filho) outro.kill('SIGTERM');
    process.exitCode = codigo ?? 0;
  });
  return filho;
});

// Ctrl+C derruba os dois sites juntos.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    for (const filho of processos) filho.kill('SIGTERM');
  });
}
