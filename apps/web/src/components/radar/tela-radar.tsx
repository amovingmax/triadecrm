'use client';

import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatarNumero } from '@/components/parceiros/formatos';

import { BarraDaFila } from './barra-fila';
import { CartaoCandidato } from './cartao-candidato';
import { CatalogoDeFontes } from './catalogo-fontes';
import {
  buscarFila,
  buscarResumo,
  chaveDaFila,
  mensagemDoErro,
  MOTIVO_DA_REVISAO,
  revisarCandidato,
  type AcaoDeRevisao,
} from './dados';
import { DialogoDeDecisao } from './dialogo-decisao';
import { ErroDaFila, EsqueletoDaFila, FilaVazia, VazioPorFiltroDaFila } from './estados';
import { FolhaDeCandidato } from './folha-candidato';
import { PainelDoColetor } from './painel-coletor';
import {
  FILTROS_INICIAIS,
  POR_PAGINA,
  ROTULO_SITUACAO,
  temRecorteNaFila,
  type CandidatoDaFila,
  type CatalogosDoRadar,
  type FiltrosDaFila,
} from './tipos';

type Aba = 'fila' | 'fontes';

/** Lista vazia estável, para não trocar a identidade de `data` a cada renderização. */
const SEM_LINHAS: CandidatoDaFila[] = [];

/**
 * O Radar (PRD §7.3, RF-RAD-*).
 *
 * Três coisas, nesta ordem de importância: dizer se o coletor está de pé (para
 * "fila vazia" e "robô desligado" não desenharem a mesma tela), trabalhar a fila
 * de revisão e mostrar o catálogo das fontes com a avaliação legal de cada uma.
 *
 * A fila, a criação e a decisão moram no Postgres (`radar_fila`,
 * `radar_criar_candidato`, `radar_revisar_candidato`): aqui só ficam o recorte
 * atual, a espera e a tradução do que voltou.
 */
export function TelaRadar({
  catalogos,
  abaInicial = 'fila',
  podeDecidir,
  podeLigarFonte,
}: {
  catalogos: CatalogosDoRadar;
  /** Veio de `/radar?aba=fontes`: um link para a regra de uma fonte abre nela. */
  abaInicial?: Aba;
  /** Papéis que trabalham a fila. A autorização de verdade é o RLS. */
  podeDecidir: boolean;
  /** Só gestor e admin ligam ou desligam fonte (RF-RAD-01). */
  podeLigarFonte: boolean;
}) {
  const clienteDeConsultas = useQueryClient();
  const [aba, setAba] = useState<Aba>(abaInicial);

  // A aba acompanha a URL por replaceState: sem entrada nova no histórico (voltar
  // tem de sair do Radar, não desfazer troca de aba) e sem ida ao servidor. Assim o
  // endereço do catálogo de fontes pode ser mandado no grupo.
  useEffect(() => {
    const alvo = `${window.location.pathname}${aba === 'fontes' ? '?aba=fontes' : ''}`;
    if (alvo !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', alvo);
    }
  }, [aba]);
  const [filtros, setFiltros] = useState<FiltrosDaFila>(FILTROS_INICIAIS);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [decisao, setDecisao] = useState<{
    candidato: CandidatoDaFila;
    acao: Exclude<AcaoDeRevisao, 'mesclar'>;
  } | null>(null);

  const resumo = useQuery({ queryKey: ['radar', 'resumo'], queryFn: buscarResumo });

  const fila = useQuery({
    queryKey: chaveDaFila(filtros),
    queryFn: () => buscarFila(filtros),
    placeholderData: keepPreviousData,
    enabled: aba === 'fila',
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
          toast.success('Aprovado: virou parceiro.', {
            description: `${candidato.nome} entrou no funil com "Primeiro contato" marcado para o próximo dia útil.`,
          });
        } else if (resposta.situacao === 'mesclado') {
          toast.success('Mesclado com a ficha existente.', {
            description: 'Só os campos que estavam vazios foram completados.',
          });
        } else {
          toast.success('Candidato recusado.', { description: candidato.nome });
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
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const novos = resumo.data?.novos ?? null;

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Radar</h1>
          <p className="text-sm text-muted-foreground">
            {resumo.isPending ? (
              'Carregando...'
            ) : novos === null ? (
              'O seu acesso não trabalha a fila do Radar.'
            ) : novos === 0 ? (
              'Nenhum candidato esperando revisão.'
            ) : (
              <>
                <span className="numerico">{formatarNumero(novos)}</span>
                {novos === 1 ? ' candidato esperando revisão' : ' candidatos esperando revisão'}
              </>
            )}
          </p>
        </div>

        {podeDecidir ? (
          <Button onClick={() => setFolhaAberta(true)} className="toque hidden md:inline-flex">
            <Plus aria-hidden="true" />
            Novo candidato
          </Button>
        ) : null}
      </header>

      <PainelDoColetor />

      {/* Duas superfícies, não duas páginas: quem revisa precisa checar a regra de uma
          fonte sem perder o recorte da fila. */}
      <nav
        aria-label="Seções do Radar"
        className="flex items-center gap-1 border-b border-hairline"
      >
        <Aba rotulo="Fila de revisão" ativa={aba === 'fila'} aoEscolher={() => setAba('fila')} />
        <Aba
          rotulo="Fontes"
          contagem={resumo.data?.fontes_total ?? null}
          ativa={aba === 'fontes'}
          aoEscolher={() => setAba('fontes')}
        />
      </nav>

      {aba === 'fontes' ? (
        <CatalogoDeFontes podeLigar={podeLigarFonte} />
      ) : (
        <>
          <BarraDaFila
            filtros={filtros}
            fontes={catalogos.origens}
            categorias={catalogos.categorias}
            marcados={resumo.data?.novos_marcados ?? null}
            aoMudar={mudar}
            aoLimpar={limpar}
          />

          <section
            aria-label="Fila de revisão do Radar"
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
                descricao={`Nenhum candidato em "${ROTULO_SITUACAO[filtros.situacao].toLowerCase()}".`}
                aoLimpar={() => mudar({ situacao: 'novo' })}
              />
            ) : linhas.length === 0 ? (
              <FilaVazia aoCadastrar={podeDecidir ? () => setFolhaAberta(true) : null} />
            ) : (
              <>
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
                        aoDecidir={(acao, organizacaoId) => decidir(candidato, acao, organizacaoId)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

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
        </>
      )}

      {podeDecidir ? (
        <>
          {aba === 'fila' ? (
            <Button
              onClick={() => setFolhaAberta(true)}
              aria-label="Novo candidato"
              className="toque sombra-base-forte fixed right-4 bottom-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior)+1rem)] z-40 size-14 rounded-full ring-4 ring-background md:hidden"
            >
              <Plus className="size-5" aria-hidden="true" />
            </Button>
          ) : null}

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

function Aba({
  rotulo,
  contagem,
  ativa,
  aoEscolher,
}: {
  rotulo: string;
  contagem?: number | null;
  ativa: boolean;
  aoEscolher: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoEscolher}
      aria-current={ativa ? 'page' : undefined}
      className={cn(
        'toque -mb-px h-11 rounded-t-lg border-b-2 px-3 text-sm font-medium transition-colors',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        ativa
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {rotulo}
      {typeof contagem === 'number' ? <span className="numerico"> ({contagem})</span> : null}
    </button>
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
