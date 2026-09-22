'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { detalharEnvio, ErroDoEnvio, mudarEnvio } from './dados';
import { fraseDaRecusa, fraseDoMotivo, porcento, rotuloDaMensagem } from './formatos';
import { STATUS_DO_ENVIO, type Contagem, type ItemDoEnvio } from './tipos';

/**
 * Uma campanha por dentro: os números, os botões de controle e cada pessoa com o
 * que aconteceu com ela. Relê a cada 15 s enquanto está andando.
 */
export function PainelDoEnvio({ id, aoFechar }: { id: string | null; aoFechar: () => void }) {
  const clientes = useQueryClient();
  const detalhe = useQuery({
    queryKey: ['envios', 'detalhe', id],
    queryFn: () => detalharEnvio(id ?? ''),
    enabled: id !== null,
    refetchInterval: (q) =>
      q.state.data && ['agendado', 'enviando'].includes(q.state.data.envio.status) ? 15_000 : false,
  });

  const mudar = useMutation({
    mutationFn: (acao: 'pausar' | 'retomar' | 'cancelar') => mudarEnvio(id ?? '', acao),
    onSuccess: (_r, acao) => {
      toast.success(acao === 'pausar' ? 'Campanha pausada.' : acao === 'retomar' ? 'Campanha retomada.' : 'Campanha cancelada.');
      void clientes.invalidateQueries({ queryKey: ['envios'] });
    },
    onError: (erro: Error) =>
      toast.error('Não deu.', {
        description: erro instanceof ErroDoEnvio ? fraseDaRecusa(erro.motivo) : erro.message,
      }),
  });

  const envio = detalhe.data?.envio;

  return (
    <Sheet open={id !== null} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{envio?.nome ?? 'Campanha'}</SheetTitle>
          <SheetDescription>
            {envio
              ? `${STATUS_DO_ENVIO[envio.status]} · ${rotuloDaMensagem(envio.modelo)} · ${envio.por_hora} por hora · criada por ${envio.criado_por ?? '—'}`
              : 'Carregando…'}
          </SheetDescription>
        </SheetHeader>

        {envio ? (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            {envio.status === 'parado' && envio.motivo_parada ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                {envio.motivo_parada}
              </p>
            ) : null}
            {['agendado', 'enviando'].includes(envio.status) ? (
              <p className="text-sm text-muted-foreground">
                Próxima mensagem por volta de{' '}
                <span className="numerico">{hora(envio.proximo_em)}</span>.
              </p>
            ) : null}

            <Numeros c={envio.contagem} />

            <div className="flex flex-wrap gap-2">
              {['agendado', 'enviando'].includes(envio.status) ? (
                <Button variant="outline" className="toque h-11 md:h-9" disabled={mudar.isPending} onClick={() => mudar.mutate('pausar')}>
                  <Pause aria-hidden="true" />
                  Pausar
                </Button>
              ) : null}
              {['pausado', 'parado'].includes(envio.status) ? (
                <Button className="toque h-11 md:h-9" disabled={mudar.isPending} onClick={() => mudar.mutate('retomar')}>
                  <Play aria-hidden="true" />
                  Retomar
                </Button>
              ) : null}
              {!['concluido', 'cancelado'].includes(envio.status) ? (
                <Button
                  variant="ghost"
                  className="toque h-11 text-destructive md:h-9"
                  disabled={mudar.isPending}
                  onClick={() => {
                    if (window.confirm('Cancelar a campanha? Quem ainda não recebeu não vai receber.')) {
                      mudar.mutate('cancelar');
                    }
                  }}
                >
                  <X aria-hidden="true" />
                  Cancelar campanha
                </Button>
              ) : null}
            </div>

            <Itens itens={detalhe.data?.itens ?? []} daMarca={envio.assinatura === 'marca'} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function Numeros({ c, compacto = false }: { c: Contagem; compacto?: boolean }) {
  const blocos: { rotulo: string; valor: number; de?: number; alerta?: boolean; destaque?: boolean }[] = [
    { rotulo: 'Enviadas', valor: c.enviadas, de: c.total },
    { rotulo: 'Entregues', valor: c.entregues, de: c.enviadas },
    { rotulo: 'Lidas', valor: c.lidas, de: c.enviadas },
    { rotulo: 'Tocaram no botão', valor: c.tocaram, de: c.enviadas },
    { rotulo: 'Clicaram no link', valor: c.clicaram, de: c.enviadas },
    { rotulo: 'Cadastraram', valor: c.cadastraram, de: c.enviadas, destaque: c.cadastraram > 0 },
    { rotulo: 'Responderam', valor: c.responderam, de: c.enviadas },
    { rotulo: 'Saíram', valor: c.sairam, de: c.enviadas, alerta: c.sairam > 0 },
    { rotulo: 'Puladas', valor: c.puladas },
  ];
  // No cartão da lista, só o funil da ação: do envio ao cadastro.
  const DO_CARTAO = ['Enviadas', 'Lidas', 'Tocaram no botão', 'Clicaram no link', 'Cadastraram'];
  const visiveis = compacto ? blocos.filter((b) => DO_CARTAO.includes(b.rotulo)) : blocos;
  return (
    <dl className={cn('grid gap-2', compacto ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-3')}>
      {visiveis.map((b) => (
        <div key={b.rotulo} className="rounded-lg border border-hairline bg-card/60 px-2.5 py-2">
          <dt className="text-[11px] text-muted-foreground">{b.rotulo}</dt>
          <dd
            className={cn(
              'numerico text-lg font-semibold',
              b.alerta && 'text-destructive',
              b.destaque && 'text-primary',
            )}
          >
            {b.valor}
            {b.de !== undefined && b.de > 0 && !compacto ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">{porcento(b.valor, b.de)}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const ROTULO_DO_ITEM: Record<ItemDoEnvio['status'], string> = {
  pendente: 'Na fila',
  enviada: 'Enviada',
  pulada: 'Pulada',
  cancelada: 'Cancelada',
};

const ROTULO_DA_MENSAGEM: Record<string, string> = {
  queued: 'saindo',
  sent: 'enviada',
  delivered: 'entregue',
  read: 'lida',
  failed: 'falhou',
};

function Itens({ itens, daMarca }: { itens: ItemDoEnvio[]; daMarca: boolean }) {
  return (
    <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-card">
      {itens.map((i) => (
        <li key={i.posicao} className="flex items-start gap-3 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{i.nome}</span>
            <span className="block text-xs text-muted-foreground">
              {daMarca ? 'em nome da Komune' : i.assinante ? `assina ${i.assinante}` : null}
              {i.status === 'enviada' && i.mensagem ? ` · ${ROTULO_DA_MENSAGEM[i.mensagem] ?? i.mensagem}` : null}
              {i.botao_tocado ? ` · tocou em “${i.botao_tocado}”` : null}
              {i.clicou ? ' · clicou no link' : null}
              {i.cadastrou ? ' · cadastrou-se na Komune' : null}
              {i.respondeu && !i.botao_tocado ? ' · respondeu' : null}
            </span>
            {i.status === 'pulada' ? (
              <span className="block text-xs text-muted-foreground">{fraseDoMotivo(i.motivo)}</span>
            ) : null}
          </span>
          {i.conversa_id ? (
            <Link href={`/conversas?org=${i.organization_id}`} className="shrink-0 text-xs text-primary hover:underline">
              Abrir conversa
            </Link>
          ) : null}
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px]',
              i.status === 'enviada' ? 'bg-primary/10 text-foreground' : 'bg-muted text-muted-foreground',
              i.respondeu && 'bg-primary text-primary-foreground',
            )}
          >
            {i.respondeu ? 'Respondeu' : ROTULO_DO_ITEM[i.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}

