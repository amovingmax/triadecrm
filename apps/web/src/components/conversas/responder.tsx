'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { BellOff, NotebookPen, PenLine, SendHorizontal, Zap } from 'lucide-react';

import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

import { ErroDaConversa, responder } from './acoes';
import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';
import { EnviarModelo } from './enviar-modelo';
import { BotaoDaMidia, PainelDaMidia, useMidiaEscolhida } from './enviar-midia';
import { arquivosDaTransferencia } from './enviar-midia-dados';
import { GravarAudio } from './gravar-audio';
import { podeEscreverLivre } from './mensagens';
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
 * Uma ferramenta da fileira de baixo, no celular: pílula de 40 px com ícone e
 * nome. No computador ela volta a ser só o ícone dentro da moldura.
 */
const FERRAMENTA =
  'toque inline-flex items-center max-md:h-10 max-md:w-auto max-md:gap-1.5 max-md:rounded-full max-md:border max-md:border-hairline max-md:bg-card max-md:px-3.5 max-md:text-[13px] max-md:font-normal max-md:text-foreground max-md:[&_svg]:size-4';

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
    mutationFn: async (envio: { fioId: string; texto: string }) => {
      await responder(envio);
      esquecerTextoDigitado(dono, envio.fioId);
    },
    onSuccess: () => {
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

  return (
    <form
      className={cn('space-y-1.5', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (pode) enviar.mutate({ fioId, texto: limpo });
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

      {midia.itens.length > 0 ? (
        <PainelDaMidia fioId={fioId} midia={midia} aoEnviar={depoisDaMidia} />
      ) : null}

      {/* DOIS DESENHOS, UMA MARCAÇÃO SÓ (20/10/2026).

          Computador: uma caixa só — o texto, o clipe, o microfone e o enviar na
          mesma moldura, como em qualquer aplicativo de conversa.

          Celular (protótipo D, escolhido pelo usuário): a caixa de texto ocupa a
          largura e CRESCE PARA BAIXO, linha a linha; o enviar fica ao lado dela,
          redondo; e as ferramentas (respostas prontas, foto ou vídeo, áudio) vão
          para uma fileira embaixo, com nome. Antes os três ícones moravam dentro
          da moldura e a frase se espremia numa coluna estreita.

          É uma marcação só porque o gravador de áudio tem estado (gravando,
          ouvindo antes de mandar): dois gravadores, um escondido, dariam dois
          relógios. No computador os invólucros do celular viram `contents` e os
          filhos caem direto na moldura.

          Arrastar foto ou vídeo para cima da caixa também vale (16/10/2026). */}
      <div
        className={cn(
          'flex flex-col gap-2 md:flex-row md:items-end md:gap-1 md:rounded-2xl md:border md:border-input md:bg-card/60 md:py-1 md:pr-1 md:pl-2 md:transition-colors md:focus-within:border-ring md:focus-within:ring-3 md:focus-within:ring-ring/40',
          arrastando && 'rounded-2xl ring-3 ring-ring/40 md:border-ring',
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
        <div className="flex items-end gap-2 md:contents">
          <div className="flex min-w-0 flex-1 rounded-[20px] border border-input bg-card/60 px-3.5 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 md:contents">
            <textarea
              id="resposta"
              ref={caixa}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onPaste={(e) => {
                // Colar um print (Ctrl+V) leva à prévia; colar texto continua texto.
                const arquivos = arquivosDaTransferencia(e.clipboardData);
                if (arquivos.length === 0) return;
                e.preventDefault();
                midia.escolher(arquivos);
              }}
              onKeyDown={(e) => {
                // Enter manda no computador; no celular o Enter do teclado é quebra
                // de linha, e enviar ali seria mandar metade da frase toda vez.
                if (e.key !== 'Enter' || e.shiftKey) return;
                if (window.matchMedia?.('(pointer: coarse)').matches) return;
                e.preventDefault();
                if (pode) enviar.mutate({ fioId, texto: limpo });
              }}
              rows={1}
              placeholder="Mensagem"
              // 16px no celular: com menos que isso o Safari do iPhone dá zoom na
              // página inteira ao tocar na caixa, e quem responde tem de desfazer o
              // zoom com dois dedos a cada mensagem (20/10/2026).
              className="min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-base leading-relaxed outline-none placeholder:text-muted-foreground max-md:max-h-[calc(var(--altura-visivel,100svh)*0.3)] md:text-[15px]"
            />
          </div>
          <Button
            type="submit"
            size="icon"
            className="toque size-12 shrink-0 rounded-full max-md:bg-menta max-md:text-menta-tinta max-md:hover:bg-menta/90 md:order-last md:size-9"
            disabled={!pode}
          >
            <SendHorizontal aria-hidden="true" />
            <span className="sr-only">Enviar pelo WhatsApp</span>
          </Button>
        </div>

        {/* A fileira das ferramentas no celular. Gravar fica perto de Enviar no
            computador porque são a mesma decisão: como mandar isto. Dentro da
            janela de 24 h os três valem. */}
        <div className="flex flex-wrap items-center gap-1.5 md:contents">
          {(respostas.data ?? []).length > 0 ? (
            <button
              type="button"
              onClick={() => {
                // Abre a mesma lista do "/": a barra entra no fim do texto, e a
                // escolha troca a barra pela resposta.
                setTexto(texto.length === 0 || /\s$/.test(texto) ? `${texto}/` : `${texto} /`);
                caixa.current?.focus();
              }}
              className={cn(
                FERRAMENTA,
                'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden',
              )}
            >
              <Zap aria-hidden="true" />
              Respostas prontas
            </button>
          ) : null}
          <BotaoDaMidia aoEscolher={midia.escolher} rotulo="Anexo" className={FERRAMENTA} />
          <GravarAudio
            key={fioId}
            fioId={fioId}
            rotulo="Áudio"
            classeDoBotao={FERRAMENTA}
            className="max-md:w-full"
          />
        </div>
      </div>

      {/* Com a caixa vazia, a dica dos atalhos — e só no computador, onde há
          tecla para isso e espaço para dizer. No celular a mesma linha seria um
          rodapé permanente sobre uma tela que já é estreita. */}
      {texto.length === 0 ? (
        <p className="hidden px-1 text-[11px] leading-relaxed text-muted-foreground md:block">
          <code className="text-primary">/</code> abre as respostas prontas · Enter envia,
          Shift+Enter quebra a linha
        </p>
      ) : null}

      {texto.length > 0 ? (
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
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
