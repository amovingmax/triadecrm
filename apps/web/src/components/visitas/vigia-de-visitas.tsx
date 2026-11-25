'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ChevronDown, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { mostrarAviso } from '@/components/avisos/aviso-do-navegador';
import { estaSilenciado, somEstaLigado } from '@/components/avisos/preferencias';
import { outraAbaJaTocou, somDestravado, tocarSom } from '@/components/avisos/som';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EMPRESA } from '@/lib/empresa';

import {
  CHAVE_DOS_PEDIDOS_DE_VISITA,
  type Decisao,
  type PedidoDeVisita,
  decidirPedidoDeVisita,
  lerPedidosDeVisita,
  linhaDoPedido,
  pedidosNaoVistos,
  quandoEmFortaleza,
  sugestaoParaDecidir,
  textoDaDecisao,
} from './pedidos-de-visita';

/**
 * O cartão dos pedidos de visita presencial (24/11/2026), só na Imova e só para admin.
 *
 * Pedido do dono: "Deve ser enviado uma solicitação se dá certo e deve aparecer um aviso
 * para todos os admins." Decisões dele: o aviso aparece no CRM e no celular (o push sai
 * do banco, na rodada de 10 segundos); qualquer admin aprova, e o primeiro vale.
 *
 * O que faz, em qualquer tela do CRM:
 * - a cada 30 segundos, e ao voltar para a aba, lê os pedidos abertos;
 * - enquanto houver pedido aberto, o cartão fica no canto de baixo, com "Ver conversa",
 *   Aprovar, Outro dia e Recusar (dá para recolher; um pedido novo abre de novo);
 * - pedido novo: o toque (o mesmo do aviso de mensagem, que sai no menu da conta) e, com
 *   o CRM fora de vista, a notificação do sistema. A primeira leitura num navegador não
 *   toca pelo que já estava lá: o cartão já mostra.
 *
 * Aprovar e Outro dia pedem o dia e a hora (já preenchidos com o que o cliente pediu);
 * o banco manda a mensagem ao cliente em nome de quem decidiu e, na aprovação, marca a
 * visita na Agenda com o imóvel.
 */

const RITMO_MS = 30_000;
const CHAVE_DOS_VISTOS = 'komune.avisos.visitas-vistas.v1';

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

interface Escolha {
  readonly pedido: PedidoDeVisita;
  readonly decisao: Decisao;
}

