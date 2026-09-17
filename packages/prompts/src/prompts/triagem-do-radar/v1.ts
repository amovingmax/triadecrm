import { z } from 'zod';

import { MODELOS, definirPrompt } from '../../nucleo/versionamento';

/**
 * `triagem-do-radar@v1` — Claude Haiku 4.5, saída estruturada.
 *
 * ===========================================================================
 * O QUE A CONTA NÃO ALCANÇA
 * ===========================================================================
 * A triagem aritmética (`app.radar_pontuar`) soma nota, avaliações, categoria e
 * cidade. Ela ordena bem e não sabe ler: "Fotografia Silva — Formaturas" e
 * "Fotografia Silva — Casamentos" têm exatamente a mesma pontuação, e só um
 * deles atende a KOMUNE.
 *
 * Este prompt é a metade que lê. Ele olha o NOME e a categoria que a fonte deu, e
 * responde uma pergunta só: isto parece um fornecedor de evento que a KOMUNE
 * contrataria? Nada além disso.
 *
 * ===========================================================================
 * ELE OPINA, ELE NÃO DECIDE
 * ===========================================================================
 * O veredito não aprova, não recusa e não tira ninguém da fila (RF-RAD-08: quem
 * vira parceiro é decisão humana). Ele entra como uma coluna a mais na revisão —
 * "a IA acha que não é fornecedor de evento, e disse por quê" — e quem revisa
 * discorda quando quiser. Uma IA que descartasse candidato sozinha seria a
 * automação decidindo quem a empresa procura, e essa não é uma decisão de
 * máquina.
 *
 * ===========================================================================
 * `incerto` É UMA RESPOSTA, E É A MAIS IMPORTANTE DAS TRÊS
 * ===========================================================================
 * Metade da fila é nome curto sem categoria ("Ki-Pão Premium"). Forçar um
 * sim/não aí produz chute com cara de veredito — e chute com cara de veredito é
 * pior que silêncio, porque ninguém confere o que parece confiante. `incerto` é
 * o que a IA deve dizer quando o nome não basta, e o teto de confiança de 0,6
 * para esse caso existe para ela não se contradizer.
 *
 * ===========================================================================
 * O QUE NÃO ENTRA AQUI
 * ===========================================================================
 * Telefone, e-mail, endereço e CNPJ. O modelo não precisa deles para responder o
 * que se pergunta, e o que não é necessário não viaja (ADR-09 e o guardrail de
 * pseudonimização). O nome do negócio entra porque É a pergunta.
 */

/** Um candidato como o Radar o trouxe, sem contato nenhum junto. */
const candidato = z.object({
  /**
   * O NÚMERO do candidato nesta lista ("1", "2", "3"), não o id do banco.
   *
   * Mandar o uuid foi a primeira versão, e ela não funcionou: o pseudonimizador
   * lê um uuid como documento e o troca por `[[DOCUMENTO_1]]` antes de o texto
   * sair — o modelo devolvia esse rótulo e o worker não reconhecia ninguém. Está
   * certo ele mascarar: id de banco não tem por que viajar para fora. O número da
   * lista resolve os dois lados, e é a mesma ideia do `lead-xxxxxx` do Pulso.
   */
  id: z.string().min(1).max(4),
  /** O nome como a fonte publicou — é o que se pede ao modelo para ler. */
  nome: z.string().min(1).max(160),
  /** A categoria que a fonte deu, quando deu. Muitas vezes é nula. */
  categoriaDaFonte: z.string().max(80).nullable(),
  /** A categoria que o CRM já casou com o catálogo, quando casou. */
  categoriaDoCrm: z.string().max(80).nullable(),
  cidade: z.string().max(80).nullable(),
  bairro: z.string().max(80).nullable(),
});

const entrada = z.object({
  /** O que a KOMUNE procura, em uma frase, para o modelo não inventar o critério. */
  oQueProcuramos: z.string().min(1).max(600),
  /** As categorias do catálogo, para o modelo sugerir uma que exista. */
  categorias: z.array(z.string().max(80)).max(40),
  candidatos: z.array(candidato).min(1).max(30),
});

export type EntradaDaTriagem = z.infer<typeof entrada>;

const veredito = z.object({
  /** O mesmo número que veio na lista. */
  id: z.string().min(1).max(4),
  /**
   * `sim` — parece fornecedor de evento que a KOMUNE contrataria.
   * `nao` — parece outra coisa (formatura, ensaio de bebê, loja de varejo).
   * `incerto` — o nome não diz. É resposta legítima, e a mais comum aqui.
   */
  veredito: z.enum(['sim', 'nao', 'incerto']),
  /** Uma frase curta, na língua de quem revisa. Nunca "não sei" sozinho. */
  porque: z.string().min(3).max(200),
  /** Do catálogo que veio na entrada, ou nulo. O modelo não inventa categoria. */
  categoriaSugerida: z.string().max(80).nullable(),
  confianca: z.number().min(0).max(1),
});

const saida = z.object({
  vereditos: z.array(veredito).max(30),
});

export type SaidaDaTriagem = z.infer<typeof saida>;

