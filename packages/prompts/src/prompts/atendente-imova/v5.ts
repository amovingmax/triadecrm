/**
 * `atendente-imova@v5` (12/11/2026): a v4 com a VISITA PRESENCIAL SEM LINK.
 *
 * Por quê: o link da agenda (o Calendly da Imova) é só de reunião online; o evento não
 * tem visita presencial. Nota do usuário no caderno (12/11/2026, 17h25): "Sempre que
 * alguém pedir ou perguntar algo que seja voltado a fazer uma visita presencial ao local
 * não deve ser mostrado o link da agenda, pois lá é só reunião online. Para esse tipo de
 * situação quero que você diga ao cliente 'Vou consultar um horário em que entre na
 * minha agenda e te retorno pra combinarmos'." Confirmado na entrevista de 12/11/2026:
 * a IA pergunta o dia e o período que o cliente prefere (se ele ainda não disse), diz a
 * frase e passa a conversa, que fica parada esperando a equipe.
 *
 * É a correção rápida, antes da versão que junta toda a entrevista. Mudam só o bloco "A
 * VISITA E A REUNIÃO", a regra de verdade 2 (o pausado) e as duas linhas da saída que
 * falavam do imóvel no link; o resto é a v4 palavra por palavra. A entrada, a saída (o
 * schema), o modelo, a montagem da mensagem e os exemplos são os da v3, como na v4:
 * voltar à v4 é trocar o número em `VIGENTES` e o import do worker, e tirar do worker a
 * trava da visita (`eLinkDeVisita`) e a limpeza do Calendly (`semOCalendlyNoTexto`).
 *
 * O worker também trava: se o modelo pedir o link de uma visita (o tipo "visita", um
 * imóvel na reunião ou "visita" no texto), não sai link nenhum; sai a frase da visita e
 * a conversa passa. E o endereço do Calendly não chega ao modelo pelo caderno nem sai em
 * resposta comum.
 *
 * Nada muda no banco. O push da visita para toda a equipe (decisão da entrevista) fica
 * para a versão seguinte, porque precisa de migração.
 */
import { definirPrompt } from '../../nucleo/versionamento';
import { type BaseDoAtendenteV2, montarBaseV2 } from './v2';
import type { EntradaDoAtendenteV3, SaidaDoAtendenteV3 } from './v3';
import { atendenteImovaV4 as v4, trocarUmaVez } from './v4';

/** A frase da visita, nas palavras do usuário (caderno, 12/11/2026). */
export const FRASE_DA_VISITA =
  'Vou consultar um horário em que entre na minha agenda e te retorno pra combinarmos.';

const INICIO_DO_BLOCO = 'A VISITA E A REUNIÃO (acao = enviar_link_da_agenda):';
const FIM_DO_BLOCO = 'O QUE É DE GENTE (acao = passar_para_corretor):';

const BLOCO_NA_V5 = `A REUNIÃO ONLINE (acao = enviar_link_da_agenda):
O link da agenda da Imova é só para REUNIÃO ONLINE: uma conversa online com a equipe, com
hora marcada, sem ir a um imóvel. Quem marca o horário é o cliente, no link. Você não
marca, não oferece e não confirma horário: manda o link.
- Para quem: o proprietário que quer anunciar, vender, alugar ou avaliar o imóvel dele, e
  quem pede para marcar uma conversa online. Quem quer ajuda para escolher um imóvel,
  ajude por aqui; o link é se ele preferir conversar.
- \`agenda.tipo\` é sempre "reuniao", e \`agenda.imovelCodigo\` é sempre null.
- A mensagem: uma ou duas frases dizendo que vai mandar o link para ele escolher o dia e o
  horário da conversa ("Ótimo! Vou te mandar o link da agenda para você escolher o melhor
  dia e horário da nossa conversa."). Nunca escreva o link nem endereço de site: o CRM põe
  o link embaixo da sua mensagem.
- Nunca invente nem confirme horário. Ele propôs um ("amanhã às 10h")? Mande o link e diga
  que lá ele vê se o horário está livre e marca; não diga que ficou marcado.
- LINKS DA AGENDA (na entrada) são os que já saíram nesta conversa; nela, o link aparece
  como "[link da agenda]". O link da reunião saiu há menos de 24 horas e não foi agendado:
  não mande de novo; responda o que ele perguntou. Mande de novo se ele pedir. Já agendou
  a reunião: não mande outro; remarcar ou cancelar é com a equipe.

A VISITA PRESENCIAL (ir ver um imóvel ou terreno): NUNCA mande o link da agenda, nem use
\`agenda.tipo = "visita"\` ou um imóvel em \`agenda.imovelCodigo\`: o link é só de reunião
online. Vale mesmo que o cliente peça "o link" ou "a agenda" para visitar, mesmo que um
link de visita já tenha saído antes nesta conversa, e mesmo que uma nota do CADERNO diga
para mandar o link na visita.
- O imóvel está definido quando dá para saber qual é, da lista IMÓVEIS: pelo código, pela
  foto reconhecida, pelo lugar ("o terreno de Tabatinga") ou porque só um combina com o
  que ele disse.
- Não dá para saber qual imóvel: pergunte qual, numa pergunta curta (acao = responder).
- Imóvel que não está na lista: pergunte uma vez onde ele viu o anúncio; se ainda assim
  não der para saber qual é, diga a frase da visita e passe a conversa.
- Imóvel "pausado": não pergunte o dia; diga a frase da visita e passe a conversa já (a
  equipe confirma a disponibilidade).
- Imóvel definido, e ele ainda não disse que dia ou período prefere: pergunte numa frase
  curta, sem oferecer horário ("Qual dia e período ficam melhores pra você?")
  (acao = responder). Mais de um imóvel: a mesma pergunta, uma vez, para todos.
- Ele já disse o dia ou o período, ou não quer dizer: diga a frase da visita e passe a
  conversa (acao = passar_para_corretor). Um horário que ele propôs ("amanhã às 10h")
  conta como a preferência.
- A visita nunca fica sem passagem. Você perguntou o dia e ele respondeu outra coisa
  (mudou de assunto, perguntou outra coisa, só agradeceu): responda o que ele disse, se
  for o caso, e, na mesma mensagem, diga a frase da visita e passe a conversa. Isto vale
  mais que a regra de não repetir pergunta e que a de não responder a um "ok".
- A frase da visita é exatamente "${FRASE_DA_VISITA}" (pode vir
  depois de uma palavra curta, como "Perfeito!"). Na passagem da visita, a mensagem não
  diz que vai passar para um corretor nem para outra pessoa: diz só a frase.
- No \`motivo\` da visita, escreva "Visita:", o código de cada imóvel e o dia e o período
  que ele prefere, ou "dia a combinar" ("Visita: TE0004 · prefere sexta de manhã"). A
  equipe recebe a conversa com esse motivo e combina com ele.
- Nunca confirme horário nem diga que a visita está marcada.
- Quer remarcar ou cancelar uma visita já marcada: passe a conversa.

`;

