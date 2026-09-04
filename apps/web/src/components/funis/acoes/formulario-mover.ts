/**
 * O formulário de mover, sem React: o schema que valida e a função que monta o
 * pedido do `move_deal` (RF-FUN-03, RF-FUN-04).
 *
 * Fica separado do componente porque é a parte que precisa ser lida com atenção — é
 * aqui que a regra "não deixa mover sem próxima ação" e a regra "não deixa perder
 * sem motivo da lista" ganham forma. O componente só desenha o que este arquivo
 * declara.
 *
 * **A validação daqui é espelho, não lei.** Quem decide é o `move_deal`, que
 * revalida tudo com a etapa real e a lista de motivos ativa. O espelho existe para
 * que a pessoa na rua não gaste uma ida ao 4G para descobrir que faltou um campo, e
 * para que o erro apareça NO CAMPO, e não num aviso solto. Toda regra abaixo tem a
 * sua gêmea na migração `20260904000900_funil_kanban.sql`.
 */
import { z } from 'zod';

import {
  camposFaltando,
  etapaEhDeSaida,
  etapaExigeMotivoDePerda,
  etapaExigeProximaAcao,
  tipoProximaAcaoSchema,
  type CamposEtapa,
  type CartaoQuadro,
  type EtapaQuadro,
  type PedidoMover,
  type TipoProximaAcao,
} from '../tipos';
import { ehAntesDeHoje, entradaParaIso } from './datas';

/** Chave do campo de motivo de perda dentro de `campos` (é o nome no banco). */
export const CAMPO_MOTIVO_DE_PERDA = 'lost_reason_id';

/** Chave do campo de data da reunião/demonstração (`stages.required_fields`). */
export const CAMPO_DATA_DA_REUNIAO = 'meeting_at';

/** Chave do campo de evidência da autorização (vira linha em `consent_events`). */
export const CAMPO_EVIDENCIA = 'authorization_evidence';

/** Tamanho mínimo da evidência, igual ao que `camposEtapaSchema` exige em tipos.ts. */
const MINIMO_DA_EVIDENCIA = 10;

/** O estado do formulário. Tudo texto: é o que os campos nativos entregam. */
export type FormularioMover = {
  /** Id da etapa de destino como texto (valor do rádio). */
  etapaDestinoId: string;
  /** Motivo livre da mudança → `deal_stage_history.reason` (RF-FUN-08). */
  motivo: string;
  /** Ligado quando a pessoa quer trocar uma próxima ação futura que já existe. */
  atualizarProximaAcao: boolean;
  proximaAcao: { kind: TipoProximaAcao; label: string; at: string };
  /**
   * Campos exigidos pela etapa, indexados pela chave de `stages.required_fields`.
   *
   * O valor é `string | undefined` porque o react-hook-form mantém a chave no objeto
   * depois que o campo sai da tela (trocar de "Perdido" para "Contatado" desmonta o
   * seletor de motivo, mas `campos.lost_reason_id` continua ali, valendo `undefined`).
   * Se o schema exigisse `string`, esse resto invisível bloquearia o envio com um erro
   * pendurado num campo que ninguém está vendo.
   */
  campos: Record<string, string | undefined>;
};

/** A etapa de destino escolhida, ou `null` enquanto ninguém escolheu. */
export function etapaEscolhida(etapas: EtapaQuadro[], id: string): EtapaQuadro | null {
  return etapas.find((e) => String(e.id) === id) ?? null;
}

/** Campos que a etapa exige e que NÃO são o motivo de perda (esse tem tela própria). */
export function camposDaEtapa(etapa: EtapaQuadro) {
  return etapa.required_fields.filter(
    (c) => c.field !== CAMPO_MOTIVO_DE_PERDA && c.table !== 'lost_reasons',
  );
}

/**
 * A etapa marca reunião e, por isso, dispensa uma próxima ação digitada à parte.
 *
 * É a regra do banco: quando `required_fields` pede `meeting_at`, o `move_deal` usa
 * a data da reunião como próxima ação e cria a tarefa `kind = 'meeting'`. Pedir as
 * duas coisas na tela seria pedir a mesma data duas vezes.
 */
export function etapaMarcaReuniao(etapa: EtapaQuadro): boolean {
  return etapa.required_fields.some((c) => c.field === CAMPO_DATA_DA_REUNIAO);
}

/**
 * O negócio já tem uma próxima ação futura (hoje ou depois)?
 *
 * O `move_deal` aceita isso como satisfação do RF-FUN-03 — o requisito é "negócio
 * aberto sem próxima ação futura é destacado", não "digite de novo o que já está
 * marcado". A tela obedece à mesma leitura e oferece a troca como opção.
 */
export function jaTemProximaAcaoFutura(cartao: CartaoQuadro): boolean {
  return (
    !!cartao.next_action_at &&
    !!cartao.next_action &&
    (cartao.next_action_state === 'hoje' || cartao.next_action_state === 'agendada')
  );
}

