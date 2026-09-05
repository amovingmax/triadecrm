'use client';

import { useState } from 'react';
import { Check, Copy, Phone, PhoneCall, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChipTemperatura } from '@/components/temperatura';

import { fraseDoBloqueio } from './chamada-janela';
import {
  fraseDeOrigem,
  linkDoDiscador,
  telefoneLegivel,
  type ChamadaEmCurso,
  type EstadoDaJanela,
  type ItemDoLote,
} from './tipos';

/**
 * O cabeçalho do contato: quem é, e o número em corpo de cartaz.
 *
 * O número é a única coisa desta tela que a pessoa precisa CONFERIR letra por letra,
 * então ele é o maior elemento e sai em IBM Plex Mono (classe `numerico`), agrupado
 * como se lê em voz alta. O `tel:` abre o discador do aparelho; o "Copiar" serve a
 * quem liga de outro telefone ou de um softphone; e o "Liguei" existe para quem já
 * discou por fora — os três abrem a MESMA tentativa e começam o mesmo cronômetro
 * (R13 §3.4, adaptador manual).
 *
 * Fora da janela o botão de discar não funciona, e a tela diz por quê e até quando
 * (R13 §6). O bloqueio não é só visual: `iniciar_chamada` recusa no banco.
 */
export function ChamadaCabecalho({
  item,
  maxTentativas,
  janela,
  chamada,
  segundos,
  abrindo,
  aoLigar,
}: {
  item: ItemDoLote;
  maxTentativas: number;
  janela: EstadoDaJanela;
  chamada: ChamadaEmCurso | null;
  segundos: number;
  abrindo: boolean;
  /** `abreDiscador` diz se o `tel:` do aparelho deve ser aberto junto. */
  aoLigar: (abreDiscador: boolean) => void;
}) {
  const [copiado, setCopiado] = useState(false);

  const tentativaAtual = item.tentativas + 1;
  const ultima = tentativaAtual >= maxTentativas;
  const podeDiscar = janela.aberta && !abrindo;

  /**
   * Durante a chamada o cabeçalho ENCOLHE no celular.
   *
   * Numa tela de 390 px a ficha inteira (nome, categoria, bairro, etapa, origem,
   * tentativa e o número em corpo de cartaz) empurra a fala do roteiro para baixo da
   * dobra — e a fala é a única coisa que ela precisa ver enquanto fala. Antes de
   * discar, a ficha é o conteúdo; depois de discar, ela é referência. No desktop nada
   * muda: lá cabe tudo, e quem liga está sentado.
   */
  const emChamada = chamada !== null;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(item.telefone);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Área de transferência bloqueada (permissão, contexto inseguro): o número
      // continua na tela em corpo grande, que é o caminho que nunca falha.
      setCopiado(false);
    }
    // Copiar abre a tentativa — é uma das três formas de discar. Fora da janela ele
    // continua copiando (o número não é segredo para quem já o tem na tela), mas não
    // abre chamada nenhuma: `iniciar_chamada` recusaria, e recusa depois do toque é
    // pior do que botão que não promete.
    if (!chamada && podeDiscar) aoLigar(false);
  }

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2
            className={cn(
              'leading-tight font-semibold sm:text-3xl',
              emChamada ? 'text-lg sm:text-3xl' : 'text-2xl',
            )}
          >
            {item.nome}
          </h2>
          <ChipTemperatura temperatura={item.temperatura} />
        </div>

        <p className={cn('text-sm text-muted-foreground', emChamada && 'max-sm:hidden')}>
          {[item.categoria, [item.bairro, item.cidade].filter(Boolean).join(', '), item.etapa]
            .filter(Boolean)
            .join(' · ') || 'Sem categoria e sem bairro na ficha'}
        </p>

        {/* A frase de origem aparece aqui SÓ durante a chamada. Antes de discar ela
            já está na primeira fala do roteiro, logo abaixo, e repetir a mesma frase
            duas vezes na mesma dobra é ruído. Depois que a árvore avança, a abertura
            sai da tela e a procedência passa a valer de novo — é o que ela precisa ter
            à mão quando ouvir "de onde tirou meu número?". */}
        {item.contatoNome || chamada ? (
          <p className={cn('text-sm text-muted-foreground', emChamada && 'max-sm:hidden')}>
            {item.contatoNome ? (
              <>
                Falar com <span className="text-foreground">{item.contatoNome}</span>.{' '}
              </>
            ) : null}
            {chamada ? `Peguei o contato ${fraseDeOrigem(item.origemSlug)}.` : null}
          </p>
        ) : null}

        {/* Durante a chamada, no celular, a contagem de tentativa sai da tela — ela é
            decisão de ANTES de discar. O aviso da ÚLTIMA tentativa fica: ele muda o que
            ela faz agora (deixar recado, insistir mais um pouco), e some seria esconder
            justamente a linha que importa. */}
        <p
          className={cn(
            'flex items-center gap-1.5 text-sm',
            ultima ? 'text-destructive-texto' : 'text-muted-foreground',
            emChamada && !ultima && 'max-sm:hidden',
          )}
        >
          {ultima ? <TriangleAlert className="size-4 shrink-0" aria-hidden="true" /> : null}
          <span>
            Tentativa <span className="numerico">{tentativaAtual}</span> de{' '}
            <span className="numerico">{maxTentativas}</span>
            {ultima ? ' — é a última deste lote.' : '.'}
          </span>
        </p>

        {item.observacao ? (
          <p className="text-sm text-muted-foreground">Da última vez: {item.observacao}</p>
        ) : null}
      </div>

      {/* O número, em corpo de cartaz. */}
      <div
        className={cn(
          'flex flex-col gap-3 rounded-xl border border-hairline bg-card sm:p-5',
          emChamada ? 'px-3 py-2 sm:py-5' : 'p-4',
        )}
      >
        {/* Em chamada, no celular, o número e o cronômetro dividem UMA linha.
            Medido em 390×844 antes disto: sobravam 120 px para a fala do roteiro — que
            é a única coisa que ela precisa ler enquanto fala —, e a frase de abertura
            saía cortada no meio, com as respostas inteiramente debaixo da barra de
            tabulação. O número continua na tela porque ela pode precisar reditar; o que
            ele não precisa mais é de corpo de cartaz, que serve a CONFERIR antes de
            discar. No desktop nada muda. */}
        <div
          className={cn(
            'flex flex-wrap items-baseline justify-between gap-3',
            emChamada && 'max-sm:flex-nowrap max-sm:items-center max-sm:gap-2',
          )}
        >
          {/* O número é TEXTO, não link: quem disca é o botão, e um número que
              também disca faria a pessoa abrir o discador ao tentar selecioná-lo
              para copiar. */}
          <p
            className={cn(
              'numerico leading-none font-semibold tracking-tight select-all sm:text-4xl',
              emChamada ? 'min-w-0 text-lg sm:text-4xl' : 'text-3xl',
            )}
          >
            {telefoneLegivel(item.telefone)}
          </p>

          {chamada ? (
            <p className="flex shrink-0 items-center gap-2 text-sm font-medium">
              <span className="relative flex size-2.5">
                <span
                  aria-hidden="true"
                  className="absolute inline-flex size-full rounded-full bg-quente"
                />
              </span>
              {/* No celular, em chamada, "Em chamada" sai da tela e fica só para quem
                  lê por leitor: o ponto vermelho e o cronômetro correndo já dizem a
                  mesma coisa, e as duas palavras eram o que espremia o número na linha
                  de 390 px. */}
              <span className="max-sm:sr-only">Em chamada</span>
              <span className="numerico text-lg" aria-label={`${segundos} segundos de chamada`}>
                {cronometro(segundos)}
              </span>
            </p>
          ) : null}
        </div>

        {chamada ? null : (
          <div className="flex flex-col gap-2 sm:flex-row">
            {podeDiscar ? (
              <Button asChild className="h-12 shrink-0 sm:flex-1 text-base">
                <a href={linkDoDiscador(item.telefone)} onClick={() => aoLigar(true)}>
                  <PhoneCall aria-hidden="true" />
                  Ligar
                </a>
              </Button>
            ) : (
              <Button type="button" disabled className="h-12 shrink-0 sm:flex-1 text-base">
                <PhoneCall aria-hidden="true" />
                Ligar
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              className="h-12 shrink-0 sm:flex-1 text-base"
              onClick={() => void copiar()}
            >
              {copiado ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copiado ? 'Copiado' : 'Copiar número'}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-12 text-base"
              disabled={!podeDiscar}
              onClick={() => aoLigar(false)}
            >
              <Phone aria-hidden="true" />
              Liguei
            </Button>
          </div>
        )}

        {janela.aberta ? null : (
          <p className="flex items-start gap-2 text-sm text-destructive-texto">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {fraseDoBloqueio(janela)}
              {janela.abreEm ? ` Faltam ${faltamAte(janela.abreEm)}.` : ''} Tabular o que já
              aconteceu continua liberado.
            </span>
          </p>
        )}
      </div>
    </header>
  );
}

/** Segundos → `mm:ss`, ou `h:mm:ss` quando a ligação passa da hora. */
export function cronometro(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const dois = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dois(m)}:${dois(r)}` : `${dois(m)}:${dois(r)}`;
}

/** "13h20" ou "38 min": o quanto falta até a próxima abertura da janela. */
export function faltamAte(iso: string, agora: Date = new Date()): string {
  const minutos = Math.max(0, Math.round((Date.parse(iso) - agora.getTime()) / 60_000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, '0')}`;
}
