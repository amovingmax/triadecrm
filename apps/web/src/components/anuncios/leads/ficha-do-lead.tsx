'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArchiveRestore,
  CircleCheck,
  ExternalLink,
  Hand,
  MessageCircle,
  Trash2,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';

import { CHAVE_DOS_ANUNCIOS } from '../dados';
import { fraseDaRecusa } from '../tipos';
import { assumirLead, mudarLead } from './leads-dados';
import {
  chegouEm,
  comoChegouOLead,
  contatoApagaEm,
  dataDoLead,
  dataHoraDoLead,
  ehLeadDoWhatsapp,
  escreveuNoPortal,
  marcaRespondidoAMao,
  nomeDoLead,
  nomeNoPortalDiferente,
  origemDoLead,
  primeiraMensagemDoLead,
  quandoChegou,
  recebidoHa,
  respostaDoLead,
  rotuloDaTransacao,
  rotuloDoPortal,
  rotuloDoTipo,
  SITUACOES_DO_LEAD,
  tiposDoLead,
  type LeadDoPortal,
  type SituacaoDoLead,
} from './leads-rotulos';
import {
  ChipDaTemperatura,
  ComoChegou,
  IconeDoTipo,
  SeloDaSituacao,
  TelefoneDoLead,
} from './partes-do-lead';

/**
 * A ficha do lead (05/11/2026): a folha que abre ao tocar numa linha — à
 * direita no computador, por baixo no celular.
 *
 * Mostra o que decide a resposta: quem é (e o nome que deu no portal, quando é
 * outro), de qual anúncio veio (ou de qual é parecido, no Lead Certo), por onde
 * chegou, a primeira mensagem e quem do time respondeu, e em quanto tempo. As
 * ações são as do lead — assumir, marcar como respondido (só quem escreveu pelo
 * portal: no WhatsApp a situação muda sozinha), descartar com motivo — e os dois
 * caminhos para responder de fato, que são a conversa e a ficha do cliente.
 * Nada daqui manda mensagem.
 *
 * Quem só clicou (`grupo = 'clicou'`) não tem ficha nem conversa: a folha diz
 * isso, mostra o contato que o portal mandou (apagado 90 dias depois) e deixa
 * revelar o telefone, com registro, para ligar.
 */
