import { ROTULO_DO_ROBO, type AutorTipo } from './tipos';

/**
 * As palavras da aba "Automáticas" (migração 20261002190000).
 *
 * Rafael, 28/09/2026: "onde e como vemos as mensagens que foram enviadas
 * automáticas? como tá esse processo? deixe isso organizado".
 */

/**
 * Quem escreveu, nas MESMAS palavras que o balão da conversa usa
 * (`mensagem-do-fio.tsx`). Uma pessoa que vê "Confirmação automática" no feed e
 * abre a conversa tem de ler "Confirmação automática" lá também — senão aprende
 * duas vezes a mesma coisa e desconfia na terceira.
 */
export function rotuloDoAutor(autor: string | null): string {
  if (autor && autor in ROTULO_DO_ROBO) {
    return ROTULO_DO_ROBO[autor as Exclude<AutorTipo, 'human'>];
  }
  return 'Automática';
}

/**
 * O nome do modelo pelo que ele É NO FLUXO, e não pelo código.
 *
 * "GEN-SYS-INTRO" não diz nada para quem atende. O Rafael abre esta tela para
 * conferir o fluxo novo — a campanha manda "Bom dia!", o lead responde, 8 a 14 s
 * depois sai a introdução, e daí em diante quem fala é gente —, e o rótulo tem
 * de falar dele. Um modelo que este mapa não conhece cai no `name` que o banco
 * já devolve, e a tela continua inteira: é por isso que ele é parcial de
 * propósito, e não um `Record` fechado que um `insert` novo quebraria.
 */
export const ROTULO_DO_MODELO: Record<string, string | undefined> = {
  'GEN-ABR-OLA-MANHA': 'Cumprimento (1ª mensagem)',
  'GEN-ABR-OLA-TARDE': 'Cumprimento (1ª mensagem)',
  'GEN-ABR-OLA-NOITE': 'Cumprimento (1ª mensagem)',
  'GEN-SYS-TUDOBEM': 'Tudo bem? (2ª mensagem)',
  'GEN-SYS-INTRO': 'Introdução automática (3ª mensagem)',
  'GEN-SYS-AUSENCIA': 'Fora do horário',
  'GEN-SYS-OPTOUT': 'Confirmação de saída',
  'GEN-SYS-MENU': 'Menu do bot de entrada',
};

/**
 * O QUE ACONTECEU DEPOIS, em uma frase — e é ela que separa esta tela de um log.
 *
 * As duas colunas do banco (`respondeu_em` e `gente_falou_em`) chegam separadas
 * de propósito, porque é o CRUZAMENTO delas que mostra o caso que importa. Aqui
 * elas viram frase, e só um dos quatro desfechos pede ação:
 *
 *   * `Não saiu` — vem da ENTREGA, não das duas colunas. Mensagem que a Meta
 *     recusou nunca chegou a existir para o lead; chamar isso de "ninguém
 *     respondeu" mandaria a pessoa procurar o defeito no lugar errado.
 *   * `Respondeu e ninguém falou ainda` — o único caso em que alguém precisa
 *     agir, e por isso o único (junto com a falha de entrega) com `alerta`.
 *   * `Respondeu, e alguém assumiu` — o fluxo funcionando.
 *   * `Alguém assumiu o fio` — o atendente continuou por conta própria, sem
 *     esperar o lead. Chamar isso de "ninguém respondeu" apagaria o trabalho
 *     que a pessoa fez.
 *   * `Ninguém respondeu` — o desfecho da maioria, e isso é normal. Pintar de
 *     alerta a linha mais comum da tela ensina a ignorar o alerta.
 */
export function resumoDoQueAconteceu({
  entrega,
  respondeuEm,
  genteFalouEm,
}: {
  entrega: string | null;
  respondeuEm: string | null;
  genteFalouEm: string | null;
}): { texto: string; alerta: boolean } {
  if (entrega === 'failed') return { texto: 'Não saiu', alerta: true };
  if (respondeuEm && genteFalouEm) return { texto: 'Respondeu, e alguém assumiu', alerta: false };
  if (respondeuEm) return { texto: 'Respondeu e ninguém falou ainda', alerta: true };
  if (genteFalouEm) return { texto: 'Alguém assumiu o fio', alerta: false };
  return { texto: 'Ninguém respondeu', alerta: false };
}

/**
 * O PLACAR DO PERÍODO — a resposta à segunda pergunta do Rafael.
 *
 * Ele perguntou duas coisas: "onde e como vemos as mensagens que foram enviadas
 * automáticas?", que a lista responde, e **"como tá esse processo?"**, que a
 * lista só responde se a pessoa contar pastilha por pastilha. Com o teto de 200
 * linhas do feed isso não é leitura, é trabalho — e a pergunta dele é sobre o
 * fluxo inteiro, não sobre uma linha.
 *
 * CONTA O QUE A PASTILHA DECIDIU, e não por conta própria. Se o placar
 * reimplementasse a regra, o dia em que `resumoDoQueAconteceu` mudasse (a
 * entrega falhada vindo antes das duas colunas, que é justamente a ordem que
 * importa) o número e a pastilha passariam a dizer coisas diferentes na mesma
 * tela — e aí ninguém acredita em nenhum dos dois.
 *
 * `esperando` é o único número com peso na tela: é o mesmo caso que a pastilha
 * pinta de alerta, e o único que pede alguém. `sairam` é o volume, `responderam`
 * é o que o fluxo colheu e `naoSairam` só aparece quando existe.
 */
