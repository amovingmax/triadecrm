'use client';

import { useMemo, useState } from 'react';
import {
  CircleSlash,
  Copy,
  CornerDownRight,
  Plus,
  RotateCcw,
  SearchCheck,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarNumero } from '@/components/parceiros/formatos';

import {
  EXPLICACAO_DECISAO,
  ORDEM_DAS_DECISOES,
  ROTULO_DECISAO,
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

/**
 * Passo 3: a prévia.
 *
 * O que esta tela precisa responder, nesta ordem: quantas entram, quantas já
 * existem — E DE QUEM —, e quantas vão para revisão. O nome da ficha duplicada
 * não é detalhe: sem ele a pessoa lê "12 duplicatas" e não tem o que decidir; com
 * ele, ela reconhece "ah, o Jôsy Buffet a gente já cadastrou" e segue.
 *
 * Cor: nenhuma. A escala térmica é a única cromia do produto (direção visual), e
 * pintar "entra" de verde competiria com ela. Aqui quem separa os grupos é o
 * ícone, a contagem em mono e a ordem.
 */
export function PassoPrevia({ previa, aoVoltar }: { previa: Previa; aoVoltar: () => void }) {
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

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {ORDEM_DAS_DECISOES.filter((d) => (previa.contagem[d] ?? 0) > 0).map((decisao) => {
          const Icone = ICONE[decisao];
          return (
            <div
              key={decisao}
              className="flex flex-col gap-1 rounded-xl border border-hairline p-3"
            >
              <span className="numerico text-2xl leading-none font-semibold">
                {formatarNumero(previa.contagem[decisao] ?? 0)}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Icone className="size-3.5 shrink-0" aria-hidden="true" />
                {ROTULO_DECISAO[decisao]}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-6">
        {grupos.map(({ decisao, linhas }) => (
          <Grupo key={decisao} decisao={decisao} linhas={linhas} />
        ))}
      </div>

      <div>
        <Button variant="ghost" onClick={aoVoltar} className="toque h-11 md:h-9">
          <CornerDownRight className="rotate-180" aria-hidden="true" />
          Voltar e corrigir as colunas
        </Button>
      </div>
    </div>
  );
}

function Grupo({ decisao, linhas }: { decisao: Decisao; linhas: LinhaDaPrevia[] }) {
  const [tudo, setTudo] = useState(false);
  const Icone = ICONE[decisao];
  const mostradas = linhas.slice(0, tudo ? TETO_VISIVEL : PRIMEIRAS);
  const escondidas = tudo ? Math.max(0, linhas.length - TETO_VISIVEL) : 0;

  return (
    <section aria-labelledby={`grupo-${decisao}`} className="flex flex-col gap-2">
      <div>
        <h3
          id={`grupo-${decisao}`}
          className="flex items-center gap-2 font-heading font-medium tracking-tight"
        >
          <Icone className="size-4 text-muted-foreground" aria-hidden="true" />
          {ROTULO_DECISAO[decisao]}
          <span className="numerico text-sm font-normal text-muted-foreground">
            {formatarNumero(linhas.length)}
          </span>
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {EXPLICACAO_DECISAO[decisao]}
        </p>
      </div>

      <ul className="border-t border-hairline">
        {mostradas.map((linha) => (
          <li
            key={`${linha.linha}-${linha.nome ?? ''}`}
            className="flex flex-col gap-1 border-b border-hairline py-2.5 md:flex-row md:items-baseline md:gap-3"
          >
            <span
              className="numerico shrink-0 text-xs text-muted-foreground"
              title={`Linha ${linha.linha} da planilha`}
            >
              {linha.linha}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {linha.nome ?? <span className="text-muted-foreground">Linha sem nome</span>}
              </p>

              <p className="text-sm text-muted-foreground">
                {[linha.categoria, linha.cidade, linha.telefone].filter(Boolean).join(' · ') ||
                  'Sem categoria, cidade ou telefone reconhecidos'}
              </p>

              {/* O nome de quem a linha duplica. É o dado que faz a pessoa decidir. */}
              {linha.duplicata ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Já existe como </span>
                  <span className="font-medium">{linha.duplicata.nome}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    ({motivoDaChave(linha.duplicata.chave)})
                  </span>
                </p>
              ) : null}

              {textoDoMotivo(linha.motivo) && !linha.duplicata ? (
                <p className="text-sm text-muted-foreground">{textoDoMotivo(linha.motivo)}</p>
              ) : null}

              {linha.avisos.length > 0 ? (
                <ul className="mt-1 flex flex-wrap gap-1">
                  {linha.avisos.map((aviso) => (
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
          </li>
        ))}
      </ul>

      {escondidas > 0 ? (
        <p className="text-sm text-muted-foreground">
          Mostrando as primeiras <span className="numerico">{formatarNumero(TETO_VISIVEL)}</span>{' '}
          de <span className="numerico">{formatarNumero(linhas.length)}</span>. As outras seguem a
          mesma regra; para conferir uma a uma, abra a planilha.
        </p>
      ) : null}

      {linhas.length > PRIMEIRAS ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTudo((v) => !v)}
            className="toque h-11 md:h-8"
          >
            {tudo
              ? 'Mostrar só as primeiras'
              : linhas.length > TETO_VISIVEL
                ? `Ver ${formatarNumero(TETO_VISIVEL)} linhas deste grupo`
                : `Ver as ${formatarNumero(linhas.length)} linhas deste grupo`}
          </Button>
        </div>
      ) : null}
    </section>
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
