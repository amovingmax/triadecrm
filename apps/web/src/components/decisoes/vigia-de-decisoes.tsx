'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Gavel, MapPin, MessageSquare, Quote } from 'lucide-react';
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
  CHAVE_DAS_DECISOES,
  type DecisaoDaIa,
  type Escolha,
  avisoDoResultado,
  decidir,
  decisoesNaoVistas,
  diferencaDoAnunciado,
  lerDecisoesAbertas,
  lerValorDigitado,
  linhaDaDecisao,
  reais,
  textoDaProposta,
  valorCurto,
} from './decisoes-da-ia';

/**
 * O aviso de decisão (25/11/2026), só na Imova e só para admin: o protótipo aprovado pelo
 * dono ("Gostei do jeito que ficou"), dentro do CRM.
 *
 * Em qualquer tela, a cada 30 segundos (e ao voltar para a aba), lê as decisões que a IA
 * pediu. Enquanto houver uma, o cartão fica no canto de baixo, acima do aviso de visita (dá
 * para recolher; uma decisão nova abre de novo). Decisão nova: o toque e, com o CRM fora de
 * vista, a notificação do sistema. Cada botão abre, dentro do cartão, a mensagem exata que
 * o cliente vai receber, e só sai com a confirmação.
 */

const RITMO_MS = 30_000;
const CHAVE_DAS_VISTAS = 'komune.avisos.decisoes-vistas.v1';

function lerVistas(usuarioId: string): Set<string> | null {
  try {
    const bruto = window.localStorage.getItem(`${CHAVE_DAS_VISTAS}:${usuarioId}`);
    return bruto === null ? null : new Set(JSON.parse(bruto) as string[]);
  } catch {
    return null;
  }
}

function gravarVistas(usuarioId: string, ids: readonly string[]): void {
  try {
    window.localStorage.setItem(
      `${CHAVE_DAS_VISTAS}:${usuarioId}`,
      JSON.stringify(ids.slice(-200)),
    );
  } catch {
    // Sem armazenamento, as vistas ficam só na memória desta aba.
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

const horaDe = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Fortaleza',
  });