/**
 * UMA CONVERSA POR CARTÃO, e não uma mensagem por linha.
 *
 * Rafael, 29/09/2026, com o print na mão: "alem de ta ocupando espaço, listando
 * uma em cima da outra, ta dizendo que n respondeu". Eram as duas metades do
 * mesmo defeito. O fluxo manda três mensagens à mesma pessoa em poucos minutos
 * (cumprimento, "Tudo bem?", introdução), e o feed por mensagem mostrava três
 * linhas do mesmo parceiro — cada uma com o SEU desfecho, calculado a partir
 * dela. A última dizia "Ninguém respondeu" porque ninguém respondeu *à
 * introdução*, dez segundos depois de ela sair; a primeira dizia "Respondeu".
 * As duas verdadeiras, e juntas uma contradição na cara de quem lê.
 *
 * Agrupado, o desfecho é UM, e é a pergunta certa: **desde que o robô começou a
 * falar com esta pessoa, ela respondeu? alguém nosso assumiu?** Por isso ele sai
 * da mensagem MAIS ANTIGA do grupo — as colunas `respondeu_em` e
 * `gente_falou_em` olham para a frente a partir de cada mensagem, e a mais
 * antiga é a que enxerga a conversa inteira.
 *
 * A entrega é a exceção: basta UMA falhar para o cartão dizer que falhou. Falha
 * de entrega é defeito, e defeito não se dilui na média do grupo.
 */
export type GrupoAutomatico = {
  chave: string;
  organizacao: string | null;
  organizationId: string | null;
  conversationId: string | null;
  atendente: string | null;
  erro: string | null;
  /** Da mais nova para a mais antiga, como o feed já chega. */
  mensagens: readonly LinhaDoFeed[];
  /** A mais recente do grupo: é a que diz "quando foi". */
  quando: string | null;
  desfecho: { texto: string; alerta: boolean };
};

export type LinhaDoFeed = {
  message_id: string | null;
  conversation_id: string | null;
  organization_id: string | null;
  organizacao: string | null;
  quando: string | null;
  autor: string | null;
  modelo: string | null;
  rotulo: string | null;
  corpo: string | null;
  entrega: string | null;
  erro: string | null;
  respondeu_em: string | null;
  gente_falou_em: string | null;
  atendente: string | null;
};

export function agruparPorConversa(linhas: readonly LinhaDoFeed[]): GrupoAutomatico[] {
  const grupos = new Map<string, LinhaDoFeed[]>();
  for (const l of linhas) {
    // Sem fio e sem ficha a mensagem ainda é dela mesma: a chave cai no id da
    // mensagem para nada sumir do feed por falta de agrupador.
    const chave = l.conversation_id ?? l.organization_id ?? l.message_id ?? '';
    const atual = grupos.get(chave);
    if (atual) atual.push(l);
    else grupos.set(chave, [l]);
  }

  return [...grupos].map(([chave, mensagens]) => {
    const maisAntiga = mensagens[mensagens.length - 1]!;
    const maisNova = mensagens[0]!;
    const algumaFalhou = mensagens.some((m) => m.entrega === 'failed');
    return {
      chave,
      organizacao: maisNova.organizacao,
      organizationId: maisNova.organization_id,
      conversationId: maisNova.conversation_id,
      atendente: maisNova.atendente,
      erro: mensagens.find((m) => m.erro)?.erro ?? null,
      mensagens,
      quando: maisNova.quando,
      desfecho: resumoDoQueAconteceu({
        entrega: algumaFalhou ? 'failed' : maisAntiga.entrega,
        respondeuEm: maisAntiga.respondeu_em,
        genteFalouEm: maisAntiga.gente_falou_em,
      }),
    };
  });
}

export function placarDoFeed(
  grupos: readonly GrupoAutomatico[],
): {
  sairam: number;
  parceiros: number;
  responderam: number;
  esperando: number;
  naoSairam: number;
} {
  let responderam = 0;
  let esperando = 0;
  let naoSairam = 0;
  let sairam = 0;
  // CONTA POR PARCEIRO, e não por mensagem. Três mensagens para a mesma pessoa
  // não são três respostas nem três esperas: são uma conversa. O volume
  // (`sairam`) continua por mensagem, porque volume é volume — e por isso a
  // frase da tela diz os dois números, em vez de escolher um e mentir no outro.
  for (const g of grupos) {
    sairam += g.mensagens.length;
    const { texto } = g.desfecho;
    if (texto === 'Não saiu') naoSairam += 1;
    if (texto === 'Respondeu e ninguém falou ainda') {
      responderam += 1;
      esperando += 1;
    }
    if (texto === 'Respondeu, e alguém assumiu') responderam += 1;
  }
  return { sairam, parceiros: grupos.length, responderam, esperando, naoSairam };
}
