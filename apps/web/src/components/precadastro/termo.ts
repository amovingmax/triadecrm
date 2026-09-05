/**
 * O termo de autorização da página de reivindicação (R06 PRE-06, RF-PRE-08).
 *
 * PENDÊNCIA BLOQUEANTE PARA PRODUÇÃO: este texto ainda NÃO passou pelo Dennis
 * (financeiro, LGPD e termos — CLAUDE.md §Pessoas). Ele é a redação de produto do
 * que a LGPD exige que esteja escrito, não a redação jurídica final. Enquanto
 * `REVISADO_PELO_JURIDICO` for `false`, a ficha avisa o time ao lado do botão que
 * emite o link; a página do fornecedor não carrega esse aviso, porque ele é um
 * problema nosso, não dele. Quando o texto final chegar: trocar as cláusulas,
 * SUBIR A VERSÃO e virar a constante. Nunca editar cláusula sem mudar a versão —
 * o aceite já registrado aponta para a versão e para o hash do texto que a pessoa
 * leu, e é isso que sustenta a prova do art. 8º §2º.
 *
 * O módulo é puro de propósito (sem Next, sem Supabase, sem `node:crypto`): o
 * mesmo texto é renderizado no navegador e re-hasheado no servidor, e o hash só
 * vale como prova se as duas pontas lerem exatamente os mesmos bytes.
 */

/** Identificador gravado em `pre_registration_acceptances.terms_version` (até 40 caracteres). */
export const TERMO_VERSAO = 'precadastro-2026-09-v1';

/** Vira `true` quando o Dennis aprovar a redação. Só a ficha lê isto. */
export const REVISADO_PELO_JURIDICO = false;

export type ClausulaDoTermo = {
  /** Estável: entra no texto canônico, logo entra no hash. Não renomear. */
  id: string;
  titulo: string;
  paragrafos: string[];
  /**
   * Cláusula de dados e de fotos sobe para a moldura em destaque (PRE-06 exige
   * que elas não fiquem no meio do bloco corrido).
   */
  destaque: boolean;
};

export const CLAUSULAS: readonly ClausulaDoTermo[] = [
  {
    id: 'dados',
    titulo: 'De onde vieram os seus dados, e o que a Komune faz com eles',
    destaque: true,
    paragrafos: [
      'A Komune montou um rascunho do seu perfil a partir de informações públicas do seu negócio: o nome, a categoria, a cidade, o bairro, o site e o @ do Instagram. Nada disso foi comprado de lista, e nada foi pedido a terceiros.',
      'O rascunho nasceu privado. Ele não aparece em busca, não conta em vitrine, não recebe pedido de orçamento e não tem selo nenhum. Só você, com este link, consegue vê-lo.',
      'Ao autorizar, você permite que a Komune use essas informações para montar o seu perfil de fornecedor no marketplace. Você pode corrigir, completar ou apagar qualquer campo depois, dentro da sua conta.',
    ],
  },
  {
    id: 'fotos',
    titulo: 'Fotos: nenhuma foi copiada',
    destaque: true,
    paragrafos: [
      'A Komune não copiou nenhuma foto sua, nem logotipo, nem texto de descrição, nem avaliação de cliente. O rascunho está sem imagem por decisão, não por falta.',
      'As fotos do seu perfil serão as que você mesmo enviar, já dentro da sua conta na Komune. No momento do envio você declara que tem direito sobre cada imagem e, quando houver pessoas retratadas, que tem autorização delas.',
    ],
  },
  {
    id: 'servico',
    titulo: 'O que você aceita ao criar o perfil',
    destaque: false,
    paragrafos: [
      'Os Termos de Uso e o Contrato de Prestação de Serviços da Komune, que regem o uso do marketplace: como os pedidos chegam até você, quais são as suas obrigações ao atender um cliente e em que condições o perfil pode ser suspenso.',
      'Criar o perfil é gratuito e não obriga você a aceitar pedido nenhum.',
    ],
  },
  {
    id: 'direitos',
    titulo: 'Os seus direitos, e como exercer',
    destaque: false,
    paragrafos: [
      'A qualquer momento você pode pedir acesso, correção, portabilidade ou exclusão dos seus dados, e pode revogar esta autorização. O pedido é atendido em até 15 dias e a exclusão do perfil, em até 48 horas.',
      'Se você não fizer nada, este rascunho é apagado sozinho em 30 dias, com um único aviso antes.',
      'Para exercer qualquer um desses direitos, escreva para privacidade@komune.app.br ou responda no mesmo WhatsApp por onde este link chegou.',
    ],
  },
] as const;

/**
 * Texto canônico do termo: é ISTO que é hasheado, e é isto que a página mostra.
 *
 * O formato é o mais simples que existe (versão, e depois título e parágrafos de
 * cada cláusula, separados por quebra de linha), porque qualquer sofisticação aqui
 * vira um jeito de o hash mudar sem o texto mudar. Sem espaço à toa, sem
 * `JSON.stringify` (a ordem das chaves não é contrato), sem data.
 */
export function textoCanonicoDoTermo(): string {
  const blocos = CLAUSULAS.map((c) => [c.titulo, ...c.paragrafos].join('\n'));
  return [`Termo de autorização Komune ${TERMO_VERSAO}`, ...blocos].join('\n\n');
}

/** Os 12 primeiros dígitos do hash, que é o que cabe na tela ao lado da versão. */
export function hashCurto(hash: string): string {
  return hash.slice(0, 12);
}
