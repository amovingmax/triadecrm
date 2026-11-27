'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Layers,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Settings2,
  UserRound,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FaixaDeNumeros, NumeroCompacto } from '@/components/ui/faixa-de-numeros';
import { FaixaDeslizante } from '@/components/ui/faixa-deslizante';
import { Skeleton } from '@/components/ui/skeleton';
import { useMidia } from '@/lib/use-midia';
import { cn } from '@/lib/utils';

import {
  casaComABusca,
  estadoDoCartao,
  itensDeAtencao,
  juntarDoCanalPro,
  naoPublicadoPronto,
} from './aba-dos-anuncios';
import { LinhaDoCanalPro } from './anuncios-no-canal-pro';
import { CartaoDoAnuncio, type ModoDaLista } from './cartao-do-anuncio';
import {
  carregarAnuncios,
  carregarCaminhoDoLead,
  carregarCanalPro,
  carregarFotosDaLista,
  carregarListaDoCanalPro,
  carregarManuais,
  CHAVE_DA_LISTA_DO_CANAL_PRO,
  CHAVE_DO_CAMINHO,
  CHAVE_DO_CANAL_PRO,
  CHAVE_DOS_ANUNCIOS,
  CHAVE_DOS_MANUAIS,
} from './dados';
import { FichaDoAnuncio } from './ficha-do-anuncio';
import { FolhaSincronizar } from './folha-sincronizar';
import { ImportarCanalPro } from './importar-canal-pro';
import { resumoDosTipos } from './leads/leads-rotulos';
import { NovoAnuncioConferido } from './novo-anuncio-conferido';
import { PainelCanalPro } from './painel-canal-pro';
import { diasDeCalendario, haQuanto } from './passos-do-caminho';
import { Pendencias } from './pendencias';
import {
  crmPublica,
  estadoNoPortal,
  precisaDoPino,
  situacaoForaDoCrm,
  type EstadoNoPortal,
} from './regras-do-cartao';
import { ativoNoCanalPro } from './relatorio-canal-pro';
import { SecoesDosAnuncios } from './secoes';

/** As abas com as palavras do Canal Pro (05/11/2026). */
type Recorte = 'todos' | 'publicados' | 'nao_publicados' | 'rascunhos' | 'excluidos';
const ESTADO_DO_RECORTE: Partial<Record<Recorte, EstadoNoPortal>> = {
  publicados: 'publicado',
  nao_publicados: 'nao_publicado',
  rascunhos: 'rascunho',
};
/** Os filtros que vêm de um botão (da troca ou do "Precisa de você"). */
type Filtro = 'arbo' | 'prontos';
const ROTULO_DO_FILTRO: Record<Filtro, string> = {
  arbo: 'Só os publicados pela Arbo',
  prontos: 'Só os não publicados prontos para ir ao ar',
};

/** Mais que isso sem a lista do Canal Pro, o número fica em alerta. */
const DIAS_DA_LISTA = 7;

/** Grade ou lista: a escolha fica neste navegador (24/11/2026). */
const GUARDADO_DO_MODO = 'anuncios:modo';
const semInscricao = () => () => {};
const lerModo = (): ModoDaLista | null => {
  try {
    const v = localStorage.getItem(GUARDADO_DO_MODO);
    return v === 'grade' || v === 'lista' ? v : null;
  } catch {
    return null;
  }
};

/**
 * A aba Anúncios (04/11/2026; redesenhada em 18/11/2026 e de novo em 24/11/2026,
 * pelo protótipo responsivo aprovado), só na Imova. De cima para baixo:
 *
 *   1. Três números numa faixa compacta: as vagas do plano, os leads dos portais
 *      (leva aos Leads) e a última lista do Canal Pro (com o "Sincronizar").
 *   2. O painel Pendências: a troca da Arbo pelo CRM (`troca-da-arbo.tsx`) e o
 *      "Precisa de você", num cartão que abre e fecha (`pendencias.tsx`).
 *   3. A busca, o Grade/Lista e os filtros com as palavras do Canal Pro, presos
 *      no topo ao rolar; e a lista: UM CARTÃO POR IMÓVEL, com o que o Canal Pro
 *      diz dele e as cópias antigas juntadas (`aba-dos-anuncios.ts`). O clique
 *      abre a ficha por cima.
 *
 * No celular a lista abre em linhas com foto pequena (cabem uns 5 anúncios por
 * tela) e "Novo anúncio" vira o botão + flutuante; do tablet para cima, grade
 * com a largura toda da página.
 */
