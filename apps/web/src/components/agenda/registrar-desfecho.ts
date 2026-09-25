'use client';

import { carregarAlvo } from '@/components/registro/alvos';
import { type ValoresExtras } from '@/components/registro/folha-extra';
import { formatarQuando } from '@/components/registro/formatos';
import {
  ErroDeRegistro,
  fraseDaRecusa,
  gravarRegistro,
  montarRegistro,
} from '@/components/registro/gravar';
import {
  comQuemPadrao,
  preverRegistro,
  type DesfechoCatalogo,
  type EtapaAlvo,
  type Feriado,
} from '@/components/registro/tipos';

import { concluirCompromisso, fecharReuniao } from './consultas';
import { type Compromisso } from './tipos';

/**
 * O desfecho de um compromisso, pelo caminho que já existe.
 *
 * "Realizada", "Não compareceu" e "Reagendar" não são três funções novas: são três
 * recortes do catálogo `public.interaction_outcomes` (`reu_interessado`,
 * `reu_no_show`, `reu_reagendada`…), gravados pela mesma `public.registrar_contato`
 * que a tela de campo usa. Quem move etapa, temperatura, porta e próxima ação
 * continua sendo o Postgres; a Agenda só escolhe o desfecho e passa o alvo.
 *
 * Este arquivo é casca fina de propósito: hidrata o alvo com `carregarAlvo`
 * (o mesmo de `components/registro`), calcula a previsão com `preverRegistro`, monta
 * o pedido com `montarRegistro` e grava com `gravarRegistro`. Zero regra própria.
 */

export type ResultadoDoDesfecho = {
  ok: boolean;
  /** Frase pronta para o toast, sempre em português. */
  frase: string;
  /** `false` quando o registro entrou mas a tarefa do compromisso não fechou. */
  compromissoFechado: boolean;
  /**
   * Recado sobre a REUNIÃO, quando o desfecho não conseguiu fechá-la.
   *
   * O campo `avisoDaAgenda` existia porque o evento do Google podia ficar para
   * trás. O Google saiu; a falha não. Agora ela é nossa e é pior: uma reunião
   * que não foi fechada continua VIVA em `public.reunioes` — segurando o
   * horário na trava de colisão e contando no teto de 4 do dia. Apagar o campo
   * seria trocar um aviso visível por um horário que some da grade sem ninguém
   * saber por quê.
   */
  avisoDaReuniao: string | null;
};

