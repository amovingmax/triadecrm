'use client';

import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';

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

import { mensagemDoErro } from './dados';
import { salvarPremissas, type Premissas } from './dados-vende';
import {
  lerPremissas,
  premissasParaDigitar,
  textoDasPremissas,
  type PremissasDigitadas,
} from './formatos-vende';

/**
 * As premissas da conta de dinheiro e da meta (09/11/2026): uma linha discreta no
 * canto da Visão geral e de Oportunidades. O "Ajustar" só aparece para quem pode
 * mudar (`premissas.pode_editar`: admin e gestor); ao salvar, todo relatório é
 * buscado de novo, porque a comissão provável muda em todas as abas.
 */
export function PremissasDaConta({ premissas }: { premissas: Premissas | null | undefined }) {
  const [aberto, setAberto] = useState(false);
  if (!premissas) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>{textoDasPremissas(premissas)}</span>
      {premissas.pode_editar ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="toque h-11 px-2 text-xs md:h-7"
            onClick={() => setAberto(true)}
          >
            <SlidersHorizontal aria-hidden="true" />
            Ajustar
          </Button>
          <Dialog open={aberto} onOpenChange={setAberto}>
            <DialogContent className="sm:max-w-sm">
              {/* Nasce a cada abertura: o que foi digitado e desistido não volta. */}
              {aberto ? <Formulario premissas={premissas} aoFechar={() => setAberto(false)} /> : null}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

function Formulario({ premissas, aoFechar }: { premissas: Premissas; aoFechar: () => void }) {
  const id = useId();
  const cliente = useQueryClient();
  const [campos, setCampos] = useState<PremissasDigitadas>(() => premissasParaDigitar(premissas));
  const [erros, setErros] = useState<Partial<Record<keyof PremissasDigitadas, string>>>({});

  const salvar = useMutation({
    mutationFn: salvarPremissas,
    onSuccess: () => {
      toast.success('Premissas salvas', {
        description: 'A comissão provável e a meta foram refeitas em todos os relatórios.',
      });
      void cliente.invalidateQueries({ queryKey: ['relatorios'] });
      aoFechar();
    },
  });

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    const leitura = lerPremissas(campos);
    if (!leitura.ok) {
      setErros(leitura.erros);
      return;
    }
    setErros({});
    salvar.mutate(leitura.valor);
  }

  const campo = (
    chave: keyof PremissasDigitadas,
    rotulo: string,
    ajuda: string,
    sufixo: string,
    modo: 'decimal' | 'numeric',
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-${chave}`} className="text-sm font-medium">
        {rotulo}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={`${id}-${chave}`}
          inputMode={modo}
          autoComplete="off"
          value={campos[chave]}
          aria-invalid={erros[chave] ? true : undefined}
          aria-describedby={`${id}-${chave}-ajuda`}
          onChange={(e) => setCampos((c) => ({ ...c, [chave]: e.target.value }))}
          className="numerico h-11 w-28 md:h-9"
        />
        <span className="text-sm text-muted-foreground">{sufixo}</span>
      </div>
      <p
        id={`${id}-${chave}-ajuda`}
        className={erros[chave] ? 'text-xs text-destructive-texto' : 'text-xs text-muted-foreground'}
      >
        {erros[chave] ?? ajuda}
      </p>
    </div>
  );

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Premissas da conta</DialogTitle>
        <DialogDescription>
          A comissão provável de cada lead é o valor do negócio vezes a comissão, vezes a chance da etapa.
          A meta é o número de negócios fechados por mês.
        </DialogDescription>
      </DialogHeader>

      {campo('comissao', 'Comissão na venda', 'Do valor do imóvel, de 0,5% a 20%.', '%', 'decimal')}
      {campo('alugueis', 'Comissão na locação', 'Em aluguéis, de 0 a 3.', 'aluguéis', 'decimal')}
      {campo('meta', 'Meta do mês', 'Negócios fechados, de 1 a 500. Em branco, o placar mostra só a previsão.', 'negócios', 'numeric')}

      {salvar.isError ? (
        <p role="alert" className="text-sm text-destructive-texto">
          {mensagemDoErro(salvar.error)}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" className="toque h-11 md:h-9" onClick={aoFechar}>
          Cancelar
        </Button>
        <Button type="submit" className="toque h-11 md:h-9" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  );
}