/** A regra de verdade 2 na v4 e na v5: o pausado segue a regra da visita. */
const VERDADE_NA_V4 = `2. Imóvel "no_ar" ou "rascunho" está disponível. Imóvel "pausado": pode falar dele, mas
   diga que vai confirmar a disponibilidade com o corretor antes de qualquer visita.`;
const VERDADE_NA_V5 = `2. Imóvel "no_ar" ou "rascunho" está disponível. Imóvel "pausado": pode falar dele, mas
   não afirme que está disponível; a visita a ele segue A VISITA PRESENCIAL.`;

/** A linha da mensagem na saída: a reunião não leva imóvel embaixo. */
const MENSAGEM_NA_SAIDA_DA_V4 = `- \`mensagem\`: o que vai para o cliente. No link da agenda, só o começo: o CRM põe embaixo
  o imóvel e o link.`;
const MENSAGEM_NA_SAIDA_DA_V5 = `- \`mensagem\`: o que vai para o cliente. No link da agenda, só o começo: o CRM põe o link
  embaixo.`;

const AGENDA_NA_SAIDA_DA_V4 = `- \`agenda\`: só em enviar_link_da_agenda (o tipo, e o código do imóvel na visita); senão
  null.`;
const AGENDA_NA_SAIDA_DA_V5 = `- \`agenda\`: só em enviar_link_da_agenda, e então sempre {"tipo": "reuniao",
  "imovelCodigo": null}; senão null.`;

/** Troca o trecho entre dois marcadores que têm de existir uma vez só, nessa ordem. */
export function trocarBloco(texto: string, inicio: string, fim: string, novo: string): string {
  const vezes = (t: string): number => texto.split(t).length - 1;
  if (vezes(inicio) !== 1 || vezes(fim) !== 1) {
    throw new Error(
      `atendente-imova@v5: os marcadores do bloco aparecem ${vezes(inicio)} e ${vezes(fim)} vez(es), e não uma.`,
    );
  }
  const de = texto.indexOf(inicio);
  const ate = texto.indexOf(fim);
  if (ate < de) throw new Error('atendente-imova@v5: o fim do bloco vem antes do começo.');
  return texto.slice(0, de) + novo + texto.slice(ate);
}

const sistema = [
  [VERDADE_NA_V4, VERDADE_NA_V5],
  [MENSAGEM_NA_SAIDA_DA_V4, MENSAGEM_NA_SAIDA_DA_V5],
  [AGENDA_NA_SAIDA_DA_V4, AGENDA_NA_SAIDA_DA_V5],
].reduce(
  (texto, [de, para]) => trocarUmaVez(texto, de!, para!),
  trocarBloco(v4.sistema, INICIO_DO_BLOCO, FIM_DO_BLOCO, BLOCO_NA_V5),
);

/** O bloco de sistema de uma chamada da v5: as regras, mais a base da Imova (a da v2). */
export function sistemaComBaseV5(base: BaseDoAtendenteV2): string {
  return `${sistema}\n\n${montarBaseV2(base)}`;
}

export const atendenteImovaV5 = definirPrompt<EntradaDoAtendenteV3, SaidaDoAtendenteV3>({
  id: 'atendente-imova',
  versao: 5,
  modelo: v4.modelo,
  proposito: v4.proposito,
  entrada: v4.entrada,
  saida: v4.saida,
  sistema,
  camposDeTexto: v4.camposDeTexto,
  camposDoTriade: v4.camposDoTriade,
  escala: v4.escala,
  maxTokens: v4.maxTokens,
  montarMensagem: v4.montarMensagem,
  exemplos: v4.exemplos,
});
