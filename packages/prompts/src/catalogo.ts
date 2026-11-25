import { atendenteImovaV1 } from './prompts/atendente-imova/v1';
import { atendenteImovaV2 } from './prompts/atendente-imova/v2';
import { atendenteImovaV3 } from './prompts/atendente-imova/v3';
import { atendenteImovaV4 } from './prompts/atendente-imova/v4';
import { atendenteImovaV5 } from './prompts/atendente-imova/v5';
import { atendenteImovaV6 } from './prompts/atendente-imova/v6';
import { atendenteImovaV7 } from './prompts/atendente-imova/v7';
import { atendenteImovaV8 } from './prompts/atendente-imova/v8';
import { atendenteImovaV9 } from './prompts/atendente-imova/v9';
import { fotoDoAnuncioV1 } from './prompts/foto-do-anuncio/v1';
import { avaliacaoDoAtendimentoV1 } from './prompts/avaliacao-do-atendimento/v1';
import { avaliacaoDoAtendimentoV2 } from './prompts/avaliacao-do-atendimento/v2';
import { conselheiroDoImovelV1 } from './prompts/conselheiro-do-imovel/v1';
import { conselheiroDoLeadV1 } from './prompts/conselheiro-do-lead/v1';
import { canalDeChegadaV1 } from './prompts/canal-de-chegada/v1';
import { classificarIntencaoV1 } from './prompts/classificar-intencao/v1';
import { fichaDaConversaV1 } from './prompts/ficha-da-conversa/v1';
import { leituraDoClienteV1 } from './prompts/leitura-do-cliente/v1';
import { leituraDoClienteV2 } from './prompts/leitura-do-cliente/v2';
import { followupLigacaoV1 } from './prompts/followup-ligacao/v1';
import { pulsoDoDiaV1 } from './prompts/pulso-do-dia/v1';
import { triagemDoRadarV1 } from './prompts/triagem-do-radar/v1';
import { triagemDoRadarV2 } from './prompts/triagem-do-radar/v2';
import { resumoLigacaoV1 } from './prompts/resumo-ligacao/v1';
import { retomarConversaV1 } from './prompts/retomar-conversa/v1';
import { retomarConversaV2 } from './prompts/retomar-conversa/v2';
import { transcricaoAudioV1 } from './prompts/transcricao-audio/v1';
import {
  type CatalogoDePrompts,
  type MetadadosDePrompt,
  type PromptVersionado,
  metadadosDoPrompt,
  selecionar,
} from './nucleo/versionamento';

/** Um prompt qualquer do catálogo, sem o tipo da entrada e da saída dele. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PromptDeQualquerVersao = PromptVersionado<any, any>;

/**
 * O catálogo: id → versão → prompt.
 *
 * A ordem dos ids é a ordem de prioridade do R13, e não é alfabética por acaso:
 * transcrever o áudio que chega, resumir a ligação, redigir o follow-up e, por baixo de
 * tudo, classificar o que o parceiro escreveu.
 *
 * Publicar uma v2 é acrescentar `2: <prompt>` na linha do id. Quem chamava
 * `obterPrompt('resumo-ligacao', 1)` continua recebendo o v1, com os schemas do v1;
 * quem chama `promptVigente` passa a receber o v2 quando `VIGENTES` mudar. As duas
 * coisas mudam separadamente, e é isso que faz uma migração de prompt ser reversível.
 */