export function VigiaDeDecisoes({ usuarioId, ligado }: { usuarioId: string; ligado: boolean }) {
  const roteador = useRouter();
  const consultas = useQueryClient();
  const [recolhido, setRecolhido] = useState(false);
  const vistasNaMemoria = useRef<Set<string> | null>(null);

  const decisoes = useQuery({
    queryKey: CHAVE_DAS_DECISOES,
    queryFn: lerDecisoesAbertas,
    enabled: ligado,
    staleTime: 15_000,
    refetchInterval: RITMO_MS,
    refetchOnWindowFocus: true,
  });
  const lista = ligado ? (decisoes.data ?? []) : [];

  // O toque e a notificação do sistema, só para decisão que esta pessoa ainda não viu.
  useEffect(() => {
    if (!ligado || decisoes.data === undefined) return;
    const vistas = lerVistas(usuarioId) ?? vistasNaMemoria.current;
    const ids = decisoes.data.map((d) => d.id);
    if (vistas === null) {
      // Primeira vez neste navegador: o que já estava lá o cartão mostra, sem tocar.
      vistasNaMemoria.current = new Set(ids);
      gravarVistas(usuarioId, ids);
      return;
    }
    const novas = decisoesNaoVistas(decisoes.data, vistas);
    const todas = [...new Set([...vistas, ...ids])];
    vistasNaMemoria.current = new Set(todas);
    gravarVistas(usuarioId, todas);
    if (novas.length === 0) return;
    setRecolhido(false);
    if (estaSilenciado(usuarioId)) return;

    const marca = `decisao:${novas.map((d) => d.id).join(',')}`;
    const comSom = somEstaLigado(usuarioId);
    const somResolvido =
      comSom && somDestravado() && (outraAbaJaTocou(usuarioId, marca) || tocarSom());
    if (document.hidden || !document.hasFocus()) {
      const primeira = novas[0];
      if (primeira === undefined) return;
      void mostrarAviso({
        titulo: `${EMPRESA.nomeNoAviso}: a IA precisa da sua decisão`,
        corpo:
          novas.length === 1
            ? linhaDaDecisao(primeira)
            : `${novas.length} decisões esperando a sua resposta`,
        marca,
        botao: 'Responder',
        alvos: [] as const,
        destino: primeira.caminho,
        silenciosa: !comSom || somResolvido,
        aoClicar: () => roteador.push(primeira.caminho),
      });
    }
  }, [ligado, usuarioId, decisoes.data, roteador]);

  const atualizar = useCallback(() => {
    void consultas.invalidateQueries({ queryKey: CHAVE_DAS_DECISOES });
  }, [consultas]);

  if (!ligado || lista.length === 0) return null;

  // O relógio do cartão é a última leitura (a cada 30 s): "há 3 min" sem relógio próprio.
  const agora = decisoes.dataUpdatedAt;
  const titulo =
    lista.length === 1 ? 'A IA precisa da sua decisão' : `${lista.length} decisões para a IA`;

  return (
    <aside aria-label="Decisões para a IA" className="pointer-events-auto">
      <div className="rounded-2xl border bg-card shadow-lg">
        <button
          type="button"
          onClick={() => setRecolhido((r) => !r)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
          aria-expanded={!recolhido}
        >
          <Gavel className="size-4 text-primary" aria-hidden />
          <span className="flex-1 text-sm font-semibold">{titulo}</span>
          <span className="text-xs text-muted-foreground">{recolhido ? 'Abrir' : 'Recolher'}</span>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${recolhido ? '' : 'rotate-180'}`}
            aria-hidden
          />
        </button>
        {!recolhido && (
          <ul className="max-h-[min(60dvh,38rem)] space-y-2 overflow-y-auto px-3 pb-3">
            {lista.map((d) => (
              <CartaoDaDecisao key={d.id} decisao={d} agora={agora} aoMudar={atualizar} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/** A mensagem que o cliente vai receber, como sai no WhatsApp (assinada "Imova", da IA). */
function Previa({ texto, comLink = false }: { texto: string; comLink?: boolean }) {
  return (
    <div className="rounded-xl rounded-tr-sm bg-primary/10 px-3 py-2">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        O cliente vai receber
      </p>
      <p className="mt-1 text-sm whitespace-pre-line">
        <span className="font-semibold text-primary">Imova:</span>
        <br />
        {texto}
        {comLink && (
          <>
            <br />
            <br />
            <span className="text-muted-foreground">[link da reunião online]</span>
          </>
        )}
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

type Modo =
  | { tipo: 'aceitar' }
  | { tipo: 'recusar' }
  | { tipo: 'contraproposta' }
  | { tipo: 'consultar' }
  | { tipo: 'sugestao'; indice: number }
  | { tipo: 'escrita' };

function CartaoDaDecisao({
  decisao: d,
  agora,
  aoMudar,
}: {
  decisao: DecisaoDaIa;
  agora: number;
  aoMudar: () => void;
}) {
  const [modo, setModo] = useState<Modo | null>(null);
  const [valorDigitado, setValorDigitado] = useState('');
  const [escrito, setEscrito] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const abrir = (m: Modo | null) => {
    setErro(null);
    setModo(m);
  };

  const responder = async (escolha: Escolha, extras: Parameters<typeof decidir>[2] = {}) => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await decidir(d.id, escolha, extras);
      const aviso = avisoDoResultado(escolha, r);
      mostrar(aviso);
      if (r.ok || r.motivo === 'ja_decidido' || r.motivo === 'nao_existe') {
        setModo(null);
        aoMudar();
      } else setErro(aviso.descricao ?? aviso.titulo);
    } catch (e) {
      toast.error('Não deu para responder', {
        description: e instanceof Error ? e.message : 'Tente de novo.',
      });
    } finally {
      setEnviando(false);
    }
  };

  const proposta = d.tipo === 'proposta' && d.valorProposto !== null;
  const valorCurtoProposto = d.valorProposto === null ? '' : valorCurto(d.valorProposto);
  const contra = lerValorDigitado(valorDigitado);
  const diferenca = diferencaDoAnunciado(d);
  const imovelLinha = [
    d.area === null ? null : `${d.area.toLocaleString('pt-BR')} m²`,
    d.codigo,
  ].filter((x) => x !== null);

  const voltar = (
    <Button size="sm" variant="ghost" onClick={() => abrir(null)} disabled={enviando}>
      Voltar
    </Button>
  );

  return (
    <li className="space-y-3 rounded-xl border bg-background p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-quente opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-quente" />
        </span>
        <span className="text-[11px] font-bold tracking-wide text-quente-texto uppercase">
          {proposta ? 'Proposta de valor' : 'Pergunta do cliente'}
        </span>
        <span className="ml-auto text-muted-foreground">
          {d.situacao === 'consultando'
            ? 'consultando o proprietário'
            : haQuanto(d.criadoEm, agora)}
        </span>
      </div>

      <div>
        <p className="font-heading text-lg leading-tight font-semibold">{d.cliente}</p>
        {d.titulo !== null && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            {[d.titulo, ...imovelLinha].join(' · ')}
          </p>
        )}
      </div>

      {proposta && d.valorProposto !== null && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-muted px-3 py-2">
            <p className="text-[11px] text-muted-foreground">Anunciado por</p>
            <p className="text-base font-semibold">
              {d.valorAnunciado === null ? '—' : reais(d.valorAnunciado)}
            </p>
          </div>
          <div className="rounded-xl bg-quente-fundo px-3 py-2">
            <p className="text-[11px] text-quente-texto">Proposta do cliente</p>
            <p className="text-base font-semibold text-quente-texto">{reais(d.valorProposto)}</p>
            {diferenca !== null && <p className="text-[11px] text-quente-texto">{diferenca}</p>}
          </div>
        </div>
      )}

      <figure className="space-y-1 rounded-xl bg-muted/60 px-3 py-2">
        <figcaption className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Quote className="size-3" aria-hidden />O que ele escreveu
        </figcaption>
        <blockquote className="text-sm">“{d.pergunta}”</blockquote>
      </figure>

      {d.respostaDaIa !== null && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">A IA já respondeu:</span> “
          {d.respostaDaIa}”
        </p>
      )}

      {d.situacao === 'consultando' && (
        <p className="rounded-xl bg-morno-fundo px-3 py-2 text-xs text-morno-texto">
          <span className="font-semibold">
            Consultando o proprietário
            {d.consultandoEm === null ? '' : ` desde ${horaDe(d.consultandoEm)}`}
            {d.consultandoPor === null ? '' : ` (${d.consultandoPor})`}.
          </span>{' '}
          O cliente já foi avisado. Quando ele responder, escolha abaixo.
        </p>
      )}

      {modo === null && proposta && (
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" onClick={() => abrir({ tipo: 'aceitar' })}>
            Aceitar os {valorCurtoProposto}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => abrir({ tipo: 'recusar' })}>
            Recusar os {valorCurtoProposto}
          </Button>
          <Button size="sm" variant="outline" onClick={() => abrir({ tipo: 'contraproposta' })}>
            Negociar outro valor
          </Button>
          {d.situacao === 'aberta' && (
            <Button size="sm" variant="outline" onClick={() => abrir({ tipo: 'consultar' })}>
              Vou consultar o proprietário
            </Button>
          )}
        </div>
      )}

      {modo === null && !proposta && (
        <div className="space-y-1.5">
          {d.sugestoes.length > 0 && (
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Respostas que a IA sugere
            </p>
          )}
          {d.sugestoes.map((s, i) => (
            <Button
              key={s.rotulo}
              size="sm"
              variant="outline"
              className="h-auto min-h-9 w-full justify-start py-2 text-left whitespace-normal"
              onClick={() => abrir({ tipo: 'sugestao', indice: i })}
            >
              {s.rotulo}
            </Button>
          ))}
          <Button
            size="sm"
            variant={d.sugestoes.length === 0 ? 'default' : 'ghost'}
            className="w-full justify-start"
            onClick={() => abrir({ tipo: 'escrita' })}
          >
            Escrever outra resposta
          </Button>
        </div>
      )}

      {modo !== null && modo.tipo !== 'contraproposta' && modo.tipo !== 'escrita' && (
        <div className="space-y-3 rounded-xl bg-muted p-3">
          {modo.tipo === 'sugestao' ? (
            <Previa texto={d.sugestoes[modo.indice]?.resposta ?? ''} />
          ) : (
            <Previa texto={textoDaProposta(modo.tipo, d)} comLink={modo.tipo === 'aceitar'} />
          )}
          <p className="text-xs text-muted-foreground">
            {modo.tipo === 'consultar'
              ? 'O aviso continua aberto até vocês voltarem com a resposta do proprietário.'
              : 'A IA manda esta mensagem e continua atendendo o cliente.'}
          </p>
          {erro !== null && <Problema>{erro}</Problema>}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={modo.tipo === 'recusar' ? 'destructive' : 'default'}
              disabled={enviando}
              onClick={() =>
                void (modo.tipo === 'sugestao'
                  ? responder('sugestao', { sugestao: modo.indice })
                  : responder(modo.tipo))
              }
            >
              Enviar ao cliente
            </Button>
            {voltar}
          </div>
        </div>
      )}

      {modo?.tipo === 'contraproposta' && (
        <div className="space-y-3 rounded-xl bg-muted p-3">
          <div className="space-y-1.5">
            <Label htmlFor={`decisao-valor-${d.id}`}>Valor que vocês aceitam</Label>
            <Input
              id={`decisao-valor-${d.id}`}
              inputMode="numeric"
              placeholder="Ex.: 4.300.000"
              value={valorDigitado}
              onChange={(e) => setValorDigitado(e.target.value)}
            />
          </div>
          {contra !== null ? (
            <Previa texto={textoDaProposta('contraproposta', d, contra)} />
          ) : (
            valorDigitado.trim() !== '' && <Problema>Digite só o valor, como 4.300.000.</Problema>
          )}
          {erro !== null && <Problema>{erro}</Problema>}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              disabled={enviando || contra === null}
              onClick={() => void responder('contraproposta', { valor: contra })}
            >
              Enviar ao cliente
            </Button>
            {voltar}
          </div>
        </div>
      )}

      {modo?.tipo === 'escrita' && (
        <div className="space-y-3 rounded-xl bg-muted p-3">
          <div className="space-y-1.5">
            <Label htmlFor={`decisao-texto-${d.id}`}>
              O que a IA deve dizer, em poucas palavras
            </Label>
            <textarea
              id={`decisao-texto-${d.id}`}
              rows={3}
              maxLength={600}
              value={escrito}
              onChange={(e) => setEscrito(e.target.value)}
              className="w-full rounded-[var(--raio-linha,0.75rem)] border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Escreva do jeito que você falaria. A IA só ajusta o tom, sem acrescentar informação.
          </p>
          {erro !== null && <Problema>{erro}</Problema>}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              disabled={enviando || escrito.trim() === ''}
              onClick={() => void responder('escrita', { texto: escrito })}
            >
              Enviar ao cliente
            </Button>
            {voltar}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
        <span>Todos os admins foram avisados. Vale a primeira resposta.</span>
        <Link
          href={d.caminho}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <MessageSquare className="size-3.5" aria-hidden />
          Ver conversa
        </Link>
      </div>
    </li>
  );
}