/** A próxima ação é obrigatória para entrar nesta etapa? */
export function exigeProximaAcaoDigitada(etapa: EtapaQuadro, cartao: CartaoQuadro): boolean {
  return (
    etapaExigeProximaAcao(etapa) && !etapaMarcaReuniao(etapa) && !jaTemProximaAcaoFutura(cartao)
  );
}

/**
 * Schema do formulário. Depende das etapas do funil e do cartão porque as regras são
 * por etapa de destino (RF-FUN-04) e por estado do negócio (RF-FUN-03).
 */
export function criarSchemaMover(etapas: EtapaQuadro[], cartao: CartaoQuadro) {
  return z
    .object({
      etapaDestinoId: z.string({ error: 'Escolha para qual etapa o cartão vai.' }),
      motivo: z
        .string({ error: 'Escreva o motivo com letras.' })
        .max(300, { error: 'Deixe o motivo em até 300 caracteres.' }),
      atualizarProximaAcao: z.boolean({ error: 'Marque ou desmarque a troca da próxima ação.' }),
      proximaAcao: z.object({
        // `.catch`: o tipo vem de uma lista fechada na tela; valor fora dela é defeito
        // de programa, não erro de quem usa — cai no padrão em vez de virar mensagem.
        kind: tipoProximaAcaoSchema.catch('follow_up' as TipoProximaAcao),
        label: z.string({ error: 'Escreva a próxima ação.' }),
        at: z.string({ error: 'Escolha quando você vai fazer isso.' }),
      }),
      campos: z.record(
        z.string(),
        z.string({ error: 'Preencha este campo com texto.' }).optional(),
      ),
    })
    .superRefine((valores, ctx) => {
      const etapa = etapaEscolhida(etapas, valores.etapaDestinoId);
      if (!etapa) {
        ctx.addIssue({
          code: 'custom',
          path: ['etapaDestinoId'],
          message: 'Escolha para qual etapa o cartão vai.',
        });
        return;
      }

      // ---- campos obrigatórios da etapa (RF-FUN-04) ----
      for (const campo of camposDaEtapa(etapa)) {
        const valor = (valores.campos[campo.field] ?? '').trim();
        const caminho = ['campos', campo.field];

        if (!valor) {
          ctx.addIssue({
            code: 'custom',
            path: caminho,
            message:
              campo.field === CAMPO_DATA_DA_REUNIAO
                ? 'Escolha a data e a hora combinadas.'
                : `Preencha: ${campo.label.toLowerCase()}.`,
          });
          continue;
        }

        if (campo.type === 'timestamptz') {
          if (Number.isNaN(Date.parse(valor))) {
            ctx.addIssue({ code: 'custom', path: caminho, message: 'Data e hora inválidas.' });
          } else if (ehAntesDeHoje(valor)) {
            ctx.addIssue({
              code: 'custom',
              path: caminho,
              message: 'A data precisa ser de hoje em diante.',
            });
          }
          continue;
        }

        if (campo.type === 'enum' && !(campo.options ?? []).includes(valor)) {
          ctx.addIssue({ code: 'custom', path: caminho, message: 'Escolha uma opção da lista.' });
          continue;
        }

        // A evidência da autorização vira prova em `consent_events` (guardrail do
        // CLAUDE.md): "ok" não é evidência, e o contrato pede o texto literal.
        if (campo.field === CAMPO_EVIDENCIA && valor.length < MINIMO_DA_EVIDENCIA) {
          ctx.addIssue({
            code: 'custom',
            path: caminho,
            message: 'Escreva o que a pessoa disse, com data e canal (ao menos 10 letras).',
          });
        }
      }

      // ---- motivo da perda, da lista fechada (RF-FUN-04) ----
      if (etapaExigeMotivoDePerda(etapa) && !(valores.campos[CAMPO_MOTIVO_DE_PERDA] ?? '').trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['campos', CAMPO_MOTIVO_DE_PERDA],
          message: 'Escolha um motivo da lista para marcar como perdido.',
        });
      }

      // ---- próxima ação (RF-FUN-03) ----
      const obrigatoria = exigeProximaAcaoDigitada(etapa, cartao);
      if (!obrigatoria && !valores.atualizarProximaAcao) return;

      const texto = valores.proximaAcao.label.replace(/\s+/g, ' ').trim();
      if (texto.length < 3) {
        ctx.addIssue({
          code: 'custom',
          path: ['proximaAcao', 'label'],
          message: 'Escreva a próxima ação (ao menos 3 letras).',
        });
      } else if (texto.length > 120) {
        ctx.addIssue({
          code: 'custom',
          path: ['proximaAcao', 'label'],
          message: 'Deixe a próxima ação em até 120 caracteres.',
        });
      }

      if (!valores.proximaAcao.at) {
        ctx.addIssue({
          code: 'custom',
          path: ['proximaAcao', 'at'],
          message: 'Escolha quando você vai fazer isso.',
        });
      } else if (ehAntesDeHoje(valores.proximaAcao.at)) {
        ctx.addIssue({
          code: 'custom',
          path: ['proximaAcao', 'at'],
          message: 'A próxima ação precisa ter data de hoje em diante.',
        });
      }
    });
}

