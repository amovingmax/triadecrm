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
  'GEN-SYS-INTRO': 'Introdução automática (2ª mensagem)',
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
export function placarDoFeed(
  linhas: readonly {
    entrega: string | null;
    respondeu_em: string | null;
    gente_falou_em: string | null;
  }[],
): { sairam: number; responderam: number; esperando: number; naoSairam: number } {
  let responderam = 0;
  let esperando = 0;
  let naoSairam = 0;
  for (const l of linhas) {
    const { texto } = resumoDoQueAconteceu({
      entrega: l.entrega,
      respondeuEm: l.respondeu_em,
      genteFalouEm: l.gente_falou_em,
    });
    if (texto === 'Não saiu') naoSairam += 1;
    if (texto === 'Respondeu e ninguém falou ainda') {
      responderam += 1;
      esperando += 1;
    }
    if (texto === 'Respondeu, e alguém assumiu') responderam += 1;
  }
  return { sairam: linhas.length, responderam, esperando, naoSairam };
}
