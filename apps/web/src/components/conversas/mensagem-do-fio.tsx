'use client';

import { useEffect, useState } from 'react';
import { AudioLines, BadgeCheck, Ban, Bot, FileText, Hourglass, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

import { urlDaMidia } from './acoes';
import { VirarTarefa } from './virar-tarefa';
import { dataHoraCompleta, hora } from './formatos';
import { entregaDaMensagem, separarAssinatura } from './mensagens';
import { ROTULO_TIPO_MENSAGEM, type MensagemDoFio } from './tipos';

/**
 * Uma mensagem dentro da conversa — um balão de verdade.
 *
 * ===========================================================================
 * O QUE MUDOU EM 23/09/2026, E POR QUÊ
 * ===========================================================================
 * "Tá muito ruim, muito feio... no mobile tá ficando muito pequeno e ruim de ver
 * a conversa" (Rafael). O desenho anterior punha os dois lados em cinza quase
 * igual, com um trilho de ícones de 44 px à esquerda, o nome de quem escreveu
 * dentro do balão e a hora, a entrega e o botão "Virar tarefa" também dentro.
 * Em 390 px sobrava meia tela para a conversa, e o olho não distinguia quem
 * falou sem ler o rótulo.
 *
 * Agora vale a gramática que todo mundo já conhece do WhatsApp:
 *   * **recebida** encosta à esquerda, no cartão (`bg-card`);
 *   * **enviada** encosta à direita, com um véu da cor da marca — o único uso de
 *     cromia fora da escala térmica, e ele não compete com ela: verde é a AÇÃO
 *     do produto (botão, link, foco), e "fui eu que falei" é ação;
 *   * hora e entrega saem do balão e viram uma linha miúda embaixo, só na
 *     ÚLTIMA mensagem de cada bloco do mesmo autor;
 *   * quem escreveu aparece uma vez por bloco, e só quando acrescenta (a IA, o
 *     robô, ou outra pessoa do time).
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
 * vez de mostrar um controle de áudio que não toca.
 */
export function Mensagem({
  mensagem,
  agrupada = false,
  fechaGrupo = true,
}: {
  mensagem: MensagemDoFio;
  /** Vem logo depois de outra do mesmo autor: sem nome em cima, colada na anterior. */
  agrupada?: boolean;
  /** É a última do bloco: só ela mostra hora e entrega. */
  fechaGrupo?: boolean;
}) {
  const entrega = entregaDaMensagem(mensagem);
  const semTexto = mensagem.texto === null;
  const entrada = mensagem.entrada;

  return (
    <div
      className={cn(
        'group flex w-full flex-col',
        entrada ? 'items-start' : 'items-end',
        fechaGrupo ? 'pb-3' : 'pb-0.5',
      )}
    >
      {agrupada ? null : <Quem mensagem={mensagem} />}

      <div
        className={cn(
          'min-w-0 max-w-[85%] space-y-2 px-3.5 py-2.5 text-[15px] leading-relaxed md:max-w-[34rem]',
          // O canto reto é o "rabinho" do balão: fica no lado de quem falou, e só
          // no último do bloco — no meio do bloco todos os cantos são redondos.
          'rounded-2xl',
          // O cinza da recebida muda de degrau com o tema: no claro o cartão é
          // quase branco (some no fundo da página) e quem separa é o `muted`; no
          // escuro é o contrário — o `muted` encosta no fundo e o cartão destaca.
          entrada
            ? cn('bg-muted text-foreground dark:bg-card', fechaGrupo && 'rounded-bl-md')
            : cn('bg-primary/20 text-foreground', fechaGrupo && 'rounded-br-md'),
        )}
      >
        {mensagem.tipo === 'audio' ? <Audio mensagem={mensagem} /> : null}

        {mensagem.texto ? <Texto texto={mensagem.texto} /> : null}

        {mensagem.tipo !== 'audio' && semTexto ? <SemCorpo mensagem={mensagem} /> : null}

      </div>

      {fechaGrupo ? (
        <p
          className={cn(
            'mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-[11px] text-muted-foreground',
            entrada ? 'justify-start' : 'flex-row-reverse',
          )}
        >
          <time dateTime={mensagem.em} title={dataHoraCompleta(mensagem.em)} className="numerico">
            {hora(mensagem.em)}
          </time>
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
          <Selos mensagem={mensagem} />
          {entrada ? <VirarTarefa mensagemId={mensagem.id} /> : null}
          {entrega.detalhe ? (
            <span className="w-full text-muted-foreground">{entrega.detalhe}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Quem escreveu, em cima do balão e só quando acrescenta.
 *
 * "O parceiro" em toda mensagem recebida era uma etiqueta repetida numa tela em
 * que o lado do balão já diz isso. Sobra o que muda: a IA, o robô, e o nome de
 * quem do time escreveu — porque o número é de todos e saber quem falou por
 * último é a pergunta de quem entra na conversa agora.
 */
function Quem({ mensagem }: { mensagem: MensagemDoFio }) {
  const daIa = mensagem.autorTipo === 'bot_ai';
  const doRobo = mensagem.autorTipo === 'bot_fixed';
  if (mensagem.entrada) return null;

  const quem = daIa ? 'Rascunho da IA' : doRobo ? 'Texto fixo do robô' : (mensagem.autor ?? 'Alguém do time');

  return (
    <p className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
      {daIa ? (
        <Sparkles className="size-3" aria-hidden="true" />
      ) : doRobo ? (
        <Bot className="size-3" aria-hidden="true" />
      ) : null}
      <span className="font-medium text-foreground">{quem}</span>
      {daIa && mensagem.aprovadoPor ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <BadgeCheck className="size-3" aria-hidden="true" />
            {mensagem.aprovadoPor} aprovou
          </span>
        </>
      ) : null}
    </p>
  );
}

/**
 * Os selos da regra: sob que permissão a mensagem saiu.
 *
 * Eles respondem a perguntas que alguém já fez em pé numa calçada — "isso gastou
 * o teto do dia?", "isso foi modelo aprovado?" —, mas são consulta, não leitura:
 * por isso vão na linha miúda embaixo do balão, e não dentro dele.
 */
function Selos({ mensagem }: { mensagem: MensagemDoFio }) {
  const selos = [
    mensagem.porModelo ? 'modelo aprovado' : null,
    mensagem.primeiroContato ? 'primeiro contato' : null,
    mensagem.confirmacaoDeOptout ? 'confirmação de opt-out' : null,
    mensagem.iniciadaPelaEmpresa && !mensagem.entrada && !mensagem.confirmacaoDeOptout
      ? 'fora da janela'
      : null,
  ].filter((s): s is string => s !== null);
  if (selos.length === 0) return null;

  return (
    <>
      {selos.map((selo) => (
        <Badge key={selo} variant="pilula" className="h-4 px-1.5 text-[10px] font-normal">
          {selo}
        </Badge>
      ))}
    </>
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
  // O que identifica o áudio para o servidor é a MENSAGEM, não o caminho do
  // arquivo (ver `urlDaMidia`). `midiaCaminho` continua valendo para saber se há
  // arquivo guardado: sem ele, nem vale a ida ao servidor.
  const caminho = mensagem.midiaCaminho;
  const messageId = mensagem.id;
  // A resposta guarda O CAMINHO que ela responde. Sem isso, trocar de conversa
  // mostraria por um instante a URL assinada do áudio anterior — que é um áudio
  // de outra pessoa.
  const [assinada, setAssinada] = useState<{ caminho: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    void urlDaMidia(messageId).then((url) => {
      if (vivo) setAssinada({ caminho, url });
    });
    return () => {
      vivo = false;
    };
  }, [caminho, messageId]);

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
              : 'O arquivo deste áudio não está guardado no CRM — a URL da Meta expira em minutos, e ele chegou quando o motor estava parado. A transcrição abaixo é o que dá para ler.'}
          </span>
        </p>
      )}

      {mensagem.transcricao ? (
        <Transcricao texto={mensagem.transcricao} />
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Sem transcrição — a transcrição automática está desligada. Toque no player para ouvir.
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

/**
 * O corpo da mensagem.
 *
 * A assinatura ("*Rafael:*" na primeira linha, que é como o parceiro vê no
 * WhatsApp) SAI do balão: quem escreveu já está dito em cima dele, e ler o mesmo
 * nome duas vezes em toda mensagem nossa era a maior fonte de ruído da coluna.
 * O texto que saiu continua inteiro no banco — aqui muda só o que a tela mostra.
 */
function Texto({ texto }: { texto: string }) {
  const { resto } = separarAssinatura(texto);
  return <p className="whitespace-pre-line">{resto}</p>;
}
