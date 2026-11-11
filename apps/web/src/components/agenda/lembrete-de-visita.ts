/**
 * O selo do lembrete da visita (11/11/2026, só na Imova: `EMPRESA.modulos.lembreteDeVisita`).
 *
 * Pedido do usuário: "Mandar um lembrete pelo WhatsApp na véspera, com botões
 * 'Confirmo' e 'Preciso remarcar'." O banco manda o lembrete e grava o toque do
 * cliente em `public.visita_lembretes` (migração 20261111206000), uma linha por
 * visita e horário. Esta regra decide o selo do cartão da Agenda e da agenda do
 * Meu dia: "Cliente confirmou" ou "Pediu para remarcar".
 *
 * O SELO É DO HORÁRIO, NÃO DA VISITA. Remarcou a visita, a resposta ao lembrete
 * da hora velha deixa de valer: o cliente confirmou as 14h, não as 15h30. Por
 * isso a comparação é pelo instante (`marcada_para` contra o `due_at` de agora),
 * e não pela tarefa. A comparação é numérica: o banco devolve `+00:00` e outros
 * lugares da tela escrevem `-03:00`.
 */

export type RespostaDoLembrete = 'confirmou' | 'remarcar';

/** O que a tela lê de `visita_lembretes`. */
export type LinhaDoLembrete = {
  task_id: string;
  marcada_para: string;
  resposta: string | null;
};

export const ROTULO_DA_RESPOSTA: Record<RespostaDoLembrete, string> = {
  confirmou: 'Cliente confirmou',
  remarcar: 'Pediu para remarcar',
};

function ehResposta(valor: string | null): valor is RespostaDoLembrete {
  return valor === 'confirmou' || valor === 'remarcar';
}

/**
 * A resposta que vale para a visita no horário em que ela está agora. Nula sem
 * lembrete, sem resposta, ou quando a resposta é de um horário que já mudou.
 */
export function respostaDoLembrete(
  quando: string,
  linhas: readonly Pick<LinhaDoLembrete, 'marcada_para' | 'resposta'>[],
): RespostaDoLembrete | null {
  const alvo = Date.parse(quando);
  if (Number.isNaN(alvo)) return null;
  for (const linha of linhas) {
    if (Date.parse(linha.marcada_para) === alvo && ehResposta(linha.resposta)) {
      return linha.resposta;
    }
  }
  return null;
}

/** As linhas agrupadas pela tarefa, para cada cartão achar as suas. */
export function lembretesPorTarefa(
  linhas: readonly LinhaDoLembrete[],
): Map<string, LinhaDoLembrete[]> {
  const porTarefa = new Map<string, LinhaDoLembrete[]>();
  for (const linha of linhas) {
    const lista = porTarefa.get(linha.task_id) ?? [];
    lista.push(linha);
    porTarefa.set(linha.task_id, lista);
  }
  return porTarefa;
}