export const CATALOGO = {
  'transcricao-audio': { 1: transcricaoAudioV1 },
  'ficha-da-conversa': { 1: fichaDaConversaV1 },
  'pulso-do-dia': { 1: pulsoDoDiaV1 },
  'triagem-do-radar': { 1: triagemDoRadarV1, 2: triagemDoRadarV2 },
  'resumo-ligacao': { 1: resumoLigacaoV1 },
  'followup-ligacao': { 1: followupLigacaoV1 },
  'classificar-intencao': { 1: classificarIntencaoV1 },
  // Só da Imova (03/11/2026): o worker o usa quando o banco é o da Imova.
  'leitura-do-cliente': { 1: leituraDoClienteV1, 2: leituraDoClienteV2 },
  // Só da Imova (06/11/2026): a IA que atende o cliente sozinha.
  'atendente-imova': {
    1: atendenteImovaV1,
    2: atendenteImovaV2,
    3: atendenteImovaV3,
    4: atendenteImovaV4,
    5: atendenteImovaV5,
    6: atendenteImovaV6,
    7: atendenteImovaV7,
    8: atendenteImovaV8,
    9: atendenteImovaV9,
  },
  // Só da Imova (09/11/2026): de qual anúncio é a foto que o cliente mandou.
  'foto-do-anuncio': { 1: fotoDoAnuncioV1 },
  // Só da Imova (06/11/2026): a IA juíza, que dá nota ao atendimento da de cima.
  'avaliacao-do-atendimento': { 1: avaliacaoDoAtendimentoV1, 2: avaliacaoDoAtendimentoV2 },
  // Só da Imova (09/11/2026): o "relatório que vende", por cliente e por imóvel.
  'conselheiro-do-lead': { 1: conselheiroDoLeadV1 },
  'conselheiro-do-imovel': { 1: conselheiroDoImovelV1 },
  // Só da Imova (06/11/2026): o canal de chegada do lead, lido do começo da conversa e
  // de até três fotos. O worker só o chama quando o banco é o da Imova.
  'canal-de-chegada': { 1: canalDeChegadaV1 },
  // Só da Imova (11/11/2026): a IA que atende retoma o contato com quem parou de responder
  // (o texto do dia 1, ainda dentro da janela de 24 h).
  'retomar-conversa': { 1: retomarConversaV1, 2: retomarConversaV2 },
} as const;

export type IdDePrompt = keyof typeof CATALOGO;

/** A versão em produção de cada prompt. Mudar aqui é o deploy de um prompt. */
export const VIGENTES = {
  'transcricao-audio': 1,
  'ficha-da-conversa': 1,
  'pulso-do-dia': 1,
  // v2 desde 25/09/2026: a v1 ensinava o modelo a devolver nome de GRUPO em
  // `categoriaSugerida` ("Locais"), e a gravação casa EXATO com o catálogo —
  // o exemplo treinava uma string que nunca casa. A v1 continua no catálogo,
  // e voltar é trocar este número.
  'triagem-do-radar': 2,
  'resumo-ligacao': 1,
  'followup-ligacao': 1,
  'classificar-intencao': 1,
  // v2 desde 04/11/2026: na primeira hora em produção a v1 perdeu 4 de 12 leituras
  // por texto um pouco mais longo que o teto do schema. A v2 diz o tamanho e encurta
  // em vez de recusar; voltar é trocar este número.
  'leitura-do-cliente': 2,
  // v2 desde 06/11/2026: a v1 se apresentava como "assistente virtual", e a IA é a
  // ferramenta de acessibilidade de um colaborador; a v2 fala como a equipe (sem
  // dizer que é gente) e não puxa assunto velho.
  // v3 desde 11/11/2026, a visita pelo link: a IA não marca mais a visita pelos
  // horários do banco; manda o link da agenda (visita com o código do imóvel, ou
  // reunião) e o cliente escolhe o horário. A entrada e a saída mudaram (sem horários,
  // com os links já mandados; `agenda` no lugar de `visita`), então voltar à v2 é
  // trocar este número E o worker (`apps/workers/src/ia/atendente.ts`), que importa a
  // versão que sabe levar ao banco.
  // v4 desde 12/11/2026: a v3 com o imóvel em rascunho também recebendo o link da
  // visita (na Imova, quase toda a carteira está em rascunho no CRM); só o pausado vai
  // ao corretor. Entrada e saída são as da v3: voltar à v3 é trocar este número e o
  // import do worker.
  // v5 desde 12/11/2026: a v4 com a visita presencial SEM link (o Calendly é só de
  // reunião online): a IA pergunta o dia e o período, diz "Vou consultar um horário em
  // que entre na minha agenda e te retorno pra combinarmos" e passa a conversa. Entrada
  // e saída são as da v3: voltar à v4 é trocar este número, o import do worker e tirar
  // dele a trava da visita.
  // v6 desde 17/11/2026: a v5 com o e-mail para ofertas: a IA convida, uma vez e na hora
  // certa, quem ainda não tem e-mail na ficha a receber ofertas por e-mail, e diz se ele
  // aceitou ou recusou (`ofertasPorEmail`). A entrada ganha `cliente.email` e a saída
  // `ofertasPorEmail`: voltar à v5 é trocar este número e o import do worker.
  // v7 desde 23/11/2026: a v6 com a busca no mapa (`buscar_no_mapa`, só OpenStreetMap):
  // a IA procura o lugar que o cliente citou e o sistema diz quais imóveis ficam perto.
  // Entrada e saída são as da v6; a chamada vira um laço com ferramenta. Voltar à v6 é
  // trocar este número e o import do worker (que já usa a v6 quando não há mapa).
  // v8 desde 24/11/2026: a v7 com a foto para confirmar o imóvel (`fotoParaConfirmar`):
  // a frase curta, sem preço, e a foto de capa do anúncio com a pergunta. Voltar à v7 é
  // trocar este número e o import do worker.
  // v9 desde 24/11/2026: a v8 com o pedido de visita (`visita`): quando passa a conversa
  // por uma visita presencial com o dia dito, a IA devolve o pedido, que vai aos admins
  // aprovarem. Voltar à v8 é trocar este número e o import do worker.
  'atendente-imova': 9,
  'foto-do-anuncio': 1,
  // v2 desde 09/11/2026: a juíza diz também a lacuna, onde a IA que atende falhou no
  // dia, para o relatório contar por tema. Voltar é trocar este número.
  'avaliacao-do-atendimento': 2,
  'conselheiro-do-lead': 1,
  'conselheiro-do-imovel': 1,
  'canal-de-chegada': 1,
  // v2 desde 25/11/2026: as decisões do dono (uma retomada só, gancho do imóvel tirado do
  // anúncio, sem pergunta, sem emoji, sem código, sem "corretor"). Voltar à v1 é trocar
  // este número e o import do worker (`apps/workers/src/ia/retomar.ts`).
  'retomar-conversa': 2,
} as const satisfies Record<IdDePrompt, number>;

