'use client';

import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, X } from 'lucide-react';
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
import { Input } from '@/components/ui/input';

import { CHAVE_DOS_GRUPOS, pedir, procurarParceiros } from './dados';
import { TETO_DA_DESCRICAO, TETO_DO_NOME } from './tipos';

/**
 * Criar um grupo. Três campos e uma chave: o nome (até 128), a descrição (até
 * 2.048), "Aprovar quem entra" (ligada: quem toca no link pede para entrar e o
 * time aprova; desligada: entra direto) e, se quiser, o parceiro do grupo.
 *
 * A criação é um pedido à Meta: o grupo aparece na lista como "criando" e vira
 * ativo, com o link de convite, quando a Meta responde. Se a conta não tiver o
 * selo da Meta, ele vira "não criado" e o painel diz por quê.
 */
export function CriarGrupo({
  aberto,
  aoFechar,
  aoCriado,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoCriado: (grupoId: string) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(estado) => (estado ? null : aoFechar())}>
      <DialogContent className="sm:max-w-md">
        {/* O formulário nasce a cada abertura: o nome de um grupo não pode
            aparecer escrito na criação do próximo. */}
        {aberto ? <Formulario aoFechar={aoFechar} aoCriado={aoCriado} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  aoFechar,
  aoCriado,
}: {
  aoFechar: () => void;
  aoCriado: (grupoId: string) => void;
}) {
  const id = useId();
  const clientes = useQueryClient();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [aprovar, setAprovar] = useState(true);
  const [parceiro, setParceiro] = useState<{ id: string; nome: string } | null>(null);

  const criar = useMutation({
    mutationFn: () =>
      pedir<{ grupo_id: string }>('grupo_criar', {
        p_assunto: nome.trim(),
        p_descricao: descricao.trim() || null,
        p_aprovacao: aprovar ? 'approval_required' : 'auto_approve',
        p_organization_id: parceiro?.id ?? null,
      }),
    onSuccess: (r) => {
      toast.success('Pedido feito à Meta.', {
        description: 'O grupo fica pronto, com o link de convite, em alguns segundos.',
      });
      void clientes.invalidateQueries({ queryKey: CHAVE_DOS_GRUPOS });
      aoCriado(r.grupo_id);
    },
    onError: (e: Error) => toast.error('O grupo não foi criado.', { description: e.message }),
  });

  const limpo = nome.trim();
  const pode = limpo.length >= 1 && limpo.length <= TETO_DO_NOME && !criar.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pode) criar.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Criar grupo</DialogTitle>
        <DialogDescription>
          Até 8 pessoas, contando a empresa. Ninguém é posto dentro: entra quem tocar no link.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-nome`} className="text-sm font-medium">
          Nome
        </label>
        <Input
          id={`${id}-nome`}
          value={nome}
          maxLength={TETO_DO_NOME}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Fornecedores do Casamento Ana e Leo"
          className="h-11 md:h-9"
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-descricao`} className="text-sm font-medium">
          Descrição <span className="font-normal text-muted-foreground">(se quiser)</span>
        </label>
        <textarea
          id={`${id}-descricao`}
          value={descricao}
          maxLength={TETO_DA_DESCRICAO}
          rows={3}
          onChange={(e) => setDescricao(e.target.value)}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </div>

      <Chave
        id={`${id}-aprovar`}
        titulo="Aprovar quem entra"
        descricao={
          aprovar
            ? 'Quem tocar no link pede para entrar, e alguém do time aprova aqui.'
            : 'Quem tocar no link entra direto.'
        }
        ligada={aprovar}
        aoMudar={setAprovar}
      />

      <EscolherParceiro escolhido={parceiro} aoEscolher={setParceiro} />

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={aoFechar} className="toque h-11 md:h-9">
          Voltar
        </Button>
        <Button type="submit" disabled={!pode} className="toque h-11 md:h-9">
          {criar.isPending ? 'Pedindo à Meta…' : 'Criar grupo'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Uma chave liga-desliga, com o que ela faz embaixo do nome. */
export function Chave({
  id,
  titulo,
  descricao,
  ligada,
  aoMudar,
  desligada = false,
}: {
  id: string;
  titulo: string;
  descricao: string;
  ligada: boolean;
  aoMudar: (v: boolean) => void;
  desligada?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-hairline px-3 py-2.5">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {titulo}
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">{descricao}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={ligada}
        disabled={desligada}
        onClick={() => aoMudar(!ligada)}
        className={cn(
          'relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          ligada ? 'bg-menta' : 'bg-muted-foreground/30',
        )}
      >
        <span className="sr-only">{ligada ? 'Ligada' : 'Desligada'}</span>
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform',
            ligada && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}

/** O parceiro do grupo (opcional): busca pelo nome, escolhe um. */
function EscolherParceiro({
  escolhido,
  aoEscolher,
}: {
  escolhido: { id: string; nome: string } | null;
  aoEscolher: (p: { id: string; nome: string } | null) => void;
}) {
  const id = useId();
  const [busca, setBusca] = useState('');
  const termo = busca.trim();
  const achados = useQuery({
    queryKey: ['grupos', 'parceiros', termo],
    queryFn: () => procurarParceiros(termo),
    enabled: escolhido === null && termo.length >= 2,
    staleTime: 60_000,
  });

  if (escolhido) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Parceiro</p>
        <div className="flex items-center gap-2 rounded-xl border border-hairline px-3 py-2">
          <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm">{escolhido.nome}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => aoEscolher(null)}
            className="toque size-9 md:size-7"
          >
            <X aria-hidden="true" />
            <span className="sr-only">Tirar o parceiro</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-parceiro`} className="text-sm font-medium">
        Parceiro <span className="font-normal text-muted-foreground">(se quiser)</span>
      </label>
      <Input
        id={`${id}-parceiro`}
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Procure pelo nome"
        className="h-11 md:h-9"
        autoComplete="off"
      />
      {termo.length >= 2 ? (
        <ul className="max-h-40 overflow-y-auto rounded-xl border border-hairline">
          {achados.isPending ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">Procurando…</li>
          ) : (achados.data ?? []).length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              Nenhum parceiro com esse nome.
            </li>
          ) : (
            (achados.data ?? []).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => aoEscolher(p)}
                  className="toque flex min-h-10 w-full items-center px-3 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="truncate">{p.nome}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
