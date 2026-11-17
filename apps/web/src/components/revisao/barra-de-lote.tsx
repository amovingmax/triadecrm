'use client';

import { useMemo } from 'react';
import { Check, MessageCircle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatarNumero } from '@/components/parceiros/formatos';

import type { CandidatoDaFila, OpcaoCategoriaRadar } from './tipos';

/** "Cada um com a sua" — o lote não impõe categoria nenhuma. É o padrão. */
const DE_CADA_UM = '__de_cada_um__';

/**
 * Os dois "sim" do lote. No celular ocupam a largura e QUEBRAM LINHA (16/11/2026):
 * o botão nomeia a categoria, e "Só aprovar 12 nomes em Locais (salões, chácaras,
 * hotéis, restaurantes, praia)" numa linha só (o `Button` é `whitespace-nowrap`)
 * passava da tela de 390px e alargava a página. No `md` volta a ser a pílula de
 * uma linha, do tamanho do texto.
 */
const BOTAO_DO_LOTE =
  'toque h-auto min-h-11 w-full py-2 whitespace-normal md:h-9 md:min-h-0 md:w-auto md:py-0 md:whitespace-nowrap';

/**
 * A barra do lote: aparece quando há nome marcado, e some quando não há.
 *
 * POR QUÊ: em 25/09/2026 a fila tinha 155 nomes presos, quase todos pelo mesmo
 * punhado de categorias que o CRM não conhecia. Um a um são três cliques por
 * nome — abrir, escolher entre 19, confirmar. Uma fila de 12 é trabalhada no
 * mesmo dia; uma de 155 é ignorada, e aí as duplicatas de verdade morrem junto
 * com o ruído.
 *
 * O QUE NÃO ESTÁ AQUI, e a ausência é o desenho:
 *   · mesclar — a decisão é QUAL FICHA VENCE, e isso não se agrupa;
 *   · "não contatar" — escreve em `suppression_list` e em `consent_events`;
 *   · "recusar" — o banco exige motivo escrito, e motivo em lote seria motivo
 *     genérico, que é o mesmo que motivo nenhum.
 * Os três continuam no cartão, um a um.
 *
 * E o botão NOMEIA o que vai acontecer — "Aprovar 12 nomes em Fotografia e
 * vídeo" — em vez de dizer "confirmar".
 */
export function BarraDeLote({
  marcados,
  categorias,
  categoriaId,
  ocupado,
  podeMandarMensagem,
  aoTrocarCategoria,
  aoAprovar,
  aoLimpar,
}: {
  marcados: readonly CandidatoDaFila[];
  categorias: readonly OpcaoCategoriaRadar[];
  /** Nula = cada um fica com a categoria que já tem. */
  categoriaId: number | null;
  ocupado: boolean;
  /** Mostra o "Aprovar e mandar mensagem" (admin e gestor; o SDR só aprova). */
  podeMandarMensagem: boolean;
  aoTrocarCategoria: (id: number | null) => void;
  /** `comMensagem` = o botão que também põe a mensagem automática na fila. */
  aoAprovar: (comMensagem: boolean) => void;
  aoLimpar: () => void;
}) {
  const semCategoria = useMemo(
    () => marcados.filter((c) => c.categoria_id === null).length,
    [marcados],
  );
  const nomeDaCategoria = categorias.find((c) => c.id === categoriaId)?.nome ?? null;

  // Sem categoria escolhida, quem não tem a sua não vira parceiro: o banco
  // exige categoria para derivar o funil. Dizer isso ANTES do clique é o que
  // evita o "3 não passaram" sem explicação.
  const impedidos = categoriaId === null ? semCategoria : 0;
  const passariam = marcados.length - impedidos;

  if (marcados.length === 0) return null;

  return (
    <div className="sticky bottom-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior))] z-30 -mx-4 flex flex-col gap-2 border-t border-hairline bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:flex-row md:items-center md:rounded-xl md:border md:px-4">
      <div className="min-w-0 md:flex-1">
        {/* No celular o "Desmarcar" sobe para a linha da contagem (16/11/2026): a
            barra gruda em cima da barra de baixo e chegava a 250px numa tela de
            667px, com uma linha inteira só para ele. No `md` ele volta para o fim
            da fila de botões, onde sempre esteve. */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            <span className="numerico">{formatarNumero(marcados.length)}</span>{' '}
            {marcados.length === 1 ? 'nome marcado' : 'nomes marcados'}
          </p>
          <Button
            variant="ghost"
            onClick={aoLimpar}
            className="toque -my-1.5 -mr-2 h-11 shrink-0 md:hidden"
          >
            <X aria-hidden="true" />
            Desmarcar
          </Button>
        </div>
        {impedidos > 0 ? (
          <p className="text-sm text-muted-foreground">
            <span className="numerico">{formatarNumero(impedidos)}</span>{' '}
            {impedidos === 1 ? 'não tem categoria e não entra' : 'não têm categoria e não entram'}.
            Escolha uma categoria para o lote, ou tire{' '}
            {impedidos === 1 ? 'esse nome' : 'esses nomes'} da seleção.
          </p>
        ) : null}
      </div>

      <Select
        value={categoriaId === null ? DE_CADA_UM : String(categoriaId)}
        onValueChange={(v) => aoTrocarCategoria(v === DE_CADA_UM ? null : Number(v))}
      >
        <SelectTrigger className="toque h-11 w-full md:h-9 md:w-72" aria-label="Categoria do lote">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DE_CADA_UM}>Cada um com a categoria que já tem</SelectItem>
          {categorias.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex flex-wrap items-center gap-2">
        {podeMandarMensagem ? (
          <Button
            disabled={ocupado || passariam <= 0}
            onClick={() => aoAprovar(true)}
            title="Cria as fichas e põe a mensagem automática de cada uma na fila. Elas saem aos poucos."
            className={BOTAO_DO_LOTE}
          >
            <MessageCircle aria-hidden="true" />
            {/* Um `<span>` só para a frase: solta dentro do `inline-flex`, cada
                pedaço ("Aprovar", o número, o resto) virava um item da fila e,
                ao quebrar linha, quebrava em colunas em vez de em frase. */}
            <span className="min-w-0">
              Aprovar <span className="numerico">{formatarNumero(passariam)}</span> e mandar
              mensagem
            </span>
          </Button>
        ) : null}
        <Button
          variant="outline"
          disabled={ocupado || passariam <= 0}
          onClick={() => aoAprovar(false)}
          title="Cria as fichas em Prospectados, sem mensagem."
          className={BOTAO_DO_LOTE}
        >
          <Check aria-hidden="true" />
          <span className="min-w-0">
            Só aprovar <span className="numerico">{formatarNumero(passariam)}</span>{' '}
            {passariam === 1 ? 'nome' : 'nomes'}
            {nomeDaCategoria ? ` em ${nomeDaCategoria}` : ''}
          </span>
        </Button>
        <Button variant="ghost" onClick={aoLimpar} className="toque hidden h-11 md:inline-flex md:h-9">
          <X aria-hidden="true" />
          Desmarcar
        </Button>
      </div>
    </div>
  );
}
