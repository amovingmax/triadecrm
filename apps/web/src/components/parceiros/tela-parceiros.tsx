'use client';

import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { BarraFiltros } from './barra-filtros';
import { buscaPorTrechoDeTelefone, buscarParceiros, chaveDaBusca } from './busca';
import { ErroDaLista, EsqueletoLista, VazioDeVerdade, VazioPorFiltro } from './estados-lista';
import { FolhaCadastroRapido } from './folha-cadastro-rapido';
import { formatarNumero } from './formatos';
import { ListaCartoes } from './lista-cartoes';
import { TabelaParceiros } from './tabela-parceiros';
import { useEhCelular } from './usar-eh-celular';
import {
  contarFiltros,
  FILTROS_VAZIOS,
  POR_PAGINA,
  temRecorte,
  urlDosFiltros,
  type Catalogos,
  type FiltrosParceiros,
  type LinhaParceiro,
} from './tipos';

/**
 * A tela de Parceiros: busca, filtros, lista e cadastro rápido.
 *
 * A paginação, a ordenação e os filtros acontecem no Postgres (RPC
 * `search_organizations`, 50 por página com a contagem total na mesma consulta).
 * O cliente guarda apenas o recorte atual e o mantém na URL, para que voltar da
 * ficha traga a mesma lista e um link de busca possa ser mandado no grupo.
 */
/** Lista vazia estável, para não trocar a identidade de `data` a cada renderização. */
const SEM_LINHAS: LinhaParceiro[] = [];

