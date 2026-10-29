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
 * build da Vercel roda em `production`) e só com o Supabase local (127.0.0.1 ou
 * localhost). Em produção a tela é a de sempre e a rota responde 404.
 */
export function entradaLocalLigada(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return (
    process.env.NODE_ENV === 'development' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)
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