export function TelaAnuncios({ podePublicar }: { podePublicar: boolean }) {
  const [recorte, setRecorte] = useState<Recorte>('todos');
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [busca, setBusca] = useState('');
  const [fichaDe, setFichaDe] = useState<string | null>(null);
  // A foto em que o carrossel da ficha abre (a que estava à vista no cartão).
  const [fotoDaFicha, setFotoDaFicha] = useState(0);
  const [painelAberto, setPainelAberto] = useState(false);
  const [planilhaAberta, setPlanilhaAberta] = useState(false);
  const [sincronizarAberto, setSincronizarAberto] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const excluidos = recorte === 'excluidos';

  // Grade ou lista: a escolha de quem usa (guardada) vale sobre o padrão do
  // tamanho, que é lista abaixo de 640px e grade do tablet para cima.
  const guardado = useSyncExternalStore(semInscricao, lerModo, () => null);
  const [escolhido, setEscolhido] = useState<ModoDaLista | null>(null);
  const largo = useMidia('(min-width: 640px)');
  const modo: ModoDaLista = escolhido ?? guardado ?? (largo ? 'grade' : 'lista');
  function escolherModo(m: ModoDaLista) {
    setEscolhido(m);
    try {
      localStorage.setItem(GUARDADO_DO_MODO, m);
    } catch {
      // Sem armazenamento (janela privada): só não lembra.
    }
  }

  const consulta = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'lista', excluidos],
    queryFn: () => carregarAnuncios(excluidos),
  });
  // Os do CRM, sempre: os números, as pendências e a troca contam com eles.
  const doCrm = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'lista', false],
    queryFn: () => carregarAnuncios(false),
    enabled: excluidos,
  });
  // Os excluídos, sempre: o código deles não volta pela sincronização, então a
  // linha do Canal Pro com esse código não é "sem cartão" (revisão de 18/11/2026).
  const excluidosSempre = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'lista', true],
    queryFn: () => carregarAnuncios(true),
    enabled: !excluidos,
  });
  const listaDoCanalPro = useQuery({
    queryKey: CHAVE_DA_LISTA_DO_CANAL_PRO,
    queryFn: carregarListaDoCanalPro,
  });
  const manuais = useQuery({ queryKey: CHAVE_DOS_MANUAIS, queryFn: carregarManuais });
  const canalPro = useQuery({ queryKey: CHAVE_DO_CANAL_PRO, queryFn: carregarCanalPro });

  const todos = useMemo(() => consulta.data ?? [], [consulta.data]);
  // As fotos de cada anúncio, para o carrossel do cartão (27/11/2026): uma
  // leitura para a lista inteira, só dos que têm mais de uma foto (a capa já
  // vem na lista).
  const comVariasFotos = useMemo(
    () =>
      todos
        .filter((a) => a.fotos > 1)
        .map((a) => ({ id: a.id, fotos: a.fotos }))
        .sort((x, y) => x.id.localeCompare(y.id)),
    [todos],
  );
  const fotosDaLista = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'fotos-da-lista', comVariasFotos],
    queryFn: () => carregarFotosDaLista(comVariasFotos),
    enabled: modo === 'grade' && comVariasFotos.length > 0,
  });
  function caminhosDasFotos(id: string): string[] | null | undefined {
    if (fotosDaLista.data) return fotosDaLista.data[id] ?? null;
    return fotosDaLista.isError ? null : undefined;
  }
  const ativos = useMemo(
    () => (excluidos ? (doCrm.data ?? []) : todos),
    [excluidos, doCrm.data, todos],
  );
  const listaDeExcluidos = useMemo(
    () => (excluidos ? todos : (excluidosSempre.data ?? [])),
    [excluidos, todos, excluidosSempre.data],
  );
  const { porAnuncio, soltas } = useMemo(
    () => juntarDoCanalPro([...ativos, ...listaDeExcluidos], listaDoCanalPro.data ?? []),
    [ativos, listaDeExcluidos, listaDoCanalPro.data],
  );
  const plano = canalPro.data?.plano ?? null;
  const vagasLivres =
    plano?.anuncios != null ? Math.max(0, plano.anuncios - plano.anunciosEmUso) : null;
  const itens = useMemo(
    () =>
      podePublicar ? itensDeAtencao({ anuncios: ativos, porAnuncio, soltas, vagasLivres }) : [],
    [podePublicar, ativos, porAnuncio, soltas, vagasLivres],
  );
  // No portal por fora do CRM e não no ar no CRM: a troca os tiraria do ar.
  const aAssumir = useMemo(
    () =>
      ativos.filter(
        (a) => a.situacao !== 'no_ar' && !a.excluido_em && situacaoForaDoCrm(a) === 'ativo',
      ),
    [ativos],
  );
  // No portal pelo sistema atual e sem o pino do mapa no CRM (19/11/2026): o
  // "Atualizar do sistema atual" o traz, antes de colar a URL e, depois da troca,
  // só para quem está no ar.
  const semPino = useMemo(() => ativos.filter(precisaDoPino), [ativos]);
  const temEnderecoDoSistemaAtual = canalPro.data?.sistemaAtual.temEndereco ?? false;
  const porEstado = useMemo(() => {
    const c: Record<EstadoNoPortal, number> = { publicado: 0, nao_publicado: 0, rascunho: 0 };
    for (const a of ativos) c[estadoNoPortal(a)] += 1;
    return c;
  }, [ativos]);

  const estadoDaAba = ESTADO_DO_RECORTE[recorte];
  const linhas = todos.filter(
    (a) =>
      (excluidos || recorte === 'todos' || estadoNoPortal(a) === estadoDaAba) &&
      (filtro !== 'arbo' || estadoDoCartao(a).tom === 'arbo') &&
      (filtro !== 'prontos' || naoPublicadoPronto(a)) &&
      casaComABusca(a, porAnuncio.get(a.id)?.copias ?? [], busca),
  );
  const soltasNaLista = (manuais.data ?? []).filter(
    (m) =>
      soltas.some((s) => s.id === m.id) &&
      !excluidos &&
      filtro === null &&
      (recorte === 'todos' ||
        (recorte === 'publicados' && ativoNoCanalPro(m.situacao)) ||
        (recorte === 'nao_publicados' && !ativoNoCanalPro(m.situacao))) &&
      casaComABusca(
        { codigo: m.codigo, titulo: m.titulo ?? '', bairro: m.bairro, cidade: m.cidade },
        [],
        busca,
      ),
  );
  const ficha = fichaDe
    ? ([...ativos, ...todos, ...listaDeExcluidos].find((a) => a.id === fichaDe) ?? null)
    : null;

  function irParaALista() {
    requestAnimationFrame(() =>
      document
        .getElementById('lista-de-anuncios')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

  const recortes: { id: Recorte; rotulo: string; contagem?: number }[] = [
    { id: 'todos', rotulo: 'Todos' },
    { id: 'publicados', rotulo: 'Publicados', contagem: porEstado.publicado },
    { id: 'nao_publicados', rotulo: 'Não publicados', contagem: porEstado.nao_publicado },
    { id: 'rascunhos', rotulo: 'Rascunhos', contagem: porEstado.rascunho },
    { id: 'excluidos', rotulo: 'Excluídos' },
  ];

  return (
    // O fim da página ganha espaço no celular para o botão + não cobrir o último cartão.
    <div className="flex w-full flex-col gap-4 pb-[4.5rem] md:gap-5 md:pb-0">
      <header className="flex flex-col gap-4">
        <SecoesDosAnuncios ativa="anuncios" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
              Anúncios
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Os imóveis da Imova no ZAP, Viva Real e OLX, com o que vem da Arbo e do Canal Pro.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {podePublicar ? (
              <Button
                variant="outline"
                className="toque h-11 md:h-10"
                onClick={() => setSincronizarAberto(true)}
              >
                <RefreshCw aria-hidden="true" />
                Sincronizar Canal Pro
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="toque size-11 p-0 md:size-10"
              aria-label="Ajustes do Canal Pro"
              title="Ajustes do Canal Pro"
              onClick={() => setPainelAberto(true)}
            >
              <Settings2 aria-hidden="true" />
            </Button>
            {/* No celular ele é o botão + flutuante, no fim desta tela. */}
            <Button
              className="toque hidden h-10 md:inline-flex"
              onClick={() => setNovoAberto(true)}
            >
              <Plus aria-hidden="true" />
              Novo anúncio
            </Button>
          </div>
        </div>
      </header>

      <Numeros
        carregando={canalPro.isPending}
        plano={plano}
        importadoEm={canalPro.data?.importadoEm ?? null}
        leadsDosAnuncios={ativos.reduce((s, a) => s + a.leads, 0)}
        podePublicar={podePublicar}
        aoSincronizar={() => setSincronizarAberto(true)}
      />

      {podePublicar ? (
        <Pendencias
          itens={itens}
          itensProntos={!consulta.isPending && !listaDoCanalPro.isPending}
          chave={canalPro.data?.chave ?? null}
          noPortalSoPeloSistemaAtual={aAssumir.length}
          pino={{ faltam: semPino.length, temEndereco: temEnderecoDoSistemaAtual }}
          aoVerNaLista={() => {
            setRecorte('todos');
            setFiltro('arbo');
            setBusca('');
            irParaALista();
          }}
          aoSincronizar={() => setSincronizarAberto(true)}
          aoAbrir={setFichaDe}
          aoFiltrarProntos={() => {
            setRecorte('todos');
            setFiltro('prontos');
            setBusca('');
            irParaALista();
          }}
        />
      ) : null}

      <section
        id="lista-de-anuncios"
        aria-label="Lista de anúncios"
        className="flex scroll-mt-14 flex-col gap-3 md:scroll-mt-[72px]"
      >
        {/* Presa abaixo do cabeçalho (56px no celular, 72px no computador): a busca
            e os filtros continuam à mão depois de rolar a lista. */}
        <div className="sticky top-14 z-20 -mx-4 flex flex-col gap-2.5 bg-background/90 px-4 py-2.5 backdrop-blur-md md:top-[72px] md:-mx-5 md:px-5">
          <div className="flex items-center gap-2">
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-card pr-3 pl-3.5 focus-within:ring-3 focus-within:ring-ring/40 md:h-10">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Código, título ou bairro"
                aria-label="Buscar anúncio"
                className="h-full min-w-0 flex-1 bg-transparent text-sm text-ellipsis outline-none"
              />
            </label>
            <div
              role="group"
              aria-label="Mostrar como"
              className="sombra-base flex h-11 shrink-0 items-center gap-0.5 rounded-full bg-card p-1 md:h-10"
            >
              {(
                [
                  ['grade', 'Grade', LayoutGrid],
                  ['lista', 'Lista', List],
                ] as const
              ).map(([id, rotulo, Icone]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={modo === id}
                  aria-label={rotulo}
                  title={rotulo}
                  onClick={() => escolherModo(id)}
                  className={cn(
                    'toque grid h-9 w-10 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8',
                    modo === id
                      ? 'bg-menta text-menta-tinta'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icone className="size-4" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <FaixaDeslizante rotulo="Que anúncios mostrar" ativo={recorte} sangria>
            {recortes.map((r) => (
              <Chip
                key={r.id}
                ativo={recorte === r.id}
                contagem={r.contagem}
                onClick={() => {
                  setRecorte(r.id);
                  setFiltro(null);
                }}
              >
                {r.rotulo}
              </Chip>
            ))}
          </FaixaDeslizante>
          {filtro ? (
            <p className="flex items-center gap-2 text-sm">
              <span className="inline-flex h-10 max-w-full items-center gap-1 rounded-full bg-primary/12 pr-1 pl-3.5 font-medium text-primary md:h-9">
                <span className="truncate">{ROTULO_DO_FILTRO[filtro]}</span>
                <button
                  type="button"
                  onClick={() => setFiltro(null)}
                  aria-label="Tirar o filtro"
                  className="toque grid size-8 shrink-0 place-items-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-3 focus-visible:ring-ring/50 md:size-7"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </span>
            </p>
          ) : null}
        </div>

        {consulta.isPending ? (
          <div aria-busy="true" className={modo === 'grade' ? GRADE : LISTA}>
            <span className="sr-only">Carregando os anúncios.</span>
            {Array.from({ length: modo === 'grade' ? 4 : 3 }, (_, i) => (
              <Skeleton
                key={i}
                className={cn('w-full rounded-xl', modo === 'grade' ? 'h-[400px]' : 'h-[108px]')}
              />
            ))}
          </div>
        ) : consulta.isError ? (
          <Vazio titulo="A lista não carregou." texto="Não deu para falar com o servidor.">
            <Button
              variant="outline"
              onClick={() => void consulta.refetch()}
              className="toque h-11 md:h-9"
            >
              <RotateCw aria-hidden="true" />
              Tentar de novo
            </Button>
          </Vazio>
        ) : linhas.length === 0 && soltasNaLista.length === 0 ? (
          excluidos ? (
            <Vazio
              titulo="Nenhum anúncio excluído."
              texto="O anúncio excluído sai do arquivo do Canal Pro e fica aqui para restaurar."
            />
          ) : busca.trim() || filtro ? (
            <Vazio
              titulo={
                busca.trim() ? `Nada encontrado para “${busca.trim()}”.` : 'Nada neste filtro.'
              }
              texto="Troque a busca ou tire o filtro."
            />
          ) : (
            <Vazio
              titulo={recorte === 'todos' ? 'Nenhum anúncio ainda.' : 'Nenhum anúncio nesta aba.'}
              texto="Crie um anúncio pelo CRM ou sincronize com o Canal Pro."
            >
              <Button className="toque h-11 w-fit md:h-9" onClick={() => setNovoAberto(true)}>
                <Plus aria-hidden="true" />
                Novo anúncio
              </Button>
            </Vazio>
          )
        ) : (
          <>
            {linhas.length ? (
              <ul className={modo === 'grade' ? GRADE : LISTA}>
                {linhas.map((a) => (
                  <CartaoDoAnuncio
                    key={a.id}
                    anuncio={a}
                    doCanalPro={porAnuncio.get(a.id)}
                    caminhosDasFotos={caminhosDasFotos(a.id)}
                    podePublicar={podePublicar}
                    plano={plano}
                    modo={modo}
                    aoAbrir={() => setFichaDe(a.id)}
                    aoAbrirNaFoto={(foto) => {
                      setFotoDaFicha(foto);
                      setFichaDe(a.id);
                    }}
                    aoSincronizar={() => setSincronizarAberto(true)}
                  />
                ))}
              </ul>
            ) : null}
            {soltasNaLista.length ? (
              <section className="flex flex-col gap-2">
                <h2 className="flex items-center gap-1.5 text-base font-medium">
                  <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
                  No Canal Pro, sem cartão no CRM
                </h2>
                <p className="text-sm text-muted-foreground">
                  Não são cópia de nenhum anúncio do CRM. A sincronização os traz com as fotos; aqui
                  dá para trazer um por um.
                </p>
                <ul className="sombra-base flex flex-col divide-y divide-hairline overflow-hidden rounded-xl bg-card">
                  {soltasNaLista.map((m) => (
                    <LinhaDoCanalPro
                      key={m.id}
                      anuncio={m}
                      trazido={ativos.find((a) => a.id === m.anuncio_id) ?? null}
                      pareceCom={null}
                      podePublicar={podePublicar}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </section>

      {/* "Novo anúncio" no celular: acima da barra de baixo e da área segura do iPhone. */}
      <Button
        className="toque sombra-base-forte fixed right-4 bottom-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior)+1rem)] z-30 size-14 rounded-xl p-0 md:hidden"
        aria-label="Novo anúncio"
        title="Novo anúncio"
        onClick={() => setNovoAberto(true)}
      >
        <Plus className="size-6" aria-hidden="true" />
      </Button>

      <FichaDoAnuncio
        anuncio={ficha}
        doCanalPro={ficha ? porAnuncio.get(ficha.id) : undefined}
        fotoInicial={fotoDaFicha}
        podePublicar={podePublicar}
        aoMudar={(aberto) => {
          if (!aberto) {
            setFichaDe(null);
            setFotoDaFicha(0);
          }
        }}
        aoSincronizar={() => {
          setFichaDe(null);
          setFotoDaFicha(0);
          setSincronizarAberto(true);
        }}
      />
      <PainelCanalPro
        aberto={painelAberto}
        aoMudar={setPainelAberto}
        podeAjustar={podePublicar}
        aAssumir={aAssumir}
        semPino={semPino}
        soNoCanalProNoAr={soltas.filter((s) => ativoNoCanalPro(s.situacao)).length}
      />
      <NovoAnuncioConferido
        aberto={novoAberto}
        aoMudar={setNovoAberto}
        anuncios={[...ativos, ...listaDeExcluidos]}
        aoAbrir={setFichaDe}
      />
      {podePublicar ? (
        <>
          <FolhaSincronizar
            aberto={sincronizarAberto}
            aoMudar={setSincronizarAberto}
            sincronizadoEm={canalPro.data?.importadoEm ?? null}
            temEnderecoDoSistemaAtual={temEnderecoDoSistemaAtual}
            crmPublica={crmPublica(canalPro.data?.ultimaLeitura?.em, new Date())}
            noArSemPino={semPino.filter((a) => a.situacao === 'no_ar').length}
            aoAbrirPlanilha={() => setPlanilhaAberta(true)}
          />
          <ImportarCanalPro aberto={planilhaAberta} aoMudar={setPlanilhaAberta} />
        </>
      ) : null}
    </div>
  );
}

/**
 * A grade usa a largura toda da página: cabe quantos cartões couberem. O mínimo é
 * 270px, e não os 250px do protótipo: a margem do CRM é menor (20px contra 32px) e,
 * com 250px, o monitor de 1440px ganhava uma 5ª coluna estreita, com o rodapé do
 * cartão quebrando em duas linhas. Com 270px ficam as 4 colunas do protótipo; nas
 * outras larguras dá o mesmo número de colunas.
 */
const GRADE = 'grid grid-cols-[repeat(auto-fill,minmax(min(270px,100%),1fr))] gap-3.5';
/** Na lista, duas colunas do computador para cima, para a linha não ficar comprida. */
const LISTA = 'grid gap-2.5 lg:grid-cols-2';

/**
 * Os três números do alto, numa faixa compacta (24/11/2026): desliza de lado no
 * celular e divide a largura do tablet para cima. Cada um aparece uma vez só na
 * tela e continua levando ao mesmo lugar: os leads abrem a seção Leads, a lista
 * do Canal Pro abre o "Sincronizar".
 */
function Numeros({
  carregando,
  plano,
  importadoEm,
  leadsDosAnuncios,
  podePublicar,
  aoSincronizar,
}: {
  carregando: boolean;
  plano: {
    anuncios: number | null;
    destaques: number | null;
    anunciosEmUso: number;
    destaquesEmUso: number;
  } | null;
  importadoEm: string | null;
  leadsDosAnuncios: number;
  podePublicar: boolean;
  aoSincronizar: () => void;
}) {
  const caminho = useQuery({
    queryKey: CHAVE_DO_CAMINHO,
    queryFn: carregarCaminhoDoLead,
    enabled: podePublicar,
  });
  if (carregando) {
    return (
      <FaixaDeNumeros rotulo="Situação">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-xl" />
        ))}
      </FaixaDeNumeros>
    );
  }
  const agora = new Date();
  const dias = importadoEm ? diasDeCalendario(importadoEm, agora) : null;
  const velha = dias === null || dias > DIAS_DA_LISTA;
  const leads = caminho.data?.leads;
  const total = leads?.total ?? leadsDosAnuncios;
  const ultimo = leads?.ultimo ?? null;
  const cheio = plano?.anuncios != null && plano.anunciosEmUso >= plano.anuncios;
  // A frase inteira do último lead (anúncio e tipo) fica na dica do número.
  const sobreOUltimo = ultimo
    ? `Último ${haQuanto(ultimo.em, agora)}${ultimo.anuncio ? ` · ${ultimo.anuncio}` : ''} · ${resumoDosTipos(ultimo.tipos).toLowerCase()}`
    : 'Nenhum lead dos portais ainda.';
  const sobreALista = 'Situação, visualizações, contatos e fotos de tudo o que está lá.';

  return (
    <FaixaDeNumeros rotulo="Situação">
      <NumeroCompacto
        rotulo="Vagas do plano"
        icone={<Layers aria-hidden="true" />}
        tom={cheio ? 'text-destructive-texto' : undefined}
        valor={
          plano?.anuncios != null ? (
            <>
              {plano.anunciosEmUso}{' '}
              <small className="font-sans text-[13px] font-medium text-muted-foreground">
                de {plano.anuncios}
              </small>
            </>
          ) : (
            '–'
          )
        }
        detalhe={
          plano?.anuncios == null
            ? 'O plano não está no CRM (Ajustes).'
            : plano.destaques != null
              ? `${plano.destaquesEmUso} de ${plano.destaques} destaques`
              : null
        }
      >
        {plano?.anuncios != null ? (
          <span className="my-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{
                width: `${Math.min(100, (plano.anunciosEmUso / Math.max(1, plano.anuncios)) * 100)}%`,
              }}
            />
          </span>
        ) : null}
      </NumeroCompacto>

      <Link
        href="/anuncios/leads"
        title={sobreOUltimo}
        className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <NumeroCompacto
          rotulo="Leads dos portais"
          icone={<UserRound aria-hidden="true" />}
          valor={total}
          className="h-full group-hover:ring-1 group-hover:ring-border"
          detalhe={
            <>
              {ultimo ? `último ${haQuanto(ultimo.em, agora)} · ` : 'nenhum ainda · '}
              <span className="font-medium text-primary">
                Ver os leads <ArrowRight className="inline size-3" aria-hidden="true" />
              </span>
            </>
          }
        />
        <span className="sr-only">. {sobreOUltimo}</span>
      </Link>

      <NumeroCompacto
        rotulo="Última lista do Canal Pro"
        icone={<RefreshCw aria-hidden="true" />}
        tom={velha ? 'text-morno-texto' : undefined}
        valor={
          dias === null ? 'nunca' : dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`
        }
        className={cn('relative', podePublicar && 'hover:ring-1 hover:ring-border')}
        detalhe={
          podePublicar ? (
            // O botão estica um `::after` sobre o número inteiro: o toque em qualquer
            // ponto sincroniza, e a caixa de 40px conta como alvo do dedo.
            <button
              type="button"
              onClick={aoSincronizar}
              title={sobreALista}
              className="-my-3 inline-flex h-10 items-center gap-1 font-medium text-primary outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
            >
              {velha ? 'Sincronizar agora' : 'Sincronizar'}
              <ArrowRight className="size-3" aria-hidden="true" />
            </button>
          ) : (
            sobreALista
          )
        }
      />
    </FaixaDeNumeros>
  );
}

function Vazio({
  titulo,
  texto,
  children,
}: {
  titulo: string;
  texto: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sombra-base flex flex-col items-start gap-3 rounded-xl bg-card p-5">
      <div>
        <p className="font-medium">{titulo}</p>
        <p className="text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}
