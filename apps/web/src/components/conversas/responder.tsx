'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { BellOff, NotebookPen, PenLine, Reply, SendHorizontal, Smile, X, Zap } from 'lucide-react';

import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { avisarDigitando, ErroDaConversa, responder } from './acoes';
import { resumoDaMensagem } from './conteudo';
import { useFio } from './contexto-do-fio';
import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';
import { deveAvisarDigitando, inserirNoCursor } from './emojis';
import { EnviarModelo } from './enviar-modelo';
import { PainelDaMidia, useMidiaEscolhida } from './enviar-midia';
import { arquivosDaTransferencia } from './enviar-midia-dados';
import { GradeDeEmojis } from './grade-de-emojis';
import { GravarAudio } from './gravar-audio';
import { podeEscreverLivre } from './mensagens';
import { AvisoDeBloqueio } from './menu-da-conversa';
import { MenuDeAnexo } from './menu-de-anexo';
import { BotaoRedondo } from './wpp';
import {
  aplicarResposta,
  atalhoEmDigitacao,
  respostasQueBatem,
  type RespostaPronta,
} from './respostas-prontas';
import { DonoDoTextoDigitado, esquecerTextoDigitado, useTextoDigitado } from './texto-digitado';

/**
 * O teto da Cloud API para uma mensagem de texto. É o único limite que existe de
 * verdade aqui: `LIMITES_PADRAO.maxCaracteres` (300) é do robô, não de gente.
 */
const TETO_DO_WHATSAPP = 4096;
import type { EstadoDaJanela, FioDaConversa } from './tipos';

/**
 * A caixa de resposta — e, principalmente, o que ela NÃO deixa fazer.
 *
 * ===========================================================================
 * A JANELA MANDA NA CAIXA
 * ===========================================================================
 * Dentro da janela de 24 h: texto livre, e é de graça. Fora dela: só modelo
 * aprovado pela Meta, porque é regra da plataforma e tentar texto livre não dá
 * erro nosso, dá erro deles. Então a caixa MUDA de forma conforme o relógio
 * acima dela — não é um aviso ao lado de um campo que continua aceitando tudo.
 *
 * Deixar a pessoa digitar e só depois recusar seria pior do que não deixar: ela
 * escreveu, pensou, e o trabalho foi para o lixo na hora de enviar. O gatilho
 * `messages_guard` recusaria de qualquer jeito (`sem_janela_e_sem_template`); a
 * tela existe para ninguém chegar até lá.
 *
 * ===========================================================================
 * E O QUE SAI, SAI PELA FILA
 * ===========================================================================
 * O que sai daqui entra em `messages` como `queued` e o worker de envio entrega
 * pela Cloud API, com o número da KOMUNE. O gatilho reconfere supressão e teto
 * na hora da entrega, não só na hora do clique — quem pedir para sair nesse
 * meio-tempo não recebe.
 *
 * ===========================================================================
 * E QUEM PEDIU PARA SAIR NÃO TEM CAIXA
 * ===========================================================================
 * A janela diz "agora não"; o opt-out diz "nunca mais". Por isso ele é a
 * PRIMEIRA pergunta desta função, antes da janela e antes de existir fio: o que
 * vale para texto livre vale igual para modelo aprovado e para o primeiro
 * contato de um fio que ainda não nasceu. Um formulário aberto para quem pediu
 * para sair é um convite a escrever uma mensagem que o banco vai recusar — e o
 * pior é que a pessoa só descobre depois de escrever.
 */
