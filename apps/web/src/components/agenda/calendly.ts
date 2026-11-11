import { isAppRole, ROTULO_PAPEL } from '@/lib/auth/role';

import { diaDoInstante, rotuloDiaCurto } from './tipos';

/**
 * As regras puras das duas partes da Agenda que dependem do banco do Calendly (só
 * na Imova, módulo `calendly`; migração 20261111204000):
 *
 * 1. O AVISO DO CANCELAMENTO QUE FALHOU. O CRM pede ao Calendly que cancele o
 *    agendamento recusado (horário ocupado, sábado, domingo, feriado) e o que a
 *    equipe desmarcou. Se o Calendly não aceita (token vencido, por exemplo), o
 *    worker tenta 8 vezes e para; o cliente continua com o horário confirmado lá.
 *    `public.calendly_cancelamentos_que_falharam()` devolve esses casos ao dono do
 *    agendamento e aos admins, e o aviso fica na Agenda até alguém marcar como
 *    resolvido (ou até o Calendly avisar que cancelou).
 *
 * 2. "QUEM ATENDE O QUE CHEGA PELO CALENDLY" (só admin): a pessoa em cuja agenda o
 *    agendamento entra, e que fica de responsável pela ficha e pelo negócio. Sem
 *    escolha, vale o anfitrião do Calendly (a conta é do Rafael).
 */

// ---------------------------------------------------------------------------
// 1. O cancelamento que falhou
// ---------------------------------------------------------------------------

export type FalhaNoCalendly = {
  id: string;
  cliente: string | null;
  natureza: 'reuniao' | 'visita';
  inicio: string | null;
  erro: string | null;
  donoId: string | null;
  donoNome: string | null;
  organizationId: string | null;
};

/** Onde a pessoa cancela à mão: a lista de agendamentos da conta no Calendly. */
export const AGENDADOS_NO_CALENDLY = 'https://calendly.com/app/scheduled_events/user/me';

const HORA_E_MINUTO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "10h" na hora cheia, "10h30" no resto, no relógio de Natal. */
export function horaCurta(iso: string): string {
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return '';
  const partes = HORA_E_MINUTO.formatToParts(quando);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '0');
  const minuto = partes.find((p) => p.type === 'minute')?.value ?? '00';
  return minuto === '00' ? `${hora}h` : `${hora}h${minuto}`;
}

/**
 * "Não consegui cancelar no Calendly o agendamento de Maria, de 20/11 às 10h.
 * Cancele lá e avise o cliente." — a frase pedida em 11/11/2026, em primeira pessoa
 * porque é o CRM falando, como nos outros avisos.
 */
export function fraseDaFalha(falha: Pick<FalhaNoCalendly, 'cliente' | 'inicio'>): string {
  const quem = falha.cliente?.trim() || 'um cliente';
  const quando = falha.inicio
    ? `, de ${rotuloDiaCurto(diaDoInstante(falha.inicio))} às ${horaCurta(falha.inicio)}`
    : '';
  return `Não consegui cancelar no Calendly o agendamento de ${quem}${quando}. Cancele lá e avise o cliente.`;
}

