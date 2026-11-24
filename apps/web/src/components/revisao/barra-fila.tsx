'use client';

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';

import { BotaoFiltros } from '@/components/ui/botao-filtros';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FaixaDeslizante } from '@/components/ui/faixa-deslizante';
import { FolhaFiltros, GrupoDeFiltro } from '@/components/ui/folha-filtros';
import { CampoDeBusca } from '@/components/parceiros/campo-de-busca';
import {
  EtiquetasDeFiltro,
  type EtiquetaDeFiltro,
} from '@/components/parceiros/etiquetas-de-filtro';
import { formatarNumero } from '@/components/parceiros/formatos';

import {
  ROTULO_SITUACAO,
  type FiltroSituacao,
  type FiltrosDaFila,
  type OpcaoCategoriaRadar,
  type OpcaoSimples,
} from './tipos';

const SITUACOES: FiltroSituacao[] = ['novo', 'aprovado', 'mesclado', 'recusado', 'todos'];

/**
 * Recorte da fila: situação, busca, e na folha a origem, a categoria e o atalho para
 * os candidatos que a higiene de entrada marcou.
 *
 * O mesmo desenho de Prospectados (protótipo responsivo da Imova, 24/11/2026): busca
 * na largura e o botão Filtros ao lado, com o número dos ligados. A situação é o
 * filtro mais usado e por isso fica à vista, em fichas que deslizam de lado: ela
 * define QUAL fila se está olhando ("Esperando você" é o atalho do dia a dia). Antes
 * as quatro caixas ficavam numa fila cortada à direita no celular, sem sinal de que
 * havia mais.
 */
export function BarraDaFila({
  filtros,
  fontes,
  categorias,
  marcados,
  novos,
  total,
  carregando,
  aoMudar,
  aoLimpar,
}: {
  filtros: FiltrosDaFila;
  fontes: OpcaoSimples[];
  categorias: OpcaoCategoriaRadar[];
  /** Quantos candidatos novos vieram marcados pela higiene; `null` enquanto carrega. */
  marcados: number | null;
  /** Quantos nomes estão esperando decisão; `null` enquanto carrega ou sem acesso. */
  novos: number | null;
  /** Quantos nomes o recorte atual devolveu (para o botão da folha). */
  total: number;
  carregando: boolean;
  aoMudar: (parcial: Partial<FiltrosDaFila>) => void;
  aoLimpar: () => void;
}) {
  const [folhaAberta, setFolhaAberta] = useState(false);
  const ligados =
    (filtros.fonteId ? 1 : 0) + (filtros.categoriaId ? 1 : 0) + (filtros.soMarcados ? 1 : 0);

  const etiquetas: EtiquetaDeFiltro[] = [];
  const fonte = fontes.find((f) => f.id === filtros.fonteId);
  if (fonte)
    etiquetas.push({
      chave: 'origem',
      rotulo: `Origem: ${fonte.nome}`,
      aoTirar: () => aoMudar({ fonteId: null }),
    });
  const categoria = categorias.find((c) => c.id === filtros.categoriaId);
  if (categoria)
    etiquetas.push({
      chave: 'categoria',
      rotulo: `Categoria: ${categoria.nome}`,
      aoTirar: () => aoMudar({ categoriaId: null }),
    });
  if (filtros.soMarcados)
    etiquetas.push({
      chave: 'problema',
      rotulo: 'Só os que têm um problema',
      aoTirar: () => aoMudar({ soMarcados: false }),
    });

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        {/* Texto de ajuda curto (24/11/2026): "…@instagram ou CNPJ" era cortado em
            "…ou CNP" no celular. A frase inteira continua para o leitor de tela. */}
        <CampoDeBusca
          valor={filtros.q}
          aoMudar={(q) => aoMudar({ q })}
          rotulo="Buscar candidato"
          placeholder="Nome, telefone, @ ou CNPJ"
          dica="Nome, telefone, @instagram ou CNPJ."
        />
        <BotaoFiltros ligados={ligados} onClick={() => setFolhaAberta(true)} />
      </div>

      <FaixaDeslizante rotulo="Situação" ativo={filtros.situacao} sangria>
        {SITUACOES.map((s) => (
          <Chip
            key={s}
            ativo={filtros.situacao === s}
            contagem={s === 'novo' ? novos : null}
            onClick={() => aoMudar({ situacao: s })}
          >
            {ROTULO_SITUACAO[s]}
          </Chip>
        ))}
      </FaixaDeslizante>

      <EtiquetasDeFiltro etiquetas={etiquetas} aoLimpar={aoLimpar} />

      <FolhaFiltros
        aberta={folhaAberta}
        aoMudar={setFolhaAberta}
        rodape={
          <>
            {ligados > 0 ? (
              <Button variant="outline" className="toque h-11" onClick={aoLimpar}>
                Limpar
              </Button>
            ) : null}
            <Button className="toque h-11" onClick={() => setFolhaAberta(false)}>
              {carregando
                ? 'Ver nomes'
                : `Ver ${formatarNumero(total)} ${total === 1 ? 'nome' : 'nomes'}`}
            </Button>
          </>
        }
      >
        {/* "Origem", e não "Fonte": a lista vem de `public.sources` INTEIRA
            (catalogos.ts), ligadas e desligadas — é assim que se acha candidato
            antigo, de uma origem que já não recebe ninguém. */}
        {fontes.length > 0 ? (
          <GrupoDeFiltro titulo="Origem">
            {fontes.map((f) => (
              <Chip
                key={f.id}
                ativo={filtros.fonteId === f.id}
                onClick={() => aoMudar({ fonteId: filtros.fonteId === f.id ? null : f.id })}
              >
                {f.nome}
              </Chip>
            ))}
          </GrupoDeFiltro>
        ) : null}
        {categorias.length > 0 ? (
          <GrupoDeFiltro titulo="Categoria">
            {categorias.map((c) => (
              <Chip
                key={c.id}
                ativo={filtros.categoriaId === c.id}
                onClick={() => aoMudar({ categoriaId: filtros.categoriaId === c.id ? null : c.id })}
              >
                {c.nome}
              </Chip>
            ))}
          </GrupoDeFiltro>
        ) : null}
        <GrupoDeFiltro titulo="Problema na entrada">
          <Chip
            ativo={filtros.soMarcados}
            contagem={marcados}
            onClick={() => aoMudar({ soMarcados: !filtros.soMarcados })}
          >
            <TriangleAlert className="size-4" aria-hidden="true" />
            Só os que têm um problema
          </Chip>
        </GrupoDeFiltro>
      </FolhaFiltros>
    </div>
  );
}