export function CaixaDeResposta({
  fio,
  janela,
  organizacaoId,
  naoContatar = false,
  recolhida = false,
  className,
}: {
  fio: FioDaConversa | null;
  janela: EstadoDaJanela;
  organizacaoId: string;
  /**
   * A ficha está em `do_not_contact`.
   *
   * O padrão é `false` porque a ausência do dado não pode virar um bloqueio: a
   * tela que não souber informar mostra a caixa, e o gatilho continua sendo o
   * guardrail de verdade. O contrário — presumir opt-out — esconderia a caixa
   * de todo mundo no dia em que alguém esquecesse de passar a prop.
   */
  naoContatar?: boolean;
  /**
   * Há um rascunho esperando aprovação logo acima.
   *
   * Aí a caixa nasce fechada, num botão de uma linha. Não é economia de pixel:
   * com rascunho na tela, a decisão é aprovar, editar ou descartar — e em 390 px
   * a caixa aberta empurrava justamente o "o que a IA entendeu" para fora da
   * vista, que é a parte que faz a aprovação não ser às cegas. Quem prefere
   * escrever à mão continua a um toque.
   */
  recolhida?: boolean;
  className?: string;
}) {
  const [aberta, setAberta] = useState(false);
  // Quem já tinha começado a escrever encontra a caixa aberta, com o texto: um
  // botão "Prefiro escrever" por cima do que a pessoa digitou o esconderia.
  const [digitado] = useTextoDigitado(fio?.id ?? null);
  const temDigitado = digitado.trim().length > 0;

  if (naoContatar) return <PediuParaSair organizacaoId={organizacaoId} className={className} />;

  // Sem conversa, ou com a janela de 24 h fechada, só modelo aprovado atravessa —
  // e é a mesma caixa para os dois (migração 20260914100000).
  if (!fio)
    return <EnviarModelo destino={{ tipo: 'ficha', organizacaoId }} className={className} />;

  // Bloqueado (27/10/2026): nada sai para o número, nem modelo. A caixa dá lugar
  // ao aviso e ao "Desbloquear".
  if (fio.bloqueadaEm) {
    return (
      <AvisoDeBloqueio
        fioId={fio.id}
        quem={fio.bloqueadaPor}
        naMeta={fio.bloqueioNaMeta}
        erro={fio.bloqueioErro}
        atualizar={[chaveDaLinha(organizacaoId)]}
        className={className}
      />
    );
  }

  if (recolhida && !aberta && !temDigitado) {
    return (
      <Button
        variant="outline"
        className={cn('toque h-11 w-full md:h-9 md:w-auto', className)}
        onClick={() => setAberta(true)}
      >
        <PenLine aria-hidden="true" />
        Prefiro escrever a resposta
      </Button>
    );
  }

  return podeEscreverLivre(janela) ? (
    // `key` pela conversa: a foto escolhida numa conversa nunca fica esperando na
    // prévia de outra (16/10/2026).
    <TextoLivre
      key={fio.id}
      fioId={fio.id}
      atualizar={[chaveDaLinha(organizacaoId)]}
      className={className}
    />
  ) : (
    <EnviarModelo destino={{ tipo: 'ficha', organizacaoId }} className={className} />
  );
}

/**
 * O parceiro pediu para não receber mais nada.
 *
 * Este bloco não é um aviso ao lado de um campo que continua aceitando texto: ele
 * SUBSTITUI o formulário. E não oferece "registrar contato por telefone", que é a
 * saída dos outros dois blocos daqui — telefonar para quem pediu para sair é o
 * mesmo contato por outro canal, e a tela de registro já recusa o caso. A única
 * ação que sobra é a honesta: abrir a ficha e anotar.
 */
function PediuParaSair({
  organizacaoId,
  className,
}: {
  organizacaoId: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2 rounded-xl border border-dashed border-hairline p-3', className)}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <BellOff className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Este parceiro pediu para não receber mais mensagens
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Nada sai daqui para ele: nem texto livre dentro da janela de 24 h, nem modelo aprovado fora
        dela. O banco recusaria o envio de qualquer jeito, e a caixa fecha antes para ninguém
        escrever à toa. Se ele procurou você, anote na ficha — anotação não devolve ninguém para a
        fila.
      </p>
      <Button asChild variant="outline" className="toque h-11 md:h-9">
        <Link href={`/parceiros/${organizacaoId}`}>
          <NotebookPen aria-hidden="true" />
          Abrir a ficha do parceiro
        </Link>
      </Button>
    </div>
  );
}

/** Até onde a caixa cresce sozinha: dez linhas, e daí em diante ela rola. */
const ALTURA_MAXIMA = 220;

/**
 * Janela aberta: texto livre, que é o que a Meta permite e não cobra.
 *
 * Exportada e sem ficha nas props desde 01/10/2026: a conversa de quem NÃO é
 * parceiro (cliente, curioso) usa a mesma caixa, na aba Clientes. Quem chama
 * diz quais leituras refazer depois do envio.
 */
