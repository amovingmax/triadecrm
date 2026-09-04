'use client';

import { useId, useState } from 'react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { AcaoDeRevisao } from './dados';
import type { CandidatoDaFila, OpcaoCategoriaRadar } from './tipos';

/**
 * O que uma decisão precisa perguntar antes de ser tomada.
 *
 * Aprovar sem categoria não decide nada: é a categoria que escolhe o funil em que
 * o negócio nasce. Recusar sem motivo escrito não é decisão, é sumiço — e o banco
 * recusa (constraint `supplier_candidates_recusa_com_motivo`). Só por isso este
 * diálogo existe; quando o candidato já traz categoria, aprovar é um clique só.
 */
export function DialogoDeDecisao({
  candidato,
  acao,
  categorias,
  ocupado,
  aoFechar,
  aoConfirmar,
}: {
  candidato: CandidatoDaFila | null;
  acao: Exclude<AcaoDeRevisao, 'mesclar'>;
  categorias: OpcaoCategoriaRadar[];
  ocupado: boolean;
  aoFechar: () => void;
  aoConfirmar: (dados: { categoriaId: number | null; motivo: string | null }) => void;
}) {
  return (
    <Dialog open={candidato !== null} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sombra-base-forte sm:max-w-md">
        {/* A `key` é o reset: trocar de candidato ou de ação monta um formulário novo,
            e o motivo digitado para o candidato anterior não vaza para o próximo.
            É o que dispensa o `useEffect` que ficaria sincronizando estado com prop. */}
        {candidato ? (
          <Conteudo
            key={`${candidato.id}:${acao}`}
            candidato={candidato}
            acao={acao}
            categorias={categorias}
            ocupado={ocupado}
            aoFechar={aoFechar}
            aoConfirmar={aoConfirmar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Conteudo({
  candidato,
  acao,
  categorias,
  ocupado,
  aoFechar,
  aoConfirmar,
}: {
  candidato: CandidatoDaFila;
  acao: Exclude<AcaoDeRevisao, 'mesclar'>;
  categorias: OpcaoCategoriaRadar[];
  ocupado: boolean;
  aoFechar: () => void;
  aoConfirmar: (dados: { categoriaId: number | null; motivo: string | null }) => void;
}) {
  const idCategoria = useId();
  const idMotivo = useId();
  const [categoriaId, setCategoriaId] = useState<number | null>(candidato.categoria_id);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const recusa = acao !== 'aprovar';

  function confirmar() {
    if (!recusa && categoriaId === null) {
      setErro('Escolha a categoria: é ela que decide em qual funil o negócio nasce.');
      return;
    }
    if (recusa && !motivo.trim()) {
      setErro('Escreva o motivo: quem abrir esse registro depois precisa entender a decisão.');
      return;
    }
    aoConfirmar({ categoriaId, motivo: recusa ? motivo.trim() : null });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {acao === 'aprovar'
            ? 'Aprovar candidato'
            : acao === 'recusar'
              ? 'Recusar candidato'
              : 'Marcar como não contatar'}
        </DialogTitle>
        <DialogDescription>
          {acao === 'aprovar'
            ? `${candidato.nome} vira parceiro e entra no funil na primeira etapa, com "Primeiro contato" marcado para o próximo dia útil.`
            : acao === 'recusar'
              ? `${candidato.nome} sai da fila. O motivo fica gravado junto com quem decidiu e quando.`
              : `${candidato.nome} sai da fila e fica marcado para nunca virar alvo.`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        {!recusa ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={idCategoria}>Categoria</Label>
            <Select
              value={categoriaId ? String(categoriaId) : undefined}
              onValueChange={(v) => {
                setCategoriaId(Number(v));
                setErro(null);
              }}
            >
              <SelectTrigger id={idCategoria} className="h-11 w-full md:h-9">
                <SelectValue placeholder="Escolha a categoria" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={idMotivo}>Motivo</Label>
            <Input
              id={idMotivo}
              autoFocus
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
                setErro(null);
              }}
              placeholder="Fora do escopo, fechou, é de outra cidade..."
              className="h-11 md:h-9"
            />
          </div>
        )}

        {erro ? (
          <p role="alert" className="text-sm text-destructive-texto">
            {erro}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={aoFechar} className="toque h-11 md:h-9">
          Cancelar
        </Button>
        <Button onClick={confirmar} disabled={ocupado} className="toque h-11 md:h-9">
          {ocupado
            ? 'Salvando...'
            : acao === 'aprovar'
              ? 'Aprovar e criar parceiro'
              : acao === 'recusar'
                ? 'Recusar'
                : 'Marcar não contatar'}
        </Button>
      </DialogFooter>
    </>
  );
}
