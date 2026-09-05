/**
 * Base de conhecimento fechada (RF-CON-23; R08 §7 "FAQ aprovada"; R08 §5.4).
 *
 * É a única fonte do que o robô pode afirmar. O que não está aqui, ele não fala — e o
 * validador de promessas (`validador-promessas.ts`) recusa o rascunho que tentar.
 *
 * Três listas, com papéis diferentes:
 *
 * - `FATOS` — o que pode ser dito, com os valores literais que cada fato autoriza. Um
 *   número no rascunho ("8%") só passa se estiver em `valores` de algum fato.
 * - `NUNCA_AFIRMAR` — a lista do R08 §5.4, para dar motivo legível quando bloquear.
 * - `TEMAS_FINANCEIROS_SEM_RESPOSTA` — o que depende de validação do Dennis. Cair aqui
 *   não bloqueia a conversa: troca a resposta pela frase de escape e abre tarefa.
 *
 * `[validar]` no R08 §7 virou ausência aqui, não fato com ressalva: item não validado é
 * item que o robô não fala.
 */

export interface FatoDaBase {
  readonly id: string;
  readonly texto: string;
  /** Valores numéricos/temporais que este fato autoriza no texto gerado. */
  readonly valores: readonly string[];
}

export const VERSAO_DA_BASE = '2026-09-05' as const;

export const FATOS: readonly FatoDaBase[] = [
  {
    id: 'o-que-e',
    texto:
      'A Komune é um app de eventos de Natal que conecta quem organiza (pessoas, produtores, cerimonialistas, empresas) com os fornecedores da cidade.',
    valores: [],
  },
  {
    id: 'taxa',
    texto:
      'Sem mensalidade, sem adesão, sem fidelidade e sem multa. O fornecedor paga 8% sobre o evento fechado pela plataforma. Quando há cerimonialista organizando, a Komune fica com 3% e o cerimonialista recebe 5%.',
    valores: ['8%', '3%', '5%'],
  },
  {
    id: 'pagamento',
    texto:
      'Pix é absorvido pela Komune. No cartão a taxa é repassada ao cliente, que vê o valor total na vitrine.',
    valores: [],
  },
  {
    id: 'preco-e-do-fornecedor',
    texto:
      'Quem define o preço é o fornecedor. A Komune não tabela, não pede desconto e não negocia em nome dele.',
    valores: [],
  },
  {
    id: 'fundador',
    texto:
      'Fornecedor Fundador tem destaque rotativo na vitrine, selo, participação nos vídeos da Komune, cadastro assistido e a primeira oportunidade real de evento em até 30 dias, vinda dos eventos próprios da Komune.',
    valores: ['30 dias'],
  },
  {
    id: 'como-chega-o-pedido',
    texto:
      'O cliente busca por categoria, tipo de evento, data e faixa de preço; o pedido chega no painel e no WhatsApp, com tipo de evento, data e número de pessoas.',
    valores: [],
  },
  {
    id: 'reuniao',
    texto: 'A apresentação leva 20 minutos, por vídeo pela manhã ou visita presencial à tarde.',
    valores: ['20 minutos', '20 min'],
  },
  {
    id: 'tamanho-do-app',
    texto:
      'Cerca de 15 mil contas criadas via ingressos dos eventos próprios. É o número real, e é o único que pode ser dito.',
    valores: ['15 mil'],
  },
  {
    id: 'eventos-proprios',
    texto: 'A Komune produz Natal Experience, LDM, LCC e formaturas.',
    valores: [],
  },
  {
    id: 'resposta-em-24h',
    texto:
      'Quem está publicado responde os pedidos em até 24 horas; o app prioriza quem responde rápido.',
    valores: ['24 horas', '24 h'],
  },
  {
    id: 'autorizacao',
    texto:
      'O pré-cadastro só é criado depois de a pessoa autorizar por escrito o uso do material público do perfil dela. Nada é publicado sem esse ok.',
    valores: [],
  },
] as const;

/** R08 §5.4 — a lista do que nunca prometer, com o motivo em uma linha. */
export const NUNCA_AFIRMAR: readonly { readonly id: string; readonly texto: string }[] = [
  { id: 'volume-de-leads', texto: 'volume futuro de leads ("você recebe X pedidos por mês")' },
  {
    id: 'taxa-zero',
    texto: 'taxa zero, desconto na taxa ou promoção — só a direção libera, por escrito',
  },
  { id: 'seguro', texto: 'seguro ou garantia de valores' },
  { id: 'exclusividade', texto: 'exclusividade de categoria ou de região' },
  {
    id: 'vender-mais-caro',
    texto: 'que o fornecedor vai vender mais caro ou o cliente vai pagar mais',
  },
  {
    id: 'prazo-de-repasse',
    texto: 'prazo de repasse, regra de cancelamento ou emissão de nota fora da FAQ',
  },
  {
    id: 'datas-de-recurso',
    texto: 'data de lançamento de recurso sem confirmação de Luiz/Matheus',
  },
  { id: 'nomes-nao-autorizados', texto: 'nome de fornecedor fundador sem `autoriza_citar_nome`' },
];

/**
 * Perguntas de dinheiro cuja resposta ainda não existe na FAQ (R08 §7, itens `[validar]`).
 * Bate aqui → a frase de escape, e uma tarefa humana. Nunca uma resposta inventada.
 */
export const TEMAS_FINANCEIROS_SEM_RESPOSTA: readonly RegExp[] = [
  /\bquando\b[^?.!]*\b(cai|recebo|paga|repassa)/i,
  /\brepasse\b/i,
  /\bnota\s+fiscal\b|\bemite\s+nota\b/i,
  /\bcancel(a|ar|amento)\b/i,
  /\bmulta\b/i,
  /\bimposto\b|\btributa/i,
  /\bcpf\b|\bconta\s+banc[áa]ria\b|\bchave\s+pix\b/i,
];

export const FRASE_DE_ESCAPE_FINANCEIRO =
  'Vou confirmar com o financeiro e te respondo hoje.' as const;

/** Domínios que podem aparecer em um texto gerado (RF-CON-24). */
export const URLS_PERMITIDAS: readonly string[] = [
  'komune.app',
  'komune.app.br',
  'instagram.com/komune.natal',
];

/** Todos os valores literais autorizados, achatados — é o que o validador consulta. */
export const VALORES_AUTORIZADOS: ReadonlySet<string> = new Set(
  FATOS.flatMap((fato) => fato.valores).map((valor) => valor.toLowerCase()),
);

export function fatoPorId(id: string): FatoDaBase | undefined {
  return FATOS.find((fato) => fato.id === id);
}

/** O bloco que vai no `system` dos prompts que redigem. Estável = cacheável. */
export function baseComoTexto(): string {
  const fatos = FATOS.map((fato) => `- (${fato.id}) ${fato.texto}`).join('\n');
  const proibido = NUNCA_AFIRMAR.map((item) => `- ${item.texto}`).join('\n');
  return [
    `BASE DE CONHECIMENTO (versão ${VERSAO_DA_BASE}). Só isto pode ser afirmado:`,
    fatos,
    '',
    'NUNCA AFIRME:',
    proibido,
    '',
    `Dúvida de dinheiro que não está na base: responda exatamente "${FRASE_DE_ESCAPE_FINANCEIRO}" e nada mais sobre o assunto.`,
  ].join('\n');
}