/**
 * Valores iniciais da folha.
 *
 * A próxima ação já nasce preenchida com o que o negócio tem, quando tem: reescrever
 * "Ligar para confirmar a reunião" a cada movimento é trabalho que a tela pode poupar.
 */
export function valoresIniciais(
  cartao: CartaoQuadro,
  etapaDestinoId: number | null,
  sugestaoDeData: string,
): FormularioMover {
  return {
    etapaDestinoId: etapaDestinoId ? String(etapaDestinoId) : '',
    motivo: '',
    atualizarProximaAcao: false,
    proximaAcao: {
      kind: 'follow_up',
      label: cartao.next_action ?? '',
      at: sugestaoDeData,
    },
    campos: {},
  };
}

/** Os campos da etapa, no formato que o `move_deal` espera em `p_fields`. */
function montarCampos(etapa: EtapaQuadro, campos: Record<string, string | undefined>): CamposEtapa {
  const saida: Record<string, string | number> = {};

  for (const campo of etapa.required_fields) {
    const valor = (campos[campo.field] ?? '').trim();
    if (!valor) continue;

    if (campo.field === CAMPO_MOTIVO_DE_PERDA || campo.table === 'lost_reasons') {
      const numero = Number.parseInt(valor, 10);
      if (Number.isFinite(numero)) saida[campo.field] = numero;
      continue;
    }

    if (campo.type === 'timestamptz') {
      const iso = entradaParaIso(valor);
      if (iso) saida[campo.field] = iso;
      continue;
    }

    saida[campo.field] = valor;
  }

  // Perda sem `lost_reason_id` declarado no catálogo: o banco exige do mesmo jeito
  // (o guardrail está no move_deal), então o valor escolhido segue junto.
  if (etapaExigeMotivoDePerda(etapa) && saida[CAMPO_MOTIVO_DE_PERDA] === undefined) {
    const numero = Number.parseInt((campos[CAMPO_MOTIVO_DE_PERDA] ?? '').trim(), 10);
    if (Number.isFinite(numero)) saida[CAMPO_MOTIVO_DE_PERDA] = numero;
  }

  return saida as CamposEtapa;
}

/** Traduz o formulário no pedido de `public.move_deal`. */
export function montarPedido(
  valores: FormularioMover,
  etapa: EtapaQuadro,
  cartao: CartaoQuadro,
  etapaAtualId: number,
): PedidoMover {
  const mandaProximaAcao = exigeProximaAcaoDigitada(etapa, cartao) || valores.atualizarProximaAcao;
  const quando = entradaParaIso(valores.proximaAcao.at);

  return {
    p_deal_id: cartao.deal_id,
    p_to_stage_id: etapa.id,
    // A guarda contra duas pessoas movendo o mesmo cartão (RF-FUN-01).
    p_expected_stage_id: etapaAtualId,
    p_reason: valores.motivo.trim() || null,
    p_fields: montarCampos(etapa, valores.campos),
    p_next_action:
      mandaProximaAcao && quando
        ? {
            kind: valores.proximaAcao.kind,
            label: valores.proximaAcao.label.replace(/\s+/g, ' ').trim(),
            at: quando,
          }
        : null,
  };
}

/**
 * Frase que explica o movimento antes de confirmar, para a folha não ser só campos.
 * Etapa de saída fecha o negócio; etapa de trabalho continua a conversa.
 */
export function resumoDoMovimento(etapa: EtapaQuadro): string {
  if (etapa.is_optout) {
    return 'Isto registra um opt-out: o número entra na lista de supressão e ninguém mais manda mensagem para ele.';
  }
  if (etapa.is_lost) return 'O negócio é encerrado como perdido e sai da fila de trabalho.';
  if (etapa.is_won) return 'O negócio é encerrado como ganho.';
  if (etapa.is_dormant) return 'O negócio sai da fila e volta a ser trabalhado na nutrição.';
  return 'O negócio continua aberto e precisa de uma próxima ação marcada.';
}

/** Quantos campos ainda faltam nesta etapa — usado para habilitar o botão. */
export function quantosCamposFaltam(
  etapa: EtapaQuadro,
  campos: Record<string, string | undefined>,
): number {
  return camposFaltando(etapa, campos).length;
}

/** Etapa de saída rotulada para a lista de destinos (a folha agrupa trabalho × saída). */
export function grupoDaEtapa(etapa: EtapaQuadro): 'trabalho' | 'saida' {
  return etapaEhDeSaida(etapa) ? 'saida' : 'trabalho';
}
