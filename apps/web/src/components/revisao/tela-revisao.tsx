'use client';

import { useCallback, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatarNumero } from '@/components/parceiros/formatos';

import { BarraDaFila } from './barra-fila';
import { BarraDeLote } from './barra-de-lote';
import { CartaoCandidato } from './cartao-candidato';
import { PedirLeituraDaIa } from './pedir-leitura-da-ia';
import { PesosDaTriagem } from './pesos-da-triagem';
import {
  buscarFila,
  buscarResumo,
  chaveDaFila,
  mensagemDoErro,
  MOTIVO_DA_REVISAO,
  revisarCandidato,
  revisarLote,
  type AcaoDeRevisao,
} from './dados';

import { DialogoDeDecisao } from './dialogo-decisao';
import { ErroDaFila, EsqueletoDaFila, FilaVazia, VazioPorFiltroDaFila } from './estados';
import { FolhaDeCandidato } from './folha-candidato';
import {
  FILTROS_INICIAIS,
  POR_PAGINA,
  ROTULO_SITUACAO,
  temRecorteNaFila,
  type CandidatoDaFila,
  type CatalogosDoRadar,
  type FiltrosDaFila,
} from './tipos';

/** Lista vazia estável, para não trocar a identidade de `data` a cada renderização. */
const SEM_LINHAS: CandidatoDaFila[] = [];

/**
 * A Revisão (PRD §7.3, RF-RAD-*).
 *
 * Uma coisa só: trabalhar a fila de quem ainda não é parceiro, venha de onde
 * vier. Em 25/09/2026 saíram o catálogo de fontes e o painel do coletor, e com
 * uma superfície só a aba virou moldura vazia — quem enche esta fila é a
 * importação, e a pergunta "o robô está de pé?" mudou de casa para
 * Ajustes → Atendimento.
 *
 * A fila, a criação e a decisão moram no Postgres (`radar_fila`,
 * `radar_criar_candidato`, `radar_revisar_candidato`): aqui só ficam o recorte
 * atual, a espera e a tradução do que voltou.
 */
