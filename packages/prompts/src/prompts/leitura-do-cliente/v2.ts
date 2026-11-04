import * as z from 'zod';

import { definirPrompt } from '../../nucleo/versionamento';
import {
  CAMPOS_DO_PERFIL,
  INTENCOES_DO_CLIENTE,
  OBJECOES_DA_IMOVA,
  SINAIS_NEGATIVOS_DO_CLIENTE,
  SINAIS_POSITIVOS_DO_CLIENTE,
  leituraDoClienteV1,
  type EntradaDaLeitura,
} from './v1';

/**
 * `leitura-do-cliente@v2` — a v1 que não joga fora a leitura por causa do tamanho
 * (Imova, 04/11/2026).
 *
 * ===========================================================================
 * O QUE MUDOU DA v1, E POR QUE ISSO É UMA VERSÃO E NÃO UM AJUSTE
 * ===========================================================================
 * Na primeira hora em produção, com o Haiku 5.5 de verdade, 4 de 12 leituras foram
 * recusadas pelo schema: resumo com 462 caracteres (o teto era 400), motivo com 207 a
 * 235 (teto 200), próxima ação com 213 e 214 (teto 200). A saída estruturada garante a
 * FORMA, e o `esquemaLimpo` do worker tira `maxLength` e `maxItems` antes de mandar —
 * a API não os aceita —, então o modelo nunca viu os tetos; o prompt só falava do
 * resumo. O dublê sempre respondeu dentro deles, e o ensaio não pegou. Cada recusa
 * eram três chamadas pagas e nenhuma leitura gravada.
 *
 * Duas mudanças, e só elas:
 * 1. O prompt diz o tamanho de cada texto (regra 15), e o schema leva o mesmo tamanho
 *    na `description` de cada campo, que o worker mantém.
 * 2. O que passar do teto é ENCURTADO na palavra, com "…", em vez de recusado; lista
 *    comprida fica com os primeiros itens. Os tetos são os do banco
 *    (`ficha_da_conversa`: resumo 600, motivo 280; `app.ia_gravar_ficha` corta a
 *    próxima ação em 200 e o trecho em 120), para nada ser cortado duas vezes. O que é
 *    estrutura (enum, número, `messageId`) continua estrito: errado ali é leitura errada.
 *
 * Entrada, mensagem, exemplos, modelo e propósito são os da v1. O banco aceita as duas
 * versões (`prompt_version like 'leitura-do-cliente@%'`), e voltar é trocar o número
 * em `VIGENTES`.
 */

/** Corta na última palavra que cabe, com "…"; o que não é texto passa como veio. */
export function encurtarTexto(maximo: number) {
  return (valor: unknown): unknown => {
    if (typeof valor !== 'string' || valor.length <= maximo) return valor;
    const corte = valor.slice(0, maximo - 1);
    const espaco = corte.lastIndexOf(' ');
    const base = espaco >= maximo * 0.6 ? corte.slice(0, espaco) : corte;
    return `${base.replace(/[\s,;:.—-]+$/u, '')}…`;
  };
}

function texto(maximo: number, pedido: string) {
  return z.preprocess(encurtarTexto(maximo), z.string().max(maximo)).describe(pedido);
}

function lista<T extends z.ZodType>(item: T, maximo: number) {
  return z.preprocess(
    (valor: unknown) => (Array.isArray(valor) ? valor.slice(0, maximo) : valor),
    z.array(item).max(maximo),
  );
}

/** Prazo que não cabe não é prazo: vira null, em vez de uma data cortada ao meio. */
const prazo = z.preprocess(
  (valor: unknown) => (typeof valor === 'string' && valor.length > 40 ? null : valor),
  z.string().max(40).nullable(),
);

const sinal = z.object({
  tipo: z.enum([...SINAIS_POSITIVOS_DO_CLIENTE, ...SINAIS_NEGATIVOS_DO_CLIENTE]),
  polaridade: z.enum(['positivo', 'negativo']),
  forca: z.enum(['fraco', 'forte']),
  messageId: z.string().min(1).max(64),
  trecho: texto(120, 'O trecho exato da mensagem, até 120 caracteres.'),
});

const saida = z.object({
  resumo: texto(600, 'Factual, até 400 caracteres.'),
  intencao: z.enum(INTENCOES_DO_CLIENTE),
  scoreIntencao: z.number().int().min(0).max(100),
  motivo: texto(280, 'Por que esse score, numa frase de até 200 caracteres.'),
  sentimento: z.enum(['positivo', 'neutro', 'negativo']),
  sinais: lista(sinal, 8),
  objecoes: lista(z.enum(OBJECOES_DA_IMOVA), 7),
  etapaSugerida: z.preprocess(encurtarTexto(80), z.string().max(80)).nullable(),
  compromissosNovos: lista(
    z.object({
      quem: z.enum(['cliente', 'equipe']),
      oQue: texto(280, 'O que foi combinado, até 200 caracteres.'),
      prazo,
      messageId: z.string().min(1).max(64),
    }),
    10,
  ),
  compromissosCumpridos: lista(
    z.object({ id: z.string().max(64), messageId: z.string().min(1).max(64) }),
    10,
  ),
  proximaAcao: z.object({
    descricao: texto(200, 'Uma ação concreta para o time, numa frase de até 160 caracteres.'),
    prazo,
  }),
  dadosExtraidos: lista(
    z.object({
      campo: z.enum(CAMPOS_DO_PERFIL),
      valor: texto(200, 'O que a pessoa disse, até 100 caracteres.'),
      confianca: z.number().min(0).max(1),
      messageId: z.string().min(1).max(64),
    }),
    12,
  ),
  alertas: lista(
    z.enum([
      'reclamacao',
      'pediu_visita',
      'pediu_proposta',
      'pronto_para_fechar',
      'risco_perda',
      'concorrente_citado',
    ]),
    6,
  ),
  confianca: z.number().min(0).max(1),
  dadosInsuficientes: z.boolean(),
});

export type SaidaDaLeituraV2 = z.infer<typeof saida>;

const REGRA_15_DA_V1 =
  '15. Português do Brasil, direto, sem floreio. O resumo é factual e cabe em 400 caracteres.';

const REGRA_15 = `15. Português do Brasil, direto, sem floreio. Tamanhos, contados em caracteres: resumo
    até 400; motivo até 200, uma frase; proximaAcao.descricao até 160, uma frase só;
    trecho até 120 (o pedaço exato da mensagem); oQue até 200; valor do perfil até 100.
    Passou disso, o CRM corta no meio da frase.`;

if (!leituraDoClienteV1.sistema.includes(REGRA_15_DA_V1)) {
  throw new Error('leitura-do-cliente@v2: a regra 15 da v1 não está onde a v2 espera.');
}

export const leituraDoClienteV2 = definirPrompt<EntradaDaLeitura, SaidaDaLeituraV2>({
  ...leituraDoClienteV1,
  versao: 2,
  saida,
  sistema: leituraDoClienteV1.sistema.replace(REGRA_15_DA_V1, REGRA_15),
});
