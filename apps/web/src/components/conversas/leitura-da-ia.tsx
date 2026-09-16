'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { dataHoraCompleta, rotuloDoDia } from './formatos';
import {
  compromissoVencido,
  faixaDoScore,
  leituraVaziaDemais,
  ordenarSinais,
  rotuloDaIntencao,
  rotuloDoAlerta,
  rotuloDoSinal,
  ROTULO_DA_FAIXA,
  type SinalDaLeitura,
} from './leitura-da-ia-formatos';
import {
  carregarLeituraDaIa,
  chaveDaLeitura,
  registrarFeedback,
  type LeituraDaConversa,
} from './leitura-da-ia-dados';

/**
 * A leitura da IA sobre a conversa aberta — o "por quê" que a temperatura sozinha
 * nunca deu.
 *
 * ===========================================================================
 * TRÊS REGRAS DE DESENHO, E AS TRÊS SÃO DECISÃO
 * ===========================================================================
 * 1. **Sem cor.** A escala térmica é a única cromia do produto, e ela pertence ao
 *    BANCO: etapa, intenção, dias parados (PRD §5.6). Pintar o score da IA com as
 *    mesmas cores diria que ele é temperatura, e ele não é — é a leitura de uma
 *    conversa, que a Fase 2 põe como mais um insumo daquela conta, não no lugar
 *    dela. Cor é a verdade do CRM; tinta preta é a leitura da máquina.
 * 2. **Uma linha, até alguém pedir mais.** O painel já perdeu 200 px de cabeçalho
 *    para a conversa caber (16/09). Um cartão de IA com seis campos devolveria o
 *    problema. Fechada, a leitura é uma linha; o que sustenta o número abre no
 *    clique de quem duvidou dele — que é exatamente quem deve ver a evidência.
 * 3. **Todo sinal aponta para a mensagem que o prova.** Clicar no sinal rola até
 *    ela. Uma afirmação de máquina que não se pode conferir em dois cliques é
 *    exatamente aquilo que ninguém deveria acreditar.
 *
 * A tela NÃO corrige a ficha: discordar é 👍/👎, que vira `feedback_da_ia` e
 * calibra a versão seguinte. Corrigir texto de IA à mão criaria um dado sem dono —
 * nem da pessoa, nem do modelo.
 */
export function LeituraDaIa({ fioId, className }: { fioId: string; className?: string }) {
  const [aberta, setAberta] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: chaveDaLeitura(fioId),
    queryFn: () => carregarLeituraDaIa(fioId),
    // A ficha muda quando o worker roda (minutos), não a cada foco da janela.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Sem ficha, sem faixa: conversa nunca analisada não ganha uma linha dizendo que
  // não foi analisada. O módulo nasce desligado, e a tela não avisa o que não falta.
  if (isLoading || !data) return null;

  const magra = leituraVaziaDemais(data);
  const faixa = faixaDoScore(data.score);
  const intencao = rotuloDaIntencao(data.intencao);

  return (
    <section
      aria-label="Leitura da IA sobre esta conversa"
      className={cn('max-w-3xl rounded-lg border border-hairline bg-card/60', className)}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />

        {data.score !== null && !magra ? (
          <span className="flex shrink-0 items-baseline gap-1.5" title="Quanto a conversa indica intenção de fechar (0 a 100). Não é a temperatura: essa continua sendo a do CRM.">
            <span className="numerico text-sm leading-none font-semibold">{data.score}</span>
            <Medidor score={data.score} />
          </span>
        ) : null}

        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {magra ? (
            <span>Conversa curta demais para uma leitura.</span>
          ) : (
            <>
              {intencao ? <span className="text-foreground">{intencao}</span> : null}
              {intencao && data.resumo ? <span aria-hidden="true"> · </span> : null}
              {data.resumo}
            </>
          )}
        </p>

        {data.alertas.map((alerta) => (
          <span
            key={alerta}
            className="hidden shrink-0 rounded-md border border-hairline px-1.5 py-0.5 text-[11px] whitespace-nowrap sm:inline"
          >
            {rotuloDoAlerta(alerta)}
          </span>
        ))}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAberta((v) => !v)}
          aria-expanded={aberta}
          className="toque h-7 shrink-0 px-2 text-xs text-muted-foreground"
        >
          {aberta ? 'Fechar' : 'Por quê'}
          <ChevronDown
            className={cn('size-3.5 transition-transform', aberta && 'rotate-180')}
            aria-hidden="true"
          />
        </Button>
      </div>

      {aberta ? <Detalhe fioId={fioId} leitura={data} faixa={faixa} /> : null}
    </section>
  );
}