export async function registrarDesfechoDoCompromisso(entrada: {
  compromisso: Compromisso;
  desfecho: DesfechoCatalogo;
  extras: ValoresExtras;
  etapasAlvo: readonly EtapaAlvo[];
  feriados: readonly Feriado[];
}): Promise<ResultadoDoDesfecho> {
  const { compromisso, desfecho, extras } = entrada;

  const alvo = await carregarAlvo(compromisso.organizationId);
  if (!alvo) {
    return {
      ok: false,
      frase: 'Não achei este parceiro na base. Recarregue a agenda e tente de novo.',
      compromissoFechado: false,
      avisoDaReuniao: null,
    };
  }

  // Agora, e não a hora do compromisso: a régua da próxima ação conta a partir do
  // instante do registro, e datar no passado faria o `move_deal` recusar a tarefa que
  // ele mesmo cria (`proxima_acao_no_passado`).
  const ocorridoEm = new Date();
  const comQuem = comQuemPadrao(desfecho);
  const superficie = compromisso.tipo === 'visita' ? ('visita' as const) : ('reuniao' as const);

  const base = preverRegistro(desfecho, {
    ocorridoEm,
    comQuem,
    temperaturaAtual: alvo.temperatura,
    etapasAlvo: entrada.etapasAlvo,
    pipelineId: alvo.pipelineId,
    feriados: entrada.feriados,
  });

  /**
   * A data combinada É a próxima ação, como em `components/registro/tela-registro`.
   *
   * Sem isto, `registrar_contato` cai na régua genérica do catálogo (D+1 para quente)
   * e o `move_deal` acaba criando DUAS tarefas: a do compromisso, na hora combinada,
   * e um "Reunião na data" no dia seguinte. Medido no banco local. A agenda tem de
   * mandar exatamente o que a tela de campo manda.
   */
  const combinada = extras.proximaAcaoEm ?? extras.reuniaoEm;
  const previsao = combinada ? { ...base, proximaAcaoEm: combinada } : base;

  try {
    const registro = montarRegistro({
      alvo,
      desfecho,
      superficie,
      comQuem,
      ocorridoEm,
      previsao,
      lostReasonId: extras.lostReasonId,
      reuniaoEm: extras.reuniaoEm,
      reuniaoFormato: extras.reuniaoFormato,
      autorizacaoEvidencia: extras.autorizacaoEvidencia,
      confirmouOptout: extras.confirmouOptout,
    });

    const resultado = await gravarRegistro(registro);
    if (!resultado.registrado) {
      return {
        ok: false,
        frase: fraseDaRecusa(resultado),
        compromissoFechado: false,
        avisoDaReuniao: null,
      };
    }

    const fechou = await concluirCompromisso(compromisso.taskId);

    /**
     * A REUNIÃO também fecha.
     *
     * Sem isto, `realizada` e `nao_compareceu` são estados que o CHECK aceita e
     * que ninguém nunca escreve: a tarefa fecha e a linha em `reunioes` fica
     * `marcada` para sempre, segurando o horário na trava de colisão, contando
     * no teto de 4 do dia e aparecendo na Agenda como compromisso vivo de uma
     * semana atrás.
     *
     * Quem diz qual dos dois estados é o próprio catálogo: `ninguem` em
     * `COM_QUEM_AFIRMADO_PELO_DESFECHO` quer dizer que não havia ninguém do
     * outro lado. O resto da superfície é reunião que aconteceu.
     *
     * "Reagendada" não chega aqui para compromisso COM reunião:
     * `recortesDoCompromisso` já não a oferece, e remarcar é o botão do cartão
     * (`public.reuniao_remarcar`), que move a linha e o eco juntos.
     *
     * Falhar aqui NÃO desfaz nada — o registro está gravado.
     */
    let avisoDaReuniao: string | null = null;
    if (compromisso.reuniaoId) {
      const fechouReuniao = await fecharReuniao(
        compromisso.reuniaoId,
        comQuem === 'ninguem' ? 'nao_compareceu' : 'realizada',
      );
      if (!fechouReuniao) {
        avisoDaReuniao =
          'O registro entrou, mas a reunião continua aberta na agenda: o horário segue ocupado. Feche-a pelo cartão.';
      }
    }

    return {
      ok: true,
      frase: fraseDoRegistro(compromisso, resultado),
      compromissoFechado: fechou,
      avisoDaReuniao,
    };
  } catch (erro) {
    if (erro instanceof ErroDeRegistro) {
      return { ok: false, frase: erro.message, compromissoFechado: false, avisoDaReuniao: null };
    }
    // ZodError de campo obrigatório que a folha deixou passar, ou defeito de programa.
    console.error('agenda: falha ao registrar o desfecho', erro);
    return {
      ok: false,
      frase: 'Faltou algum campo obrigatório deste resultado. Confira e tente de novo.',
      compromissoFechado: false,
      avisoDaReuniao: null,
    };
  }
}

/** O que o toast diz. A autoridade é a resposta do banco, nunca a previsão da tela. */
function fraseDoRegistro(
  compromisso: Compromisso,
  resultado: Extract<Awaited<ReturnType<typeof gravarRegistro>>, { registrado: true }>,
): string {
  const partes: string[] = ['Registrado.'];

  if (resultado.etapa_aplicada && resultado.etapa_depois) {
    partes.push(`${compromisso.organizacao} está em "${resultado.etapa_depois}".`);
  } else if (resultado.etapa_recusa === 'etapa_fora_do_funil') {
    partes.push('Este funil não tem a etapa deste resultado, então a etapa não mudou.');
  } else if (resultado.etapa_recusa === 'etapa_mudou') {
    partes.push('Alguém mexeu na etapa antes de você; confira o funil.');
  } else if (resultado.sem_negocio) {
    partes.push('Este parceiro não está em funil nenhum: ficou só a atividade.');
  }

  const quando = formatarQuando(resultado.proxima_acao_em);
  if (resultado.proxima_acao_titulo && quando) {
    // A data primeiro: metade dos rótulos do catálogo já termina em "hoje" ou "D+3",
    // e "Pedir autorização hoje, hoje, 16:52" é a frase que sai da ordem inversa.
    partes.push(`Próxima ação ${quando}: ${resultado.proxima_acao_titulo}.`);
  }

  return partes.join(' ');
}
