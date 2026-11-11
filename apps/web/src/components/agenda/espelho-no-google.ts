/**
 * O espelho no Google, em linguagem de gente (11/11/2026, só na Imova).
 *
 * O gargalo: o que a equipe marca no CRM continuava livre no Calendly, porque o
 * espelho (o bloco "Ocupado" no Google Agenda que o Calendly confere) estava
 * desligado e ninguém via. `public.agenda_espelho_estado()` (só admin e gestor)
 * conta como ele está; esta regra pura escolhe a frase do cartão
 * (`espelho-no-google.tsx`), na ordem do que mais pede ação:
 *
 *   1. "Espelho no Google desligado: falta o id da agenda";
 *   2. "Com erro desde 10/11 15h: a agenda recusou (403). Rode a conferência";
 *   3. o id está lá, mas o worker não passa (a chave saiu do Fly, ou ele caiu);
 *   4. "Ligado: 12 horários copiados, o último às 14h10".
 *
 * Fica separada do componente para ser testada sem DOM.
 */
import { EMPRESA } from '@/lib/empresa';

import { diaDoInstante, horaEmNatal, rotuloDiaCurto } from './tipos';

/**
 * O cartão só existe na Imova: a função do banco só é criada lá (na KOMUNE não
 * há Calendly). Usa a mesma chave do resto da tela do Calendly.
 */
export const ESPELHO_NA_EMPRESA: boolean = EMPRESA.modulos.calendly;

export const CHAVE_DO_ESPELHO = ['agenda', 'espelho-no-google'] as const;

/** O que `public.agenda_espelho_estado()` devolve, já conferido. */
export type EstadoDoEspelho = {
  idPreenchido: boolean;
  workerPassando: boolean;
  workerPassouEm: string | null;
  pessoa: string | null;
  pendentes: number;
  gravados: number;
  feriados: number;
  comErro: number;
  ultimoGravadoEm: string | null;
  ultimoErro: { erro: string; em: string | null; desde: string | null; ativo: boolean } | null;
};

export type Tom = 'desligado' | 'erro' | 'parado' | 'ligado';

export type FraseDoEspelho = {
  tom: Tom;
  titulo: string;
  /** Uma frase a mais: o efeito para o cliente, ou o que fazer. */
  detalhe: string | null;
  /** O comando que o dono roda, quando há o que conferir. */
  comando: string | null;
};

export const COMANDO_DA_CONFERENCIA =
  'node scripts/google-agenda-conferir.mjs ~/Downloads/crm-imova-agenda-XXXX.json';

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function numero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Lê a resposta do banco sem confiar na forma. Devolve null se não for um estado. */
export function lerEstadoDoEspelho(valor: unknown): EstadoDoEspelho | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null;
  const v = valor as Record<string, unknown>;
  if (typeof v.google_agenda_id_preenchido !== 'boolean') return null;
  const pessoa = v.pessoa as Record<string, unknown> | null | undefined;
  const erro = v.ultimo_erro as Record<string, unknown> | null | undefined;
  return {
    idPreenchido: v.google_agenda_id_preenchido,
    workerPassando: v.worker_passando === true,
    workerPassouEm: texto(v.worker_passou_em),
    pessoa: pessoa && typeof pessoa === 'object' ? texto(pessoa.nome) : null,
    pendentes: numero(v.pendentes),
    gravados: numero(v.gravados),
    feriados: numero(v.feriados),
    comErro: numero(v.com_erro),
    ultimoGravadoEm: texto(v.ultimo_gravado_em),
    ultimoErro:
      erro && typeof erro === 'object' && texto(erro.erro)
        ? {
            erro: texto(erro.erro) ?? '',
            em: texto(erro.em),
            desde: texto(erro.desde),
            ativo: erro.ativo === true,
          }
        : null,
  };
}

/** "14h10", "15h": a hora em Natal, do jeito que se fala. */
export function horaFalada(iso: string): string {
  const hhmm = horaEmNatal(iso);
  const [h = '--', m = '--'] = hhmm.split(':');
  return m === '00' ? `${h}h` : `${h}h${m}`;
}

