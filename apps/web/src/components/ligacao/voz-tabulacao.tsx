'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  COLUNAS_DESFECHO,
  MENSAGENS_DE_RECUSA,
  resultadoRegistroSchema,
  RPC_REGISTRAR_CONTATO,
  type MotivoPerda,
} from '@/components/registro/tipos';

import { ChamadaExtras, precisaDeExtras, type ExtrasDaChamada } from './chamada-extras';
import {
  exigeAtendimento,
  MAPA_RESULTADO_TECNICO,
  type DesfechoDeLigacao,
  type ResultadoTecnico,
} from './tipos';
import { vincularAtividade } from './voz-rpc';

/**
 * O resultado da ligação feita pela ficha, logo depois de desligar.
 *
 * NÃO é um catálogo novo. São os mesmos desfechos de ligação da `/registrar`
 * (`interaction_outcomes`, superfície `ligacao`), gravados pela mesma
 * `registrar_contato` — então etapa, temperatura, próxima ação e meta saem
 * exatamente como sairiam de um contato registrado à mão. O que a ligação pelo
 * navegador acrescenta é o que ela SABE: se a linha foi atendida e quanto durou.
 *
 * - Sem atendimento, os desfechos que pressupõem conversa ficam apagados: o
 *   provedor viu que ninguém atendeu, e "Interessado" ali seria dado inventado.
 * - Os casos que pedem um dado a mais (motivo de perda, data da reunião, data do
 *   retorno combinado) abrem a mesma folha do módulo de ligação.
 *
 * "Registrar depois" não perde a tentativa: em 30 minutos ela entra na linha do
 * tempo como ligação com desfecho pendente (`app.voz_fechar_orfas`).
 */
export function TabulacaoDaLigacao({
  ligacaoId,
  organizationId,
  atendida,
  sugestao,
  duracaoSeg,
  aoGravar,
  aoAdiar,
}: {
  ligacaoId: string;
  organizationId: string;
  atendida: boolean;
  sugestao: ResultadoTecnico | null;
  duracaoSeg: number;
  aoGravar: () => void;
  aoAdiar: () => void;
}) {
  const router = useRouter();
  const idObservacao = useId();
  const [catalogo, setCatalogo] = useState<DesfechoDeLigacao[] | null>(null);
  const [motivos, setMotivos] = useState<MotivoPerda[]>([]);
  const [escolhidoId, setEscolhidoId] = useState<number | null>(null);
  const [observacao, setObservacao] = useState('');
  const [pedindoExtras, setPedindoExtras] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Uma chave por ligação: tocar em Salvar duas vezes não cria duas atividades.
  const [clientKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let vivo = true;
    const supabase = createClient();
    void Promise.all([
      supabase
        .from('interaction_outcomes')
        .select(`${COLUNAS_DESFECHO}, requires_answer`)
        .eq('is_active', true)
        .contains('surfaces', ['ligacao'])
        .order('position'),
      supabase
        .from('lost_reasons')
        .select('id, slug, name')
        .eq('is_active', true)
        .order('position'),
    ]).then(([desfechos, perdas]) => {
      if (!vivo) return;
      const lista = (desfechos.data ?? []) as DesfechoDeLigacao[];
      setCatalogo(lista);
      setMotivos((perdas.data ?? []) as MotivoPerda[]);
      // O que a linha já contou vem marcado; quem ouviu a chamada corrige se for o caso.
      const slug = sugestao ? MAPA_RESULTADO_TECNICO[sugestao] : null;
      const sugerido = slug ? lista.find((d) => d.slug === slug) : undefined;
      if (sugerido) setEscolhidoId(sugerido.id);
    });
    return () => {
      vivo = false;
    };
  }, [sugestao]);

  const escolhido = useMemo(
    () => catalogo?.find((d) => d.id === escolhidoId) ?? null,
    [catalogo, escolhidoId],
  );

  async function gravar(desfecho: DesfechoDeLigacao, extras: ExtrasDaChamada | null) {
    setGravando(true);
    setErro(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc(RPC_REGISTRAR_CONTATO, {
        p_client_key: clientKey,
        p_organization_id: organizationId,
        p_outcome_id: desfecho.id,
        p_com_quem: 'nao_informado',
        p_body: observacao.trim() || undefined,
        p_duration_min: atendida ? Math.max(1, Math.round(duracaoSeg / 60)) : undefined,
        p_lost_reason_id: extras?.lostReasonId ?? undefined,
        p_meeting_at: extras?.reuniaoEm ?? undefined,
        p_meeting_format: extras?.reuniaoFormato ?? undefined,
        // A data combinada ao telefone é a próxima ação (mesma regra da tela do lote).
        p_next_action_at: extras?.agendarPara ?? extras?.reuniaoEm ?? undefined,
      });
      if (error) {
        console.error('[voz] registrar', error);
        setErro('Não deu para gravar agora. Tente de novo.');
        return;
      }
      const lido = resultadoRegistroSchema.safeParse(data);
      if (!lido.success) {
        setErro('O servidor respondeu de um jeito que esta tela não entende. Recarregue a página.');
        return;
      }
      if (!lido.data.registrado) {
        setErro(MENSAGENS_DE_RECUSA[lido.data.motivo]);
        return;
      }
      await vincularAtividade(ligacaoId, lido.data.activity_id);
      toast.success('Ligação registrada.', { description: desfecho.name });
      router.refresh();
      aoGravar();
    } finally {
      setGravando(false);
    }
  }

  function salvar() {
    if (!escolhido) {
      setErro('Escolha o resultado da ligação.');
      return;
    }
    if (precisaDeExtras(escolhido, false)) {
      setPedindoExtras(true);
      return;
    }
    void gravar(escolhido, null);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">Resultado da ligação</p>

      {catalogo === null ? (
        <p className="text-sm text-muted-foreground">Carregando os resultados...</p>
      ) : (
        <div role="radiogroup" aria-label="Resultado da ligação" className="flex flex-wrap gap-1.5">
          {catalogo.map((d) => {
            const apagado = exigeAtendimento(d) && !atendida;
            const marcado = d.id === escolhidoId;
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={marcado}
                disabled={apagado || gravando}
                title={apagado ? 'Ninguém atendeu esta ligação.' : undefined}
                onClick={() => {
                  setEscolhidoId(d.id);
                  setErro(null);
                }}
                className={cn(
                  'toque min-h-9 rounded-full border border-input px-3 text-sm',
                  marcado && 'border-foreground bg-foreground text-background',
                  apagado && 'opacity-40',
                )}
              >
                {d.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={idObservacao}>Observações</Label>
        <textarea
          id={idObservacao}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          rows={2}
          maxLength={2000}
          disabled={gravando}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {erro ? (
        <p role="alert" className="text-sm text-destructive-texto">
          {erro}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" className="h-10 flex-1" onClick={salvar} disabled={gravando}>
          {gravando ? 'Salvando...' : 'Salvar'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-10"
          onClick={aoAdiar}
          disabled={gravando}
        >
          Registrar depois
        </Button>
      </div>

      <ChamadaExtras
        desfecho={pedindoExtras ? escolhido : null}
        pediuParaNaoLigar={false}
        motivosPerda={motivos}
        formatosDaEtapa={['meet', 'visita']}
        sugestaoDeData={null}
        aoConfirmar={(extras) => {
          setPedindoExtras(false);
          if (escolhido) void gravar(escolhido, extras);
        }}
        aoCancelar={() => setPedindoExtras(false)}
      />
    </div>
  );
}
