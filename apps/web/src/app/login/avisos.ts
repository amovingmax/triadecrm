/**
 * Avisos da tela de login. Cada um diz O QUE ACONTECEU e O QUE FAZER, nessa ordem,
 * em voz de ferramenta. `grave` separa o que a pessoa não resolve sozinha (e-mail fora
 * da allowlist, recusado pelo gatilho de auth.users; falta de perfil e conta desativada,
 * decididas pelo hook do banco com HTTP 403) do que se resolve tentando de novo. Zero
 * travessão, como manda o guia de cópia.
 */

export type ChaveAviso =
  'nao-autorizado' | 'sem-perfil' | 'desativado' | 'provedor' | 'callback' | 'sessao';

export interface AvisoAcesso {
  titulo: string;
  saida: string;
  /** Bloqueio real (precisa de um admin) e não um tropeço de fluxo. */
  grave: boolean;
  /** Rótulo do botão quando "tentar de novo" com a mesma conta não adianta. */
  rotuloBotao?: string;
}

export const AVISOS: Record<ChaveAviso, AvisoAcesso> = {
  // app.handle_new_auth_user recusa o INSERT em auth.users: o e-mail não está em
  // allowed_users nem em allowed_domains. O Google autenticou, o CRM nem chegou a criar
  // a conta. Tentar de novo com a mesma conta nunca vai funcionar.
  'nao-autorizado': {
    titulo: 'Esse e-mail não tem acesso ao CRM.',
    saida:
      'Entre com o seu e-mail @komune.app.br. Se você já usou o e-mail da empresa, peça a um admin (Rafael, Luiz ou Matheus) para liberar o seu acesso.',
    grave: true,
    rotuloBotao: 'Entrar com outra conta',
  },
  // public.custom_access_token_hook devolve 403 "Usuário sem perfil no KOMUNE CRM"
  // quando não existe linha em profiles: o Google autentica, o CRM não libera.
  'sem-perfil': {
    titulo: 'Sua conta Google funcionou, mas ela ainda não tem perfil no CRM.',
    saida:
      'Peça a um admin (Rafael, Luiz ou Matheus) para criar o seu acesso, depois entre de novo.',
    grave: true,
    rotuloBotao: 'Entrar com outra conta',
  },
  desativado: {
    titulo: 'Seu acesso ao CRM está desativado.',
    saida: 'Fale com um admin (Rafael, Luiz ou Matheus) para reativar o seu perfil.',
    grave: true,
    rotuloBotao: 'Entrar com outra conta',
  },
  provedor: {
    titulo: 'O Google não concluiu o login.',
    saida: 'O pedido pode ter sido cancelado ou a conta recusada. Tente de novo.',
    grave: false,
  },
  callback: {
    titulo: 'O login não foi concluído.',
    saida: 'Tente de novo. Se continuar assim, avise um admin.',
    grave: false,
  },
  sessao: {
    titulo: 'Sua sessão expirou.',
    saida: 'Entre de novo para continuar de onde parou.',
    grave: false,
  },
};

export function avisoDe(chave: string | null | undefined): AvisoAcesso | null {
  if (!chave) return null;
  return AVISOS[chave as ChaveAviso] ?? AVISOS.callback;
}