export function FichaDoLead({
  lead,
  aoFechar,
  euId,
  agora,
}: {
  lead: LeadDoPortal | null;
  aoFechar: () => void;
  euId: string;
  agora: Date;
}) {
  const ehCelular = useEhCelular();
  return (
    <Sheet open={lead !== null} onOpenChange={(aberta) => !aberta && aoFechar()}>
      <SheetContent
        side={ehCelular ? 'bottom' : 'right'}
        className="sombra-base-forte max-h-[92dvh] gap-0 overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
      >
        {lead ? <Corpo key={lead.id} lead={lead} euId={euId} agora={agora} /> : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * O endereço da conversa: com ficha, `?org=`; sem ficha (a ficha automática
 * ainda não rodou), a conversa pelo id, em `?cliente=` — o mesmo par que
 * `urlDoEstado`, de Conversas, escreve.
 */
export function enderecoDaConversa(
  lead: Pick<LeadDoPortal, 'organization_id' | 'conversation_id'>,
): string | null {
  if (!lead.conversation_id) return null;
  return lead.organization_id
    ? `/conversas?org=${encodeURIComponent(lead.organization_id)}`
    : `/conversas?cliente=${encodeURIComponent(lead.conversation_id)}`;
}

function Corpo({ lead, euId, agora }: { lead: LeadDoPortal; euId: string; agora: Date }) {
  const cliente = useQueryClient();
  const [ocupado, setOcupado] = useState<'assumir' | 'respondido' | 'voltar' | null>(null);

  const { nome, semNome } = nomeDoLead(lead);
  const noPortal = nomeNoPortalDiferente(lead);
  const mandou = lead.grupo === 'mensagem';
  const origem = origemDoLead(lead);
  const tipos = tiposDoLead(lead.tipos);
  const chegou = chegouEm(lead);
  const clicou = quandoChegou(lead);
  const como = comoChegouOLead(lead);
  // 12/11/2026: o lead que nasceu da conversa (o texto do anúncio no WhatsApp).
  const doWhatsapp = ehLeadDoWhatsapp(lead);
  const portal = rotuloDoPortal(lead.portal);
  const resposta = respostaDoLead(lead, agora);
  const primeira = primeiraMensagemDoLead(lead);
  const transacao = rotuloDaTransacao(lead.transacao);
  const ehMeu = lead.responsavel_id === euId;
  const descartado = lead.situacao === 'descartado';
  const conversa = enderecoDaConversa(lead);
  // Pela conversa só quando há conversa ligada: o lead do WhatsApp de quem pediu
  // para não ser contatado chega sem ela.
  const pelaConversa = mandou && lead.chegou_por === 'whatsapp' && Boolean(lead.conversation_id);
  // A mensagem do portal, inteira (a da lista vem cortada em 280 letras), só
  // quando a pessoa escreveu nele: no clique, o portal manda um texto pronto.
  const mensagemNoPortal = (escreveuNoPortal(lead.tipos) && lead.mensagem?.trim()) || null;

  function atualizar() {
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
  }

  async function voltarPara(situacao: SituacaoDoLead) {
    const r = await mudarLead(lead.id, situacao);
    atualizar();
    if (!r.ok) toast.error('Não deu para desfazer.', { description: fraseDaRecusa(r.motivo) });
  }

  async function assumir() {
    setOcupado('assumir');
    const r = await assumirLead(lead.id);
    setOcupado(null);
    atualizar();
    if (!r.ok) {
      toast.error('Não deu para assumir.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    toast.success(
      lead.responsavel_nome
        ? `O lead era de ${lead.responsavel_nome}. Agora é seu.`
        : 'O lead é seu agora.',
    );
  }

  async function mudar(situacao: SituacaoDoLead, acao: 'respondido' | 'voltar') {
    // O desfazer volta à situação GRAVADA: a "respondido" da conversa é do banco.
    const antes = lead.situacao_registrada ?? lead.situacao;
    setOcupado(acao);
    const r = await mudarLead(lead.id, situacao);
    setOcupado(null);
    atualizar();
    if (!r.ok) {
      toast.error('Não deu para mudar.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    toast.success(
      situacao === 'respondido'
        ? 'Marcado como respondido.'
        : `De volta à lista, em "${SITUACOES_DO_LEAD[situacao]}".`,
      { action: { label: 'Desfazer', onClick: () => void voltarPara(antes) } },
    );
  }

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle className={cn('text-lg leading-tight', semNome && 'text-muted-foreground')}>
          {nome}
        </SheetTitle>
        {noPortal ? (
          <p className="text-sm text-muted-foreground">
            {doWhatsapp ? 'No WhatsApp' : 'No portal'}:{' '}
            <span className="text-foreground">{noPortal}</span>
          </p>
        ) : null}
        <SheetDescription>
          <span title={dataHoraDoLead(chegou)}>
            {mandou ? `${como ?? 'Mandou mensagem'} · ${recebidoHa(chegou, agora)}` : null}
            {mandou ? null : `Clicou ${recebidoHa(chegou, agora)}`}
          </span>
          {transacao ? ` · ${transacao}` : ''}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {/* Quem só clicou não escreveu: "sem resposta" não diz nada dele. */}
          {mandou || descartado ? <SeloDaSituacao situacao={lead.situacao} /> : null}
          <ChipDaTemperatura valor={lead.temperatura} completo />
          {lead.responsavel_nome ? (
            <span className="text-xs text-muted-foreground">
              com {ehMeu ? 'você' : lead.responsavel_nome}
            </span>
          ) : null}
        </div>
        {resposta ? (
          <p
            className={cn(
              'pt-1 text-sm',
              resposta.respondido ? 'text-muted-foreground' : 'font-medium',
            )}
          >
            {resposta.frase}
          </p>
        ) : null}
      </SheetHeader>

      <div className="flex flex-col gap-5 px-4 pb-4">
        <Acoes>
          {conversa ? (
            <Button asChild className="toque h-11 md:h-9">
              <Link href={conversa}>
                <MessageCircle aria-hidden="true" />
                Abrir conversa
              </Link>
            </Button>
          ) : null}
          {lead.organization_id ? (
            <Button asChild variant="outline" className="toque h-11 md:h-9">
              <Link href={`/parceiros/${lead.organization_id}`}>
                <UserRound aria-hidden="true" />
                Ver ficha
              </Link>
            </Button>
          ) : null}
          {!descartado && !ehMeu ? (
            <Button
              type="button"
              variant="outline"
              className="toque h-11 md:h-9"
              disabled={ocupado !== null}
              onClick={() => void assumir()}
            >
              <Hand aria-hidden="true" />
              {ocupado === 'assumir' ? 'Assumindo...' : 'Assumir'}
            </Button>
          ) : null}
          {!descartado && lead.situacao !== 'respondido' && marcaRespondidoAMao(lead) ? (
            <Button
              type="button"
              variant="outline"
              className="toque h-11 md:h-9"
              disabled={ocupado !== null}
              onClick={() => void mudar('respondido', 'respondido')}
            >
              <CircleCheck aria-hidden="true" />
              {ocupado === 'respondido' ? 'Marcando...' : 'Marcar como respondido'}
            </Button>
          ) : null}
          {descartado ? (
            <Button
              type="button"
              variant="outline"
              className="toque h-11 md:h-9"
              disabled={ocupado !== null}
              onClick={() => void mudar(lead.responsavel_id ? 'em_atendimento' : 'novo', 'voltar')}
            >
              <ArchiveRestore aria-hidden="true" />
              {ocupado === 'voltar' ? 'Trazendo...' : 'Trazer de volta'}
            </Button>
          ) : (
            <BotaoDescartar
              lead={lead}
              nome={semNome ? null : nome}
              disabled={ocupado !== null}
              className="toque h-11 text-muted-foreground md:h-9"
            />
          )}
        </Acoes>
        {pelaConversa && !descartado && lead.situacao !== 'respondido' ? (
          <p className="-mt-3 text-xs text-muted-foreground">
            Quando alguém do time responder na conversa, o lead fica como respondido sozinho.
          </p>
        ) : mandou && lead.organization_id && !lead.conversation_id ? (
          <p className="-mt-3 text-xs text-muted-foreground">
            Ainda não há conversa de WhatsApp com essa pessoa.
          </p>
        ) : null}

        {descartado ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="font-medium">Descartado</span>
            {lead.motivo_descarte ? `: “${lead.motivo_descarte}”` : '.'}
          </p>
        ) : null}

        {!mandou ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            Ainda não mandou mensagem. Se chamar no WhatsApp, a conversa chega com a etiqueta deste
            anúncio.
          </p>
        ) : null}

        <Bloco titulo="Contato">
          <ContatoDoLead lead={lead} />
        </Bloco>

        <Bloco titulo={origem.tipo === 'parecido' ? 'Parecido com o anúncio' : 'Anúncio'}>
          {origem.codigo ? (
            <div className="flex flex-col gap-1 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="numerico font-medium">{origem.codigo}</span>
                {lead.anuncio_titulo ? <span>{lead.anuncio_titulo}</span> : null}
              </p>
              {lead.anuncio_id ? (
                <Link
                  href={`/anuncios/${lead.anuncio_id}`}
                  className="w-fit text-sm underline underline-offset-4"
                >
                  Abrir o anúncio
                </Link>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {lead.anuncio_no_canal_pro_id
                    ? 'Está no Canal Pro, por fora do CRM.'
                    : 'Esse código não está no CRM.'}
                </p>
              )}
              {origem.tipo === 'parecido' ? (
                <p className="text-xs text-muted-foreground">
                  Lead Certo: a pessoa procurou um imóvel parecido em outro anúncio, e o Grupo OLX
                  indicou a Imova. Ela não viu este anúncio.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{origem.frase}.</p>
          )}
        </Bloco>

        <Bloco titulo={mandou ? 'Como chegou' : 'O que tocou no anúncio'}>
          {mandou ? <ComoChegou lead={lead} className="text-sm" /> : null}
          {doWhatsapp ? (
            <p className="text-xs text-muted-foreground">
              O canal de chegada da conversa diz que a pessoa veio do anúncio
              {portal ? ` no ${portal}` : ' num portal'}: o texto pronto do botão de WhatsApp, ou a
              correção de alguém do time.
            </p>
          ) : null}
          {!doWhatsapp && portal ? (
            <p className="text-xs text-muted-foreground">
              Do {portal}, pelo canal de chegada da conversa de WhatsApp da mesma pessoa.
            </p>
          ) : null}
          {mandou && !doWhatsapp && tipos.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              No anúncio: {tipos.map((t) => rotuloDoTipo(t)).join(' · ')}
            </p>
          ) : null}
          {!mandou && tipos.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {tipos.map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <IconeDoTipo tipo={t} className="text-muted-foreground" />
                  {rotuloDoTipo(t)}
                </li>
              ))}
            </ul>
          ) : null}
          {!mandou && tipos.length === 0 ? (
            <p className="text-sm text-muted-foreground">O portal não disse.</p>
          ) : null}
          {lead.mcmv ? (
            <p className="text-xs text-muted-foreground">
              Fez a simulação do Minha Casa Minha Vida no portal.
            </p>
          ) : null}
        </Bloco>

        {pelaConversa ? (
          <Bloco titulo="Primeira mensagem">
            {primeira ? (
              <p
                className={cn(
                  'text-sm leading-relaxed whitespace-pre-wrap',
                  primeira.midia && 'text-muted-foreground',
                )}
              >
                {primeira.texto}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Mensagem sem texto.</p>
            )}
          </Bloco>
        ) : null}

        {mandou && !pelaConversa ? (
          <Bloco titulo="Primeira mensagem">
            {mensagemNoPortal ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{mensagemNoPortal}</p>
            ) : doWhatsapp ? (
              <p className="text-sm text-muted-foreground">
                Escreveu no WhatsApp; a conversa não fica ligada a quem pediu para não ser
                contatado.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Não escreveu mensagem.</p>
            )}
          </Bloco>
        ) : mensagemNoPortal ? (
          <Bloco titulo="Mensagem no portal">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{mensagemNoPortal}</p>
          </Bloco>
        ) : null}

        <Bloco titulo="Quando">
          <dl className="flex flex-col gap-2 text-sm">
            {/* O lead do WhatsApp não clicou em nada que o portal tenha avisado. */}
            {doWhatsapp ? null : (
              <Linha rotulo={pelaConversa || !mandou ? 'Clicou' : 'Pediu contato'}>
                {dataHoraDoLead(clicou)}
              </Linha>
            )}
            {pelaConversa || doWhatsapp ? (
              <Linha rotulo="1ª mensagem">{dataHoraDoLead(chegou)}</Linha>
            ) : null}
            {lead.respondido_em ? (
              <Linha rotulo="1ª resposta">
                {dataHoraDoLead(lead.respondido_em)}
                {lead.respondido_por_nome ? ` · ${lead.respondido_por_nome}` : ''}
              </Linha>
            ) : null}
            {lead.recebido_no_portal_em ? (
              <Linha rotulo="Chegou ao CRM">{dataHoraDoLead(lead.recebido_em)}</Linha>
            ) : null}
            {lead.link_historico ? (
              <Linha rotulo="Histórico">
                <a
                  href={lead.link_historico}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                >
                  Ver no portal
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </Linha>
            ) : null}
          </dl>
        </Bloco>
      </div>
    </>
  );
}

