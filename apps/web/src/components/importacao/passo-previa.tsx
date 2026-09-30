'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CircleSlash,
  Copy,
  Plus,
  RotateCcw,
  SearchCheck,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { SeletorDeAba } from '@/components/ui/abas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarNumero } from '@/components/parceiros/formatos';

import { totalDe } from './dados';
import {
  ORDEM_DAS_DECISOES,
  textoDoAviso,
  textoDoMotivo,
  type Decisao,
  type LinhaDaPrevia,
  type Previa,
} from './tipos';

const ICONE: Record<Decisao, LucideIcon> = {
  entra: Plus,
  duplicata: Copy,
  revisao: SearchCheck,
  nao_contatar: CircleSlash,
  repetida: RotateCcw,
  erro: TriangleAlert,
};

/** Quantas linhas de cada grupo aparecem antes do "ver todas". */
const PRIMEIRAS = 8;

/**
 * Teto de linhas desenhadas por grupo, mesmo com o grupo aberto.
 *
 * Uma planilha de 15.000 linhas produz um grupo de 13.000 — e desenhar 13.000
 * itens de lista congela a aba, que é exatamente o que esta tela promete não
 * fazer. Trezentas bastam para conferir o padrão do que está entrando; o resto
 * está no arquivo, que é onde a correção acontece de qualquer jeito.
 */
const TETO_VISIVEL = 300;

/** Os nomes das abas: curtos, e ditos do ponto de vista de quem importa. */
const ABA: Record<Decisao, string> = {
  entra: 'Novos parceiros',
  duplicata: 'Já estão na base',
  revisao: 'Sem categoria',
  nao_contatar: 'Pediram para parar',
  repetida: 'Já importadas',
  erro: 'Com problema',
};

/** Uma linha por grupo, e só uma: o porquê longo mora em `EXPLICACAO_DECISAO`. */
const O_QUE_ACONTECE: Record<Decisao, string> = {
  entra: 'Entram agora na base e no funil, na primeira etapa, com você como responsável.',
  duplicata:
    'Nada é sobrescrito: vão para a Revisão com o parceiro parecido apontado, para juntar ou descartar.',
  revisao: 'Vão para a Revisão, para você escolher a categoria.',
  nao_contatar: 'Já tinham pedido para parar de receber. Não entram.',
  repetida: 'Vieram numa importação anterior, ou repetidas no arquivo. Nada é criado de novo.',
  erro: 'Sem nome, ou sem nenhum contato. Corrija no arquivo e importe de novo.',
};

/** A frase do topo: quantas entram, quantas vão para a Revisão, quantas não entram. */
function resumoDaPrevia(contagem: Previa['contagem']): string {
  const entra = contagem.entra ?? 0;
  const fila = (contagem.duplicata ?? 0) + (contagem.revisao ?? 0);
  const fora = (contagem.nao_contatar ?? 0) + (contagem.repetida ?? 0) + (contagem.erro ?? 0);
  const partes = [
    entra === 0
      ? 'Nenhuma vira parceiro agora'
      : `${formatarNumero(entra)} ${entra === 1 ? 'entra agora como parceiro' : 'entram agora como parceiros'}`,
  ];
  if (fila > 0) partes.push(`${formatarNumero(fila)} ${fila === 1 ? 'vai' : 'vão'} para a Revisão`);
  if (fora > 0) partes.push(`${formatarNumero(fora)} não ${fora === 1 ? 'entra' : 'entram'}`);
  return `${partes.join(', ')}.`;
}