/** Para o admin, que vê o de todo mundo: de quem é a agenda, quando não é a dele. */
export function deQuemEhAAgenda(
  falha: Pick<FalhaNoCalendly, 'donoId' | 'donoNome'>,
  usuarioId: string,
): string | null {
  if (!falha.donoId || falha.donoId === usuarioId) return null;
  return falha.donoNome ? `Agenda de ${falha.donoNome}` : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

/** As linhas da função do banco, conferidas uma a uma (linha estranha fica de fora). */
export function lerFalhas(linhas: unknown): FalhaNoCalendly[] {
  if (!Array.isArray(linhas)) return [];
  return linhas.flatMap((linha): FalhaNoCalendly[] => {
    if (typeof linha !== 'object' || linha === null) return [];
    const l = linha as Record<string, unknown>;
    const id = texto(l.id);
    if (!id) return [];
    return [
      {
        id,
        cliente: texto(l.cliente),
        natureza: l.natureza === 'visita' ? 'visita' : 'reuniao',
        inicio: texto(l.inicio),
        erro: texto(l.erro),
        donoId: texto(l.dono_id),
        donoNome: texto(l.dono_nome),
        organizationId: texto(l.organization_id),
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// 2. Quem atende o que chega pelo Calendly
// ---------------------------------------------------------------------------

export type PessoaQueAtende = { id: string; nome: string; papel: string };

export type QuemAtende = {
  /** A pessoa escolhida; nulo = o padrão (o anfitrião do Calendly). */
  pessoaId: string | null;
  /** O e-mail gravado que não é de ninguém ativo: a tela avisa que vale o padrão. */
  emailSemPessoa: string | null;
  /** Quem recebeu o último agendamento: diz quem é o "padrão" hoje. */
  ultimoDonoNome: string | null;
  pessoas: PessoaQueAtende[];
};

/** O valor do seletor para "sem escolha" (o seletor não aceita valor vazio). */
export const SEM_ESCOLHA = 'padrao';

export function lerQuemAtende(valor: unknown): QuemAtende {
  const v = (typeof valor === 'object' && valor !== null ? valor : {}) as Record<string, unknown>;
  const pessoas = Array.isArray(v.pessoas)
    ? v.pessoas.flatMap((p): PessoaQueAtende[] => {
        if (typeof p !== 'object' || p === null) return [];
        const pessoa = p as Record<string, unknown>;
        const id = texto(pessoa.id);
        return id
          ? [{ id, nome: texto(pessoa.nome) ?? 'Sem nome', papel: texto(pessoa.papel) ?? '' }]
          : [];
      })
    : [];
  return {
    pessoaId: texto(v.pessoa_id),
    emailSemPessoa: texto(v.email_sem_pessoa),
    ultimoDonoNome: texto(v.ultimo_dono_nome),
    pessoas,
  };
}

/** "O dono da conta do Calendly (hoje, Rafael)". */
export function rotuloDoPadrao(quem: Pick<QuemAtende, 'ultimoDonoNome'>): string {
  return quem.ultimoDonoNome
    ? `O dono da conta do Calendly (hoje, ${quem.ultimoDonoNome})`
    : 'O dono da conta do Calendly';
}

/** "Caio · SDR", para a lista de escolha. */
export function rotuloDaPessoa(pessoa: PessoaQueAtende): string {
  return isAppRole(pessoa.papel) ? `${pessoa.nome} · ${ROTULO_PAPEL[pessoa.papel]}` : pessoa.nome;
}

/** O que a tela diz embaixo do campo, conforme a escolha. */
export function explicacaoDaEscolha(quem: QuemAtende): string {
  const escolhida = quem.pessoas.find((p) => p.id === quem.pessoaId);
  if (escolhida) {
    return `O que o cliente marca pelo link entra na agenda de ${escolhida.nome}, e a ficha e o negócio novos ficam com ${escolhida.nome} como responsável. É também a agenda que o CRM copia no Google para o Calendly esconder os horários ocupados.`;
  }
  if (quem.emailSemPessoa) {
    return `O e-mail gravado (${quem.emailSemPessoa}) não é de ninguém ativo no CRM, então vale o dono da conta do Calendly. Escolha uma pessoa.`;
  }
  return 'Sem escolha, o agendamento entra na agenda do dono da conta do Calendly, que fica como responsável pela ficha e pelo negócio novos.';
}

/** O recado da recusa do banco, para o aviso da tela. */
export function erroAoGravarQuemAtende(codigo: string | undefined): string {
  if (codigo === '42501') return 'Só um admin escolhe quem atende o que chega pelo Calendly.';
  if (codigo === '22023') return 'Essa pessoa não está ativa na equipe. Escolha outra.';
  return 'Não deu para gravar agora. Confira a conexão e tente de novo.';
}