export function TelaRevisao({
  catalogos,
  podeDecidir,
  podeAjustarTriagem,
}: {
  catalogos: CatalogosDoRadar;
  /**
   * Papéis que trabalham a fila. A autorização de verdade é o RLS.
   *
   * É o espelho de `app.can_write()` (admin, gestor, sdr, embaixador), a mesma
   * guarda que `radar_revisar_candidato` usa para recusar com `sem_permissao` —
   * por isso é ele, e não `podeAjustarTriagem`, que responde por decidir na fila.
   */
  podeDecidir: boolean;
  /** Só gestor e admin ajustam os pesos da triagem e pedem leitura da IA. */
  podeAjustarTriagem: boolean;
}) {
  const clienteDeConsultas = useQueryClient();
  const [filtros, setFiltros] = useState<FiltrosDaFila>(FILTROS_INICIAIS);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  /**
   * Os nomes marcados para o lote, por id.
   *
   * Vive por `Set` e não por campo no candidato porque a fila é paginada e
   * recarregada: a marcação tem de sobreviver a um `invalidateQueries`, e o
   * que não estiver mais na página deixa de contar sozinho (ver `marcados`).
   */
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set());
  const [categoriaDoLote, setCategoriaDoLote] = useState<number | null>(null);
  const [lotando, setLotando] = useState(false);
  const [decisao, setDecisao] = useState<{
    candidato: CandidatoDaFila;
    acao: Exclude<AcaoDeRevisao, 'mesclar'>;
  } | null>(null);

  const resumo = useQuery({ queryKey: ['radar', 'resumo'], queryFn: buscarResumo });

  const fila = useQuery({
    queryKey: chaveDaFila(filtros),
    queryFn: () => buscarFila(filtros),
    placeholderData: keepPreviousData,
  });

  const mudar = useCallback((parcial: Partial<FiltrosDaFila>) => {
    setFiltros((atual) => ({ ...atual, pagina: 1, ...parcial }));
  }, []);

  const limpar = useCallback(
    () => setFiltros((atual) => ({ ...FILTROS_INICIAIS, situacao: atual.situacao })),
    [],
  );

  const recarregar = useCallback(() => {
    void clienteDeConsultas.invalidateQueries({ queryKey: ['radar'] });
  }, [clienteDeConsultas]);

  /** Manda a decisão ao banco e conta o que aconteceu, em português. */
  const enviarDecisao = useCallback(
    async (
      candidato: CandidatoDaFila,
      acao: AcaoDeRevisao,
      extra: { organizacaoId?: string; categoriaId?: number | null; motivo?: string | null } = {},
    ) => {
      setOcupado(candidato.id);
      try {
        const resposta = await revisarCandidato({
          candidatoId: candidato.id,
          acao,
          organizacaoId: extra.organizacaoId ?? null,
          categoriaId: extra.categoriaId ?? candidato.categoria_id,
          motivo: extra.motivo ?? null,
        });

        if (!resposta.ok) {
          toast.error('A decisão não foi gravada.', {
            description: MOTIVO_DA_REVISAO[resposta.motivo] ?? 'Atualize a fila e tente de novo.',
          });
          return;
        }

        setDecisao(null);
        if (resposta.situacao === 'aprovado') {
          toast.success(`${candidato.nome} virou parceiro.`, {
            description: `${candidato.nome} entrou no funil com "Primeiro contato" marcado para o próximo dia útil.`,
          });
        } else if (resposta.situacao === 'mesclado') {
          toast.success('Mesclado com a ficha existente.', {
            description: 'Só os campos que estavam vazios foram completados.',
          });
        } else {
          toast.success('Nome descartado.', { description: candidato.nome });
        }
        recarregar();
      } catch (erro) {
        toast.error('A decisão não foi gravada.', { description: mensagemDoErro(erro) });
      } finally {
        setOcupado(null);
      }
    },
    [recarregar],
  );

  /** O cartão pediu uma ação: umas exigem uma pergunta antes, outras não. */
  const decidir = useCallback(
    (candidato: CandidatoDaFila, acao: AcaoDeRevisao, organizacaoId?: string) => {
      if (acao === 'mesclar' && organizacaoId) {
        void enviarDecisao(candidato, 'mesclar', { organizacaoId });
        return;
      }
      if (acao === 'aprovar' && candidato.categoria_id !== null) {
        void enviarDecisao(candidato, 'aprovar');
        return;
      }
      if (acao !== 'mesclar') setDecisao({ candidato, acao });
    },
    [enviarDecisao],
  );

  const recorte = temRecorteNaFila(filtros);
  const total = fila.data?.total ?? 0;
  const linhas = fila.data?.linhas ?? SEM_LINHAS;

  /**
   * Quem pode entrar no lote.
   *
   * Nome já decidido não entra; quem pediu para não ser procurado não entra (o
   * banco recusa, e oferecer a caixinha seria prometer o que não acontece); e
   * quem tem ficha parecida na base não entra, porque ali a decisão é QUAL
   * FICHA VENCE — e isso não se agrupa.
   */
  const entraNoLote = useCallback(
    (c: CandidatoDaFila) =>
      podeDecidir && c.status === 'novo' && !c.nao_contatar && c.duplicatas.length === 0,
    [podeDecidir],
  );

  /** Os marcados que ainda estão na página: o que saiu da lista sai da conta. */
  const marcados = linhas.filter((c) => selecionados.has(c.id) && entraNoLote(c));

  /**
   * Os nomes de categoria da FONTE que se repetem nesta página, com dois ou
   * mais nomes atrás. É o atalho que resolve os 155: eles estão parados pelo
   * mesmo punhado de rótulos do Google, e não por 155 razões diferentes.
   */
  const gruposDaPagina = (() => {
    const por = new Map<string, string[]>();
    for (const c of linhas) {
      if (!entraNoLote(c) || c.categoria_na_fonte === null) continue;
      const atual = por.get(c.categoria_na_fonte);
      if (atual) atual.push(c.id);
      else por.set(c.categoria_na_fonte, [c.id]);
    }
    return [...por.entries()]
      .filter(([, ids]) => ids.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 4)
      .map(([nome, ids]) => ({ nome, ids }));
  })();

  const marcar = useCallback((id: string, ligado: boolean) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (ligado) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }, []);

  const aprovarLote = useCallback(async () => {
    const ids = marcados
      .filter((c) => categoriaDoLote !== null || c.categoria_id !== null)
      .map((c) => c.id);
    if (ids.length === 0) return;
    setLotando(true);
    try {
      const r = await revisarLote({ ids, categoriaId: categoriaDoLote });
      if (r.aprovados > 0) {
        toast.success(
          r.aprovados === 1
            ? '1 nome virou parceiro.'
            : `${formatarNumero(r.aprovados)} nomes viraram parceiro.`,
        );
      }
      // O que não passou é nomeado, e não some numa contagem: "3 não passaram"
      // sem dizer quais é o mesmo que não dizer nada.
      if (r.recusados > 0) {
        const quais = r.itens
          .filter((i) => !i.ok)
          .map((i) => `${i.nome ?? 'sem nome'} (${MOTIVO_DA_REVISAO[i.motivo ?? ''] ?? i.motivo})`)
          .slice(0, 5)
          .join('; ');
        toast.error(
          r.recusados === 1 ? '1 nome não passou.' : `${formatarNumero(r.recusados)} nomes não passaram.`,
          { description: quais },
        );
      }
      setSelecionados(new Set());
      setCategoriaDoLote(null);
      recarregar();
    } catch (erro) {
      toast.error('O lote não foi gravado.', { description: mensagemDoErro(erro) });
    } finally {
      setLotando(false);
    }
  }, [categoriaDoLote, marcados, recarregar]);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const novos = resumo.data?.novos ?? null;

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Revisão</h1>
          <p className="text-sm text-muted-foreground">
            {resumo.isPending ? (
              'Carregando...'
            ) : novos === null ? (
              'O seu acesso não trabalha a fila.'
            ) : novos === 0 ? (
              'Nada esperando. Tudo que entrou já foi decidido.'
            ) : (
              <>
                <span className="numerico">{formatarNumero(novos)}</span>
                {novos === 1 ? ' nome esperando você' : ' nomes esperando você'}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Pedir leitura da IA e mexer nos pesos da triagem são de admin e
              gestor. O banco recusa de todo jeito — este `if` existe para não
              oferecer um botão que sempre erra. */}
          {podeAjustarTriagem ? <PedirLeituraDaIa className="hidden md:inline-flex" /> : null}
          {podeAjustarTriagem ? (
            <PesosDaTriagem catalogos={catalogos} className="hidden md:inline-flex" />
          ) : null}
          {podeDecidir ? (
            <Button onClick={() => setFolhaAberta(true)} className="toque hidden md:inline-flex">
              <Plus aria-hidden="true" />
              Novo candidato
            </Button>
          ) : null}
        </div>
      </header>

      <BarraDaFila
            filtros={filtros}
            fontes={catalogos.origens}
            categorias={catalogos.categorias}
            marcados={resumo.data?.novos_marcados ?? null}
            aoMudar={mudar}
            aoLimpar={limpar}
          />

          <section
            aria-label="Fila de revisão"
            className={cn(
              'border-t border-hairline',
              podeDecidir && 'pb-20 md:pb-0',
              fila.isPlaceholderData && 'pointer-events-none opacity-60',
            )}
          >
            {fila.isPending ? (
              <EsqueletoDaFila />
            ) : fila.isError ? (
              <ErroDaFila causa={mensagemDoErro(fila.error)} aoTentar={() => void fila.refetch()} />
            ) : linhas.length === 0 && recorte ? (
              <VazioPorFiltroDaFila
                descricao={descreverRecorte(filtros, catalogos)}
                aoLimpar={limpar}
                soBusca={Boolean(filtros.q.trim()) && !filtros.fonteId && !filtros.categoriaId}
              />
            ) : linhas.length === 0 && filtros.situacao !== 'novo' ? (
              <VazioPorFiltroDaFila
                descricao={`Nenhum nome em "${ROTULO_SITUACAO[filtros.situacao].toLowerCase()}".`}
                aoLimpar={() => mudar({ situacao: 'novo' })}
              />
            ) : linhas.length === 0 ? (
              <FilaVazia aoCadastrar={podeDecidir ? () => setFolhaAberta(true) : null} />
            ) : (
              <>
                {podeDecidir && linhas.some(entraNoLote) ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={
                          marcados.length > 0 &&
                          marcados.length === linhas.filter(entraNoLote).length
                        }
                        onChange={(e) =>
                          setSelecionados((atual) => {
                            const novo = new Set(atual);
                            for (const c of linhas.filter(entraNoLote)) {
                              if (e.target.checked) novo.add(c.id);
                              else novo.delete(c.id);
                            }
                            return novo;
                          })
                        }
                        aria-label="Marcar todos desta página que podem entrar em lote"
                        className="size-4 accent-foreground"
                      />
                      Marcar os{' '}
                      <span className="numerico">{linhas.filter(entraNoLote).length}</span> desta
                      página
                    </label>
                    {/* Marcar por NOME DE CATEGORIA DA FONTE é o que resolve os
                        155 presos: eles estão parados pelo mesmo punhado de
                        rótulos do Google, e não por 155 razões diferentes. */}
                    {gruposDaPagina.map((g) => (
                      <button
                        key={g.nome}
                        type="button"
                        className="text-sm underline underline-offset-2 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setSelecionados((atual) => {
                            const novo = new Set(atual);
                            for (const c of g.ids) novo.add(c);
                            return novo;
                          })
                        }
                      >
                        os <span className="numerico">{g.ids.length}</span> de “{g.nome}”
                      </button>
                    ))}
                  </div>
                ) : null}

                {podeDecidir ? (
                  <p className="hidden py-2 text-xs text-muted-foreground md:block">
                    Com o cartão em foco (Tab): <Tecla>A</Tecla> aprova, <Tecla>M</Tecla> mescla com
                    a primeira sugestão, <Tecla>R</Tecla> recusa, <Tecla>N</Tecla> marca não
                    contatar.
                  </p>
                ) : null}

                <ul className="flex flex-col">
                  {linhas.map((candidato) => (
                    <li key={candidato.id}>
                      <CartaoCandidato
                        candidato={candidato}
                        ocupado={ocupado === candidato.id}
                        podeDecidir={podeDecidir}
                        marcado={entraNoLote(candidato) ? selecionados.has(candidato.id) : null}
                        aoMarcar={(ligado) => marcar(candidato.id, ligado)}
                        aoDecidir={(acao, organizacaoId) => decidir(candidato, acao, organizacaoId)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {podeDecidir ? (
            <BarraDeLote
              marcados={marcados}
              categorias={catalogos.categorias}
              categoriaId={categoriaDoLote}
              ocupado={lotando}
              aoTrocarCategoria={setCategoriaDoLote}
              aoAprovar={() => void aprovarLote()}
              aoLimpar={() => setSelecionados(new Set())}
            />
          ) : null}

          {linhas.length > 0 && paginas > 1 ? (
            <Paginacao
              pagina={filtros.pagina}
              paginas={paginas}
              total={total}
              aoIr={(pagina) => {
                setFiltros((atual) => ({ ...atual, pagina }));
                window.scrollTo({ top: 0, behavior: 'auto' });
              }}
            />
          ) : null}

      {podeDecidir ? (
        <>
          <Button
            onClick={() => setFolhaAberta(true)}
            aria-label="Cadastrar um nome"
            className="toque sombra-base-forte fixed right-4 bottom-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior)+1rem)] z-40 size-14 rounded-full ring-4 ring-background md:hidden"
          >
            <Plus className="size-5" aria-hidden="true" />
          </Button>

          <FolhaDeCandidato
            aberta={folhaAberta}
            aoFechar={() => setFolhaAberta(false)}
            catalogos={catalogos}
            aoCriar={recarregar}
          />

          <DialogoDeDecisao
            candidato={decisao?.candidato ?? null}
            acao={decisao?.acao ?? 'aprovar'}
            categorias={catalogos.categorias}
            ocupado={ocupado !== null}
            aoFechar={() => setDecisao(null)}
            aoConfirmar={({ categoriaId, motivo }) => {
              if (!decisao) return;
              void enviarDecisao(decisao.candidato, decisao.acao, { categoriaId, motivo });
            }}
          />
        </>
      ) : null}
    </div>
  );
}


function Tecla({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="pilula mx-0.5 inline-flex h-5 items-center px-1.5 font-mono text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

function Paginacao({
  pagina,
  paginas,
  total,
  aoIr,
}: {
  pagina: number;
  paginas: number;
  total: number;
  aoIr: (pagina: number) => void;
}) {
  const primeiro = (pagina - 1) * POR_PAGINA + 1;
  const ultimo = Math.min(pagina * POR_PAGINA, total);

  return (
    <nav
      aria-label="Paginação da fila"
      className="flex flex-col items-start gap-2 pb-2 md:flex-row md:items-center md:justify-between md:gap-3"
    >
      <p className="text-sm text-muted-foreground">
        <span className="numerico">
          {formatarNumero(primeiro)} a {formatarNumero(ultimo)}
        </span>{' '}
        de <span className="numerico">{formatarNumero(total)}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          disabled={pagina <= 1}
          onClick={() => aoIr(pagina - 1)}
          className="toque h-11 md:h-8"
        >
          <ChevronLeft aria-hidden="true" />
          Anterior
        </Button>
        <span className="numerico px-1 text-sm text-muted-foreground">
          {pagina}/{paginas}
        </span>
        <Button
          variant="outline"
          disabled={pagina >= paginas}
          onClick={() => aoIr(pagina + 1)}
          className="toque h-11 md:h-8"
        >
          Próxima
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

/** Diz em português o que a pessoa recortou, para o vazio não ser genérico. */
function descreverRecorte(filtros: FiltrosDaFila, catalogos: CatalogosDoRadar): string {
  const partes: string[] = [];
  if (filtros.q.trim()) partes.push(`busca "${filtros.q.trim()}"`);
  const fonte = catalogos.origens.find((f) => f.id === filtros.fonteId);
  if (fonte) partes.push(`fonte ${fonte.nome}`);
  const categoria = catalogos.categorias.find((c) => c.id === filtros.categoriaId);
  if (categoria) partes.push(`categoria ${categoria.nome}`);
  if (filtros.soMarcados) partes.push('só os marcados pela higiene');

  const situacao = ROTULO_SITUACAO[filtros.situacao].toLowerCase();
  const lista = partes.join(', ');
  return partes.length > 1
    ? `Nada em "${situacao}" bate com ${lista} ao mesmo tempo. Tire um recorte por vez.`
    : `Nada em "${situacao}" bate com ${lista}.`;
}