/** "às 14h10" hoje; "em 10/11 às 14h10" noutro dia. */
function quando(iso: string, agora: Date): string {
  const dia = diaDoInstante(iso);
  return dia === diaDoInstante(agora.toISOString())
    ? `às ${horaFalada(iso)}`
    : `em ${rotuloDiaCurto(dia)} às ${horaFalada(iso)}`;
}

/** "10/11 15h": o dia e a hora, sempre com o dia. */
function diaEHora(iso: string): string {
  return `${rotuloDiaCurto(diaDoInstante(iso))} ${horaFalada(iso)}`;
}

/** O erro do Google em poucas palavras ("a agenda recusou (403)"). */
export function motivoDoErro(erro: string): string {
  const status = /Google (\d{3})/.exec(erro)?.[1];
  if (/não deu o token/i.test(erro)) {
    const s = /\((\d{3})\)/.exec(erro)?.[1];
    return `o Google não deu a permissão${s ? ` (${s})` : ''}`;
  }
  if (status === '403') return 'a agenda recusou (403)';
  if (status === '404') return 'a agenda não foi achada (404)';
  if (status === '401') return 'o Google recusou o acesso (401)';
  if (status === '429') return 'o Google pediu para esperar (429)';
  if (status && status.startsWith('5')) return `o Google ficou fora do ar (${status})`;
  if (status) return `o Google respondeu ${status}`;
  return 'o Google não respondeu';
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** A frase do cartão. Pura: o relógio entra por parâmetro. */
export function fraseDoEspelho(e: EstadoDoEspelho, agora: Date): FraseDoEspelho {
  if (!e.idPreenchido) {
    return {
      tom: 'desligado',
      titulo: 'Espelho no Google desligado: falta o id da agenda',
      detalhe:
        'Até ligar, o Calendly oferece os horários que a equipe ocupa no CRM (e os feriados): o cliente escolhe, recebe "confirmado" e, segundos depois, "cancelado". Passo a passo no guia do Calendly.',
      comando: COMANDO_DA_CONFERENCIA,
    };
  }

  if (e.comErro > 0 && e.ultimoErro?.ativo) {
    const desde = e.ultimoErro.desde ?? e.ultimoErro.em;
    return {
      tom: 'erro',
      titulo: `${desde ? `Com erro desde ${diaEHora(desde)}` : 'Com erro'}: ${motivoDoErro(
        e.ultimoErro.erro,
      )}. Rode a conferência`,
      detalhe: `${plural(e.comErro, 'horário não foi copiado', 'horários não foram copiados')} para o Google, e o Calendly ainda os oferece.`,
      comando: COMANDO_DA_CONFERENCIA,
    };
  }

  if (!e.workerPassando) {
    return {
      tom: 'parado',
      titulo: e.workerPassouEm
        ? `Espelho parado: o worker não passa desde ${diaEHora(e.workerPassouEm)}`
        : 'Espelho parado: o worker ainda não passou por aqui',
      detalhe:
        'O id da agenda está gravado, mas nada vai ao Google. Confira GOOGLE_AGENDA_CREDENCIAL no imova-worker-wa e se ele está no ar.',
      comando: null,
    };
  }

  const copiados =
    e.gravados === 0 && e.feriados === 0
      ? 'nada copiado ainda'
      : `${plural(e.gravados, 'horário copiado', 'horários copiados')}${
          e.feriados > 0 ? ` e ${plural(e.feriados, 'feriado', 'feriados')}` : ''
        }`;
  const ultimo = e.ultimoGravadoEm ? `, o último ${quando(e.ultimoGravadoEm, agora)}` : '';
  const partes = [
    e.pessoa
      ? `A agenda de ${e.pessoa} está no Google.`
      : 'Ninguém atende pelo Calendly ainda: só os feriados vão ao Google.',
    e.pendentes > 0 ? `${plural(e.pendentes, 'item', 'itens')} na fila.` : null,
  ].filter(Boolean);
  return {
    tom: 'ligado',
    titulo: `Ligado: ${copiados}${ultimo}`,
    detalhe: partes.join(' '),
    comando: null,
  };
}
