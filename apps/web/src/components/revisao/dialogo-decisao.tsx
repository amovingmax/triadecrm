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
  irmas,
}: {
  candidato: CandidatoDaFila | null;
  acao: Exclude<AcaoDeRevisao, 'mesclar'>;
  categorias: OpcaoCategoriaRadar[];
  ocupado: boolean;
  aoFechar: () => void;
  aoConfirmar: (dados: {
    categoriaId: number | null;
    motivo: string | null;
    aprenderAgora?: boolean;
  }) => void;
  /**
   * Quantos OUTROS nomes na fila vieram com o mesmo rótulo da fonte.
   *
   * `null` enquanto o banco não respondeu. Zero esconde a caixinha: oferecer
   * "valer para os outros 0" é ruído.
   */
  irmas: number | null;
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
            irmas={irmas}
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
  irmas,
}: {
  candidato: CandidatoDaFila;
  acao: Exclude<AcaoDeRevisao, 'mesclar'>;
  categorias: OpcaoCategoriaRadar[];
  ocupado: boolean;
  aoFechar: () => void;
  aoConfirmar: (dados: {
    categoriaId: number | null;
    motivo: string | null;
    aprenderAgora?: boolean;
  }) => void;
  /**
   * Quantos OUTROS nomes na fila vieram com o mesmo rótulo da fonte.
   *
   * `null` enquanto o banco não respondeu. Zero esconde a caixinha: oferecer
   * "valer para os outros 0" é ruído.
   */
  irmas: number | null;
}) {
  const idCategoria = useId();
  const idMotivo = useId();
  const [categoriaId, setCategoriaId] = useState<number | null>(candidato.categoria_id);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  /**
   * DESMARCADA POR PADRÃO, e isso é o desenho.
   *
   * Marcar grava a regra do de-para na hora, pulando o contador dos cinco
   * freios — consentimento explícito vale mais que contagem, mas só quando é
   * explícito. Nascer marcada transformaria um clique distraído numa regra
   * permanente que cria ficha errada para sempre.
   */
  const [aprenderAgora, setAprenderAgora] = useState(false);

  const recusa = acao !== 'aprovar';

  function confirmar() {
    if (!recusa && categoriaId === null) {
      setErro('Escolha a categoria — é ela que decide em que funil o parceiro nasce, e as metas e o relatório contam por ela.');
      return;
    }
    if (recusa && !motivo.trim()) {
      setErro('Escreva o motivo: quem abrir esse registro depois precisa entender a decisão.');
      return;
    }
    aoConfirmar({
      categoriaId,
      motivo: recusa ? motivo.trim() : null,
      aprenderAgora: !recusa && aprenderAgora,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {acao === 'aprovar'
            ? 'Falta a categoria'
            : acao === 'recusar'
              ? 'Descartar este nome'
              : 'Marcar como não contatar'}
        </DialogTitle>
        <DialogDescription>
          {acao === 'aprovar'
            ? candidato.categoria_na_fonte
              ? `O arquivo dizia “${candidato.categoria_na_fonte}”, que o CRM não conhece. Escolha a categoria e ${candidato.nome} vira parceiro, no funil, com "Primeiro contato" no próximo dia útil.`
              : `Escolha a categoria e ${candidato.nome} vira parceiro, no funil, com "Primeiro contato" no próximo dia útil.`
            : acao === 'recusar'
              ? `${candidato.nome} sai da fila. O motivo fica gravado com quem decidiu e quando.`
              : `${candidato.nome} sai da fila e fica marcado para nunca ser procurado.`}
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

        {/* "Valer para os outros N": o número vem de um `count` real no banco
            (`public.radar_irmas_pelo_rotulo`). Prometer 5 e mexer em 9 seria
            pior que não oferecer. */}
        {!recusa && candidato.categoria_na_fonte && irmas !== null && irmas > 0 ? (
          <label className="flex max-w-prose items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={aprenderAgora}
              onChange={(e) => setAprenderAgora(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-foreground"
            />
            <span>
              Valer para {irmas === 1 ? 'o outro' : `os outros ${irmas}`} que também{' '}
              {irmas === 1 ? 'veio' : 'vieram'} como “{candidato.categoria_na_fonte}”.{' '}
              <span className="text-muted-foreground">
                {irmas === 1 ? 'Ele vira' : 'Eles viram'} parceiro agora, e o CRM passa a
                reconhecer esse nome sozinho nas próximas listas.
              </span>
            </span>
          </label>
        ) : null}

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
              ? 'Criar o parceiro'
              : acao === 'recusar'
                ? 'Descartar'
                : 'Marcar não contatar'}
        </Button>
      </DialogFooter>
    </>
  );
}