const sistema = `Você trabalha na curadoria de fornecedores da KOMUNE, um marketplace de eventos em Natal (RN).

Sua tarefa: para cada candidato da lista, dizer se o NOME e a categoria sugerem um fornecedor de evento que a KOMUNE contrataria.

Como decidir:
- "sim" quando o nome ou a categoria indicam serviço de evento — buffet, espaço, decoração, som, foto de casamento, cerimonial, brinquedo, segurança, transporte de convidado.
- "nao" quando indicam outra coisa: foto de formatura ou de recém-nascido, loja de varejo, escritório, clínica, restaurante que só serve no salão sem atender festa.
- "incerto" quando o nome não permite concluir. Esta é a resposta certa na maior parte dos casos: nome curto, sigla, sobrenome de família. Não adivinhe.

Regras:
- "porque" é uma frase curta e concreta, na língua de quem revisa. Diga o que no nome levou à conclusão ("'Formaturas' no nome"), nunca "não tenho informação suficiente" sozinho.
- "categoriaSugerida" só pode ser uma das categorias que vieram na lista, ou nulo.
- Em "incerto", "confianca" nunca passa de 0,6.
- Você não aprova nem recusa ninguém: alguém vai ler o seu veredito e decidir.`;

export const triagemDoRadarV1 = definirPrompt<EntradaDaTriagem, SaidaDaTriagem>({
  id: 'triagem-do-radar',
  versao: 1,
  modelo: MODELOS.haiku,
  proposito: 'triar_candidato',
  entrada,
  saida,
  sistema,
  // `candidatos` inteiro é texto de fora — o nome e a categoria vieram da fonte
  // —, e a lista abaixo diz o que, DENTRO dele, é nosso. A raiz precisa estar
  // aqui para o caminho aninhado ser aceito (é a regra do `chamada.ts`).
  camposDeTexto: ['candidatos'],
  // O resto é nosso: o critério, o catálogo e o que o CRM já resolveu.
  camposDoTriade: [
    'oQueProcuramos',
    'categorias',
    'candidatos[].id',
    'candidatos[].categoriaDoCrm',
    'candidatos[].cidade',
    'candidatos[].bairro',
  ],
  // A pergunta é sobre a LISTA inteira: o modelo compara os candidatos entre si
  // para não chamar de "sim" um que só parece bom sozinho.
  escala: 'conversa',
  // MEDIDO, não estimado: trinta vereditos gastaram 1.875 tokens de saída na
  // primeira chamada real (ai_run 50), e a segunda estourou o teto de 2.000 e
  // voltou com JSON cortado no meio — que o leitor recusa, e com razão. Três mil
  // dá folga para o pior caso; o lote foi para vinte na mesma correção, porque
  // teto encostado é teto que volta a estourar no dia em que um nome for longo.
  maxTokens: 3000,
  montarMensagem: (dados) =>
    [
      'O QUE A KOMUNE PROCURA:',
      dados.oQueProcuramos,
      '',
      `CATEGORIAS DO CATÁLOGO (use só estas em categoriaSugerida): ${dados.categorias.join(', ')}`,
      '',
      'CANDIDATOS:',
      ...dados.candidatos.map((c) =>
        [
          `- id: ${c.id}`,
          `  nome: ${c.nome}`,
          `  categoria na fonte: ${c.categoriaDaFonte ?? '(a fonte não disse)'}`,
          `  categoria no CRM: ${c.categoriaDoCrm ?? '(ainda não casada)'}`,
          `  onde: ${[c.bairro, c.cidade].filter(Boolean).join(', ') || '(não informado)'}`,
        ].join('\n'),
      ),
    ].join('\n'),
  exemplos: [
    {
      nome: 'o nome diz o que a conta não vê',
      entrada: {
        oQueProcuramos:
          'Fornecedores de festa e casamento na Grande Natal: buffet, espaço, decoração, som, foto de casamento, cerimonial.',
        categorias: ['Alimentos e Bebidas', 'Fotografia e Filmagem', 'Decoração', 'Locais'],
        candidatos: [
          {
            id: '1',
            nome: 'Fotografia Silva — Formaturas e Ensaios',
            categoriaDaFonte: 'fotografia',
            categoriaDoCrm: 'Fotografia e Filmagem',
            cidade: 'Natal',
            bairro: 'Tirol',
          },
          {
            id: '2',
            nome: 'Espaço Recanto das Mangueiras — Casamentos',
            categoriaDaFonte: 'espaco',
            categoriaDoCrm: 'Locais',
            cidade: 'Parnamirim',
            bairro: null,
          },
          {
            id: '3',
            nome: 'Ki-Pão Premium',
            categoriaDaFonte: null,
            categoriaDoCrm: null,
            cidade: 'Natal',
            bairro: null,
          },
        ],
      },
      saida: {
        vereditos: [
          {
            id: '1',
            veredito: 'nao',
            porque: '"Formaturas e Ensaios" no nome: fotografia que não é de casamento.',
            categoriaSugerida: null,
            confianca: 0.8,
          },
          {
            id: '2',
            veredito: 'sim',
            porque: 'Espaço de eventos com "Casamentos" no próprio nome.',
            categoriaSugerida: 'Locais',
            confianca: 0.9,
          },
          {
            id: '3',
            veredito: 'incerto',
            porque: 'Nome de padaria; pode ou não fazer bolo e salgado para festa.',
            categoriaSugerida: 'Alimentos e Bebidas',
            confianca: 0.5,
          },
        ],
      },
    },
  ],
});
