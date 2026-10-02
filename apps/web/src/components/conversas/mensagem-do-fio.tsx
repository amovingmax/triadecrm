'use client';

import { useEffect, useState } from 'react';
import {
  AudioLines,
  BadgeCheck,
  Ban,
  Bot,
  FileText,
  Film,
  Hourglass,
  ImageIcon,
  Sparkles,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { iniciaisDe } from '@/lib/iniciais';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

import { urlDaMidia } from './acoes';
import { VirarTarefa } from './virar-tarefa';
import { dataHoraCompleta, hora } from './formatos';
import { entregaDaMensagem, separarAssinatura } from './mensagens';
import { ROTULO_DO_ROBO, ROTULO_TIPO_MENSAGEM, type MensagemDoFio } from './tipos';

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
  nomeDoParceiro = null,
}: {
  mensagem: MensagemDoFio;
  /** Vem logo depois de outra do mesmo autor: sem nome em cima, colada na anterior. */
  agrupada?: boolean;
  /** É a última do bloco: só ela mostra hora e entrega. */
  fechaGrupo?: boolean;
  /** Como se chama quem está do outro lado — o nome em cima do balão recebido. */
  nomeDoParceiro?: string | null;
}) {
  const entrega = entregaDaMensagem(mensagem);
  const semTexto = mensagem.texto === null;
  const entrada = mensagem.entrada;

  // ===========================================================================
  // 28/09/2026 — O REDESENHO QUE O RAFAEL PEDIU DE VERDADE
  // ===========================================================================
  // "vamos pivotear o designer, ta mtt feio e pequeno, pode compor mais espaço
  // (...) deixando o visual mais clean, deixando claro quem é quem". A primeira
  // tentativa foi tímida — alargou a coluna e aumentou o balão —, e ele
  // respondeu "manteve o mesmo". O que faltava era o desenho, não o tamanho:
  //
  //   * AVATAR por bloco, na coluna de quem falou. "Quem é quem" deixa de ser
  //     uma linha de texto de 11 px e passa a ser reconhecível de relance, que
  //     é como se lê uma conversa.
  //   * COR DE VERDADE no que nós mandamos: `bg-primary` sólido no lugar do
  //     véu de 20%, que no tema escuro era quase o mesmo cinza da recebida —
  //     os dois lados pareciam iguais, e era esse o "não dá pra ver quem é".
  //   * TIPO MAIOR em toda largura (16 px, não 15), e mais ar por dentro.
  return (
    <div
      className={cn(
        'group flex w-full items-end gap-2',
        entrada ? 'flex-row' : 'flex-row-reverse',
        fechaGrupo ? 'pb-4' : 'pb-1',
      )}
    >
      {/* O avatar só no ÚLTIMO do bloco, e um espaço do mesmo tamanho nos
          outros: é o que alinha a coluna sem repetir a mesma bolinha cinco
          vezes numa sequência de cinco mensagens. */}
      {fechaGrupo ? (
        <Retrato mensagem={mensagem} nomeDoParceiro={nomeDoParceiro} />
      ) : (
        <span className="size-8 shrink-0" aria-hidden="true" />
      )}

      <div className={cn('flex min-w-0 flex-col', entrada ? 'items-start' : 'items-end')}>
      {agrupada ? null : <Quem mensagem={mensagem} nomeDoParceiro={nomeDoParceiro} />}

      <div
        className={cn(
          'min-w-0 max-w-[85%] space-y-2 px-4 py-3 text-base leading-relaxed',
          'md:max-w-[38rem]',
          // O canto reto é o "rabinho" do balão: fica no lado de quem falou, e só
          // no último do bloco — no meio do bloco todos os cantos são redondos.
          'rounded-2xl',
          // O cinza da recebida muda de degrau com o tema: no claro o cartão é
          // quase branco (some no fundo da página) e quem separa é o `muted`; no
          // escuro é o contrário — o `muted` encosta no fundo e o cartão destaca.
          // O QUE NÓS MANDAMOS É VERDE SÓLIDO. Era `bg-primary/20`: no tema
          // escuro o véu de 20% caía quase no mesmo cinza da recebida, e os dois
          // lados da conversa ficavam com o mesmo peso — a queixa de "não dá
          // para ver quem é quem" era literalmente isso. A recebida ganhou
          // borda em vez de fundo mais claro, para não competir.
          entrada
            ? cn('border border-hairline bg-card text-foreground', fechaGrupo && 'rounded-bl-md')
            : cn('bg-primary text-primary-foreground', fechaGrupo && 'rounded-br-md'),
        )}
      >
        {mensagem.tipo === 'audio' ? <Audio mensagem={mensagem} /> : null}
        {mensagem.tipo === 'image' ? <Foto mensagem={mensagem} /> : null}
        {mensagem.tipo === 'video' ? <Video mensagem={mensagem} /> : null}
        {mensagem.tipo === 'document' ? <Documento mensagem={mensagem} /> : null}

        {mensagem.texto ? <Texto texto={mensagem.texto} /> : null}

        {!TIPOS_COM_ARQUIVO.has(mensagem.tipo) && semTexto ? <SemCorpo mensagem={mensagem} /> : null}

      </div>

      {fechaGrupo ? (
        <p
          className={cn(
            'mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-muted-foreground',
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
    </div>
  );
}

/**
 * O retrato de quem falou: duas letras num círculo, na coluna do lado dele.
 *
 * Não é enfeite. Numa conversa em que revezam o fornecedor, três pessoas do
 * time, o robô e a IA, o lado do balão distingue dois grupos — nós e eles — e
 * mais nada. O círculo distingue os cinco, e distingue antes de alguém ler.
 *
 * O robô e a IA têm ícone em vez de letra: eles não são gente, e dar iniciais a
 * eles seria exatamente a "tagzinha de IA" que o Rafael recusou — ao contrário,
 * na verdade: seria a máquina se fantasiando de pessoa.
 */
function Retrato({
  mensagem,
  nomeDoParceiro,
}: {
  mensagem: MensagemDoFio;
  nomeDoParceiro: string | null;
}) {
  // Guardar o tipo NUMA CONSTANTE é o que deixa o TypeScript saber, lá embaixo,
  // que `ROTULO_DO_ROBO` tem chave para ele: `mensagem.autorTipo` volta a ser o
  // tipo largo dentro do JSX.
  const robo =
    mensagem.autorTipo === 'bot_ai' ||
    mensagem.autorTipo === 'bot_fixed' ||
    mensagem.autorTipo === 'system'
      ? mensagem.autorTipo
      : null;

  if (!mensagem.entrada && robo !== null) {
    return (
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-muted text-muted-foreground"
        title={ROTULO_DO_ROBO[robo]}
      >
        {robo === 'bot_ai' ? (
          <Sparkles className="size-4" aria-hidden="true" />
        ) : (
          <Bot className="size-4" aria-hidden="true" />
        )}
        <span className="sr-only">{ROTULO_DO_ROBO[robo]}</span>
      </span>
    );
  }

  const nome = mensagem.entrada
    ? (nomeDoParceiro?.trim() || 'Parceiro')
    : (mensagem.autor ?? 'Time');

  return (
    <Avatar className="size-8 shrink-0" title={nome}>
      <AvatarFallback
        className={cn(
          'text-[11px] font-medium',
          mensagem.entrada ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary',
        )}
      >
        {iniciaisDe(nome)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Quem escreveu, em cima do balão e só quando acrescenta.
 *
 * De um lado a IA, o robô e o nome de quem do time escreveu — porque o número é
 * de todos e saber quem falou por último é a pergunta de quem entra na conversa
 * agora. Do outro, o nome do parceiro.
 *
 * O recebido ficou SEM nome por um tempo, com o argumento de que o lado do balão
 * já diz quem falou. Diz de quem NÃO é; não diz de quem é. Numa tela em que três
 * pessoas do time revezam no mesmo número e a conversa é lida do meio, "Buffet
 * Aurora" em cima do balão é o que fecha a conta — e é o nome que a pessoa pôs
 * no próprio WhatsApp, não o número (28/09/2026).
 */
function Quem({
  mensagem,
  nomeDoParceiro,
}: {
  mensagem: MensagemDoFio;
  nomeDoParceiro: string | null;
}) {
  const daIa = mensagem.autorTipo === 'bot_ai';
  const doRobo = mensagem.autorTipo === 'bot_fixed';
  // `system` é o que o BANCO monta sozinho — hoje, a confirmação de opt-out
  // (`GEN-SYS-OPTOUT`). Ele caía em "Alguém do time", e isso é falso: não houve
  // alguém. Ganhou nome em 28/09/2026 junto com a aba Automáticas, que usa estas
  // mesmas três palavras — se a tela nova e o fio chamassem a mesma coisa por
  // nomes diferentes, a pessoa teria de aprender duas vezes.
  const doSistema = mensagem.autorTipo === 'system';

  const quem = mensagem.entrada
    ? (nomeDoParceiro?.trim() || 'O parceiro')
    : mensagem.autorTipo === 'human'
      ? (mensagem.autor ?? 'Alguém do time')
      : ROTULO_DO_ROBO[mensagem.autorTipo];

  return (
    <p className="mb-1 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
      {mensagem.entrada ? null : daIa ? (
        <Sparkles className="size-3" aria-hidden="true" />
      ) : doRobo || doSistema ? (
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

/** Os tipos que trazem um arquivo para mostrar no balão (02/10/2026). */
const TIPOS_COM_ARQUIVO: ReadonlySet<string> = new Set(['audio', 'image', 'video', 'document']);

/**
 * A URL assinada do arquivo de uma mensagem.
 *
 * O que identifica o arquivo para o servidor é a MENSAGEM, não o caminho (ver
 * `urlDaMidia`). `midiaCaminho` continua valendo para saber se há arquivo
 * guardado: sem ele, nem vale a ida ao servidor.
 *
 * A URL vale cinco minutos (`/api/midia`). Quem fica mais tempo com a conversa
 * aberta e dá play num vídeo pega uma URL vencida — por isso `renovar()`, que o
 * player chama no erro, uma vez.
 */
function useArquivoDaMensagem(mensagem: MensagemDoFio): {
  estado: EstadoDoArquivo;
  url: string | null;
  renovar: () => void;
} {
  const caminho = mensagem.midiaCaminho;
  const messageId = mensagem.id;
  const [vez, setVez] = useState(0);
  // A resposta guarda O CAMINHO e a VEZ que ela responde. Sem isso, trocar de
  // conversa mostraria por um instante o arquivo anterior — de outra pessoa.
  const [assinada, setAssinada] = useState<{ chave: string; url: string | null } | null>(null);
  const chave = `${caminho ?? ''}#${vez}`;

  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    void urlDaMidia(messageId).then((url) => {
      if (vivo) setAssinada({ chave, url });
    });
    return () => {
      vivo = false;
    };
  }, [caminho, messageId, chave]);

  const resposta = assinada?.chave === chave ? assinada : null;
  const estado: EstadoDoArquivo = !caminho
    ? 'ausente'
    : resposta === null
      ? 'procurando'
      : resposta.url
        ? 'pronto'
        : 'ausente';
  return { estado, url: resposta?.url ?? null, renovar: () => setVez((v) => (v < 2 ? v + 1 : v)) };
}

/**
 * Abre o arquivo numa aba nova com uma URL RECÉM-ASSINADA. A do balão pode ter
 * vencido (cinco minutos); a aba é aberta antes do pedido para o navegador não
 * tratar como janela não solicitada.
 */
async function abrirArquivo(messageId: string): Promise<void> {
  const aba = window.open('', '_blank');
  const url = await urlDaMidia(messageId);
  if (aba === null) return;
  if (url) {
    aba.opener = null;
    aba.location.href = url;
  } else {
    aba.close();
  }
}

/**
 * Sem arquivo guardado. Diz o que aconteceu e o que vai acontecer: o worker tenta
 * buscar de novo na Meta o que chegou nos últimos 30 dias (`midias-atrasadas.ts`).
 */
function ArquivoAusente({ rotulo, icone }: { rotulo: string; icone: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <span className="mt-0.5 shrink-0">{icone}</span>
      <span>
        {rotulo} ainda sem arquivo no CRM. O CRM busca de novo na Meta o que chegou nos últimos 30
        dias; depois disso, só pedindo para a pessoa mandar outra vez.
      </span>
    </p>
  );
}

/** A foto, no balão. Um toque abre em tamanho real numa aba nova. */
function Foto({ mensagem }: { mensagem: MensagemDoFio }) {
  const { estado, url, renovar } = useArquivoDaMensagem(mensagem);
  if (estado === 'ausente') {
    return <ArquivoAusente rotulo="Foto" icone={<ImageIcon className="size-3.5" aria-hidden="true" />} />;
  }
  if (estado === 'procurando' || !url) {
    return <div className="h-48 w-64 max-w-full animate-pulse rounded-xl bg-muted" aria-label="Carregando a foto" />;
  }
  return (
    <button
      type="button"
      onClick={() => void abrirArquivo(mensagem.id)}
      className="block overflow-hidden rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      title="Abrir a foto em tamanho real"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do Storage: o otimizador do Next guardaria uma cópia de algo que tem de expirar. */}
      <img
        src={url}
        alt={mensagem.entrada ? 'Foto recebida' : 'Foto enviada'}
        loading="lazy"
        onError={renovar}
        className="max-h-80 w-auto max-w-full object-cover"
      />
    </button>
  );
}

/** O vídeo, com o player do navegador. `preload="metadata"`: só a capa e a duração. */
function Video({ mensagem }: { mensagem: MensagemDoFio }) {
  const { estado, url, renovar } = useArquivoDaMensagem(mensagem);
  if (estado === 'ausente') {
    return <ArquivoAusente rotulo="Vídeo" icone={<Film className="size-3.5" aria-hidden="true" />} />;
  }
  if (estado === 'procurando' || !url) {
    return <div className="h-48 w-72 max-w-full animate-pulse rounded-xl bg-muted" aria-label="Carregando o vídeo" />;
  }
  return (
    <video
      controls
      preload="metadata"
      playsInline
      src={url}
      onError={renovar}
      className="max-h-80 w-full max-w-md rounded-xl bg-black"
      aria-label={mensagem.entrada ? 'Vídeo recebido' : 'Vídeo enviado'}
    />
  );
}

/** O documento: um botão que abre o arquivo numa aba nova. */
function Documento({ mensagem }: { mensagem: MensagemDoFio }) {
  const { estado } = useArquivoDaMensagem(mensagem);
  if (estado === 'ausente') {
    return <ArquivoAusente rotulo="Documento" icone={<FileText className="size-3.5" aria-hidden="true" />} />;
  }
  const pdf = (mensagem.midiaTipo ?? '').includes('pdf');
  return (
    <button
      type="button"
      disabled={estado === 'procurando'}
      onClick={() => void abrirArquivo(mensagem.id)}
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
        mensagem.entrada
          ? 'border-hairline bg-muted/50 hover:bg-muted'
          : 'border-primary-foreground/20 bg-primary-foreground/10 hover:bg-primary-foreground/20',
      )}
    >
      <FileText className="size-4 shrink-0" aria-hidden="true" />
      {estado === 'procurando' ? 'Procurando o arquivo...' : pdf ? 'Abrir o PDF' : 'Abrir o documento'}
    </button>
  );
}

function Audio({ mensagem }: { mensagem: MensagemDoFio }) {
  const { estado, url } = useArquivoDaMensagem(mensagem);

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
      <p className="mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
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
