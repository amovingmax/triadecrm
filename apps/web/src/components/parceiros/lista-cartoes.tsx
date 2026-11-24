'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils';
import { RevelarLista, useRevelarLinha } from '@/components/movimento';
import { EtiquetaEtapa } from '@/components/funis/etapa';
import { MudarEtapa } from '@/components/funis/mudar-etapa';

import { BotaoConsultoria } from './consultoria-botoes';
import { formatarLocal, formatarTelefone } from './formatos';
import { BotaoSaudacao } from './saudacao-botoes';
import { CaixaDeMarcar, type AcoesNaTabela } from './tabela-parceiros';
import type { LinhaParceiro } from './tipos';
import { resumoDoContato, TagDoContato } from './ultimo-contato';

/**
 * A lista em cartões, abaixo de 1024px (protótipo responsivo da Imova, 24/11/2026;
 * até então só abaixo de 768px). No tablet a tabela quebrava: seis filtros em três
 * linhas em cima e colunas espremidas embaixo.
 *
 * Três linhas, um assunto por linha:
 *
 *     nome ............................................ [enviar]
 *     categoria · bairro · telefone
 *     [etapa] [o que o contato deu] quando · tentativa
 *
 * O nome fica numa linha só (a etiqueta da etapa desceu para a terceira e deixou de
 * empurrar o nome para duas). O cartão INTEIRO é o alvo de toque e abre a ficha: o
 * link é uma camada por cima dele, com o nome como rótulo. O que precisa ficar acima
 * desse link (enviar a saudação, e no tablet a caixa de marcar, a etapa e a marca
 * de Parceiro) sobe de camada com `relative z-10`, e o botão de enviar tem 44px e
 * mora fora do texto, na coluna da direita: botão dentro de link é toque ambíguo.
 *
 * Os cartões vivem num cartão branco, separados por hairline, como as linhas da
 * tabela. Categoria e bairro vêm juntos e truncam primeiro; o telefone não trunca.
 *
 * O escalonamento de entrada vem do `useRevelarLinha` (className + delay no próprio
 * `<li>`), e não do `<RevelarItem>`, que embrulharia o `<li>` numa `<div>` e
 * quebraria a semântica da lista.
 */
export type SaudacaoNoCartao = {
  pedidos: ReadonlySet<string>;
  ocupado: boolean;
  pedirUm: (id: string) => void;
};

/** Marcar vários (para a saudação em lote): só do tablet para cima, como na tabela. */
export type SelecaoNoCartao = {
  escolhidos: ReadonlySet<string>;
  alternar: (id: string) => void;
  marcarVarios: (ids: readonly string[], marcar: boolean) => void;
  marcaveis: readonly string[];
};

export function ListaCartoes({
  linhas,
  saudacao = null,
  selecao = null,
  acoes = null,
}: {
  linhas: LinhaParceiro[];
  saudacao?: SaudacaoNoCartao | null;
  /**
   * A caixa de marcar, a etapa que muda e a marca de Parceiro. No celular ficam de
   * fora (marcar vários e mudar etapa é trabalho de mesa, como sempre foi); no
   * tablet entram, porque até 24/11/2026 o tablet via a tabela, que tem as três.
   */
  selecao?: SelecaoNoCartao | null;
  acoes?: AcoesNaTabela | null;
}) {
  const marcadas = selecao
    ? selecao.marcaveis.filter((id) => selecao.escolhidos.has(id)).length
    : 0;
  const todas =
    selecao !== null && selecao.marcaveis.length > 0 && marcadas === selecao.marcaveis.length;

  return (
    <RevelarLista>
      <div className="sombra-base rounded-xl bg-card px-4 py-1">
        {selecao && selecao.marcaveis.length > 0 ? (
          <div className="-mx-1 flex items-center gap-1 border-b border-hairline py-1 text-sm text-muted-foreground">
            <CaixaDeMarcar
              marcada={todas}
              meia={marcadas > 0 && !todas}
              habilitada
              rotulo="Marcar todos desta página que têm WhatsApp"
              aoMudar={() => selecao.marcarVarios(selecao.marcaveis, !todas)}
            />
            <span>
              Marcar os <span className="numerico">{selecao.marcaveis.length}</span> desta página
              que têm WhatsApp
            </span>
          </div>
        ) : null}
        <ul className="corpo-tabela flex flex-col">
          {linhas.map((linha, indice) => (
            <Cartao
              key={linha.id}
              linha={linha}
              indice={indice}
              saudacao={saudacao}
              selecao={selecao}
              acoes={acoes}
            />
          ))}
        </ul>
      </div>
    </RevelarLista>
  );
}

