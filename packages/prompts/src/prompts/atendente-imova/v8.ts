/**
 * `atendente-imova@v8` (24/11/2026): a v7 com A FOTO PARA CONFIRMAR O IMÓVEL.
 *
 * Pedido do usuário, com o print da conversa em que a IA achou o terreno da Etelvino
 * Cunha pela Avenida Gustavo Neves e respondeu "Pelo lugar, deve ser o terreno da Rua
 * Professor Etelvino Cunha, em Capim Macio, em Natal. É esse que você viu? Se for, já
 * adianto que ele tem escritura pública e o valor de venda é R$ 1.000.000.": "a IA me
 * respondeu de forma pouco humanizada [...] gostaria que a IA tivesse o poder de enviar
 * foto ao cliente, nesse caso ele poderia na primeira mensagem enviar uma mensagem mais
 * humanizada e logo na mensagem seguinte enviar uma imagem do terreno que a IA captou
 * pelas informações, e perguntar ao cliente se é esse terreno/imóvel que ele estava se
 * referindo. O cliente confirmando o imóvel/terreno a IA segue com o atendimento."
 *
 * O que muda em relação à v7:
 * - A saída ganha `fotoParaConfirmar` ({ imovelCodigo, legenda } | null). O worker manda
 *   o texto, copia a foto de capa do anúncio e chama `ia_atendente_mostrar_foto`
 *   (migração 20261124170000), que põe a foto na fila logo depois do texto. Sem foto no
 *   anúncio, ou se a foto falhar, a legenda sai como texto.
 * - Um bloco no fim do sistema: QUANDO a confirmação vai com foto, como é a mensagem
 *   antes dela (curta, calorosa, segura, sem preço, sem metragem, sem pergunta) e como seguir
 *   depois do "é esse sim". O exemplo é o modelo que o usuário pediu, sem a metragem (a
 *   nota 13 do caderno proíbe confirmar pela área).
 * - A linha da saída ganha o campo novo.
 * - "Corretor" sai das regras herdadas (`TROCAS_DO_CORRETOR`): vale o que a nota 9 (d) do
 *   caderno manda, "diga que vai verificar e retorna".
 *
 * Entrada, ferramenta, mensagem e exemplos são os da v7 (os exemplos com
 * `fotoParaConfirmar: null`, mais um da foto). Voltar à v7 é trocar o número em `VIGENTES`
 * e o import do worker.
 *
 * O número: a nota 9 do caderno ("REGRAS FIRMES — PROVISÓRIA: tirar quando a v8 estiver
 * no ar") fala das regras firmes, que esta versão NÃO leva para o prompt. Ao publicar, o
 * título da nota 9 (e da 9b) deve passar a dizer "v9".
 */
import { z } from 'zod';

import { definirPrompt } from '../../nucleo/versionamento';
import { type BaseDoAtendenteV2, montarBaseV2 } from './v2';
import { trocarUmaVez } from './v4';
import { type EntradaDoAtendenteV6, saidaDoAtendenteV6 } from './v6';
import { atendenteImovaV7 as v7 } from './v7';

/** A legenda da foto quando o modelo não escreve uma. */
export const LEGENDA_PADRAO_DA_FOTO = 'É este aqui que você viu?';

/** Teto da legenda (o banco recusa acima de 300). */
export const TETO_DA_LEGENDA = 200;

const fotoParaConfirmar = z
  .object({
    imovelCodigo: z
      .string()
      .min(1)
      .describe('O código do imóvel, exatamente como está na lista dos imóveis.'),
    legenda: z
      .string()
      .max(TETO_DA_LEGENDA)
      .describe('A pergunta curta que vai com a foto, como "É este aqui que você viu?".'),
  })
  .nullable()
  .describe(
    'Só na mensagem que confirma o imóvel identificado por uma referência do cliente: o imóvel e a legenda da foto que o sistema manda logo depois da mensagem. Senão null.',
  );

