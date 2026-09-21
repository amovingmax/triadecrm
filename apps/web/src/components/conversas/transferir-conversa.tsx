'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';

/**
 * Passar a conversa para outra pessoa ou para outro setor (Fase 1, 21/09/2026).
 *
 * Três campos e um botão. "Para quem" e "Ou para o setor" são alternativos: só o
 * setor entrega a quem tem menos conversas abertas nele (o banco escolhe). A
 * nota é o "histórico junto" — quem recebe lê o motivo na tarefa que ganha e no
 * aviso em cima da caixa de resposta.
 */
type Opcao = { id: string; nome: string };

const RECUSAS: Record<string, string> = {
  sem_permissao: 'Seu papel não transfere conversas.',
  conversa_inexistente: 'Esta conversa não está mais no seu alcance. Atualize a tela.',
  sem_destino: 'Escolha uma pessoa ou um setor.',
  nota_longa_demais: 'A nota passou de 500 letras.',
  setor_invalido: 'Este setor não existe mais.',
  pessoa_invalida: 'Esta pessoa não está ativa ou não atende conversas.',
  nada_mudou: 'A conversa já está com essa pessoa e nesse setor.',
};

const respostaSchema = z.object({
  ok: z.boolean(),
  motivo: z.string().optional(),
  para: z.string().nullable().optional(),
  setor: z.string().nullable().optional(),
});

const NINGUEM = '_';

export function TransferirConversa({
  fioId,
  organizacaoId,
  pessoas,
  setores,
  className,
}: {
  fioId: string;
  organizacaoId: string;
  pessoas: readonly Opcao[];
  setores: readonly { id: number; nome: string }[];
  className?: string;
}) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        className={cn('toque h-11 md:h-9', className)}
        onClick={() => setAberta(true)}
      >
        <ArrowRightLeft aria-hidden="true" />
        <span className="hidden sm:inline">Transferir</span>
        <span className="sr-only sm:hidden">Transferir</span>
      </Button>
      {aberta ? (
        <Folha
          fioId={fioId}
          organizacaoId={organizacaoId}
          pessoas={pessoas}
          setores={setores}
          aoFechar={() => setAberta(false)}
        />
      ) : null}
    </>
  );
}

function Folha({
  fioId,
  organizacaoId,
  pessoas,
  setores,
  aoFechar,
}: {
  fioId: string;
  organizacaoId: string;
  pessoas: readonly Opcao[];
  setores: readonly { id: number; nome: string }[];
  aoFechar: () => void;
}) {
  const clientes = useQueryClient();
  const [pessoa, setPessoa] = useState(NINGUEM);
  const [setor, setSetor] = useState(NINGUEM);
  const [nota, setNota] = useState('');

  const transferir = useMutation({
    mutationFn: async () => {
      const { data, error } = await createClient().rpc('transferir_conversa', {
        p_conversation_id: fioId,
        p_para_pessoa: pessoa === NINGUEM ? undefined : pessoa,
        p_para_setor: setor === NINGUEM ? undefined : Number(setor),
        p_nota: nota.trim() || undefined,
      });
      if (error) throw new Error(error.message);
      const r = respostaSchema.parse(data);
      if (!r.ok) throw new Error(RECUSAS[r.motivo ?? ''] ?? `O banco recusou: ${r.motivo}.`);
      return r;
    },
    onSuccess: (r) => {
      toast.success(`Conversa passada para ${r.para ?? 'o setor'}${r.setor ? ` (${r.setor})` : ''}.`, {
        description: 'Quem recebe ganhou uma tarefa com a sua nota.',
      });
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      void clientes.invalidateQueries({ queryKey: chaveDaLinha(organizacaoId) });
      void clientes.invalidateQueries({ queryKey: ['conversas', 'transferencia', fioId] });
      aoFechar();
    },
    onError: (erro: Error) => toast.error('Não deu para transferir.', { description: erro.message }),
  });

  const podeTransferir = pessoa !== NINGUEM || setor !== NINGUEM;

  return (
    <Sheet open onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Transferir conversa</SheetTitle>
          <SheetDescription>
            O histórico vai junto. Quem recebe ganha uma tarefa com a sua nota.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <div className="space-y-1">
            <label htmlFor="transferir-pessoa" className="text-xs text-muted-foreground">
              Para quem
            </label>
            <Select value={pessoa} onValueChange={setPessoa}>
              <SelectTrigger id="transferir-pessoa" className="toque h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NINGUEM}>Quem estiver livre no setor</SelectItem>
                {pessoas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="transferir-setor" className="text-xs text-muted-foreground">
              Setor
            </label>
            <Select value={setor} onValueChange={setSetor}>
              <SelectTrigger id="transferir-setor" className="toque h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NINGUEM}>O mesmo de agora</SelectItem>
                {setores.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Escolhendo só o setor, a conversa vai para quem tem menos conversas abertas nele.
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor="transferir-nota" className="text-xs text-muted-foreground">
              Nota para quem recebe (opcional)
            </label>
            <textarea
              id="transferir-nota"
              value={nota}
              maxLength={500}
              rows={3}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ex.: quer a segunda via do boleto de setembro"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-hairline p-4">
          <Button
            className="toque h-11 md:h-9"
            disabled={!podeTransferir || transferir.isPending}
            onClick={() => transferir.mutate()}
          >
            {transferir.isPending ? 'Transferindo…' : 'Transferir'}
          </Button>
          <Button variant="ghost" className="toque h-11 md:h-9" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const transferenciaSchema = z.object({
  nota: z.string().nullable(),
  feita_por: z.string(),
  feita_em: z.string(),
});

/**
 * "Fulano está atendendo" — a trava leve contra duas pessoas respondendo a
 * mesma conversa sem saber uma da outra. Não bloqueia: quem responde assume, e
 * é isso que a frase diz ANTES de a pessoa escrever. Traz também a nota da
 * última transferência, que é o contexto que quem recebe precisa.
 */
export function AvisoDeQuemAtende({
  fioId,
  atendente,
  paraMim,
  nomeDaPessoa,
}: {
  fioId: string;
  atendente: string | null;
  paraMim: boolean;
  nomeDaPessoa: Map<string, string>;
}) {
  const ultima = useQuery({
    queryKey: ['conversas', 'transferencia', fioId],
    queryFn: async () => {
      const { data } = await createClient()
        .from('conversa_transferencias')
        .select('nota, feita_por, feita_em')
        .eq('conversation_id', fioId)
        .order('feita_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? transferenciaSchema.parse(data) : null;
    },
    staleTime: 30_000,
  });

  const nota = ultima.data?.nota ?? null;
  const quem = ultima.data ? (nomeDaPessoa.get(ultima.data.feita_por) ?? 'alguém do time') : null;

  if (paraMim && !nota) return null;
  return (
    <div className="rounded-lg border border-hairline bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      {paraMim ? null : (
        <p>
          <span className="font-medium text-foreground">{atendente ?? 'Outra pessoa'}</span> está
          atendendo esta conversa. Se você responder, ela passa para você.
        </p>
      )}
      {nota ? (
        <p>
          Transferida por {quem}: <span className="text-foreground">“{nota}”</span>
        </p>
      ) : null}
    </div>
  );
}
