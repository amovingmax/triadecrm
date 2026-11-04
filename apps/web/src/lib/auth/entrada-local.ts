/**
 * A ENTRADA SEM GOOGLE, só no CRM que roda no computador de quem desenvolve.
 *
 * O login do CRM é só Google, e o Google não está configurado no Supabase local:
 * o botão "Entrar com Google" levava a uma página de erro do Google, sem saída
 * (29/10/2026: "preciso colocar conta do Google e fico travado"). No computador, a
 * tela de login troca o Google pelos usuários de teste, que só existem no banco
 * local, e quem entra é `app/auth/dev/route.ts`.
 *
 * Duas travas, e as duas valem para a tela e para a rota: só em `next dev` (o
 * build da Vercel roda em `production`) e só com o Supabase local (127.0.0.1,
 * localhost, o endereço deste computador na rede ou o nome `.local` dele, que é como
 * o celular de teste o enxerga). Em produção a tela é a de sempre e a rota responde 404.
 */
export function entradaLocalLigada(): boolean {
  const host =
    /^http:\/\/([^/:]+)(:\d+)?$/.exec(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')?.[1] ?? '';
  return (
    process.env.NODE_ENV === 'development' &&
    (host === '127.0.0.1' ||
      host === 'localhost' ||
      enderecoDaRedeLocal(host) ||
      nomeDaRedeLocal(host))
  );
}

/**
 * O nome do computador na rede local (`MacBook-Air-de-A.local`, mDNS), que só existe
 * dentro dela. O celular de teste chama o banco da Imova por ele: as duas empresas de
 * teste ficam no mesmo endereço, e o cookie de sessão do Supabase leva no nome o
 * primeiro pedaço do endereço do banco. Com o mesmo número nas duas, uma empresa lia o
 * login da outra (medido em 03/11/2026).
 */
export function nomeDaRedeLocal(host: string): boolean {
  return /^[a-z0-9-]+\.local$/i.test(host);
}

/**
 * Endereço de rede privada (10.x, 172.16–31.x, 192.168.x): o computador visto pelo
 * celular de teste na mesma rede Wi-Fi. O app de celular abre o site assim, com o
 * Supabase local no mesmo endereço (`apps/app/scripts/site-na-rede.ts`).
 */
export function enderecoDaRedeLocal(host: string): boolean {
  return /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/.test(
    host,
  );
}

/**
 * Os usuários de teste do banco local. CADA PAPEL NO SEU ENDEREÇO: a sessão é
 * cookie, e o navegador guarda um cookie por endereço. Com os dois em
 * `localhost`, entrar como SDR numa aba trocava o gestor da outra; por isso o
 * gestor mora em `localhost` e o SDR em `127.0.0.1` (pedido de 28/09/2026).
 */
export const USUARIOS_DE_TESTE = {
  gestor: { email: 'gestor.teste@teste.local', host: 'localhost', rotulo: 'Entrar como gestor' },
  sdr: { email: 'sdr.teste@teste.local', host: '127.0.0.1', rotulo: 'Entrar como SDR' },
} as const;

export type QuemTesta = keyof typeof USUARIOS_DE_TESTE;