const saida = saidaDoAtendenteV6.extend({ fotoParaConfirmar });
export type SaidaDoAtendenteV8 = z.infer<typeof saida>;

const OFERTAS_NA_SAIDA =
  '- `ofertasPorEmail`: "aceitou", "recusou" ou null (ver O E-MAIL PARA OFERTAS).';
const OFERTAS_E_FOTO_NA_SAIDA = `${OFERTAS_NA_SAIDA}
- \`fotoParaConfirmar\`: { imovelCodigo, legenda } ou null (ver A FOTO PARA CONFIRMAR O IMÓVEL).`;

export const BLOCO_DA_FOTO = `A FOTO PARA CONFIRMAR O IMÓVEL (acao = responder):
Quando você reconhecer de qual imóvel o cliente fala por uma referência que ele deu (rua,
avenida, bairro, praia, condomínio, ponto conhecido, ou o que a busca no mapa mostrou) e
ainda precisar que ele confirme, a confirmação vai em duas mensagens:
1. \`mensagem\`: uma frase curta, calorosa e segura dizendo qual é o imóvel, pelo tipo e pelo
   lugar, com a referência que ele deu. Sem mostrar dúvida: nunca "acho", "acredito",
   "deve ser", "parece", "talvez", "provavelmente", "pelo que você descreve" nem "se for".
   Sem preço (mesmo que ele tenha perguntado: o valor vem na resposta ao "é esse"), sem
   documentação, sem metragem, sem outros detalhes e sem pergunta: a pergunta vai na foto.
   Ex.: "É o nosso terreno bem perto da Gustavo Neves, na Rua Professor Etelvino Cunha, em
   Capim Macio."
2. \`fotoParaConfirmar\`: o código do imóvel, exatamente como está na lista, e a legenda, uma
   pergunta curta: "${LEGENDA_PADRAO_DA_FOTO}" ou "É este o terreno que você viu?". O sistema
   manda a foto principal do anúncio logo depois da sua mensagem.
Ele confirmou ("é esse", "isso", "sim"): siga o atendimento e responda o que ele perguntou
(se está disponível, o preço, a documentação) pelas outras regras e pelo caderno, sem
mandar a foto de novo. Ex.: "Esse mesmo! Ele está disponível, sim." e o que mais ele pediu.
Disse que não é: siga o caderno (nota 7 a).
Sem foto (\`fotoParaConfirmar\` = null): quando ele já deixou claro de qual imóvel fala (mandou
a foto ou o anúncio, citou o código, ou o imóvel já foi confirmado nesta conversa); quando
há mais de um imóvel possível (pergunte qual, pelo tipo e pelo lugar); quando a ação não é
responder; e em toda mensagem que não é a da confirmação. Uma foto por resposta, e nunca a
mesma foto duas vezes na conversa.
Na conversa, a foto que você mandou aparece como "[foto do anúncio ... que você mandou]".
Nunca escreva que vai mandar a foto nem a descreva: ela vai sozinha. É a única foto que sai
daqui; se ele pedir mais fotos ou vídeo, siga o caderno.`;

/**
 * "Corretor" sai das regras herdadas (24/11/2026). A bateria da v8 mostrou a IA dizendo
 * "já vou passar a conversa para um corretor" em 5 de 9 passagens: as regras antigas
 * mandavam isso, e só a nota 9 (d) do caderno ("Nunca diga corretor: diga que vai
 * verificar e retorna") desmentia. Ficam o nome da ação (`passar_para_corretor`), o
 * pedido do cliente ("pede corretor") e a proibição da frase da visita.
 */