function Cartao({
  linha,
  indice,
  saudacao,
  selecao,
  acoes,
}: {
  linha: LinhaParceiro;
  indice: number;
  saudacao: SaudacaoNoCartao | null;
  selecao: SelecaoNoCartao | null;
  acoes: AcoesNaTabela | null;
}) {
  const revelar = useRevelarLinha(indice);
  const local = formatarLocal(linha.neighborhood, linha.city);
  const contexto = [linha.primary_category, local || null].filter(Boolean).join(' · ');
  const contato = resumoDoContato(linha);

  return (
    <li
      {...revelar}
      className={cn(
        'relative flex items-center gap-3 border-b border-hairline py-3 last:border-b-0',
        revelar.className,
      )}
    >
      {/* O link da ficha é uma camada por cima do cartão inteiro, com o nome como
          rótulo: o alvo de toque é o retângulo todo, e não a linha de 23px do nome. */}
      <Link
        href={`/parceiros/${linha.id}`}
        aria-label={linha.name}
        className="absolute inset-0 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted/40"
      />

      {selecao ? (
        <span className="relative z-10 -ml-2 self-start">
          <CaixaDeMarcar
            marcada={selecao.escolhidos.has(linha.id)}
            habilitada={Boolean(linha.phone)}
            rotulo={linha.phone ? `Marcar ${linha.name}` : `${linha.name} não tem WhatsApp`}
            aoMudar={() => selecao.alternar(linha.id)}
          />
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-[15px] font-semibold">{linha.name}</p>

        <p className="flex min-w-0 items-center gap-2 text-[13px] whitespace-nowrap text-muted-foreground">
          {contexto ? <span className="truncate">{contexto}</span> : null}
          {contexto && linha.phone ? <span aria-hidden="true">·</span> : null}
          {linha.phone ? (
            <span className="numerico shrink-0">{formatarTelefone(linha.phone)}</span>
          ) : null}
          {!contexto && !linha.phone ? <span>-</span> : null}
        </p>

        {/* A etapa e o contato numa linha só, que quebra se precisar: a tag e o
            "quando" são uma frase ("não atendeu, há 2 dias") e ficam juntos. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {acoes && linha.stage ? (
            <MudarEtapa
              organizacaoId={linha.id}
              nome={linha.name}
              etapa={linha.stage}
              aoMudar={acoes.aoMudarEtapa}
              className="relative z-10 h-8 px-2.5 text-foreground"
            />
          ) : (
            <EtiquetaEtapa etapa={linha.stage} />
          )}
          {acoes?.consultoria ? (
            <BotaoConsultoria
              nome={linha.name}
              marcado={acoes.consultoria.naConsultoria.has(linha.id)}
              tag={acoes.consultoria.naConsultoria.get(linha.id) ?? null}
              aoMudar={(sim) => acoes.consultoria?.marcar(linha.id, sim, linha.name)}
              className={cn(
                'relative z-10',
                acoes.consultoria.naConsultoria.has(linha.id) ? 'h-8' : 'size-8',
              )}
            />
          ) : null}
          {contato.contatado ? (
            <>
              <TagDoContato resumo={contato} />
              <span className="min-w-0 truncate" title={contato.descricao}>
                {[contato.quando, contato.tentativas].filter(Boolean).join(' · ')}
              </span>
            </>
          ) : (
            <span>Ainda não contatado</span>
          )}
        </div>
      </div>

      {saudacao && linha.phone ? (
        <BotaoSaudacao
          nome={linha.name}
          pedido={saudacao.pedidos.has(linha.id)}
          ocupado={saudacao.ocupado}
          aoPedir={() => saudacao.pedirUm(linha.id)}
          className="relative z-10 -mr-1.5 size-11"
        />
      ) : null}
    </li>
  );
}
