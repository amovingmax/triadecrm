'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  Clock,
  MapPin,
  MessageSquare,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { mostrarAviso } from '@/components/avisos/aviso-do-navegador';
import { estaSilenciado, somEstaLigado } from '@/components/avisos/preferencias';
import { outraAbaJaTocou, somDestravado, tocarSom } from '@/components/avisos/som';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EMPRESA } from '@/lib/empresa';

import {
  type Aviso,
  CHAVE_DOS_AGUARDANDO,
  CHAVE_DOS_PEDIDOS_DE_VISITA,
  type Decisao,
  MOTIVOS_DE_NAO,
  PERIODOS,
  type PedidoAguardando,
  type PedidoDeVisita,
  confirmacaoDaProposta,
  decidirPedidoDeVisita,
  horaSugerida,
  horaTexto,
  horariosDoPeriodo,
  lerPedidosAguardando,
  lerPedidosDeVisita,
  linhaDoPedido,
  oQueSai,
  pedidosNaoVistos,
  problemaDoQuando,
  quandoEmFortaleza,
  quandoPedido,
  responderPeloCliente,
  sugestaoParaAgendar,
  textoDaConfirmacao,
  textoDaDecisao,
  textoDaResposta,
} from './pedidos-de-visita';

/**
 * O aviso dos pedidos de visita presencial (24/11/2026), só na Imova e só para admin.
 *
 * Pedido do dono: "Deve ser enviado uma solicitação se dá certo e deve aparecer um aviso
 * para todos os admins." Decisões dele: o aviso aparece no CRM e no celular (o push sai
 * do banco, na rodada de 10 segundos); qualquer admin decide, e o primeiro vale. Em
 * 25/11/2026, depois do protótipo aprovado: o aviso mostra o nome do cliente, o local
 * da visita e o dia e o horário pedidos, com Aceitar, Agendar e Não é possível; cada
 * botão abre, dentro do próprio aviso, a mensagem exata que o cliente vai receber.
 *
 * O que faz, em qualquer tela do CRM:
 * - a cada 30 segundos, e ao voltar para a aba, lê os pedidos abertos e as propostas
 *   que esperam o cliente;
 * - enquanto houver um ou outro, o aviso fica no canto de baixo (dá para recolher; um
 *   pedido novo abre de novo);
 * - pedido novo: o toque (o mesmo do aviso de mensagem, que sai no menu da conta) e, com
 *   o CRM fora de vista, a notificação do sistema. A primeira leitura num navegador não
 *   toca pelo que já estava lá: o aviso já mostra.
 */

const RITMO_MS = 30_000;
const CHAVE_DOS_VISTOS = 'komune.avisos.visitas-vistas.v1';
const CAMPO =
  'h-9 w-full rounded-[var(--raio-linha,0.75rem)] border border-input bg-background px-3 text-sm';

function lerVistos(usuarioId: string): Set<string> | null {
  try {
    const bruto = window.localStorage.getItem(`${CHAVE_DOS_VISTOS}:${usuarioId}`);
    return bruto === null ? null : new Set(JSON.parse(bruto) as string[]);
  } catch {
    return null;
  }
}

function gravarVistos(usuarioId: string, ids: readonly string[]): void {
  try {
    window.localStorage.setItem(
      `${CHAVE_DOS_VISTOS}:${usuarioId}`,
      JSON.stringify(ids.slice(-200)),
    );
  } catch {
    // Sem armazenamento, os vistos ficam só na memória desta aba.
  }
}

function mostrar(aviso: Aviso): void {
  const opcoes = aviso.descricao === null ? {} : { description: aviso.descricao };
  if (aviso.tom === 'sucesso') toast.success(aviso.titulo, opcoes);
  else if (aviso.tom === 'aviso') toast.warning(aviso.titulo, opcoes);
  else toast.error(aviso.titulo, opcoes);
}