export function TextoLivre({
  fioId,
  atualizar = [],
  className,
}: {
  fioId: string;
  /** Chaves de consulta a refazer depois do envio, além da lista de conversas. */
  atualizar?: readonly (readonly unknown[])[];
  className?: string;
}) {
  const clientes = useQueryClient();
  // O TEXTO SOBREVIVE À TROCA DE CONVERSA (02/10/2026). Era um `useState`, e a
  // conversa é remontada a cada troca: clicar em outra apagava o que estava
  // escrito. Agora ele mora em `texto-digitado.ts`, por conversa, no navegador
  // de quem digitou — volta à caixa na reabertura, e a lista mostra "Rascunho:".
  // O que é ENVIADO não mudou: o mesmo `responder`, com o mesmo texto aparado.
  const dono = useContext(DonoDoTextoDigitado);
  const [texto, setTexto] = useTextoDigitado(fioId);
  // A citação (27/10/2026): o balão escolhe, a caixa manda. Só a desta conversa.
  const doFio = useFio();
  const citando = doFio?.citando && doFio.citando.fioId === fioId ? doFio.citando : null;
  const pararDeCitar = doFio?.citar;
  // "Digitando…" para o contato, no máximo a cada 15 s (`emojis.ts`). Só o que
  // se digita na caixa conta: escolher uma resposta pronta não é digitar. O
  // relógio é o do evento (`timeStamp`), que anda junto em toda tecla.
  const avisadoEm = useRef<number | null>(null);
  const aoDigitar = (novo: string, agora: number) => {
    setTexto(novo);
    if (deveAvisarDigitando({ ultimoEm: avisadoEm.current, agora, texto: novo })) {
      avisadoEm.current = agora;
      void avisarDigitando(fioId);
    }
  };
  const respostas = useQuery({
    queryKey: ['conversas', 'respostas-prontas'],
    queryFn: async (): Promise<RespostaPronta[]> => {
      const { data } = await createClient()
        .from('respostas_rapidas')
        .select('id, atalho, titulo, texto')
        .eq('ativo', true)
        .order('atalho');
      return (data ?? []) as RespostaPronta[];
    },
    staleTime: 5 * 60_000,
  });
  const digitando = atalhoEmDigitacao(texto);
  const sugestoes = digitando === null ? [] : respostasQueBatem(respostas.data ?? [], digitando);

  const enviar = useMutation({
    // O texto enviado é esquecido AQUI, logo depois de a fila aceitar, e não no
    // `onSuccess`: se a pessoa trocar de conversa enquanto envia, a caixa sai da
    // tela, e um texto que ficasse guardado voltaria como rascunho de uma
    // mensagem que já foi — convite a mandá-la duas vezes. Se a fila recusar, o
    // texto fica onde está, como sempre ficou.
    mutationFn: async (envio: { fioId: string; texto: string; respondeA: string | null }) => {
      await responder(envio);
      esquecerTextoDigitado(dono, envio.fioId);
    },
    onSuccess: () => {
      pararDeCitar?.(null);
      toast.success('Mensagem na fila do WhatsApp.', {
        description: `Sai pelo número da ${EMPRESA.nomeDoNumero} em instantes.`,
      });
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      for (const chave of atualizar) void clientes.invalidateQueries({ queryKey: chave });
    },
    onError: (erro) => {
      toast.error('A mensagem não entrou na fila.', {
        description:
          erro instanceof ErroDaConversa ? erro.message : 'Tente de novo em alguns segundos.',
      });
    },
  });

  // Foto e vídeo (16/10/2026): o que foi escolhido, colado ou arrastado espera
  // na prévia, em cima da caixa, até alguém mandar ou cancelar.
  const midia = useMidiaEscolhida();
  const [arrastando, setArrastando] = useState(false);
  const depoisDaMidia = () => {
    void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
    for (const chave of atualizar) void clientes.invalidateQueries({ queryKey: chave });
  };
  // O que sai pelo clipe leva a citação junto, e a fecha.
  const destino = {
    fioId,
    respondeA: citando?.id ?? null,
    aoEnviar: () => {
      pararDeCitar?.(null);
      depoisDaMidia();
    },
  };

  const limpo = texto.trim();
  // O teto de 300 de `LIMITES_PADRAO` é do ROBÔ (RF-CON-24): ele existe para a
  // resposta automática não virar um texto de vendas. Aplicá-lo a uma pessoa que
  // está escrevendo à mão era um erro de categoria — quem fala com o parceiro é
  // gente, e gente escreve o que precisa. O teto aqui é o da Cloud API.
  const longo = texto.length > TETO_DO_WHATSAPP;
  const pode = limpo.length > 0 && !enviar.isPending && !longo;

  // A CAIXA CRESCE COM O TEXTO, de uma linha até dez.
  //
  // Ela era fixa em duas linhas: quem escreve três parágrafos digitava dentro de
  // uma janelinha rolando, e quem escreve "ok" pagava duas linhas de altura numa
  // tela de 390 px onde cada linha é uma mensagem a menos à vista.
  const caixa = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAXIMA)}px`;
  }, [texto]);

  // Escolheu "Responder" num balão: o cursor vem para cá.
  const citandoId = citando?.id ?? null;
  useEffect(() => {
    if (citandoId) caixa.current?.focus();
  }, [citandoId]);

  /** O emoji entra onde o cursor estava, e o cursor fica depois dele. */
  function porEmoji(emoji: string) {
    const el = caixa.current;
    const { texto: novo, cursor } = inserirNoCursor(
      texto,
      el?.selectionStart,
      el?.selectionEnd,
      emoji,
    );
    setTexto(novo);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }
  const mandar = () => enviar.mutate({ fioId, texto: limpo, respondeA: citando?.id ?? null });

  return (
    <form
      className={cn('space-y-1.5', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (pode) mandar();
      }}
    >
      <label htmlFor="resposta" className="sr-only">
        Escrever a resposta
      </label>
      {sugestoes.length > 0 ? (
        <ul
          aria-label="Respostas prontas"
          className="max-h-48 overflow-y-auto rounded-xl border border-hairline bg-popover shadow-sm"
        >
          {sugestoes.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setTexto(aplicarResposta(texto, r))}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <code className="shrink-0 text-primary">/{r.atalho}</code>
                <span className="min-w-0 truncate text-muted-foreground">{r.titulo}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {citando ? (
        <BarraDaCitacao
          resumo={resumoDaMensagem(citando)}
          quem={
            citando.entrada ? doFio?.nomeDoParceiro?.trim() || 'Contato' : (citando.autor ?? 'Time')
          }
          aoCancelar={() => pararDeCitar?.(null)}
        />
      ) : null}

      {midia.itens.length > 0 ? (
        <PainelDaMidia
          fioId={fioId}
          midia={midia}
          aoEnviar={depoisDaMidia}
          respondeA={citando?.id ?? null}
          aoCitar={() => pararDeCitar?.(null)}
        />
      ) : null}

      {/* A CAIXA DO WHATSAPP (03/11/2026), do protótipo aprovado. Uma marcação só
          para os dois aparelhos, porque o gravador de áudio tem estado (gravando,
          ouvindo antes de mandar) e dois gravadores dariam dois relógios:

          Computador: emoji, anexo e respostas prontas à esquerda, o texto numa
          pílula e, na ponta, o enviar verde — ou o microfone, com a caixa vazia.

          Celular: a pílula leva o emoji, o texto, as respostas prontas e o anexo;
          o botão redondo verde fica ao lado (enviar ou microfone). No computador
          a pílula vira `contents` e os filhos caem direto na fileira, na ordem
          do `md:order-*`. A caixa continua crescendo para baixo, linha a linha
          (protótipo D, 20/10/2026).

          Arrastar foto ou vídeo para cima da caixa também vale (16/10/2026). */}
      <div
        className={cn(
          'flex flex-wrap items-end gap-1.5 md:flex-nowrap md:gap-0.5',
          arrastando && 'rounded-3xl ring-3 ring-ring/40',
        )}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          setArrastando(false);
          const arquivos = arquivosDaTransferencia(e.dataTransfer);
          if (arquivos.length === 0) return;
          e.preventDefault();
          midia.escolher(arquivos);
        }}
      >
        <div className="flex min-h-11 min-w-0 flex-1 items-end rounded-3xl border border-wpp-linha bg-wpp-campo px-0.5 md:contents">
          <SeletorDeEmoji aoEscolher={porEmoji} className="max-md:size-[42px] md:order-1" />
          <textarea
            id="resposta"
            ref={caixa}
            value={texto}
            onChange={(e) => aoDigitar(e.target.value, e.timeStamp)}
            onPaste={(e) => {
              // Colar uma foto (print, imagem copiada) também anexa (16/10/2026).
              const arquivos = arquivosDaTransferencia(e.clipboardData);
              if (arquivos.length === 0) return;
              e.preventDefault();
              midia.escolher(arquivos);
            }}
            onKeyDown={(e) => {
              // Enter envia e Shift+Enter quebra a linha, no computador. No celular
              // o Enter do teclado quebra a linha: quem envia é o botão.
              if (e.key !== 'Enter' || e.shiftKey) return;
              if (window.matchMedia?.('(pointer: coarse)').matches) return;
              e.preventDefault();
              if (pode) mandar();
            }}
            rows={1}
            placeholder="Mensagem"
            title="/ abre as respostas prontas · Enter envia, Shift+Enter quebra a linha"
            // 16px no celular: abaixo disso o Safari do iPhone dá zoom no campo.
            className={cn(
              'min-h-[42px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-base leading-snug outline-none placeholder:text-wpp-suave',
              'max-md:max-h-[calc(var(--altura-visivel,100svh)*0.3)]',
              'md:order-4 md:ml-1.5 md:min-h-[46px] md:rounded-[23px] md:border md:border-wpp-linha md:bg-wpp-campo md:px-[18px] md:py-3 md:text-[15px] md:focus-visible:ring-3 md:focus-visible:ring-ring/40',
            )}
          />
          {(respostas.data ?? []).length > 0 ? (
            <BotaoRedondo
              onClick={() => {
                // O "/" no fim do texto abre a lista das respostas prontas, a
                // mesma que aparece quando se digita a barra.
                setTexto(texto.length === 0 || /\s$/.test(texto) ? `${texto}/` : `${texto} /`);
                caixa.current?.focus();
              }}
              aria-label="Respostas prontas"
              className="max-md:h-[42px] max-md:w-9 md:order-3"
            >
              <Zap aria-hidden="true" />
            </BotaoRedondo>
          ) : null}
          <MenuDeAnexo
            midia={midia}
            destino={destino}
            className="size-[42px] rounded-full text-wpp-suave hover:bg-foreground/[0.07] md:order-2 md:size-11 [&_svg]:size-[19px]"
          />
        </div>
        {limpo.length > 0 ? (
          <Button
            type="submit"
            size="icon"
            className="toque size-11 shrink-0 rounded-full bg-menta text-menta-tinta hover:bg-menta/90 md:order-5 md:ml-2 md:size-[46px]"
            disabled={!pode}
          >
            <SendHorizontal aria-hidden="true" />
            <span className="sr-only">Enviar pelo WhatsApp</span>
          </Button>
        ) : (
          <GravarAudio
            key={fioId}
            fioId={fioId}
            classeDoBotao="toque size-11 shrink-0 rounded-full bg-menta text-menta-tinta hover:bg-menta/90 md:order-5 md:ml-2 md:size-[46px] md:bg-transparent md:text-wpp-suave md:hover:bg-foreground/[0.07] [&_svg]:size-5"
            className="order-last basis-full"
            respondeA={citando?.id ?? null}
            aoEnviar={() => pararDeCitar?.(null)}
          />
        )}
      </div>

      {/* A assinatura não aparece no balão do CRM, então a caixa diz como sai — só
          no computador. No celular a linha aparecia ao começar a digitar e
          empurrava a conversa para cima, o que o WhatsApp não faz (04/11/2026);
          lá o nome de quem escreveu já vai no alto do balão enviado. O aviso de
          texto longo demais continua nos dois. */}
      {texto.length > 0 ? (
        <p
          className={cn(
            'px-3 text-[11px] leading-relaxed text-wpp-suave',
            texto.length <= TETO_DO_WHATSAPP - 400 && 'max-md:hidden',
          )}
        >
          Sai com seu primeiro nome em negrito na frente.
          {texto.length > TETO_DO_WHATSAPP - 400 ? (
            <span className={cn(longo && 'text-destructive-texto')}>
              {' · '}
              <span className="numerico">{texto.length}</span> de{' '}
              <span className="numerico">{TETO_DO_WHATSAPP}</span> caracteres
            </span>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}

/**
 * "Respondendo a…" em cima da caixa (27/10/2026): quem e o começo do que foi
 * dito. O X desiste da citação, não do texto.
 */
function BarraDaCitacao({
  quem,
  resumo,
  aoCancelar,
}: {
  quem: string;
  resumo: string;
  aoCancelar: () => void;
}) {
  return (
    <div className="mx-1 flex items-center gap-2.5 rounded-xl border-l-4 border-l-wpp-cita-barra bg-wpp-cita py-1.5 pr-1 pl-3">
      <Reply className="size-4 shrink-0 text-wpp-suave" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug">
        <span className="block text-[12.5px] font-semibold text-wpp-cita-nome">
          Respondendo a {quem}
        </span>
        <span className="block truncate text-wpp-suave">{resumo}</span>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="toque size-9 shrink-0"
        onClick={aoCancelar}
        aria-label="Não citar"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

/** O botão do emoji, dentro da caixa: a grade da casa (`grade-de-emojis.tsx`). */
function SeletorDeEmoji({
  aoEscolher,
  className,
}: {
  aoEscolher: (emoji: string) => void;
  className?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <BotaoRedondo title="Emoji" className={className}>
          <Smile aria-hidden="true" />
          <span className="sr-only">Pôr um emoji</span>
        </BotaoRedondo>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[22rem] max-w-[calc(100vw-2rem)]">
        <GradeDeEmojis aoEscolher={aoEscolher} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