/**
 * O medidor: 24 px de trilho e o quanto do score preencheu. Ele não substitui o
 * número — está do lado dele — porque 82 e 76 decidem coisas diferentes e uma
 * barra de 24 px não distingue os dois. Ele existe para dar a faixa de relance.
 */
function Medidor({ score }: { score: number }) {
  return (
    <span className="relative inline-block h-1 w-6 overflow-hidden rounded-full bg-hairline" role="presentation">
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
        style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
      />
    </span>
  );
}

function Detalhe({
  fioId,
  leitura,
  faixa,
}: {
  fioId: string;
  leitura: LeituraDaConversa;
  faixa: ReturnType<typeof faixaDoScore>;
}) {
  const sinais = ordenarSinais(leitura.sinais);
  const agora = new Date();

  return (
    <div className="flex flex-col gap-3 border-t border-hairline px-3 py-2.5 text-xs">
      {leitura.motivo || faixa ? (
        <p className="text-muted-foreground">
          {faixa ? <span className="text-foreground">{ROTULO_DA_FAIXA[faixa]}</span> : null}
          {faixa && leitura.motivo ? <span aria-hidden="true"> · </span> : null}
          {leitura.motivo}
        </p>
      ) : null}

      {sinais.length > 0 ? (
        <Bloco titulo="No que ela se baseia">
          <ul className="flex flex-wrap gap-1.5">
            {sinais.map((sinal, indice) => (
              <li key={`${sinal.tipo}-${indice}`}>
                <Sinal sinal={sinal} />
              </li>
            ))}
          </ul>
        </Bloco>
      ) : null}

      {leitura.proximaAcao ? (
        <Bloco titulo="Próxima ação sugerida">
          <p className="text-foreground">
            {leitura.proximaAcao}
            {leitura.proximaAcaoEm ? (
              <span className="text-muted-foreground" title={dataHoraCompleta(leitura.proximaAcaoEm)}>
                {' '}
                · até {rotuloDoDia(leitura.proximaAcaoEm).palavra.toLowerCase()}
                <span className="numerico">{rotuloDoDia(leitura.proximaAcaoEm).numero}</span>
              </span>
            ) : null}
          </p>
        </Bloco>
      ) : null}

      {leitura.compromissos.length > 0 ? (
        <Bloco titulo="Prometido">
          <ul className="flex flex-col gap-1">
            {leitura.compromissos.map((c) => {
              const vencido = compromissoVencido(c.prazo, c.status, agora);
              return (
                <li key={c.id} className="flex items-baseline gap-1.5">
                  <span className="text-muted-foreground">
                    {c.quem === 'equipe' ? 'nós:' : 'ele:'}
                  </span>
                  <span className="min-w-0 flex-1 text-foreground">{c.oQue}</span>
                  {c.prazo ? (
                    <span
                      className={cn('shrink-0 text-muted-foreground', vencido && 'text-foreground')}
                      title={dataHoraCompleta(c.prazo)}
                    >
                      {vencido ? 'venceu ' : 'até '}
                      {rotuloDoDia(c.prazo).palavra.toLowerCase()}
                      <span className="numerico">{rotuloDoDia(c.prazo).numero}</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Bloco>
      ) : null}

      <Rodape fioId={fioId} leitura={leitura} />
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[11px] tracking-wide text-muted-foreground uppercase">{titulo}</h3>
      {children}
    </div>
  );
}

/**
 * Um sinal, com a mensagem que o prova a um clique. O `-` e o `+` fazem o trabalho
 * que a cor faria em outra interface — e aqui cor é temperatura, não julgamento.
 */
function Sinal({ sinal }: { sinal: SinalDaLeitura }) {
  const rotulo = rotuloDoSinal(sinal.tipo);
  const marca = sinal.polaridade === 'negativo' ? '−' : '+';
  const conteudo = (
    <>
      <span aria-hidden="true" className="numerico text-muted-foreground">
        {marca}
      </span>
      {rotulo}
    </>
  );
  const classe = cn(
    'inline-flex items-center gap-1 rounded-md border border-hairline px-1.5 py-0.5',
    sinal.forca === 'fraco' && 'text-muted-foreground',
  );

  if (sinal.messageId === null) {
    return (
      <span className={classe} title={sinal.trecho || undefined}>
        {conteudo}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => irAteAMensagem(sinal.messageId as string)}
      title={sinal.trecho ? `"${sinal.trecho}" — clique para ver a mensagem` : 'Ver a mensagem'}
      className={cn(classe, 'toque hover:bg-muted')}
    >
      {conteudo}
    </button>
  );
}

/**
 * Rola até a mensagem que sustenta o sinal e a pisca. O id é o mesmo que a linha do
 * tempo escreve (`evento-mensagem:<uuid>`); quando a mensagem está fora da janela
 * carregada, nada acontece — e não acontecer é melhor que pular para o lugar errado.
 */
function irAteAMensagem(messageId: string): void {
  const alvo = document.getElementById(`evento-mensagem:${messageId}`);
  if (alvo === null) return;
  alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  alvo.setAttribute('data-apontada', '');
  window.setTimeout(() => alvo.removeAttribute('data-apontada'), 2200);
}

function Rodape({ fioId, leitura }: { fioId: string; leitura: LeituraDaConversa }) {
  const cliente = useQueryClient();
  const [dito, setDito] = useState<'util' | 'inutil' | null>(null);

  const enviar = useMutation({
    mutationFn: (tipo: 'util' | 'inutil') =>
      registrarFeedback({
        fioId,
        tipo,
        valorDaIa: leitura.intencao,
        promptVersion: leitura.promptVersion,
      }),
    onSuccess: (_, tipo) => {
      setDito(tipo);
      void cliente.invalidateQueries({ queryKey: chaveDaLeitura(fioId) });
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-2 text-[11px] text-muted-foreground">
      <span>
        Leitura da IA
        {leitura.promptVersion ? <span> · {leitura.promptVersion}</span> : null}
        {leitura.analisadaEm ? (
          <span title={dataHoraCompleta(leitura.analisadaEm)}>
            {' · '}
            {rotuloDoDia(leitura.analisadaEm).palavra.toLowerCase()}
            <span className="numerico">{rotuloDoDia(leitura.analisadaEm).numero}</span>
          </span>
        ) : null}
      </span>

      <span className="flex-1" />

      {dito !== null ? (
        <span>{dito === 'util' ? 'Obrigado — isso calibra a próxima.' : 'Anotado.'}</span>
      ) : (
        <span className="flex items-center gap-0.5">
          <span className="mr-1">Ajudou?</span>
          <Button
            variant="ghost"
            size="icon"
            className="toque size-7"
            disabled={enviar.isPending}
            onClick={() => enviar.mutate('util')}
          >
            <ThumbsUp className="size-3.5" aria-hidden="true" />
            <span className="sr-only">A leitura ajudou</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="toque size-7"
            disabled={enviar.isPending}
            onClick={() => enviar.mutate('inutil')}
          >
            <ThumbsDown className="size-3.5" aria-hidden="true" />
            <span className="sr-only">A leitura não ajudou</span>
          </Button>
        </span>
      )}
    </div>
  );
}
