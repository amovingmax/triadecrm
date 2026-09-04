import { TIMEZONE } from '@komune/schema';

import { diasDeDiferenca, formatarLocal } from '@/components/parceiros/formatos';

import { SEMAFORO_PROXIMA_ACAO, type CartaoQuadro, type EstadoProximaAcao } from './tipos';

/**
 * Texto do cartão do funil. Fica separado do componente por dois motivos: dá para
 * testar a regra sem montar React (é o que `cartao-formatos.test.ts` faz) e a folha
 * de mover, no celular, precisa das mesmas frases sem carregar o cartão inteiro.
 *
 * Duas regras da casa valem em tudo que sai daqui:
 *
 * 1. **Toda data é `America/Fortaleza`.** O time está em Natal e a próxima ação de
 *    amanhã às 9h tem de ser amanhã às 9h para todo mundo, inclusive para o
 *    navegador de quem abrir o CRM fora do estado. O `next_action_state` que o banco
 *    manda no cartão já foi calculado nesse fuso; aqui só se escreve o prazo.
 * 2. **Número sai separado da palavra.** Quem escreve "em 3 d" numa string só obriga
 *    a linha inteira a virar IBM Plex Mono, e mono numa frase fica torto. Então o
 *    retorno tem `prefixo`, `numero` e `unidade`, e só o `numero` recebe o utilitário
 *    `numerico`. É a mesma decisão de `components/temperatura/dias-sem-contato.tsx`.
 *
 * `diasDeDiferenca` e `formatarLocal` vêm de `components/parceiros/formatos.ts` de
 * propósito: são funções puras já em uso na lista e na ficha, e uma segunda contagem
 * de dias de calendário no projeto é exatamente o tipo de coisa que diverge em
 * silêncio no primeiro horário de verão.
 */

const HORA = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});

/**
 * Prazo da próxima ação, pronto para a linha do cartão.
 *
 * `urgente` é o que faz a linha ganhar peso e tinta cheia em vez do esmaecido: vale
 * para a ação vencida e para a ausência de ação (RF-FUN-03). Cor não entra nessa
 * decisão em nenhum dos dois casos, porque na interface cor significa temperatura.
 */
export type PrazoProximaAcao = {
  /** Palavra antes do número ("Em ", "Atrasada "). Sozinha quando não há número. */
  prefixo: string;
  /** O número (dias ou hora); recebe o utilitário `numerico`. `null` quando não há. */
  numero: string | null;
  /** O que vem depois do número ("d"), colado nele e um pouco menor. */
  unidade: string;
  /** Frase inteira, para `title` e leitor de tela. */
  descricao: string;
  /** Pede peso maior e tinta cheia na linha (vencida ou sem ação marcada). */
  urgente: boolean;
};

/**
 * Escreve o prazo a partir do estado que o banco calculou e da data da ação.
 *
 * O estado manda: ele veio de `America/Fortaleza` e é a mesma verdade do relatório de
 * segunda. A contagem de dias daqui só preenche o "quanto", nunca contradiz o "qual" —
 * por isso `agendada` com contagem zero ou negativa cai em "Hoje" em vez de escrever
 * "em 0 d", e `atrasada` sem data nenhuma vira a frase de ausência.
 */
export function formatarPrazoProximaAcao(
  estado: EstadoProximaAcao,
  iso: string | null | undefined,
  agora: Date = new Date(),
): PrazoProximaAcao {
  const semAcao: PrazoProximaAcao = {
    prefixo: 'Sem próxima ação',
    numero: null,
    unidade: '',
    descricao: SEMAFORO_PROXIMA_ACAO.sem.descricao,
    urgente: true,
  };

  if (estado === 'sem' || !iso) return semAcao;

  const alvo = new Date(iso);
  if (Number.isNaN(alvo.getTime())) return semAcao;

  const quando = DATA_HORA.format(alvo);
  const dias = diasDeDiferenca(agora, alvo);

  if (estado === 'hoje' || (estado === 'agendada' && dias <= 0)) {
    return {
      prefixo: 'Hoje, ',
      numero: HORA.format(alvo),
      unidade: '',
      descricao: `Próxima ação hoje, às ${HORA.format(alvo)}.`,
      urgente: false,
    };
  }

  if (estado === 'agendada') {
    if (dias === 1) {
      return {
        prefixo: 'Amanhã, ',
        numero: HORA.format(alvo),
        unidade: '',
        descricao: `Próxima ação amanhã, às ${HORA.format(alvo)}.`,
        urgente: false,
      };
    }
    return {
      prefixo: 'Em ',
      numero: String(dias),
      unidade: 'd',
      descricao: `Próxima ação em ${dias} dias, ${quando}.`,
      urgente: false,
    };
  }

  // Atrasada: o banco já decidiu que venceu; aqui só se conta há quanto tempo.
  const atraso = Math.max(1, Math.abs(dias));
  if (atraso === 1) {
    return {
      prefixo: 'Venceu ontem',
      numero: null,
      unidade: '',
      descricao: `Próxima ação venceu ontem, ${quando}.`,
      urgente: true,
    };
  }
  return {
    prefixo: 'Atrasada ',
    numero: String(atraso),
    unidade: 'd',
    descricao: `Próxima ação atrasada há ${atraso} dias; venceu em ${quando}.`,
    urgente: true,
  };
}

/**
 * Segunda linha do cartão: categoria e onde a pessoa fica. Sem travessão e sem
 * repetir vírgula quando falta um dos dois. Devolve string vazia quando não há nada,
 * e quem chama decide o texto de ausência (o cartão escreve "Sem categoria").
 */
export function formatarCategoriaELocal(cartao: CartaoQuadro): string {
  const local = formatarLocal(cartao.neighborhood, cartao.city);
  return [cartao.primary_category, local || null].filter(Boolean).join(' · ');
}

/**
 * Rótulo do responsável. Sem dono não é um defeito do dado: os negócios nascem no
 * bolo comum e quem move assume (o `move_deal` grava `claimed`). Então a frase é
 * um convite, não um erro.
 */
export function rotuloResponsavel(nome: string | null | undefined): string {
  return nome?.trim() ? nome.trim() : 'Sem responsável';
}

/**
 * Texto da pastilha de "parado" (RF-FUN-02). O cartão só a mostra quando o banco diz
 * `is_rotting`, e o número de dias vem de `days_in_stage`, que é o que a pessoa
 * reconhece ("está aí desde a semana passada").
 */
export function formatarParado(dias: number): {
  rotulo: string;
  numero: string | null;
  unidade: string;
  descricao: string;
} {
  const inteiro = Math.max(0, Math.trunc(dias));
  if (inteiro === 0) {
    return {
      rotulo: 'Parado',
      numero: null,
      unidade: '',
      descricao: 'Passou do prazo da etapa sem nenhuma atividade registrada.',
    };
  }
  return {
    rotulo: 'Parado há ',
    numero: String(inteiro),
    unidade: 'd',
    descricao: `Passou do prazo da etapa: ${inteiro} ${inteiro === 1 ? 'dia' : 'dias'} nesta etapa sem atividade.`,
  };
}
