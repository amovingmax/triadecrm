'use client';

import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Loader2, LockKeyhole, SendHorizontal } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SeletorDeAba } from '@/components/ui/abas';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';
import { EscolherImovel } from '@/components/agenda/escolher-imovel';
import { anuncioPadrao } from '@/components/agenda/imovel-da-visita';
import { useAnunciosDaEscolha } from '@/components/agenda/imovel-da-visita-dados';

import { useCanais } from './canal-de-chegada-dados';
import { CHAVE_CONVERSAS } from './dados';
import {
  comecoPadrao,
  porqueOLinkNaoSai,
  previaComOComeco,
  recadoDoLink,
  TETO_DO_COMECO,
  TIPOS_DO_LINK,
  type TipoDoLink,
} from './link-da-agenda';
import {
  carregarPreviaDoLink,
  enviarLinkDaAgenda,
  fichaDaConversa,
  LINK_DA_AGENDA_NA_EMPRESA,
} from './link-da-agenda-dados';
import { useOrigemNoPortal } from './origem-no-portal-dados';
import type { EstadoDaJanela } from './tipos';

/**
 * "Enviar link da agenda" (11/11/2026, só na Imova, módulo `agendaComImovel`).
 *
 * Pedido do usuário: "Preciso que a IA envie o link da agenda para o cliente marcar
 * o horário da visita ao local ou horário da reunião. Caso seja visita presencial,
 * deverá ter o endereço e o código do imóvel/terreno que será tratado." A pessoa da
 * equipe manda o mesmo link que a IA manda, por aqui.
 *
 * DOIS LUGARES, A MESMA FOLHA. No clipe da caixa de escrever (onde moram os outros
 * envios que não são texto), e nas Ações dos dados do contato — que existem também
 * com a janela fechada, e aí o botão fica desligado e diz por quê, no tom do relógio
 * da janela: o link é texto livre, e fora da janela só passa modelo aprovado.
 *
 * A folha: o tipo ("Visita a um imóvel" ou "Reunião", o texto exato da pergunta do
 * Calendly); na visita, o anúncio, que já abre no de onde o cliente veio (o lead do
 * portal, "Veio do anúncio X", ou o código que a IA leu na placa); o começo da
 * mensagem, opcional; e a prévia, que é a do banco (`agenda_link_previa`). O envio é
 * `agenda_enviar_link`, que cria o convite e põe a mensagem na fila pela porteira de
 * sempre. Cada recusa vira frase (`recadoDoLink`).
 */