export const TROCAS_DO_CORRETOR: readonly (readonly [string, string])[] = [
  [
    'Na passagem, a mensagem responde o que der e diz que você já vai passar para um corretor,',
    'Na passagem, a mensagem responde o que der e diz que você vai verificar e já retorna,',
  ],
  [
    'Não sabe? Diga que vai confirmar com o corretor e, se for importante para ele, passe.',
    'Não sabe? Diga que vai verificar e retorna e, se for importante para ele, passe.',
  ],
  ['passe para o corretor.', 'passe para a equipe.'],
  [
    'vai confirmar o valor atualizado com o corretor.',
    'vai verificar o valor atualizado e retorna.',
  ],
  ['diga que vai confirmar\n  com o corretor.', 'diga que vai verificar\n  e retorna.'],
  ['diga só que vai confirmar com o corretor.', 'diga só que vai verificar e retorna.'],
];

function semCorretor(texto: string): string {
  let saida = texto;
  for (const [de, para] of TROCAS_DO_CORRETOR) {
    if (!saida.includes(de))
      throw new Error(`atendente-imova@v8: a regra herdada mudou, falta "${de}"`);
    saida = saida.split(de).join(para);
  }
  return saida;
}

const sistema = `${trocarUmaVez(semCorretor(v7.sistema), OFERTAS_NA_SAIDA, OFERTAS_E_FOTO_NA_SAIDA)}\n\n${BLOCO_DA_FOTO}`;

/** O bloco de sistema de uma chamada da v8: as regras, mais a base da Imova (a da v2). */
export function sistemaComBaseV8(base: BaseDoAtendenteV2): string {
  return `${sistema}\n\n${montarBaseV2(base)}`;
}

/** Os exemplos da v7 sem foto, mais o da confirmação com foto (o print de 24/11). */
const exemplos = [
  ...v7.exemplos.map((e) => ({
    nome: e.nome,
    entrada: e.entrada,
    saida: { ...e.saida, fotoParaConfirmar: null },
  })),
  {
    nome: 'referência de rua que o mapa liga a um terreno: frase calorosa, sem preço, e a foto com a pergunta',
    entrada: {
      leadId: 'lead-24',
      agora: '2026-11-24T14:00',
      agoraPorExtenso: 'terça-feira, 24 de novembro, às 14h00',
      treino: false,
      cliente: {
        nome: '[[NOME_1]]',
        temFicha: true,
        etapa: 'Respondeu',
        perfil: [],
        visitas: [],
        canalDeChegada: 'anuncios' as const,
        email: { naFicha: true, ofertas: null },
      },
      convitesDaAgenda: [],
      respostasNaUltimaHora: 1,
      mensagens: [
        {
          messageId: 'm1',
          de: 'ia' as const,
          quem: null,
          quando: '24/11 13:58',
          texto: 'Olá, boa tarde! Tudo bem? Como posso te ajudar?',
        },
        {
          messageId: 'm2',
          de: 'cliente' as const,
          quem: null,
          quando: '24/11 14:00',
          texto: 'Oi, vi um terreno à venda perto da Avenida Gustavo Neves. Ainda está disponível?',
        },
      ],
    },
    saida: {
      acao: 'responder' as const,
      mensagem:
        'É o nosso terreno bem perto da Gustavo Neves, na Rua Professor Etelvino Cunha, em Capim Macio.',
      agenda: null,
      motivo:
        'Mapa: o terreno de Capim Macio fica bem perto da Gustavo Neves; mando a foto para ele confirmar antes de falar de preço.',
      anotacoes: [],
      fotosEnsinadas: [],
      confianca: 0.8,
      ofertasPorEmail: null,
      fotoParaConfirmar: { imovelCodigo: 'TE0006', legenda: LEGENDA_PADRAO_DA_FOTO },
    },
  },
];

export const atendenteImovaV8 = definirPrompt<EntradaDoAtendenteV6, SaidaDoAtendenteV8>({
  id: 'atendente-imova',
  versao: 8,
  modelo: v7.modelo,
  proposito: v7.proposito,
  entrada: v7.entrada,
  saida,
  sistema,
  ferramentas: v7.ferramentas,
  camposDeTexto: v7.camposDeTexto,
  camposDoTriade: v7.camposDoTriade,
  escala: v7.escala,
  maxTokens: v7.maxTokens,
  montarMensagem: v7.montarMensagem,
  exemplos,
});