/**
 * O telefone e o e-mail: da ficha, quando há; do portal, quando não há. Quem só
 * clicou fica sabendo que o contato some aos 90 dias; depois disso, a folha diz
 * que ele sumiu.
 */
function ContatoDoLead({ lead }: { lead: LeadDoPortal }) {
  const comFicha = Boolean(lead.organization_id);
  const doWhatsapp = ehLeadDoWhatsapp(lead);
  const semDado = comFicha ? null : doWhatsapp ? 'O WhatsApp não traz' : 'O portal não mandou';
  if (!comFicha && lead.suprimido) {
    return (
      <p className="text-sm text-muted-foreground">
        O telefone está na lista de quem pediu para não ser contatado. O lead fica anotado, sem
        ficha e sem número.
      </p>
    );
  }
  if (!comFicha && lead.contato_apagado_em) {
    return (
      <p className="text-sm text-muted-foreground">
        {doWhatsapp
          ? `O telefone guardado com o lead foi apagado em ${dataDoLead(lead.contato_apagado_em)}, 90 dias depois da mensagem. A conversa continua em Conversas.`
          : `O contato que o portal mandou foi apagado em ${dataDoLead(lead.contato_apagado_em)}, 90 dias depois do aviso. Ficam o anúncio, o que a pessoa tocou e a data.`}
      </p>
    );
  }
  if (!comFicha && !lead.phone_e164 && !lead.email) {
    return (
      <p className="text-sm text-muted-foreground">O portal não mandou telefone nem e-mail.</p>
    );
  }
  return (
    <>
      <dl className="flex flex-col gap-2 text-sm">
        <Linha rotulo="Telefone">
          {lead.phone_e164 ? (
            <TelefoneDoLead lead={lead} />
          ) : (
            <span className="text-muted-foreground">{semDado ?? 'Sem telefone na ficha'}</span>
          )}
        </Linha>
        <Linha rotulo="E-mail">
          {lead.email ? (
            <span className="break-all">{lead.email}</span>
          ) : (
            <span className="text-muted-foreground">{semDado ?? 'Sem e-mail na ficha'}</span>
          )}
        </Linha>
      </dl>
      {!comFicha && lead.grupo === 'clicou' ? (
        <p className="text-xs text-muted-foreground">
          Sem ficha: é o contato que o portal mandou, apagado em {dataDoLead(contatoApagaEm(lead))}{' '}
          (90 dias depois do clique).
        </p>
      ) : null}
    </>
  );
}