export function FolhaDoLinkDaAgenda({
  aberta,
  aoFechar,
  conversaId,
  organizacaoId,
  aoEnviar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  conversaId: string;
  /** A ficha da conversa, quando quem abre já sabe; senão a folha procura. */
  organizacaoId?: string | null;
  /** Saiu: quem abriu relê o que precisar (a citação do clipe fecha). */
  aoEnviar?: () => void;
}) {
  const ehCelular = useEhCelular();
  return (
    <Sheet open={aberta} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent
        side={ehCelular ? 'bottom' : 'right'}
        className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
      >
        <SheetHeader>
          <SheetTitle>Enviar link da agenda</SheetTitle>
          <SheetDescription>
            O cliente escolhe o horário no Calendly, e o compromisso entra na agenda já com a ficha,
            a conversa e, na visita, o imóvel.
          </SheetDescription>
        </SheetHeader>
        {/* Nasce a cada abertura: o que foi escolhido para uma conversa não vai
            para a próxima. */}
        {aberta ? (
          <Formulario
            conversaId={conversaId}
            organizacaoId={organizacaoId}
            aoEnviado={() => {
              aoEnviar?.();
              aoFechar();
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Formulario({
  conversaId,
  organizacaoId,
  aoEnviado,
}: {
  conversaId: string;
  organizacaoId?: string | null;
  aoEnviado: () => void;
}) {
  const id = useId();
  const clientes = useQueryClient();
  const [tipo, setTipo] = useState<TipoDoLink>('visita');
  // `undefined` = a pessoa ainda não mexeu: vale o anúncio de onde o cliente veio.
  // `null` = tocou em "Trocar" e ainda não escolheu outro.
  const [escolhido, setEscolhido] = useState<string | null | undefined>(undefined);
  const [comeco, setComeco] = useState('');
  const [recusa, setRecusa] = useState<string | null>(null);

  const anuncios = useAnunciosDaEscolha();
  const ficha = useQuery({
    queryKey: ['conversas', 'ficha-da-conversa', conversaId],
    queryFn: () => fichaDaConversa(conversaId),
    enabled: organizacaoId === undefined,
    staleTime: 5 * 60_000,
  });
  const origem = useOrigemNoPortal({
    conversaId,
    organizacaoId: organizacaoId === undefined ? (ficha.data ?? null) : organizacaoId,
  });
  const canais = useCanais();
  const padrao = anuncioPadrao(anuncios.data ?? [], {
    doLead: origem,
    daChegada: canais.porConversa.get(conversaId)?.foto?.codigo ?? null,
  });
  const anuncioId = tipo === 'visita' ? (escolhido === undefined ? padrao : escolhido) : null;
  const peloQueChegou = tipo === 'visita' && escolhido === undefined && padrao !== null;

  const previa = useQuery({
    queryKey: ['conversas', 'link-da-agenda', conversaId, tipo, anuncioId],
    queryFn: () => carregarPreviaDoLink({ conversaId, tipo, anuncioId }),
    enabled: tipo === 'reuniao' || anuncioId !== null,
    staleTime: 30_000,
  });
  const pronta = previa.data?.ok ? previa.data : null;

  const envio = useMutation({
    mutationFn: () =>
      enviarLinkDaAgenda({
        conversaId,
        tipo,
        anuncioId,
        texto: comeco.trim() || null,
      }),
    onSuccess: (r) => {
      if (!r.ok) {
        setRecusa(recadoDoLink(r.motivo, r.detalhe));
        return;
      }
      toast.success('Link da agenda na fila do WhatsApp.', {
        description:
          tipo === 'visita'
            ? 'Quando o cliente escolher o horário, a visita entra na agenda já com o imóvel.'
            : 'Quando o cliente escolher o horário, a reunião entra na agenda.',
      });
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      // A conversa aberta relê o fio, e a mensagem aparece na fila dela.
      void clientes.invalidateQueries({ queryKey: ['conversas', 'linha'] });
      aoEnviado();
    },
    onError: () => setRecusa(recadoDoLink('erro_do_servidor')),
  });

  const pode = pronta !== null && !envio.isPending && comeco.length <= TETO_DO_COMECO;

  return (
    <div className="flex flex-col gap-5 px-4 pb-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">O que o cliente vai marcar</p>
        <SeletorDeAba
          rotulo="O que o cliente vai marcar"
          ativo={tipo}
          aoTrocar={(novo) => {
            setTipo(novo);
            setRecusa(null);
          }}
          itens={TIPOS_DO_LINK}
        />
      </div>

      {tipo === 'visita' ? (
        <div className="flex flex-col gap-1.5">
          <EscolherImovel
            valor={{ modo: 'anuncio', anuncioId }}
            aoMudar={(e) => {
              setEscolhido(e.modo === 'anuncio' ? e.anuncioId : null);
              setRecusa(null);
            }}
            permiteSemAnuncio={false}
          />
          {peloQueChegou ? (
            <p className="text-xs text-muted-foreground">
              Já escolhido pelo anúncio de onde o cliente veio.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg bg-muted/45 px-3 py-2.5 text-sm text-muted-foreground">
          Na reunião, o link não leva imóvel: o cliente só escolhe o horário.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-comeco`} className="text-sm font-medium">
          Começo da mensagem <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <textarea
          id={`${id}-comeco`}
          rows={3}
          maxLength={TETO_DO_COMECO}
          value={comeco}
          onChange={(e) => {
            setComeco(e.target.value);
            setRecusa(null);
          }}
          placeholder={pronta ? comecoPadrao(pronta) : 'Oi! Para escolher o melhor horário:'}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base md:text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <p className="text-xs text-muted-foreground">
          Em branco, vai o começo de exemplo. O CRM acrescenta sempre
          {tipo === 'visita' ? ' a linha do imóvel e' : ''} o link pessoal do cliente.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Como sai</p>
        {tipo === 'visita' && anuncioId === null ? (
          <p className="rounded-lg bg-muted/45 px-3 py-3 text-sm text-muted-foreground">
            Escolha o imóvel para ver a mensagem.
          </p>
        ) : previa.isPending ? (
          <p className="rounded-lg bg-muted/45 px-3 py-3 text-sm text-muted-foreground">
            <Loader2 className="inline size-4 animate-spin" aria-hidden="true" /> Montando a
            mensagem…
          </p>
        ) : !previa.data || !previa.data.ok ? (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-3 text-sm text-destructive-texto"
          >
            {previa.data
              ? recadoDoLink(previa.data.motivo, previa.data.detalhe)
              : recadoDoLink('erro_do_servidor')}
          </p>
        ) : (
          // O balão de quem envia, como na conversa: o que o cliente vai ler.
          <div className="flex justify-end rounded-xl bg-muted/45 p-3">
            <p className="max-w-[92%] rounded-lg rounded-tr-none bg-wpp-sai px-2.5 py-1.5 text-[14px] leading-[1.45] break-words whitespace-pre-wrap text-foreground shadow-wpp">
              {previaComOComeco(previa.data, comeco)}
            </p>
          </div>
        )}
      </div>

      {recusa ? (
        <p role="alert" className="text-sm text-destructive-texto">
          {recusa}
        </p>
      ) : null}

      <Button
        size="lg"
        className="toque h-11 md:h-10"
        disabled={!pode}
        onClick={() => envio.mutate()}
      >
        {envio.isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <SendHorizontal aria-hidden="true" />
        )}
        Enviar pelo WhatsApp
      </Button>
    </div>
  );
}

/**
 * O botão das Ações dos dados do contato. Com a janela fechada (ou o contato
 * bloqueado, ou quem pediu para sair) fica desligado, e a frase embaixo diz por quê.
 */
export function BotaoDoLinkDaAgenda({
  conversaId,
  organizacaoId,
  janela,
  naoContatar = false,
  bloqueada = false,
  className,
  classeDoBloco,
}: {
  conversaId: string;
  organizacaoId: string | null;
  janela: EstadoDaJanela;
  naoContatar?: boolean;
  bloqueada?: boolean;
  className?: string;
  /** O bloco do botão e da frase (na folha do celular, a linha inteira). */
  classeDoBloco?: string;
}) {
  const [aberta, setAberta] = useState(false);
  if (!LINK_DA_AGENDA_NA_EMPRESA) return null;
  const porque = porqueOLinkNaoSai({ janela, naoContatar, bloqueada });

  return (
    <div className={cn('flex flex-col gap-1.5', classeDoBloco)}>
      <Button
        variant="outline"
        className={className}
        disabled={porque !== null}
        onClick={() => setAberta(true)}
      >
        <CalendarPlus aria-hidden="true" />
        Enviar link da agenda
      </Button>
      {porque ? (
        <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {porque}
        </p>
      ) : null}
      <FolhaDoLinkDaAgenda
        aberta={aberta}
        aoFechar={() => setAberta(false)}
        conversaId={conversaId}
        organizacaoId={organizacaoId}
      />
    </div>
  );
}
