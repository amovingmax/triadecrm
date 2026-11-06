/**
 * TROCAR DE EMPRESA SEM ENTRAR DE NOVO (pedido do usuário em 06/11/2026).
 *
 * Cada empresa é um site com banco e login próprios. Antes, quem tinha acesso às duas
 * tocava na outra empresa e, na primeira vez, entrava com o Google de novo. Agora:
 *
 *   1. O botão de trocar abre `IR_PARA_OUTRA_EMPRESA` NESTA empresa (`auth/empresa/ir`).
 *      O servidor daqui lê o e-mail da sessão (nunca do navegador) e pede à outra empresa,
 *      servidor a servidor, um código de entrada (`PEDIDO_DE_ENTRADA`), assinado com
 *      `SEGREDO_ENTRE_EMPRESAS` para a finalidade `entrada` (`lib/pergunta-entre-empresas.ts`).
 *   2. A outra empresa confere no PRÓPRIO banco se o e-mail entra lá
 *      (`public.email_entra_no_crm`, a mesma regra do login). Só então gera o código de
 *      uso único (o link mágico do Supabase, sem e-mail nenhum) e o devolve.
 *   3. O navegador vai para `ENTRAR_PELA_TROCA` na outra empresa, que troca o código pela
 *      sessão de lá. A pessoa cai logada, na tela pedida.
 *
 * Qualquer falha (segredo ausente, outra empresa fora do ar, sem acesso, código vencido)
 * cai no caminho de antes: a tela da outra empresa, que pede o login se precisar.
 *
 * Este arquivo só tem os endereços: é lido pelo botão (cliente) e pelas rotas (servidor).
 */

/** Nesta empresa: começa a troca. `?para=<empresa>&next=<tela>`. */
export const IR_PARA_OUTRA_EMPRESA = '/auth/empresa/ir';

/** Na outra empresa, servidor a servidor: o pedido do código de entrada. */
export const PEDIDO_DE_ENTRADA = '/api/empresas/entrada';

/** Na outra empresa, no navegador: troca o código pela sessão. `?codigo=…&next=<tela>`. */
export const ENTRAR_PELA_TROCA = '/auth/empresa/entrar';

/** O endereço do botão de trocar para uma empresa. */
export function enderecoDaTroca(empresa: string): string {
  return `${IR_PARA_OUTRA_EMPRESA}?para=${encodeURIComponent(empresa)}`;
}
