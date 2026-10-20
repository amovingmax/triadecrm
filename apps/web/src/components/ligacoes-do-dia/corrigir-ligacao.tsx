'use client';

/**
 * O diálogo de corrigir o resultado de uma ligação (13/10/2026).
 *
 * Segue as regras do `DialogoExcluir`: a descrição CONTA o que o clique faz (a
 * etapa, a próxima ação e o recontato passam a seguir o resultado certo; o
 * registro antigo fica na ficha como nota), o motivo é obrigatório porque é o
 * que explica a mudança para quem conferir o relatório depois, e o botão diz o
 * que faz.
 */
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  avisoDaCorrecao,
  carregarOpcoesDeCorrecao,
  CHAVE_DAS_OPCOES_DE_CORRECAO,
  chaveAtual,
  corrigirLigacao,
  recadoDaCorrecao,
  type OpcaoDeResultado,
} from './correcao';
import { horaDe, resultadoDaLigacao } from './formatos';
import type { LigacaoDoDia } from './tipos';

const MOTIVO_MINIMO = 3;

export function DialogoCorrigirLigacao({
  ligacao,
  aoFechar,
}: {
  /** A ligação a corrigir; `null` fecha o diálogo. */
  ligacao: LigacaoDoDia | null;
  aoFechar: () => void;
}) {
  return (
    <Dialog open={ligacao !== null} onOpenChange={(estado) => !estado && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        {/* Nasce a cada abertura: a escolha feita para uma ligação não pode
            aparecer marcada na correção da próxima. */}
        {ligacao ? <Conteudo key={ligacao.id} ligacao={ligacao} aoFechar={aoFechar} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Conteudo({ ligacao, aoFechar }: { ligacao: LigacaoDoDia; aoFechar: () => void }) {
  const id = useId();
  const cliente = useQueryClient();
  // Uma chave por abertura: o clique repetido, ou a rede que cai depois de
  // gravar, não lança o resultado duas vezes.
  const [chaveDoCliente] = useState(() => crypto.randomUUID());
  const [escolha, setEscolha] = useState<OpcaoDeResultado | null>(null);
  const [motivoDePerda, setMotivoDePerda] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const opcoes = useQuery({
    queryKey: CHAVE_DAS_OPCOES_DE_CORRECAO,
    queryFn: carregarOpcoesDeCorrecao,
    staleTime: 5 * 60_000,
  });

  const correcao = useMutation({
    mutationFn: corrigirLigacao,
    onSuccess: (resultado) => {
      if (!resultado.ok) {
        setErro(recadoDaCorrecao(resultado.motivo));
        return;
      }
      const aviso = avisoDaCorrecao(resultado);
      toast.success(aviso.titulo, { description: aviso.detalhe });
      void cliente.invalidateQueries({ queryKey: ['ligacoes-do-dia'] });
      aoFechar();
    },
  });

  const atual = chaveAtual(ligacao);

  function confirmar() {
    if (!escolha) {
      setErro('Escolha o resultado certo.');
      return;
    }
    if (escolha.pedeMotivoDePerda && motivoDePerda === null) {
      setErro('Escolha o motivo da perda.');
      return;
    }
    const limpo = motivo.trim();
    if (limpo.length < MOTIVO_MINIMO) {
      setErro('Escreva o motivo: é o que explica esta correção para quem conferir o relatório.');
      return;
    }
    setErro(null);
    correcao.mutate({
      chaveDoCliente,
      ligacaoId: ligacao.id,
      opcao: escolha,
      motivo: limpo,
      motivoDePerdaId: escolha.pedeMotivoDePerda ? motivoDePerda : null,
    });
  }

  const grupo = (titulo: string, lista: readonly OpcaoDeResultado[]) => (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">
        {lista
          .filter((opcao) => opcao.chave !== atual)
          .map((opcao) => {
            const marcada = escolha?.chave === opcao.chave;
            return (
              <button
                key={opcao.chave}
                type="button"
                role="radio"
                aria-checked={marcada}
                onClick={() => {
                  setEscolha(opcao);
                  setErro(null);
                }}
                className={cn(
                  'toque min-h-11 rounded-lg border px-3 text-sm transition-colors md:min-h-9',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  marcada
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input bg-background hover:bg-muted',
                )}
              >
                {opcao.rotulo}
              </button>
            );
          })}
      </div>
    </div>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Corrigir o resultado</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-2 text-left leading-relaxed">
            <p>
              Ligação das <span className="numerico">{horaDe(ligacao.iniciada_em)}</span> para{' '}
              {ligacao.organizacao ?? 'parceiro sem nome'}, lançada como “
              {resultadoDaLigacao(ligacao)}”.
            </p>
            <p>
              A etapa do funil, a próxima ação e o prazo de recontato passam a seguir o resultado
              certo. O registro antigo fica na ficha do parceiro como nota, com o motivo.
            </p>
          </div>
        </DialogDescription>
      </DialogHeader>

      {opcoes.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando os resultados...</p>
      ) : opcoes.isError ? (
        <p className="text-sm text-destructive-texto">
          Não deu para ler a lista de resultados. Feche e abra de novo.
        </p>
      ) : (
        <div role="radiogroup" aria-label="Resultado certo" className="flex flex-col gap-3">
          {grupo('Atendeu', opcoes.data.atendidas)}
          {grupo('Não atendeu', opcoes.data.naoAtendidas)}

          {escolha?.pedeMotivoDePerda ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-perda`} className="text-sm font-medium">
                Motivo da perda
              </label>
              <select
                id={`${id}-perda`}
                value={motivoDePerda ?? ''}
                onChange={(e) => {
                  setMotivoDePerda(e.target.value === '' ? null : Number(e.target.value));
                  setErro(null);
                }}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base md:text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:h-9"
              >
                <option value="">Escolha…</option>
                {opcoes.data.motivosDePerda.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-motivo`} className="text-sm font-medium">
          Motivo da correção
        </label>
        <textarea
          id={`${id}-motivo`}
          rows={2}
          maxLength={500}
          value={motivo}
          onChange={(e) => {
            setMotivo(e.target.value);
            setErro(null);
          }}
          placeholder="Cliquei no botão errado"
          aria-invalid={erro !== null}
          aria-describedby={erro ? `${id}-erro` : undefined}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base md:text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        {erro ? (
          <p id={`${id}-erro`} role="alert" className="text-xs text-destructive-texto">
            {erro}
          </p>
        ) : null}
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={aoFechar}
          disabled={correcao.isPending}
          className="toque h-11 md:h-9"
        >
          Voltar
        </Button>
        <Button
          type="button"
          onClick={confirmar}
          disabled={correcao.isPending || opcoes.isPending}
          className="toque h-11 md:h-9"
        >
          {correcao.isPending ? 'Corrigindo...' : 'Corrigir resultado'}
        </Button>
      </DialogFooter>
    </>
  );
}
