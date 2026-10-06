import { ROTULOS_RESULTADO_TECNICO, type ResultadoTecnico } from '@/components/ligacao/tipos';
import { ROTULOS_COM_QUEM } from '@/components/registro/tipos';

import type { LigacaoDoDia, PessoaDoDia, ResultadoDoDia } from './tipos';

/**
 * Como os números do dia de quem ligou viram texto.
 *
 * Tudo aqui é função pura, de propósito: é a parte da tela que decide o que a
 * gestão LÊ num relatório que serve para conferir diária, e por isso é a parte
 * com teste (`formatos.test.ts`).
 */

const FUSO = 'America/Fortaleza';

const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "10:05", no relógio de Natal — nunca no do aparelho. */
export function horaDe(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const quando = new Date(iso);
  return Number.isNaN(quando.getTime()) ? null : HORA.format(quando);
}

/**
 * Tempo falado, por extenso e curto: "45 s", "3 min 20 s", "1 h 12 min".
 *
 * Segundos aparecem enquanto a conta é de minutos, porque é ali que 40 s fazem
 * diferença (uma ligação de 50 s não é uma de 1 min 50 s). Acima de uma hora
 * eles são ruído.
 */
export function duracao(segundos: number | null | undefined): string {
  const total = Math.max(0, Math.round(segundos ?? 0));
  if (total < 60) return `${total} s`;
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = total % 60;
  if (horas > 0) return minutos > 0 ? `${horas} h ${minutos} min` : `${horas} h`;
  return resto > 0 ? `${minutos} min ${resto} s` : `${minutos} min`;
}

/** A duração de UMA ligação. Quem não atendeu não tem duração: travessão, e não "0 s". */
export function duracaoDaLigacao(ligacao: Pick<LigacaoDoDia, 'duracao_seg' | 'resultado'>): string {
  if (ligacao.resultado !== 'atendida_humano') return '—';
  return duracao(ligacao.duracao_seg);
}

/** De cada 100 ligações, quantas atenderam. `null` quando ninguém ligou. */
export function taxaDeAtendimento(
  pessoa: Pick<PessoaDoDia, 'ligacoes' | 'atendidas'>,
): number | null {
  if (pessoa.ligacoes <= 0) return null;
  return Math.round((pessoa.atendidas * 100) / pessoa.ligacoes);
}

/** "das 10:00 às 16:42"; uma ligação só é "às 10:00"; nenhuma, `null`. */
export function jornada(pessoa: Pick<PessoaDoDia, 'primeira_em' | 'ultima_em'>): string | null {
  const primeira = horaDe(pessoa.primeira_em);
  const ultima = horaDe(pessoa.ultima_em);
  if (!primeira) return null;
  if (!ultima || ultima === primeira) return `às ${primeira}`;
  return `das ${primeira} às ${ultima}`;
}

const ROTULOS_FORA_DO_CATALOGO: Readonly<Record<string, string>> = {
  sem_resultado: 'Sem resultado',
  atendida_sem_desfecho: 'Atendeu, sem desfecho',
};

function rotuloTecnico(chave: string): string | null {
  return chave in ROTULOS_RESULTADO_TECNICO
    ? ROTULOS_RESULTADO_TECNICO[chave as ResultadoTecnico]
    : null;
}

/** O nome de uma linha do "como terminou": o desfecho do catálogo ou o resultado da linha. */
export function rotuloDoResultado(resultado: Pick<ResultadoDoDia, 'chave' | 'nome'>): string {
  return (
    resultado.nome ??
    ROTULOS_FORA_DO_CATALOGO[resultado.chave] ??
    rotuloTecnico(resultado.chave) ??
    resultado.chave
  );
}

/** Como terminou UMA ligação, com as mesmas palavras do resumo. */
export function resultadoDaLigacao(
  ligacao: Pick<LigacaoDoDia, 'resultado' | 'desfecho_nome'>,
): string {
  if (ligacao.resultado === null) return 'Sem resultado';
  if (ligacao.resultado === 'atendida_humano') {
    return ligacao.desfecho_nome ?? 'Atendeu, sem desfecho';
  }
  return rotuloTecnico(ligacao.resultado) ?? ligacao.resultado;
}

/** "Não informado" não é informação: some da linha em vez de ocupar a coluna. */
export function comQuemFalou(valor: string | null | undefined): string | null {
  if (!valor || valor === 'nao_informado') return null;
  return (ROTULOS_COM_QUEM as Readonly<Record<string, string>>)[valor] ?? null;
}

/** A soma do time, para a linha de cima do relatório da gestão. */
export function somarOTime(pessoas: readonly PessoaDoDia[]): {
  pessoas: number;
  ligacoes: number;
  atendidas: number;
  tempoFaladoSeg: number;
  reunioesMarcadas: number;
} {
  return pessoas.reduce(
    (soma, p) => ({
      pessoas: soma.pessoas + (p.ligacoes > 0 ? 1 : 0),
      ligacoes: soma.ligacoes + p.ligacoes,
      atendidas: soma.atendidas + p.atendidas,
      tempoFaladoSeg: soma.tempoFaladoSeg + p.tempo_falado_seg,
      reunioesMarcadas: soma.reunioesMarcadas + p.reunioes_marcadas,
    }),
    { pessoas: 0, ligacoes: 0, atendidas: 0, tempoFaladoSeg: 0, reunioesMarcadas: 0 },
  );
}