export function VigiaDeVisitas({ usuarioId, ligado }: { usuarioId: string; ligado: boolean }) {
  const roteador = useRouter();
  const consultas = useQueryClient();
  const [recolhido, setRecolhido] = useState(false);
  const [escolha, setEscolha] = useState<Escolha | null>(null);
  const vistosNaMemoria = useRef<Set<string> | null>(null);

  const pedidos = useQuery({
    queryKey: CHAVE_DOS_PEDIDOS_DE_VISITA,
    queryFn: lerPedidosDeVisita,
    enabled: ligado,
    staleTime: 15_000,
    refetchInterval: RITMO_MS,
    refetchOnWindowFocus: true,
  });
  const lista = ligado ? (pedidos.data ?? []) : [];

  // O toque e a notificação do sistema, só para pedido que esta pessoa ainda não viu.
  useEffect(() => {
    if (!ligado || pedidos.data === undefined) return;
    const vistos = lerVistos(usuarioId) ?? vistosNaMemoria.current;
    const ids = pedidos.data.map((p) => p.id);
    if (vistos === null) {
      // Primeira vez neste navegador: o que já estava lá o cartão mostra, sem tocar.
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
            : `${novos.length} pedidos de visita esperando a sua aprovação`,
        marca,
        botao: 'Ver pedido',
        alvos: [] as const,
        destino: primeiro.caminho,
        silenciosa: !comSom || somResolvido,
        aoClicar: () => roteador.push(primeiro.caminho),
      });
    }
  }, [ligado, usuarioId, pedidos.data, roteador]);

  const decidido = useCallback(() => {
    void consultas.invalidateQueries({ queryKey: CHAVE_DOS_PEDIDOS_DE_VISITA });
  }, [consultas]);

  if (!ligado || lista.length === 0) return null;

  return (
    <>
      <aside
        aria-label="Pedidos de visita"
        className="fixed inset-x-3 bottom-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior)+0.75rem)] z-40 md:inset-x-auto md:right-5 md:bottom-5 md:w-[23.5rem]"
      >
        <div className="rounded-2xl border bg-card shadow-lg">
          <button
            type="button"
            onClick={() => setRecolhido((r) => !r)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left"
            aria-expanded={!recolhido}
          >
            <CalendarCheck className="size-4 text-primary" aria-hidden />
            <span className="flex-1 text-sm font-semibold">
              {lista.length === 1 ? 'Pedido de visita' : `${lista.length} pedidos de visita`}
            </span>
            <span className="text-xs text-muted-foreground">
              {recolhido ? 'Abrir' : 'Recolher'}
            </span>
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${recolhido ? '' : 'rotate-180'}`}
              aria-hidden
            />
          </button>
          {!recolhido && (
            <ul className="max-h-[50dvh] space-y-2 overflow-y-auto px-3 pb-3">
              {lista.map((p) => (
                <li key={p.id} className="rounded-xl border bg-background p-3">
                  <p className="text-sm font-medium">{p.cliente}</p>
                  <p className="text-sm text-muted-foreground">
                    Quer ver {p.imovel}
                    <br />
                    {p.diaPedido}
                    {p.comoDisse !== null && p.comoDisse !== p.diaPedido
                      ? ` ("${p.comoDisse}")`
                      : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => setEscolha({ pedido: p, decisao: 'aprovada' })}
                    >
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEscolha({ pedido: p, decisao: 'outro_dia' })}
                    >
                      Outro dia
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEscolha({ pedido: p, decisao: 'recusada' })}
                    >
                      Recusar
                    </Button>
                    <Link
                      href={p.caminho}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <MessageSquare className="size-3.5" aria-hidden />
                      Ver conversa
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
      {escolha !== null && (
        <DialogoDaDecisao
          escolha={escolha}
          aoFechar={() => setEscolha(null)}
          aoDecidir={decidido}
        />
      )}
    </>
  );
}

const TITULOS: Readonly<Record<Decisao, string>> = {
  aprovada: 'Aprovar a visita',
  outro_dia: 'Propor outro dia',
  recusada: 'Recusar o pedido',
};

function DialogoDaDecisao({
  escolha,
  aoFechar,
  aoDecidir,
}: {
  escolha: Escolha;
  aoFechar: () => void;
  aoDecidir: () => void;
}) {
  const { pedido, decisao } = escolha;
  const comHorario = decisao !== 'recusada';
  const [sugestao] = useState(() =>
    comHorario ? sugestaoParaDecidir(pedido, decisao, new Date()) : { dia: '', hora: '' },
  );
  const [dia, setDia] = useState(sugestao.dia);
  const [hora, setHora] = useState(sugestao.hora);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const confirmar = async () => {
    const quando = comHorario ? quandoEmFortaleza(dia, hora) : null;
    if (comHorario && quando === null) {
      toast.error('Escolha o dia e a hora.');
      return;
    }
    setEnviando(true);
    try {
      const r = await decidirPedidoDeVisita(
        pedido.id,
        decisao,
        quando,
        decisao === 'recusada' ? motivo : null,
      );
      const t = textoDaDecisao(decisao, r);
      const opcoes = t.descricao === null ? {} : { description: t.descricao };
      if (t.tom === 'sucesso') toast.success(t.titulo, opcoes);
      else if (t.tom === 'aviso') toast.warning(t.titulo, opcoes);
      else toast.error(t.titulo, opcoes);
      if (r.ok || r.motivo === 'ja_decidido' || r.motivo === 'nao_existe') {
        aoDecidir();
        aoFechar();
      }
    } catch (erro) {
      toast.error('Não deu para decidir', {
        description: erro instanceof Error ? erro.message : 'Tente de novo.',
      });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITULOS[decisao]}</DialogTitle>
          <DialogDescription>
            {pedido.cliente} quer ver {pedido.imovel}: {pedido.diaPedido}.
          </DialogDescription>
        </DialogHeader>
        {comHorario ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="visita-dia">Dia</Label>
              <Input
                id="visita-dia"
                type="date"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="visita-hora">Hora</Label>
              <Input
                id="visita-hora"
                type="time"
                step={900}
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              {decisao === 'aprovada'
                ? 'O cliente recebe a confirmação em seu nome, e a visita entra na sua Agenda com o imóvel.'
                : 'O cliente recebe a proposta em seu nome; a resposta dele chega na conversa.'}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="visita-motivo">Por quê (opcional, só para a equipe)</Label>
            <textarea
              id="visita-motivo"
              value={motivo}
              maxLength={300}
              onChange={(e) => setMotivo(e.target.value)}
              className="min-h-20 w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Nada é enviado ao cliente: fale com ele pela conversa.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={aoFechar} disabled={enviando}>
            Voltar
          </Button>
          <Button
            onClick={() => void confirmar()}
            disabled={enviando}
            variant={decisao === 'recusada' ? 'destructive' : 'default'}
          >
            {decisao === 'aprovada'
              ? 'Aprovar e avisar o cliente'
              : decisao === 'outro_dia'
                ? 'Propor ao cliente'
                : 'Recusar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