/**
 * O passo 3 da importação: conferir e importar.
 *
 * O QUE ERA, E POR QUE MUDOU (30/09/2026). A conferência era a última metade
 * de uma pilha: quatro cartões de contagem, depois TODOS os grupos um embaixo
 * do outro (cada um com título, parágrafo e oito linhas), e uma barra de
 * "Gravar estas 20 linhas" grudada no pé da tela, por cima da própria lista,
 * com a frase "5 viram parceiro agora. As outras 15 não somem: 6 param na fila
 * porque já estão na base e 9 param na fila esperando categoria". Rafael: "to
 * entendendo nada".
 *
 * Agora é UM cartão:
 *   1. em cima, a resposta em uma frase ("5 entram agora como parceiros, 15 vão
 *      para a Revisão") e o botão de importar, ao lado dela — a pessoa decide
 *      sem rolar, e não há mais barra fixa cobrindo nada;
 *   2. embaixo, um grupo de cada vez, em abas com a contagem. Quem quer
 *      conferir as duplicatas abre a aba delas; quem confia importa.
 *
 * O nome do parceiro que a linha duplica continua na linha: sem ele a pessoa lê
 * "6 já estão na base" e não tem o que decidir.
 */
export function PassoPrevia({
  previa,
  ocupado,
  aoImportar,
  aoVoltar,
  foraPorEscolha,
  aoTrazerDeVolta,
}: {
  previa: Previa;
  ocupado: boolean;
  aoImportar: () => void;
  /** Volta ao passo das categorias, quando ele existiu. */
  aoVoltar?: () => void;
  /** Nomes de categoria que a pessoa mandou não importar. */
  foraPorEscolha: readonly string[];
  aoTrazerDeVolta: () => void;
}) {
  const grupos = useMemo(() => {
    const mapa = new Map<Decisao, LinhaDaPrevia[]>();
    for (const linha of previa.linhas) {
      const atual = mapa.get(linha.decisao);
      if (atual) atual.push(linha);
      else mapa.set(linha.decisao, [linha]);
    }
    return ORDEM_DAS_DECISOES.filter((d) => (mapa.get(d)?.length ?? 0) > 0).map((d) => ({
      decisao: d,
      linhas: mapa.get(d) ?? [],
    }));
  }, [previa.linhas]);

  const [aba, setAba] = useState<Decisao | null>(null);
  const ativa = grupos.find((g) => g.decisao === aba) ?? grupos[0] ?? null;
  const IconeAtivo = ativa ? ICONE[ativa.decisao] : null;
  const total = totalDe(previa.contagem);

  return (
    <section
      aria-labelledby="conferir-titulo"
      className="sombra-base flex flex-col gap-5 rounded-xl bg-card p-4 sm:p-5"
    >
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="conferir-titulo" className="text-lg font-semibold tracking-[-0.01em]">
            {resumoDaPrevia(previa.contagem)}
          </h2>
          <p className="text-sm text-muted-foreground">
            Confira abaixo, empresa por empresa. Nada é gravado antes de você importar.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {aoVoltar ? (
            <Button variant="ghost" onClick={aoVoltar} disabled={ocupado} className="toque h-11 md:h-10">
              <ArrowLeft aria-hidden="true" />
              Categorias
            </Button>
          ) : null}
          <Button
            variant="menta"
            onClick={aoImportar}
            disabled={ocupado || total === 0}
            className="toque h-11 md:h-10 md:px-5"
          >
            <Upload aria-hidden="true" />
            Importar lista
          </Button>
        </div>
      </header>

      {foraPorEscolha.length > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Você tirou desta importação: {foraPorEscolha.join(' · ')}.{' '}
          <button
            type="button"
            className="toque underline underline-offset-4 hover:text-foreground"
            onClick={aoTrazerDeVolta}
          >
            Trazer de volta
          </button>
        </p>
      ) : null}

      {ativa ? (
        <div className="flex flex-col gap-3">
          <SeletorDeAba
            rotulo="O que acontece com cada empresa"
            rolavel
            itens={grupos.map((g) => ({
              id: g.decisao,
              rotulo: ABA[g.decisao],
              contagem: g.linhas.length,
            }))}
            ativo={ativa.decisao}
            aoTrocar={(id) => setAba(id)}
          />
          <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
            {IconeAtivo ? <IconeAtivo className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : null}
            <span>{O_QUE_ACONTECE[ativa.decisao]}</span>
          </p>
          <Grupo key={ativa.decisao} linhas={ativa.linhas} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * O aviso que repete o motivo da linha não vai à tela: "A categoria não bate com
 * nenhuma do catálogo" e, logo embaixo, a pílula "Categoria não reconhecida" são
 * a mesma frase duas vezes.
 */
function avisosQueDizemAlgoANovo(linha: LinhaDaPrevia): string[] {
  return linha.avisos.filter((aviso) => !(linha.motivo && aviso === linha.motivo));
}

function Grupo({ linhas }: { linhas: LinhaDaPrevia[] }) {
  const [tudo, setTudo] = useState(false);
  const mostradas = linhas.slice(0, tudo ? TETO_VISIVEL : PRIMEIRAS);
  const escondidas = tudo ? Math.max(0, linhas.length - TETO_VISIVEL) : 0;

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {mostradas.map((linha) => (
          <li
            key={`${linha.linha}-${linha.nome ?? ''}`}
            className="flex items-start gap-3 rounded-lg bg-muted/45 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">
                {linha.nome ?? <span className="text-muted-foreground">Linha sem nome</span>}
              </p>

              <p className="text-[13px] text-muted-foreground">
                {[linha.categoria, linha.cidade, linha.telefone].filter(Boolean).join(' · ') ||
                  'Sem categoria, cidade ou telefone reconhecidos'}
              </p>

              {/* O nome de quem a linha duplica. É o dado que faz a pessoa decidir. */}
              {linha.duplicata ? (
                <p className="text-[13px]">
                  <span className="text-muted-foreground">Parece com </span>
                  <span className="font-medium">{linha.duplicata.nome}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    ({motivoDaChave(linha.duplicata.chave)})
                  </span>
                </p>
              ) : null}

              {textoDoMotivo(linha.motivo) && !linha.duplicata ? (
                <p className="text-[13px] text-muted-foreground">{textoDoMotivo(linha.motivo)}</p>
              ) : null}

              {avisosQueDizemAlgoANovo(linha).length > 0 ? (
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {avisosQueDizemAlgoANovo(linha).map((aviso) => (
                    <li key={aviso}>
                      <Badge
                        variant={aviso === 'cpf_descartado' ? 'destructive' : 'outline'}
                        className={cn('h-auto py-0.5 text-xs font-normal whitespace-normal')}
                      >
                        {textoDoAviso(aviso)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <span
              className="numerico shrink-0 pt-0.5 text-xs text-muted-foreground"
              title="A linha desta empresa no arquivo"
            >
              linha {linha.linha}
            </span>
          </li>
        ))}
      </ul>

      {escondidas > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Mostrando as primeiras <span className="numerico">{formatarNumero(TETO_VISIVEL)}</span> de{' '}
          <span className="numerico">{formatarNumero(linhas.length)}</span>. As outras seguem a
          mesma regra.
        </p>
      ) : null}

      {linhas.length > PRIMEIRAS ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTudo((v) => !v)}
            className="toque h-11 md:h-9"
          >
            {tudo
              ? 'Mostrar menos'
              : linhas.length > TETO_VISIVEL
                ? `Ver ${formatarNumero(TETO_VISIVEL)} empresas`
                : `Ver as ${formatarNumero(linhas.length)} empresas`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A chave que casou, dita como uma pessoa diria. */
function motivoDaChave(chave: string): string {
  switch (chave) {
    case 'cnpj':
      return 'mesmo CNPJ';
    case 'phone':
      return 'mesmo telefone';
    case 'instagram':
      return 'mesmo @';
    case 'place_id':
      return 'mesmo ponto no mapa';
    case 'domain':
      return 'mesmo site';
    case 'landline_neighborhood':
      return 'mesmo fixo e mesmo bairro';
    case 'name_trgm':
      return 'nome muito parecido';
    default:
      return chave;
  }
}
