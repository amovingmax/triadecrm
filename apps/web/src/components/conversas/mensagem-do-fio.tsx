'use client';

import { useEffect, useState } from 'react';
import {
  AudioLines,
  BadgeCheck,
  Ban,
  Bot,
  CircleAlert,
  FileText,
  Hourglass,
  Sparkles,
  UserRound,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

import { urlDaMidia } from './acoes';
import { dataHoraCompleta, hora } from './formatos';
import { entregaDaMensagem } from './mensagens';
import { ROTULO_ORIGEM, ROTULO_TIPO_MENSAGEM, type MensagemDoFio } from './tipos';

/**
 * Uma mensagem dentro da linha do tempo.
 *
 * ===========================================================================
 * POR QUE ELA NÃO TEM ABA PRÓPRIA
 * ===========================================================================
 * A mensagem divide a coluna com a ligação, a visita e a mudança de etapa, na
 * mesma ordem cronológica. É o desenho que o módulo já tinha, e ele estava certo
 * pelo motivo que só aparece em campo: o WhatsApp das 14h20 é a CONSEQUÊNCIA da
 * ligação das 14h. Em duas abas, quem lê perde a causa.
 *
 * O que separa a mensagem do resto é a forma: ela é balão. Recebida encosta à
 * esquerda e é preenchida; enviada encosta à direita e é contornada. Sem cor —
 * a cromia desta interface é a escala térmica, e uma mensagem não tem
 * temperatura.
 *
 * ===========================================================================
 * O ÁUDIO
 * ===========================================================================
 * O fornecedor manda áudio mesmo quando a gente escreve — é o R13 inteiro. Então
 * o áudio recebido mostra as DUAS coisas: o player (para ouvir a voz, que é onde
 * está o tom) e a transcrição (para ler no ônibus, sem fone). E a transcrição vem
 * marcada como o que é: máquina. Quem decide se marca reunião a partir de uma
 * frase transcrita precisa saber que aquela frase pode estar errada.
 *
 * O player só aparece quando dá para assinar a URL do arquivo. Hoje, em geral,
 * não dá — o balde `mensagens` é privado e não tem política de leitura (ver
 * `BUCKET_MIDIA` em `acoes.ts`) —, e aí o balão diz isso com todas as letras em
 * vez de mostrar um controle de áudio que não toca. A transcrição fica de pé nos
 * dois casos, porque ela é a parte que a Heloísa lê na rua.
 */
export function Mensagem({ mensagem }: { mensagem: MensagemDoFio }) {
  const entrega = entregaDaMensagem(mensagem);
  const semTexto = mensagem.texto === null;

  return (
    <div className={cn('flex w-full', mensagem.entrada ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'min-w-0 max-w-[92%] space-y-1.5 rounded-xl px-3 py-2 md:max-w-[34rem]',
          mensagem.entrada
            ? 'rounded-tl-sm bg-muted'
            : 'rounded-tr-sm border border-hairline bg-card/60',
        )}
      >
        <Assinatura mensagem={mensagem} />

        {mensagem.tipo === 'audio' ? <Audio mensagem={mensagem} /> : null}

        {mensagem.texto ? (
          <p className="text-sm leading-relaxed whitespace-pre-line">{mensagem.texto}</p>
        ) : null}

        {mensagem.tipo !== 'audio' && semTexto ? <SemCorpo mensagem={mensagem} /> : null}

        {mensagem.erroDetalhe || mensagem.erroCodigo ? (
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span>{mensagem.erroDetalhe ?? mensagem.erroCodigo}</span>
          </p>
        ) : null}

        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <time dateTime={mensagem.em} title={dataHoraCompleta(mensagem.em)} className="numerico">
            {hora(mensagem.em)}
          </time>
          <span aria-hidden="true">·</span>
          <span
            className={cn(
              'inline-flex items-center gap-1',
              entrega.tom === 'falha' && 'text-destructive-texto',
              entrega.tom === 'espera' && 'text-foreground',
            )}
          >
            {entrega.tom === 'espera' ? (
              <Hourglass className="size-3" aria-hidden="true" />
            ) : entrega.tom === 'falha' ? (
              <Ban className="size-3" aria-hidden="true" />
            ) : null}
            {entrega.rotulo}
          </span>
          {entrega.detalhe ? (
            <span className="w-full text-muted-foreground">{entrega.detalhe}</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/**
 * Quem escreveu esta mensagem, e sob que regra ela saiu.
 *
 * A pilha de selos parece muita coisa, e cada um responde a uma pergunta que
 * alguém já fez em pé numa calçada: "isso saiu do meu celular ou do CRM?", "quem
 * aprovou esse texto?", "isso foi robô?", "isso gastou o teto do dia?".
 */
function Assinatura({ mensagem }: { mensagem: MensagemDoFio }) {
  const daIa = mensagem.autorTipo === 'bot_ai';
  const doRobo = mensagem.autorTipo === 'bot_fixed';

  const quem = mensagem.entrada
    ? 'O parceiro'
    : daIa
      ? 'Rascunho da IA'
      : doRobo
        ? 'Texto fixo do robô'
        : (mensagem.autor ?? 'Alguém do time');

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
      {mensagem.entrada ? (
        <UserRound className="size-3" aria-hidden="true" />
      ) : daIa ? (
        <Sparkles className="size-3" aria-hidden="true" />
      ) : doRobo ? (
        <Bot className="size-3" aria-hidden="true" />
      ) : null}
      <span className="font-medium text-foreground">{quem}</span>

      {mensagem.entrada ? null : (
        <>
          <span aria-hidden="true">·</span>
          <span>{ROTULO_ORIGEM[mensagem.origem]}</span>
        </>
      )}

      {daIa && mensagem.aprovadoPor ? (
        <Badge variant="pilula" className="h-4 gap-1 px-1.5 text-[10px] font-normal">
          <BadgeCheck className="size-2.5" aria-hidden="true" />
          {mensagem.aprovadoPor} aprovou
        </Badge>
      ) : null}

      {mensagem.porModelo ? (
        <Badge variant="pilula" className="h-4 px-1.5 text-[10px] font-normal">
          modelo aprovado
        </Badge>
      ) : null}

      {mensagem.primeiroContato ? (
        <Badge variant="pilula" className="h-4 px-1.5 text-[10px] font-normal">
          primeiro contato
        </Badge>
      ) : null}

      {mensagem.confirmacaoDeOptout ? (
        <Badge variant="pilula" className="h-4 px-1.5 text-[10px] font-normal">
          confirmação de opt-out
        </Badge>
      ) : null}

      {mensagem.iniciadaPelaEmpresa && !mensagem.entrada && !mensagem.confirmacaoDeOptout ? (
        <Badge variant="pilula" className="h-4 px-1.5 text-[10px] font-normal">
          fora da janela
        </Badge>
      ) : null}
    </p>
  );
}

/**
 * Mensagem sem corpo — que não é o mesmo que mensagem vazia.
 *
 * Duas causas, e as duas precisam ser ditas: ou é mídia que ninguém baixou
 * ainda, ou é a retenção de 12 meses (PRD §10.6), que apaga o texto e mantém a
 * linha. Escrever só "(sem conteúdo)" faria parecer defeito.
 */
function SemCorpo({ mensagem }: { mensagem: MensagemDoFio }) {
  const midia = mensagem.tipo !== 'text' && mensagem.tipo !== 'template';
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <FileText className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span>
        {midia
          ? `${ROTULO_TIPO_MENSAGEM[mensagem.tipo]} sem arquivo guardado: o CRM não baixou esta mídia da Meta.`
          : 'O texto desta mensagem foi apagado pela retenção de 12 meses; a linha fica como registro.'}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Áudio: o player e a transcrição de máquina
// ---------------------------------------------------------------------------

type EstadoDoArquivo = 'procurando' | 'pronto' | 'ausente';

function Audio({ mensagem }: { mensagem: MensagemDoFio }) {
  const caminho = mensagem.midiaCaminho;
  // A resposta guarda O CAMINHO que ela responde. Sem isso, trocar de conversa
  // mostraria por um instante a URL assinada do áudio anterior — que é um áudio
  // de outra pessoa.
  const [assinada, setAssinada] = useState<{ caminho: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    void urlDaMidia(caminho).then((url) => {
      if (vivo) setAssinada({ caminho, url });
    });
    return () => {
      vivo = false;
    };
  }, [caminho]);

  // Derivado, não guardado: um `setEstado('ausente')` dentro do efeito faria
  // uma repintura em cascata só para dizer o que já dá para saber aqui.
  const resposta = assinada?.caminho === caminho ? assinada : null;
  const estado: EstadoDoArquivo = !caminho
    ? 'ausente'
    : resposta === null
      ? 'procurando'
      : resposta.url
        ? 'pronto'
        : 'ausente';
  const url = resposta?.url ?? null;

  return (
    <div className="space-y-2">
      {estado === 'pronto' && url ? (
        // `preload="none"`: a Heloísa abre esta tela no 4G da rua, e um áudio de
        // 30 s baixado sozinho a cada conversa aberta é dado dela indo embora.
        <audio
          controls
          preload="none"
          src={url}
          className="h-11 w-full"
          aria-label="Áudio recebido do parceiro"
        />
      ) : (
        <p className="flex items-start gap-1.5 rounded-lg border border-dashed border-hairline px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
          <AudioLines className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {estado === 'procurando'
              ? 'Procurando o arquivo do áudio...'
              : 'O áudio está guardado no balde privado do CRM, e esta tela ainda não tem permissão para abri-lo: falta o endereço no servidor que assina a URL. A transcrição abaixo é o que dá para ler agora.'}
          </span>
        </p>
      )}

      {mensagem.transcricao ? (
        <Transcricao texto={mensagem.transcricao} />
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Sem transcrição: quem transcreve é o faster-whisper na máquina de Natal
          (RF-CON-27), e ele ainda não roda.
        </p>
      )}
    </div>
  );
}

/**
 * A transcrição, marcada como máquina.
 *
 * Não é rodapé pequeno: é o rótulo em cima do texto. Uma transcrição automática
 * lida como se fosse a fala da pessoa é como "quinta não dá" vira "quinta dá" e
 * alguém aparece na porta de um buffet num dia errado. O texto fica em itálico e
 * dentro de uma moldura tracejada pela mesma razão — é a única coisa nesta tela
 * que nenhuma pessoa conferiu.
 */
function Transcricao({ texto }: { texto: string }) {
  return (
    <div className="rounded-lg border border-dashed border-hairline bg-background/40 px-2.5 py-2">
      <p className="mb-1 flex items-center gap-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
        <AudioLines className="size-3" aria-hidden="true" />
        transcrição automática, ninguém conferiu
      </p>
      <p className="text-sm leading-relaxed whitespace-pre-line italic">{texto}</p>
    </div>
  );
}