function haQuanto(iso: string, agora: number): string {
  const minutos = Math.round((agora - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return horas < 24 ? `há ${horas} h` : `há ${Math.floor(horas / 24)} d`;
}

const primeiroNome = (nome: string): string => nome.trim().split(/\s+/)[0] ?? nome;

export function VigiaDeVisitas({
  usuarioId,
  usuarioNome,
  ligado,
}: {
  usuarioId: string;
  usuarioNome: string;
  ligado: boolean;
}) {
  const roteador = useRouter();
  const consultas = useQueryClient();
  const [recolhido, setRecolhido] = useState(false);
  const vistosNaMemoria = useRef<Set<string> | null>(null);

  const pedidos = useQuery({
    queryKey: CHAVE_DOS_PEDIDOS_DE_VISITA,
    queryFn: lerPedidosDeVisita,
    enabled: ligado,
    staleTime: 15_000,
    refetchInterval: RITMO_MS,
    refetchOnWindowFocus: true,
  });
  const aguardando = useQuery({
    queryKey: CHAVE_DOS_AGUARDANDO,
    queryFn: lerPedidosAguardando,
    enabled: ligado,
    staleTime: 15_000,
    refetchInterval: RITMO_MS,
    refetchOnWindowFocus: true,
  });
  const lista = ligado ? (pedidos.data ?? []) : [];
  const esperando = ligado ? (aguardando.data ?? []) : [];

  // O toque e a notificação do sistema, só para pedido que esta pessoa ainda não viu.
  useEffect(() => {
    if (!ligado || pedidos.data === undefined) return;
    const vistos = lerVistos(usuarioId) ?? vistosNaMemoria.current;
    const ids = pedidos.data.map((p) => p.id);
    if (vistos === null) {
      // Primeira vez neste navegador: o que já estava lá o aviso mostra, sem tocar.
      vistosNaMemoria.current = new Set(ids);
      gravarVistos(usuarioId, ids);
      return;
    }
    const novos = pedidosNaoVistos(pedidos.data, vistos);
    const todos = [...new Set([...vistos, ...ids])];
    vistosNaMemoria.current = new Set(todos);
    gravarVistos(usuarioId, todos);
    if (novos.length === 0) return;
    setRecolhido(false);
    if (estaSilenciado(usuarioId)) return;

    const marca = `visita:${novos.map((p) => p.id).join(',')}`;
    const comSom = somEstaLigado(usuarioId);
    const somResolvido =
      comSom && somDestravado() && (outraAbaJaTocou(usuarioId, marca) || tocarSom());
    if (document.hidden || !document.hasFocus()) {
      const primeiro = novos[0];
      if (primeiro === undefined) return;
      void mostrarAviso({
        titulo: `${EMPRESA.nomeNoAviso}: pedido de visita`,
        corpo:
          novos.length === 1
            ? linhaDoPedido(primeiro)
            : `${novos.length} pedidos de visita esperando a sua decisão`,
        marca,
        botao: 'Ver pedido',
        alvos: [] as const,
        destino: primeiro.caminho,
        silenciosa: !comSom || somResolvido,
        aoClicar: () => roteador.push(primeiro.caminho),
      });
    }
  }, [ligado, usuarioId, pedidos.data, roteador]);

  const atualizar = useCallback(() => {
    void consultas.invalidateQueries({ queryKey: CHAVE_DOS_PEDIDOS_DE_VISITA });
    void consultas.invalidateQueries({ queryKey: CHAVE_DOS_AGUARDANDO });
  }, [consultas]);

  if (!ligado || (lista.length === 0 && esperando.length === 0)) return null;

  // O relógio do aviso é a última leitura (a cada 30 s): "há 3 min" sem relógio próprio.
  const agora = Math.max(pedidos.dataUpdatedAt, aguardando.dataUpdatedAt);
  const titulo =
    lista.length === 0
      ? esperando.length === 1
        ? '1 visita esperando o cliente'
        : `${esperando.length} visitas esperando o cliente`
      : lista.length === 1
        ? 'Pedido de visita'
        : `${lista.length} pedidos de visita`;
  const assinatura = primeiroNome(usuarioNome);

  return (
    <aside
      aria-label="Pedidos de visita"
      className="fixed inset-x-3 bottom-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior)+0.75rem)] z-40 md:inset-x-auto md:right-5 md:bottom-5 md:w-[25rem]"
    >
      <div className="rounded-2xl border bg-card shadow-lg">
        <button
          type="button"
          onClick={() => setRecolhido((r) => !r)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
          aria-expanded={!recolhido}
        >
          <CalendarCheck className="size-4 text-primary" aria-hidden />
          <span className="flex-1 text-sm font-semibold">{titulo}</span>
          <span className="text-xs text-muted-foreground">{recolhido ? 'Abrir' : 'Recolher'}</span>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${recolhido ? '' : 'rotate-180'}`}
            aria-hidden
          />
        </button>
        {!recolhido && (
          <div className="max-h-[min(70dvh,42rem)] space-y-2 overflow-y-auto px-3 pb-3">
            {lista.length > 0 && (
              <ul className="space-y-2">
                {lista.map((p) => (
                  <CartaoDoPedido
                    key={p.id}
                    pedido={p}
                    agora={agora}
                    assinatura={assinatura}
                    aoMudar={atualizar}
                  />
                ))}
              </ul>
            )}
            {esperando.length > 0 && (
              <section aria-label="Esperando o cliente" className="space-y-2">
                <h3 className="px-1 pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Esperando o cliente responder
                </h3>
                <ul className="space-y-2">
                  {esperando.map((a) => (
                    <CartaoAguardando
                      key={a.id}
                      pedido={a}
                      assinatura={assinatura}
                      aoMudar={atualizar}
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/** A mensagem que o cliente vai receber, como sai no WhatsApp (assinada por quem decide). */
function Previa({ assinatura, texto }: { assinatura: string; texto: string }) {
  return (
    <div className="rounded-xl rounded-tr-sm bg-primary/10 px-3 py-2">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        O cliente vai receber
      </p>
      <p className="mt-1 text-sm">
        <span className="font-semibold text-primary">{assinatura}:</span>
        <br />
        {texto}
      </p>
    </div>
  );
}

function Problema({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-xs font-medium text-morno-texto">
      {children}
    </p>
  );
}

type Modo = 'aceitar' | 'agendar' | 'nao';

function CartaoDoPedido({
  pedido: p,
  agora,
  assinatura,
  aoMudar,
}: {
  pedido: PedidoDeVisita;
  agora: number;
  assinatura: string;
  aoMudar: () => void;
}) {
  const [modo, setModo] = useState<Modo | null>(null);
  const [horaAceitar, setHoraAceitar] = useState(() => horaSugerida(p));
  const [agendar, setAgendar] = useState(() => sugestaoParaAgendar(p, new Date()));
  const [motivo, setMotivo] = useState<string>(MOTIVOS_DE_NAO[0]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const instante = new Date(agora);
  const horaDoAceite = p.hora ?? horaAceitar;
  const problemaDoAceite =
    p.data === null
      ? 'O cliente não disse o dia. Use Agendar para propor um.'
      : problemaDoQuando(p.data, horaDoAceite, instante);
  const problemaDoAgendar = problemaDoQuando(agendar.dia, agendar.hora, instante);
  const saida = oQueSai(p, agendar.dia, agendar.hora);

  const abrir = (m: Modo | null) => {
    setErro(null);
    setModo(m);
  };

  const decidir = async (decisao: Decisao, dia: string | null, hora: string | null) => {
    const quando = dia !== null && hora !== null ? quandoEmFortaleza(dia, hora) : null;
    setEnviando(true);
    setErro(null);
    try {
      const r = await decidirPedidoDeVisita(
        p.id,
        decisao,
        quando,
        decisao === 'recusada' ? motivo : null,
      );
      const aviso = textoDaDecisao(decisao, r);
      mostrar(aviso);
      if (r.ok || r.motivo === 'ja_decidido' || r.motivo === 'nao_existe') aoMudar();
      else setErro(aviso.descricao ?? aviso.titulo);
    } catch (e) {
      toast.error('Não deu para decidir', {
        description: e instanceof Error ? e.message : 'Tente de novo.',
      });
    } finally {
      setEnviando(false);
    }
  };

  const voltar = (
    <Button size="sm" variant="ghost" onClick={() => abrir(null)} disabled={enviando}>
      Voltar
    </Button>
  );

  return (
    <li className="space-y-3 rounded-xl border bg-background p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-menta opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-menta" />
        </span>
        <span className="text-[11px] font-bold tracking-wide text-menta-texto uppercase">
          Pedido de visita
        </span>
        <span className="ml-auto text-muted-foreground">{haQuanto(p.criadoEm, agora)}</span>
      </div>

      <p className="font-heading text-lg leading-tight font-semibold">{p.cliente}</p>

      <ul className="space-y-2.5">
        <li className="flex gap-2.5">
          <MapPin
            className="size-8 shrink-0 rounded-lg bg-primary/10 p-1.5 text-primary"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Local da visita
            </p>
            <p className="text-sm font-medium">{p.titulo}</p>
            {(p.lugar !== null || p.codigo !== null) && (
              <p className="text-xs text-muted-foreground">
                {[p.lugar, p.codigo].filter((x) => x !== null).join(' · ')}
              </p>
            )}
          </div>
        </li>
        <li className="flex gap-2.5">
          <CalendarDays
            className="size-8 shrink-0 rounded-lg bg-primary/10 p-1.5 text-primary"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Dia e horário pedidos
            </p>
            <p className="text-sm font-medium">{quandoPedido(p)}</p>
            {p.comoDisse !== null && (
              <p className="text-xs text-muted-foreground">Na conversa: “{p.comoDisse}”</p>
            )}
          </div>
        </li>
      </ul>

      {modo === null && (
        <div className="grid grid-cols-3 gap-1.5">
          <Button size="sm" onClick={() => abrir('aceitar')}>
            Aceitar
          </Button>
          <Button size="sm" variant="outline" onClick={() => abrir('agendar')}>
            Agendar
          </Button>
          <Button size="sm" variant="destructive" onClick={() => abrir('nao')}>
            Não é possível
          </Button>
        </div>
      )}

      {modo === 'aceitar' && (
        <div className="space-y-3 rounded-xl bg-muted p-3">
          <p className="text-sm font-semibold">
            {p.hora !== null ? 'Aceitar no dia e no horário pedidos' : 'Aceitar no dia pedido'}
          </p>
          {p.data !== null && p.hora === null && (
            <div className="space-y-1.5">
              <Label htmlFor={`visita-hora-aceitar-${p.id}`}>
                Horário
                {p.periodo !== null ? ` (o cliente pediu ${PERIODOS[p.periodo].rotulo})` : ''}
              </Label>
              <select
                id={`visita-hora-aceitar-${p.id}`}
                value={horaAceitar}
                onChange={(e) => setHoraAceitar(e.target.value)}
                className={CAMPO}
              >
                {horariosDoPeriodo(p.periodo).map((h) => (
                  <option key={h} value={h}>
                    {horaTexto(h)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {problemaDoAceite === null && p.data !== null ? (
            <>
              <Previa
                assinatura={assinatura}
                texto={textoDaConfirmacao(p.imovel, p.data, horaDoAceite)}
              />
              <p className="text-xs text-muted-foreground">
                A visita entra na sua Agenda como confirmada.
              </p>
            </>
          ) : (
            <Problema>{problemaDoAceite}</Problema>
          )}
          {erro !== null && <Problema>{erro}</Problema>}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              disabled={enviando || problemaDoAceite !== null}
              onClick={() => void decidir('aprovada', p.data, horaDoAceite)}
            >
              Confirmar visita
            </Button>
            {voltar}
          </div>
        </div>
      )}

      {modo === 'agendar' && (
        <div className="space-y-3 rounded-xl bg-muted p-3">
          <p className="text-sm font-semibold">Escolha o dia e o horário</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor={`visita-dia-${p.id}`}>Dia</Label>
              <Input
                id={`visita-dia-${p.id}`}
                type="date"
                value={agendar.dia}
                onChange={(e) => setAgendar((a) => ({ ...a, dia: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`visita-hora-${p.id}`}>Horário</Label>
              <Input
                id={`visita-hora-${p.id}`}
                type="time"
                step={900}
                value={agendar.hora}
                onChange={(e) => setAgendar((a) => ({ ...a, hora: e.target.value }))}
              />
            </div>
          </div>
          {problemaDoAgendar === null ? (
            <>
              <Previa assinatura={assinatura} texto={saida.texto} />
              <p className="text-xs text-muted-foreground">
                {saida.decisao === 'aprovada'
                  ? 'Cabe no que o cliente pediu: a visita entra na sua Agenda como confirmada.'
                  : 'O horário fica reservado na sua Agenda até o cliente responder.'}
              </p>
            </>
          ) : (
            <Problema>{problemaDoAgendar}</Problema>
          )}
          {erro !== null && <Problema>{erro}</Problema>}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              disabled={enviando || problemaDoAgendar !== null}
              onClick={() => void decidir(saida.decisao, agendar.dia, agendar.hora)}
            >
              {saida.decisao === 'aprovada' ? 'Confirmar visita' : 'Enviar ao cliente'}
            </Button>
            {voltar}
          </div>
        </div>
      )}

      {modo === 'nao' && (
        <div className="space-y-3 rounded-xl bg-muted p-3">
          <p className="text-sm font-semibold">
            Por que não é possível?{' '}
            <span className="font-normal text-muted-foreground">Só a equipe vê.</span>
          </p>
          <div role="radiogroup" aria-label="Motivo" className="space-y-1.5">
            {MOTIVOS_DE_NAO.map((m, i) => (
              <label
                key={m}
                htmlFor={`visita-motivo-${p.id}-${i}`}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${
                  motivo === m ? 'border-primary bg-primary/10' : 'bg-background'
                }`}
              >
                <input
                  type="radio"
                  id={`visita-motivo-${p.id}-${i}`}
                  name={`visita-motivo-${p.id}`}
                  value={m}
                  checked={motivo === m}
                  onChange={() => setMotivo(m)}
                  className="accent-primary"
                />
                {m}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            O cliente não recebe mensagem automática. A conversa fica com a equipe para combinar com
            ele.
          </p>
          {erro !== null && <Problema>{erro}</Problema>}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              disabled={enviando}
              onClick={() => void decidir('recusada', null, null)}
            >
              Marcar como não é possível
            </Button>
            {voltar}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
        <span>Todos os admins foram avisados. Vale a primeira decisão.</span>
        <Link
          href={p.caminho}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <MessageSquare className="size-3.5" aria-hidden />
          Ver conversa
        </Link>
      </div>
    </li>
  );
}

function CartaoAguardando({
  pedido: a,
  assinatura,
  aoMudar,
}: {
  pedido: PedidoAguardando;
  assinatura: string;
  aoMudar: () => void;
}) {
  const [resposta, setResposta] = useState<'confirmou' | 'nao_pode' | null>(null);
  const [enviando, setEnviando] = useState(false);

  const marcar = async (confirmou: boolean) => {
    setEnviando(true);
    try {
      const r = await responderPeloCliente(a.id, confirmou);
      mostrar(textoDaResposta(confirmou, r));
      if (r.ok || r.motivo === 'ja_respondido' || r.motivo === 'nao_aguarda') aoMudar();
    } catch (e) {
      toast.error('Não deu para marcar', {
        description: e instanceof Error ? e.message : 'Tente de novo.',
      });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <li className="space-y-2.5 rounded-xl border border-dashed bg-background p-3">
      <div className="flex items-center gap-2 text-xs">
        <Clock className="size-3.5 text-morno-texto" aria-hidden />
        <span className="font-semibold text-morno-texto">Aguardando o cliente</span>
        {a.propostoPor !== null && (
          <span className="ml-auto text-muted-foreground">
            proposto por {primeiroNome(a.propostoPor)}
          </span>
        )}
      </div>
      <div>
        <p className="text-sm font-semibold">{a.cliente}</p>
        <p className="text-sm">
          {a.quando.charAt(0).toUpperCase() + a.quando.slice(1)}
          <span className="text-muted-foreground">
            {' · '}
            {a.imovel}
          </span>
        </p>
        {a.naAgenda && (
          <p className="text-xs text-muted-foreground">Reservado na Agenda até ele responder.</p>
        )}
      </div>

      {resposta === 'confirmou' && (
        <div className="space-y-2.5 rounded-xl bg-muted p-3">
          <Previa assinatura={assinatura} texto={confirmacaoDaProposta(a)} />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={enviando} onClick={() => void marcar(true)}>
              Confirmar visita
            </Button>
            <Button size="sm" variant="ghost" disabled={enviando} onClick={() => setResposta(null)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
      {resposta === 'nao_pode' && (
        <div className="space-y-2.5 rounded-xl bg-muted p-3">
          <p className="text-xs text-muted-foreground">
            A reserva sai da Agenda e nada é enviado ao cliente. Combine outro horário pela
            conversa.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              disabled={enviando}
              onClick={() => void marcar(false)}
            >
              Tirar da Agenda
            </Button>
            <Button size="sm" variant="ghost" disabled={enviando} onClick={() => setResposta(null)}>
              Voltar
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {resposta === null && (
          <>
            <Button size="sm" variant="outline" onClick={() => setResposta('confirmou')}>
              Cliente confirmou
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResposta('nao_pode')}>
              Cliente não pode
            </Button>
          </>
        )}
        <Link
          href={a.caminho}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <MessageSquare className="size-3.5" aria-hidden />
          Ver conversa
        </Link>
      </div>
    </li>
  );
}