/** Uma versão específica, com o tipo daquela versão. */
export function obterPrompt<Id extends IdDePrompt, Versao extends keyof (typeof CATALOGO)[Id]>(
  id: Id,
  versao: Versao,
): (typeof CATALOGO)[Id][Versao] {
  return selecionar(CATALOGO, id, versao);
}

/**
 * Todas as vigentes, como metadados.
 *
 * Existe porque `promptVigente(id)` com `id` de tipo união não resolve o índice
 * `CATALOGO[Id][VIGENTES[Id]]` — o TypeScript devolve `unknown`, e isso só
 * apareceu quando a primeira v2 foi publicada. Quem precisa percorrer o
 * catálogo inteiro usa esta lista; quem sabe o id usa `promptVigente`.
 */
export function vigentes(): readonly PromptDeQualquerVersao[] {
  return (Object.keys(CATALOGO) as IdDePrompt[]).map(
    (id) => promptVigente(id) as PromptDeQualquerVersao,
  );
}

/**
 * O prompt vigente de um id, com o tipo daquela versão.
 *
 * O `extends` não é cerimônia: para um `Id` GENÉRICO, `VIGENTES[Id]` é a união
 * `1 | 2` desde que existe a primeira v2, e `2` não é chave de um prompt que só
 * tem a v1. Para cada `Id` concreto o par sempre existe, e o condicional é o
 * que diz isso ao TypeScript.
 */
export type VersaoVigente<Id extends IdDePrompt> =
  (typeof VIGENTES)[Id] extends keyof (typeof CATALOGO)[Id]
    ? (typeof CATALOGO)[Id][(typeof VIGENTES)[Id]]
    : never;

/** A versão vigente, com o tipo dela. */
export function promptVigente<Id extends IdDePrompt>(id: Id): VersaoVigente<Id> {
  // A travessia é apagada e o tipo volta numa asserção só, como em `selecionar`
  // e pela mesma razão. Desde que existe uma v2, `VIGENTES[Id]` para um `Id`
  // GENÉRICO é `1 | 2`, e o TypeScript não aceita `2` como chave de um prompt
  // que só tem a v1 — embora, para cada `Id` concreto, o par sempre exista. A
  // assinatura, que é o que o chamador vê, continua exata.
  return selecionar(CATALOGO as CatalogoDePrompts, id, VIGENTES[id]) as VersaoVigente<Id>;
}

/**
 * A versão VIGENTE de cada prompt, em metadados — é o que o documento de custos
 * lê, e é por prompt, não por versão publicada: o custo do mês é o do que roda.
 * A v1 da triagem continua no CATALOGO, para voltar trocando um número.
 */
export const INVENTARIO: readonly MetadadosDePrompt[] = [
  metadadosDoPrompt(transcricaoAudioV1),
  metadadosDoPrompt(fichaDaConversaV1),
  metadadosDoPrompt(pulsoDoDiaV1),
  metadadosDoPrompt(triagemDoRadarV2),
  metadadosDoPrompt(resumoLigacaoV1),
  metadadosDoPrompt(followupLigacaoV1),
  metadadosDoPrompt(classificarIntencaoV1),
  metadadosDoPrompt(canalDeChegadaV1),
];
