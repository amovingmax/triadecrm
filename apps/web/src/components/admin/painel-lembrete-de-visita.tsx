'use client';

import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { dataHoraCompleta } from '@/components/conversas/formatos';

import { Interruptor } from './painel-atendimento';
import {
  CHAVE_DO_LEMBRETE,
  carregarLembrete,
  mandarModeloParaAMeta,
  mudarLembrete,
} from './lembrete-de-visita-dados';
import {
  fraseDoInterruptor,
  fraseDoModelo,
  fraseDoMotivo,
  HORAS_DO_LEMBRETE,
  rotuloDaHora,
} from './lembrete-de-visita-regras';

/**
 * Ajustes → WhatsApp → Lembrete da visita (11/11/2026, só na Imova:
 * `EMPRESA.modulos.lembreteDeVisita`).
 *
 * Pedido do usuário: "Mandar um lembrete pelo WhatsApp na véspera, com botões
 * 'Confirmo' e 'Preciso remarcar'." A seção mostra, nesta ordem: em que pé está o
 * modelo na Meta (e o botão que o manda para aprovação), o interruptor, a hora, o
 * texto que o cliente recebe e os números dos últimos 30 dias, com os últimos que
 * não saíram e por quê. Admin e gestor mudam; o banco confere o papel de novo.
 */
export function PainelLembreteDeVisita({ podeEditar }: { podeEditar: boolean }) {
  const id = useId();
  const clientes = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE_DO_LEMBRETE, queryFn: carregarLembrete });

  const aoSalvar = {
    onSuccess: () => {
      toast.success('Salvo.');
      void clientes.invalidateQueries({ queryKey: CHAVE_DO_LEMBRETE });
    },
    onError: (e: Error) => toast.error('Não salvou.', { description: e.message }),
  };
  const mudar = useMutation({ mutationFn: mudarLembrete, ...aoSalvar });
  const mandar = useMutation({
    mutationFn: mandarModeloParaAMeta,
    onSuccess: () => {
      toast.success('Pedido feito.', {
        description: 'O modelo vai para a Meta na próxima sincronização do WhatsApp.',
      });
      void clientes.invalidateQueries({ queryKey: CHAVE_DO_LEMBRETE });
    },
    onError: (e: Error) => toast.error('Não deu.', { description: e.message }),
  });

  if (consulta.isPending) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (consulta.isError || !consulta.data) {
    return <p className="text-sm text-destructive">Não deu para ler o lembrete da visita.</p>;
  }
  const painel = consulta.data;
  const situacao = painel.modelo?.situacao ?? 'sem_modelo';
  const ocupado = mudar.isPending || mandar.isPending;
  const { numeros } = painel;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Na véspera de cada visita com hora marcada, o cliente recebe pelo WhatsApp o dia, a hora e o
        endereço, com os botões “Confirmo” e “Preciso remarcar”. A resposta aparece no cartão da
        Agenda e no Meu dia; quem pede para remarcar vira tarefa do corretor responsável. Nunca sai
        em domingo nem em feriado.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/45 px-4 py-3">
        <p className="min-w-0 text-sm">
          {fraseDoModelo(situacao, painel.modelo?.motivoDaRecusa ?? null)}
        </p>
        {situacao === 'nao_enviado' && podeEditar ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => mandar.mutate()}
            disabled={ocupado}
            className="toque h-11 shrink-0 md:h-8"
          >
            <Send aria-hidden="true" />
            Mandar para a Meta aprovar
          </Button>
        ) : null}
      </div>

      <Interruptor
        id={`${id}-ligado`}
        titulo="Mandar o lembrete na véspera"
        descricao={fraseDoInterruptor(painel.ligado, situacao, painel.hora)}
        ligado={painel.ligado}
        podeEditar={podeEditar && !ocupado}
        aoMudar={(v) => mudar.mutate({ ligado: v })}
      />

      <div className="flex flex-wrap items-center gap-3 sombra-base rounded-xl bg-card px-4 py-3">
        <label htmlFor={`${id}-hora`} className="text-sm font-medium">
          A partir de
        </label>
        <select
          id={`${id}-hora`}
          value={painel.hora}
          disabled={!podeEditar || ocupado}
          onChange={(e) => mudar.mutate({ hora: e.target.value })}
          className="h-11 rounded-full border border-input bg-background px-3 text-base disabled:opacity-50 md:h-9 md:text-sm"
        >
          {(HORAS_DO_LEMBRETE.includes(painel.hora)
            ? HORAS_DO_LEMBRETE
            : [painel.hora, ...HORAS_DO_LEMBRETE]
          ).map((hora) => (
            <option key={hora} value={hora}>
              {rotuloDaHora(hora)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          horário de Natal. A visita marcada depois dessa hora para o dia seguinte recebe na hora,
          se ainda estiver no horário de envio.
        </p>
      </div>

      {painel.modelo ? (
        <details className="rounded-xl bg-muted/45 px-4 py-3 text-sm">
          <summary className="cursor-pointer text-sm font-medium">O que o cliente recebe</summary>
          <p className="mt-2 text-xs whitespace-pre-line text-foreground/80">
            {painel.modelo.corpo}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Botões: {painel.modelo.botoes.map((b) => `“${b}”`).join(' e ')}. Modelo{' '}
            {painel.modelo.codigo}.
          </p>
        </details>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Nos últimos 30 dias: {numeros.enviados} {numeros.enviados === 1 ? 'enviado' : 'enviados'} ·{' '}
        {numeros.confirmaram} {numeros.confirmaram === 1 ? 'confirmou' : 'confirmaram'} ·{' '}
        {numeros.remarcar} {numeros.remarcar === 1 ? 'pediu' : 'pediram'} para remarcar ·{' '}
        {numeros.semResposta} sem resposta
        {numeros.naoSairam > 0 ? ` · ${numeros.naoSairam} não saíram` : ''}.
      </p>
      {painel.naoSairam.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {painel.naoSairam.map((l) => (
            <li key={`${l.cliente}-${l.marcadaPara}`}>
              {l.cliente}, visita de {dataHoraCompleta(l.marcadaPara)}: {fraseDoMotivo(l.motivo)}.
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