/**
 * No celular, um botão por linha, de dedo; na folha do computador, cada um com a
 * largura do próprio nome ("Marcar como respondido" não cabe em meia folha).
 */
function Acoes({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Ações"
      className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:flex-wrap"
    >
      {children}
    </section>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

/**
 * O botão "Descartar" com o diálogo do motivo, para a folha e para a linha de
 * quem clicou e não chamou. Descartar não apaga: o lead vai para Descartados,
 * com o motivo, e o toast desfaz.
 *
 * O diálogo é filho deste botão na árvore do React: o clique dentro dele subiria
 * até a linha da lista e abriria a folha. O `span` de fora para isso.
 */
export function BotaoDescartar({
  lead,
  nome,
  disabled = false,
  className,
  rotulo = 'Descartar',
}: {
  lead: Pick<
    LeadDoPortal,
    'id' | 'situacao' | 'situacao_registrada' | 'organization_id' | 'conversation_id'
  >;
  nome: string | null;
  disabled?: boolean;
  className?: string;
  rotulo?: string;
}) {
  const cliente = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function voltarPara(situacao: SituacaoDoLead) {
    const r = await mudarLead(lead.id, situacao);
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
    if (!r.ok) toast.error('Não deu para desfazer.', { description: fraseDaRecusa(r.motivo) });
  }

  async function confirmar(motivo: string) {
    const antes = lead.situacao_registrada ?? lead.situacao;
    setOcupado(true);
    const r = await mudarLead(lead.id, 'descartado', motivo);
    setOcupado(false);
    if (!r.ok) {
      toast.error('Não deu para descartar.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    setAberto(false);
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
    toast.success('Lead descartado.', {
      description: 'Ele continua na lista de Descartados, com o motivo.',
      action: { label: 'Desfazer', onClick: () => void voltarPara(antes) },
    });
  }

  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <Button
        type="button"
        variant="ghost"
        className={className}
        disabled={disabled}
        onClick={() => setAberto(true)}
      >
        <Trash2 aria-hidden="true" />
        {rotulo}
      </Button>
      <DialogoDescartar
        aberto={aberto}
        ocupado={ocupado}
        nome={nome}
        comFicha={Boolean(lead.organization_id || lead.conversation_id)}
        aoFechar={() => setAberto(false)}
        aoConfirmar={(motivo) => void confirmar(motivo)}
      />
    </span>
  );
}

/** O mesmo piso de `public.portal_lead_mudar`. */
const MOTIVO_MINIMO = 3;

/**
 * Descartar, no desenho do `DialogoExcluir` (07/10/2026): a descrição conta o
 * que acontece, o motivo é obrigatório (quem abrir os descartados daqui a um
 * mês decide por ele) e o "Voltar" fica à esquerda. Descartar não apaga: o lead
 * fica, com o motivo, e volta pelo "Trazer de volta".
 */
function DialogoDescartar({
  aberto,
  ocupado,
  nome,
  comFicha,
  aoFechar,
  aoConfirmar,
}: {
  aberto: boolean;
  ocupado: boolean;
  nome: string | null;
  comFicha: boolean;
  aoFechar: () => void;
  aoConfirmar: (motivo: string) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(estado) => !estado && !ocupado && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        {aberto ? (
          <ConteudoDoDescarte
            ocupado={ocupado}
            nome={nome}
            comFicha={comFicha}
            aoFechar={aoFechar}
            aoConfirmar={aoConfirmar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConteudoDoDescarte({
  ocupado,
  nome,
  comFicha,
  aoFechar,
  aoConfirmar,
}: {
  ocupado: boolean;
  nome: string | null;
  comFicha: boolean;
  aoFechar: () => void;
  aoConfirmar: (motivo: string) => void;
}) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function confirmar() {
    const limpo = texto.trim();
    if (limpo.length < MOTIVO_MINIMO) {
      setErro('Escreva o motivo do descarte (pelo menos 3 letras).');
      return;
    }
    aoConfirmar(limpo);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Descartar o lead</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-2 text-left leading-relaxed">
            <p>
              {nome ? `O lead de ${nome}` : 'O lead'} sai da lista e vai para Descartados, com o
              motivo.{comFicha ? ' A ficha e a conversa não mudam.' : ''}
            </p>
            <p>Dá para trazer de volta quando quiser.</p>
          </div>
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-motivo`} className="text-sm font-medium">
          Motivo
        </label>
        <textarea
          id={`${id}-motivo`}
          rows={2}
          maxLength={300}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setErro(null);
          }}
          placeholder="Ex.: número errado; já é cliente; liguei e não quer"
          aria-invalid={erro !== null}
          aria-describedby={erro ? `${id}-erro` : undefined}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base md:text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        {erro ? (
          <p id={`${id}-erro`} className="text-xs text-destructive-texto">
            {erro}
          </p>
        ) : null}
      </div>
      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={aoFechar}
          disabled={ocupado}
          className="toque h-11 md:h-9"
        >
          Voltar
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={confirmar}
          disabled={ocupado}
          className="toque h-11 md:h-9"
        >
          <Trash2 aria-hidden="true" />
          {ocupado ? 'Descartando...' : 'Descartar lead'}
        </Button>
      </DialogFooter>
    </>
  );
}
