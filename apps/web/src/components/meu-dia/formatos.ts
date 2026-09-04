import { TIMEZONE } from '@komune/schema';

import { diasDeDiferenca } from '@/components/parceiros/formatos';

import type { ItemDoDia } from './tipos';

/**
 * Tudo o que esta tela escreve sobre tempo passa por aqui, e tudo em
 * `America/Fortaleza`: o aparelho da Heloísa pode estar em qualquer fuso, mas o dia
 * de trabalho é o de Natal. A separação em `prefixo`/`numero`/`sufixo` existe pela
 * regra tipográfica do sistema — só o dígito recebe a IBM Plex Mono; preposição e
 * unidade continuam em Poppins.
 */

const HORA = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TIMEZONE,
});

const DIA_E_MES = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: TIMEZONE,
});

const DIA_POR_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: TIMEZONE,
});

const DATA_COMPLETA = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TIMEZONE,
});

/** A hora civil em Natal, 0 a 23, do instante dado. */
function horaEmFortaleza(quando: Date): number {
  const partes = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: TIMEZONE,
  }).format(quando);
  return Number.parseInt(partes, 10);
}

/**
 * A saudação certa para a hora de Natal. A madrugada volta a ser "boa noite": às
 * 00:30 ninguém diz bom dia, e a Heloísa às vezes abre o CRM tarde para deixar o dia
 * seguinte pronto.
 */
export function saudacaoDoDia(agora: Date): string {
  const hora = horaEmFortaleza(agora);
  if (hora < 5) return 'Boa noite';
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** "quinta-feira, 4 de setembro" — com maiúscula, porque abre a linha. */
export function dataPorExtenso(agora: Date): string {
  const texto = DIA_POR_EXTENSO.format(agora);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** O primeiro nome, que é como o time se chama. Vazio vira string vazia, não "undefined". */
export function primeiroNome(nome: string | null | undefined): string {
  const limpo = (nome ?? '').trim();
  if (!limpo) return '';
  return limpo.split(/\s+/)[0] ?? '';
}

export type QuandoFormatado = {
  prefixo: string;
  /** A parte que vai em IBM Plex Mono. Nulo quando a frase não tem número. */
  numero: string | null;
  sufixo: string;
  /** `true` quando já venceu: o texto ganha peso e deixa de ser cinza. */
  atencao: boolean;
  /** Data e hora por extenso, para o `title` e para o leitor de tela. */
  detalhe: string;
};

/**
 * Quanto tempo falta, ou há quanto tempo passou.
 *
 * O atraso vem calculado do banco (`atraso_horas`), então a fila e o relatório nunca
 * discordam sobre há quanto tempo uma tarefa está vencida. O que sobra para o
 * navegador é a distância em DIAS até um compromisso futuro, que depende só do
 * calendário.
 */
export function formatarQuando(item: ItemDoDia, agora: Date = new Date()): QuandoFormatado {
  const detalhe = item.quando ? DATA_COMPLETA.format(new Date(item.quando)) : 'Sem prazo definido.';

  const atraso = item.atrasoHoras;
  if (atraso !== null && atraso > 0) {
    if (atraso < 1) {
      const minutos = Math.max(1, Math.round(atraso * 60));
      return { prefixo: 'há ', numero: String(minutos), sufixo: ' min', atencao: true, detalhe };
    }
    if (atraso < 24) {
      return {
        prefixo: 'há ',
        numero: String(Math.round(atraso)),
        sufixo: ' h',
        atencao: true,
        detalhe,
      };
    }
    return {
      prefixo: 'há ',
      numero: String(Math.floor(atraso / 24)),
      sufixo: ' d',
      atencao: true,
      detalhe,
    };
  }

  if (!item.quando) {
    return { prefixo: 'sem prazo', numero: null, sufixo: '', atencao: false, detalhe };
  }

  const alvo = new Date(item.quando);
  const dias = diasDeDiferenca(agora, alvo);

  if (dias === 0) {
    return {
      prefixo: '',
      numero: HORA.format(alvo),
      sufixo: '',
      // Reunião ou visita em menos de três horas é o único item futuro que já pede
      // ação: sair de casa. Ele vem com prioridade 1 e o horário sai em destaque.
      atencao: item.tipo === 'reuniao_proxima',
      detalhe,
    };
  }
  if (dias === 1) {
    return { prefixo: 'amanhã', numero: null, sufixo: '', atencao: false, detalhe };
  }
  return { prefixo: '', numero: DIA_E_MES.format(alvo), sufixo: '', atencao: false, detalhe };
}

/** A mesma frase em texto corrido, para `aria-label` e `title`. */
export function quandoEmTexto(quando: QuandoFormatado): string {
  return `${quando.prefixo}${quando.numero ?? ''}${quando.sufixo}`.trim();
}
