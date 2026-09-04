import { formatarNumero } from '@/components/parceiros/formatos';

import { situacaoDaLinha, type LinhaProgresso } from './tipos';

/**
 * A frase embaixo da barra: o que está acontecendo e o que fazer, em português.
 *
 * É ela que carrega o estado, porque a barra é neutra de propósito (a cor da
 * interface significa temperatura do negócio, nunca desempenho de pessoa). Todo
 * número sai em `numerico` (IBM Plex Mono com tabular-nums).
 *
 * Nada de adjetivo sobre a pessoa: "faltam 7" e "pelo menos 2 por dia útil" são
 * fatos que dão o próximo passo; "abaixo do esperado" só dá um rótulo.
 */

function N({ children }: { children: string }) {
  return <span className="numerico">{children}</span>;
}

/**
 * Dias úteis que ainda restam, reconstruídos a partir do que o banco devolve.
 *
 * `app.business_days` conta o dia de HOJE nos dois lados (nos decorridos e nos que
 * restam), então `total - decorridos` erraria por um dia sempre que a pessoa abre a
 * tela dentro do período — e na sexta-feira daria zero, com a semana ainda por
 * fechar. `ritmo_necessario` é exatamente `falta / restantes` calculado no Postgres,
 * então a divisão inversa devolve o número que o próprio banco usou.
 */
function diasRestantes(linha: LinhaProgresso, falta: number): number {
  if (linha.ritmo_necessario !== null && linha.ritmo_necessario > 0) {
    return Math.max(1, Math.round(falta / linha.ritmo_necessario));
  }
  return Math.max(0, linha.dias_uteis_total - linha.dias_uteis_decorridos);
}

/**
 * O ritmo sai INTEIRO, arredondado para cima, e a frase diz "pelo menos".
 *
 * Dois motivos. Ninguém abre 6,7 portas: quem lê precisa de um número que dê para
 * cumprir, e arredondar para baixo não fecha a meta. E a vírgula em IBM Plex Mono
 * ocupa uma célula inteira, então "6,7" sai desenhado como "6 , 7" no meio de uma
 * frase — o mono existe para alinhar coluna de número, não para escrever decimal
 * dentro de texto corrido.
 */
function porDiaUtil(valor: number): string {
  return String(Math.max(1, Math.ceil(valor)));
}

export function FraseDaMeta({ linha }: { linha: LinhaProgresso }) {
  const situacao = situacaoDaLinha(linha);
  const feito = linha.realizado ?? 0;
  const meta = linha.meta ?? 0;
  const falta = Math.max(0, meta - feito);
  const restam = diasRestantes(linha, falta);
  const ehDia = linha.periodo === 'day';

  if (situacao === 'nao_mensuravel') {
    return <>Ainda não dá para medir: {linha.fonte.replace(/^Ainda não é medível: /, '')}</>;
  }

  if (situacao === 'sem_meta') {
    return <>Sem meta definida para este período.</>;
  }

  if (situacao === 'futuro') {
    return <>O período ainda não começou.</>;
  }

  if (situacao === 'sem_dia_util') {
    return <>Sem dia útil neste período: nada a cobrar aqui.</>;
  }

  if (situacao === 'batida') {
    const sobra = feito - meta;
    return sobra > 0 ? (
      <>
        Meta batida, com <N>{formatarNumero(sobra)}</N> a mais.
      </>
    ) : (
      <>Meta batida.</>
    );
  }

  if (ehDia) {
    return situacao === 'no_ritmo' ? (
      <>
        No ritmo. Faltam <N>{formatarNumero(falta)}</N> hoje.
      </>
    ) : (
      <>
        Faltam <N>{formatarNumero(falta)}</N> hoje.
      </>
    );
  }

  if (situacao === 'no_ritmo') {
    return (
      <>
        No ritmo. Faltam <N>{formatarNumero(falta)}</N>, com <N>{formatarNumero(restam)}</N>{' '}
        {restam === 1 ? 'dia útil' : 'dias úteis'} pela frente.
      </>
    );
  }

  if (restam <= 0) {
    return (
      <>
        Faltam <N>{formatarNumero(falta)}</N> e não sobra dia útil neste período.
      </>
    );
  }

  // Com um dia útil só, "pelo menos 7 por dia útil" repetiria o próprio número que
  // falta: o ritmo vira a meta, e a frase fica dizendo duas vezes a mesma coisa.
  if (restam === 1) {
    return (
      <>
        Faltam <N>{formatarNumero(falta)}</N> e sobra <N>1</N> dia útil no período.
      </>
    );
  }

  return (
    <>
      Faltam <N>{formatarNumero(falta)}</N>: pelo menos{' '}
      <N>{porDiaUtil(linha.ritmo_necessario ?? falta / restam)}</N> por dia útil nos{' '}
      <N>{formatarNumero(restam)}</N> dias úteis que sobram.
    </>
  );
}