export function TelaParceiros({
  catalogos,
  filtrosIniciais,
  podeCriar,
  leTelefoneCompleto,
  abrirCadastro = false,
}: {
  catalogos: Catalogos;
  filtrosIniciais: FiltrosParceiros;
  /** `leitura`, `financeiro` e o robô não criam parceiro (a regra de verdade é o RLS). */
  podeCriar: boolean;
  /** Espelho de `app.reads_base_pii()`: só explica por que a busca por trecho não acha nada. */
  leTelefoneCompleto: boolean;
  /** Veio de `/parceiros?novo=1` (paleta de comandos): abre a folha já na entrada. */
  abrirCadastro?: boolean;
}) {
  // Cartão ou tabela é decidido em JS, não por classe: esconder um dos dois com CSS
  // montava as 50 linhas da tabela junto dos 50 cartões no celular, dobrando o HTML
  // que trafega no 4G da rua e o trabalho do React a cada tecla da busca.
  const ehCelular = useEhCelular();
  const [filtros, setFiltros] = useState<FiltrosParceiros>(filtrosIniciais);
  const [folhaAberta, setFolhaAberta] = useState(abrirCadastro);
  const clienteDeConsultas = useQueryClient();

  // A URL acompanha o recorte por replaceState: sem entrada nova no histórico
  // (voltar tem de sair da lista, não desfazer filtro por filtro) e sem uma volta
  // ao servidor a cada tecla digitada.
  useEffect(() => {
    const alvo = `${window.location.pathname}${urlDosFiltros(filtros)}`;
    if (alvo !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', alvo);
    }
  }, [filtros]);

  const consulta = useQuery({
    queryKey: chaveDaBusca(filtros),
    queryFn: () => buscarParceiros(filtros),
    // Ao trocar de página a lista anterior fica no lugar até a nova chegar, em vez
    // de a tela piscar em branco.
    placeholderData: keepPreviousData,
  });

  const mudar = useCallback((parcial: Partial<FiltrosParceiros>) => {
    setFiltros((atual) => ({ ...atual, pagina: 1, ...parcial }));
  }, []);

  const limpar = useCallback(() => setFiltros(FILTROS_VAZIOS), []);

  const recorte = temRecorte(filtros);
  // Busca de texto sem nenhum seletor ligado: o vazio não pode mandar limpar filtro
  // que a pessoa nunca ligou.
  const soBusca = recorte && contarFiltros(filtros) === 0;
  const total = consulta.data?.total ?? 0;
  // Constante de módulo, não `?? []`: um array novo a cada renderização invalidaria
  // os modelos da tabela, que dependem da identidade de `data`.
  const linhas = consulta.data?.linhas ?? SEM_LINHAS;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Parceiros</h1>
          <p className="text-sm text-muted-foreground">
            {consulta.isPending ? (
              'Carregando a base...'
            ) : (
              <>
                <span className="numerico">{formatarNumero(total)}</span>
                {total === 1 ? ' parceiro' : ' parceiros'}
                {!recorte ? ' na base' : soBusca ? ' com essa busca' : ' com esse filtro'}
              </>
            )}
          </p>
        </div>

        {/* No celular o botão é flutuante (o polegar não sobe até o cabeçalho). */}
        {podeCriar ? (
          <Button onClick={() => setFolhaAberta(true)} className="toque hidden md:inline-flex">
            <Plus aria-hidden="true" />
            Novo parceiro
          </Button>
        ) : null}
      </header>

      <BarraFiltros filtros={filtros} catalogos={catalogos} aoMudar={mudar} aoLimpar={limpar} />

      <section
        aria-label="Lista de parceiros"
        className={cn(
          'border-t border-hairline',
          // Enquanto a próxima página chega, a lista antiga fica apagada e sem toque:
          // o dado que está na tela ainda é o anterior, e a interface não finge que não.
          consulta.isPlaceholderData && 'pointer-events-none opacity-60',
        )}
      >
        {consulta.isPending ? (
          <EsqueletoLista />
        ) : consulta.isError ? (
          <ErroDaLista
            causa={mensagemDoErro(consulta.error)}
            aoTentar={() => void consulta.refetch()}
          />
        ) : linhas.length === 0 && recorte ? (
          <VazioPorFiltro
            aoLimpar={limpar}
            soBusca={soBusca}
            descricao={descreverRecorte(filtros, catalogos, leTelefoneCompleto)}
          />
        ) : linhas.length === 0 ? (
          <VazioDeVerdade aoCadastrar={podeCriar ? () => setFolhaAberta(true) : null} />
        ) : ehCelular ? (
          <ListaCartoes linhas={linhas} />
        ) : (
          <TabelaParceiros linhas={linhas} />
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

      {podeCriar ? (
        <>
          {/* Botão flutuante do celular: 56px, acima da barra inferior e da área segura.
              Leva o gradiente de ação (variante `default` do Button, que é o
              `acao-gradiente`: branco no escuro, tinta no claro) e a sombra tingida
              pela base, nunca a sombra preta do `shadow-lg`. Raio de 8px, o dos
              interativos: o flutuante é para tocar, não é contêiner.
              A altura da barra inferior mais a área segura mantêm ele fora da
              coluna da paginação, que no celular empilha à esquerda. */}
          <Button
            onClick={() => setFolhaAberta(true)}
            aria-label="Novo parceiro"
            className="toque sombra-base-forte fixed right-4 bottom-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior)+1rem)] z-40 size-14 rounded-lg md:hidden"
          >
            <Plus className="size-5" aria-hidden="true" />
          </Button>

          <FolhaCadastroRapido
            aberta={folhaAberta}
            aoFechar={() => setFolhaAberta(false)}
            catalogos={catalogos}
            aoCriar={() => void clienteDeConsultas.invalidateQueries({ queryKey: ['parceiros'] })}
          />
        </>
      ) : null}
    </div>
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
    // No celular os controles descem para uma segunda linha, alinhados à esquerda:
    // na linha única o botão "Próxima" ficava debaixo do botão flutuante de novo
    // parceiro (que é fixo à direita) e o toque abria a folha de cadastro. O `md:`
    // casa com o `md:hidden` do próprio flutuante, então o desktop não muda.
    <nav
      aria-label="Paginação"
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

/** Diz em português o que a pessoa filtrou, para o estado vazio não ser genérico. */
function descreverRecorte(
  filtros: FiltrosParceiros,
  catalogos: Catalogos,
  leTelefoneCompleto: boolean,
): string {
  const partes: string[] = [];
  if (filtros.q.trim()) partes.push(`busca "${filtros.q.trim()}"`);
  const categoria = catalogos.categorias.find((c) => c.id === filtros.categoriaId);
  if (categoria) partes.push(`categoria ${categoria.nome}`);
  const cidade = catalogos.cidades.find((c) => c.id === filtros.cidadeId);
  if (cidade) partes.push(`cidade ${cidade.nome}`);
  const etapa = catalogos.etapas.find((e) => e.id === filtros.etapaId);
  if (etapa) partes.push(`etapa ${etapa.nome}`);
  const pessoa = catalogos.pessoas.find((p) => p.id === filtros.responsavelId);
  if (pessoa) partes.push(`responsável ${pessoa.nome}`);

  const quantos = contarFiltros(filtros);
  const lista = partes.join(', ');
  let frase =
    quantos + (filtros.q.trim() ? 1 : 0) > 1
      ? `Nada bate com ${lista} ao mesmo tempo. Tire um filtro por vez.`
      : `Nada bate com ${lista}.`;

  // Sem o aviso, quem não lê o telefone de base digita os quatro últimos dígitos que
  // leu num cartão, recebe zero resultado e cadastra o parceiro de novo.
  if (!leTelefoneCompleto && buscaPorTrechoDeTelefone(filtros.q)) {
    frase +=
      ' Com o seu acesso, telefone só é encontrado pelo número completo: digite o DDD e todos os dígitos.';
  }

  return frase;
}

function mensagemDoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : '';
  if (/jwt|autenticad/i.test(texto)) return 'A sua sessão expirou.';
  if (/fetch|network|failed/i.test(texto)) return 'O aplicativo não alcançou o servidor.';
  return texto ? `O servidor respondeu: ${texto}.` : 'O servidor não respondeu.';
}
