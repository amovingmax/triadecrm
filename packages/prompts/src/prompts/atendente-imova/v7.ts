/**
 * `atendente-imova@v7` (23/11/2026): a v6 com A BUSCA NO MAPA.
 *
 * Pedido do usuário, depois da Alinne (23/11): ela disse "terreno em Camurupim", "perto
 * do Condomínio Serv Club", "Condomínio Itapetinga" e mandou "Avenida Praia de
 * Camurupim, Nísia Floresta", e ninguém achou o terreno. "Não precisa de um agente
 * especializado na busca, mas devemos passar a instrução para IA sempre buscar no mapa
 * de acordo com a referência que o cliente passou para que possamos ver se as
 * informações batem." Só OpenStreetMap.
 *
 * O que muda em relação à v6:
 * - Uma ferramenta, `buscar_no_mapa` ({ referencia, cidade? }). Quem a executa é o
 *   worker (`apps/workers/src/ia/busca-no-mapa.ts`): procura no OpenStreetMap, com cache,
 *   e o CÓDIGO mede a distância até os imóveis (haversine) e devolve faixas ("bem
 *   perto", "na mesma região", nenhum perto; numa cidade inteira, os imóveis da cidade).
 *   O modelo nunca vê coordenada nem calcula distância.
 * - Um parágrafo curto no fim do sistema dizendo que a ferramenta existe. QUANDO usar e
 *   o que fazer com o resultado ficam no caderno (nota "14. BUSCA NO MAPA"), como pediu o
 *   usuário.
 * - A chamada vira um laço (`executarComFerramentas`): cada volta é uma linha em
 *   `ai_runs` e o resultado da ferramenta passa pela auditoria de PII. Teto de buscas por
 *   resposta (`MAX_BUSCAS_NO_MAPA`) e de voltas; a última volta não oferece ferramenta,
 *   e o modelo responde o JSON de sempre.
 *
 * Entrada, saída, mensagem e exemplos são os da v6, palavra por palavra. Voltar à v6 é
 * trocar o número em `VIGENTES` e o import do worker; e o worker já usa a v6 sozinho
 * quando não há mapa (sem `NOMINATIM_USER_AGENT`).
 *
 * O número: a nota 9 do caderno ("REGRAS FIRMES — PROVISÓRIA: tirar quando a v7
 * estiver no ar") falava das regras firmes, que eram a "v7" planejada em 16/11. Como o
 * e-mail ficou com o 6, o mapa fica com o 7, e aquela passa a ser a v8: ao publicar,
 * o título da nota 9 deve dizer "v8".
 */
import { type FerramentaDoPrompt, definirPrompt } from '../../nucleo/versionamento';
import { type BaseDoAtendenteV2, montarBaseV2 } from './v2';
import { type EntradaDoAtendenteV6, type SaidaDoAtendenteV6, atendenteImovaV6 as v6 } from './v6';

/** Buscas no mapa por resposta, no máximo. Passou disso, a ferramenta diz que acabou. */
export const MAX_BUSCAS_NO_MAPA = 3;

/** Idas ao modelo por resposta, no máximo: as buscas, a resposta e uma de folga. */
export const MAX_VOLTAS_DO_ATENDENTE = MAX_BUSCAS_NO_MAPA + 2;

export const FERRAMENTA_BUSCAR_NO_MAPA: FerramentaDoPrompt = {
  nome: 'buscar_no_mapa',
  descricao:
    'Procura no mapa (OpenStreetMap) um lugar que o cliente citou para dizer onde fica o imóvel, e diz ' +
    'quais imóveis da lista ficam perto dele, pela conta do sistema: "bem perto", "na mesma região" ou ' +
    'nenhum perto. Se o lugar achado é uma cidade inteira, diz os imóveis nossos nessa cidade. Não achou: ' +
    'tente uma referência mais geral (o bairro, a praia ou a cidade). Até três buscas por resposta.',
  entrada: {
    type: 'object',
    properties: {
      referencia: {
        type: 'string',
        description:
          'O lugar como o cliente disse (rua, avenida, bairro, praia, condomínio, ponto conhecido), ou um ' +
          'pouco mais geral, sem número de casa e sem "perto de".',
      },
      cidade: {
        type: 'string',
        description: 'A cidade, se o cliente disse ou a conversa deixa claro.',
      },
    },
    required: ['referencia'],
    additionalProperties: false,
  },
};

const BLOCO_DO_MAPA = `A BUSCA NO MAPA:
Você tem a ferramenta buscar_no_mapa: ela diz onde fica no mapa um lugar que o cliente
citou e quais imóveis da lista ficam perto, pela conta do sistema. Quando usar e o que
fazer com o resultado está no caderno. O resultado serve para identificar o imóvel: não
é fato para dizer ao cliente. Depois das buscas, responda com o JSON de sempre.`;

const sistema = `${v6.sistema}\n\n${BLOCO_DO_MAPA}`;

/** O bloco de sistema de uma chamada da v7: as regras, mais a base da Imova (a da v2). */
export function sistemaComBaseV7(base: BaseDoAtendenteV2): string {
  return `${sistema}\n\n${montarBaseV2(base)}`;
}

export const atendenteImovaV7 = definirPrompt<EntradaDoAtendenteV6, SaidaDoAtendenteV6>({
  id: 'atendente-imova',
  versao: 7,
  modelo: v6.modelo,
  proposito: v6.proposito,
  entrada: v6.entrada,
  saida: v6.saida,
  sistema,
  ferramentas: [FERRAMENTA_BUSCAR_NO_MAPA],
  camposDeTexto: v6.camposDeTexto,
  camposDoTriade: v6.camposDoTriade,
  escala: v6.escala,
  maxTokens: v6.maxTokens,
  montarMensagem: v6.montarMensagem,
  exemplos: v6.exemplos,
});
