'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { OpcaoCategoria } from '@/components/parceiros/tipos';

import { adicionarContatosAoDisparo, buscarPublico, ErroDoEnvio } from './dados';
import {
  formatarNumero,
  fraseDaRecusa,
  fraseDeUmCadastro,
  fraseDoMotivo,
  lerListaColada,
  resumoDaListaColada,
  resumoDoCadastro,
  telefoneDoBrasil,
} from './formatos';
import type { CadastroDeContatos, ContatoDigitado, PessoaDoPublico } from './tipos';

/**
 * Os três jeitos de pôr gente em "Quem recebe" (protótipo B, 12/11/2026): digitar
 * uma pessoa, colar uma lista e escolher da base. Os dois primeiros cadastram
 * na hora (`disparo_adicionar_contatos`): quem é novo vira ficha em Prospectados,
 * e quem já tinha ficha entra com a que já existe. Nenhum deles manda nada.
 */

export type Entrada = {
  ids: string[];
  /** Os que nasceram agora: ganham a etiqueta "Ficha nova". */
  novas: string[];
  /** A frase do que aconteceu, para o aviso da lista. */
  aviso: string;
};

function mensagemDoErro(erro: Error): string {
  return erro instanceof ErroDoEnvio ? fraseDaRecusa(erro.motivo) : erro.message;
}

/** Quem entra na lista depois de um cadastro: os novos e os que já tinham ficha. */
function quemEntra(r: CadastroDeContatos): { ids: string[]; novas: string[] } {
  const ids: string[] = [];
  const novas: string[] = [];
  for (const i of r.itens) {
    if (!i.organization_id || (i.status !== 'novo' && i.status !== 'ja_estava')) continue;
    ids.push(i.organization_id);
    if (i.status === 'novo') novas.push(i.organization_id);
  }
  return { ids, novas };
}

const ROTULO = 'flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground';
const CAMPO = 'h-11 bg-background md:h-10';

// ---------------------------------------------------------------------------
// Adicionar contato
// ---------------------------------------------------------------------------

export function AdicionarContato({
  idsNaLista,
  aoEntrar,
}: {
  idsNaLista: ReadonlySet<string>;
  aoEntrar: (e: Entrada) => void;
}) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const campoDoNome = useRef<HTMLInputElement>(null);
  const focarNoNome = useRef(false);

  // A resposta é lida contra o que FOI enviado (as variáveis da mutation), não
  // contra o que está no campo agora.
  const cadastrar = useMutation({
    mutationFn: (contato: ContatoDigitado) => adicionarContatosAoDisparo([contato]),
    onSuccess: (r, enviado) => {
      const item = r.itens[0];
      if (!item) {
        setErro('Não deu para pôr essa pessoa na lista.');
        return;
      }
      const frase = fraseDeUmCadastro(
        { ...item, nome: item.nome ?? enviado.nome },
        item.organization_id !== null && idsNaLista.has(item.organization_id),
      );
      if (!frase.entrou || !item.organization_id) {
        setErro(frase.texto);
        return;
      }
      aoEntrar({
        ids: [item.organization_id],
        novas: item.status === 'novo' ? [item.organization_id] : [],
        aviso: frase.texto,
      });
      // Pronto para a próxima: quem cadastra três seguidas não larga o teclado.
      setNome('');
      setTelefone('');
      setEmpresa('');
      setErro(null);
      // O campo ainda está travado neste instante: o foco volta quando destrava.
      focarNoNome.current = true;
    },
    onError: (e: Error) => setErro(mensagemDoErro(e)),
  });

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (cadastrar.isPending) return;
    if (nome.trim() === '') {
      setErro('Falta o nome.');
      return;
    }
    if (!telefoneDoBrasil(telefone)) {
      setErro('Confira o WhatsApp: DDD e número, como (84) 99999-0101.');
      return;
    }
    cadastrar.mutate({ nome: nome.trim(), telefone, empresa });
  }
  const ocupado = cadastrar.isPending;
  useEffect(() => {
    if (ocupado || !focarNoNome.current) return;
    focarNoNome.current = false;
    campoDoNome.current?.focus();
  }, [ocupado]);

  return (
    <form
      onSubmit={enviar}
      className="@container space-y-3 rounded-xl bg-muted/40 p-3 md:p-4"
      aria-label="Adicionar contato"
    >
      <div className="grid gap-3 @sm:grid-cols-2 @sm:items-end @3xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className={ROTULO}>
          Nome
          <Input
            ref={campoDoNome}
            value={nome}
            disabled={ocupado}
            autoFocus
            autoComplete="off"
            maxLength={120}
            onChange={(e) => {
              setNome(e.target.value);
              setErro(null);
            }}
            placeholder="Ex.: Carla Dantas"
            className={CAMPO}
          />
        </label>
        <label className={ROTULO}>
          WhatsApp
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={telefone}
            disabled={ocupado}
            maxLength={30}
            onChange={(e) => {
              setTelefone(e.target.value);
              setErro(null);
            }}
            placeholder="(84) 99999-0000"
            className={cn(CAMPO, 'numerico')}
          />
        </label>
        <label className={ROTULO}>
          Empresa (opcional)
          <Input
            value={empresa}
            disabled={ocupado}
            autoComplete="off"
            maxLength={120}
            onChange={(e) => setEmpresa(e.target.value)}
            placeholder="Ex.: Som da Carla"
            className={CAMPO}
          />
        </label>
        <Button type="submit" className="toque h-11 md:h-10" disabled={cadastrar.isPending}>
          {cadastrar.isPending ? 'Adicionando…' : 'Adicionar'}
        </Button>
      </div>
      {erro ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {erro}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Entra na lista e vira uma ficha nova em Prospectados. Se o WhatsApp já tiver ficha, entra a
        que já existe.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Colar lista
// ---------------------------------------------------------------------------

export function ColarLista({
  idsNaLista,
  vagas,
  maximo,
  aoEntrar,
  aoFechar,
}: {
  idsNaLista: ReadonlySet<string>;
  /** Quantas pessoas ainda cabem na lista do disparo. */
  vagas: number;
  /** O máximo da lista (2.000), para a frase. */
  maximo: number;
  aoEntrar: (e: Entrada) => void;
  aoFechar: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [sobrou, setSobrou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // O que passa do que cabe fica de fora ANTES de ir ao banco: nenhuma ficha
  // nasce para não entrar na lista.
  const lida = useMemo(() => lerListaColada(texto, Math.max(vagas, 0)), [texto, vagas]);
  const prontas = lida.validas.length;

  // A resposta é lida contra o que FOI enviado (texto e linhas da hora do clique).
  const cadastrar = useMutation({
    mutationFn: (pedido: { texto: string; lida: ReturnType<typeof lerListaColada> }) =>
      adicionarContatosAoDisparo(
        pedido.lida.validas.map((v) => ({
          nome: v.nome,
          telefone: v.telefone,
          empresa: v.empresa,
        })),
      ),
    onSuccess: (r, pedido) => {
      const { ids, novas } = quemEntra(r);
      const fora = pedido.lida.recusadas.filter((x) => x.motivo === 'acima_do_limite').length;
      const aviso = resumoDoCadastro(r.itens, idsNaLista);
      aoEntrar({
        ids,
        novas,
        aviso:
          fora > 0
            ? `${aviso} ${formatarNumero(fora)} ${fora === 1 ? 'ficou' : 'ficaram'} de fora: a lista vai até ${formatarNumero(maximo)}.`
            : aviso,
      });
      // O que não entrou por erro de digitação fica no campo, para corrigir e
      // mandar de novo. Quem pediu para sair, já estava ou passou do limite, não.
      const linhas = pedido.texto.split(/\r?\n/);
      const corrigir = [
        ...pedido.lida.recusadas
          .filter((x) => x.motivo === 'sem_nome' || x.motivo === 'sem_whatsapp')
          .map((x) => x.linha),
        ...r.itens
          .filter((i) => i.status === 'telefone_invalido' || i.status === 'nome_obrigatorio')
          .map((i) => pedido.lida.validas[i.linha - 1]?.linha)
          .filter((l): l is number => l !== undefined),
      ].sort((a, b) => a - b);
      if (corrigir.length > 0) {
        setTexto(corrigir.map((l) => linhas[l - 1] ?? '').join('\n'));
        setSobrou(true);
      } else {
        setTexto('');
        setSobrou(false);
        aoFechar();
      }
    },
    onError: (e: Error) => setErro(mensagemDoErro(e)),
  });

  return (
    <form
      className="space-y-3 rounded-xl bg-muted/40 p-3 md:p-4"
      aria-label="Colar lista"
      onSubmit={(e) => {
        e.preventDefault();
        if (prontas > 0 && !cadastrar.isPending) cadastrar.mutate({ texto, lida });
      }}
    >
      <label className={ROTULO} htmlFor="lista-colada">
        Uma pessoa por linha: nome, WhatsApp e, se quiser, a empresa
      </label>
      <textarea
        id="lista-colada"
        rows={5}
        autoFocus
        value={texto}
        disabled={cadastrar.isPending}
        onChange={(e) => {
          setTexto(e.target.value);
          setSobrou(false);
          setErro(null);
        }}
        aria-describedby="lista-colada-resumo"
        placeholder={'Carla Dantas, (84) 98888-1201\nPedro Alves, (84) 98888-1202, Som do Pedro'}
        className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-base leading-relaxed focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60 md:text-sm"
      />
      {sobrou ? (
        <p className="text-sm font-medium text-foreground">
          Ficaram aqui as linhas que não entraram. Corrija e adicione de novo.
        </p>
      ) : null}
      {erro ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {erro}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="lista-colada-resumo" className="text-xs text-muted-foreground" aria-live="polite">
          {texto.trim() === ''
            ? 'Separe com vírgula ou ponto e vírgula, ou cole direto de uma planilha.'
            : resumoDaListaColada(lida, maximo)}
        </p>
        <Button
          type="submit"
          className="toque h-11 md:h-10"
          disabled={prontas === 0 || cadastrar.isPending}
        >
          {cadastrar.isPending
            ? 'Adicionando…'
            : prontas === 0
              ? 'Adicionar'
              : `Adicionar ${formatarNumero(prontas)} ${prontas === 1 ? 'pessoa' : 'pessoas'}`}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Escolher da base
// ---------------------------------------------------------------------------

/** Quantas linhas a busca desenha de cada vez. "Marcar todas" vale para todas. */
const LINHAS_DA_BUSCA = 100;
const TODAS = 'todas';

export function EscolherDaBase({
  categorias,
  idsNaLista,
  aoMarcar,
  aoTirar,
  aoFechar,
}: {
  categorias: readonly OpcaoCategoria[];
  idsNaLista: ReadonlySet<string>;
  aoMarcar: (ids: string[]) => void;
  aoTirar: (ids: string[]) => void;
  aoFechar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState<string>(TODAS);
  const [soQuemNuncaRecebeu, setSoQuemNuncaRecebeu] = useState(true);
  const [verTodas, setVerTodas] = useState(false);
  const buscaAdiada = useDeferredValue(busca.trim());

  const filtro = {
    busca: buscaAdiada,
    categorias: categoria === TODAS ? [] : [Number(categoria)],
    situacoes: soQuemNuncaRecebeu ? ['nunca_contatado'] : [],
  };
  const publico = useQuery({
    queryKey: ['envios', 'publico', filtro],
    queryFn: () => buscarPublico(filtro),
    placeholderData: (anterior) => anterior,
  });
  const resultados: PessoaDoPublico[] = publico.data ?? [];
  const marcaveis = resultados.filter((p) => p.bloqueio === null);
  const naLista = resultados.filter((p) => idsNaLista.has(p.organization_id));
  const faltam = marcaveis.filter((p) => !idsNaLista.has(p.organization_id));
  const visiveis = verTodas ? resultados : resultados.slice(0, LINHAS_DA_BUSCA);
  // "Marcar as primeiras N": mandar a 100 de 800 sem desmarcar 700.
  const [primeirasEscrito, setPrimeirasEscrito] = useState('');
  const primeiras = Math.floor(Number(primeirasEscrito));
  const primeirasValidas = Number.isFinite(primeiras) && primeiras >= 1;

  return (
    <div
      className="@container space-y-3 rounded-xl bg-muted/40 p-3 md:p-4"
      role="group"
      aria-label="Escolher da base"
    >
      <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_14rem]">
        <label className={ROTULO}>
          {/* A busca de `app.envio_publico` olha o nome da FICHA (a empresa),
              não o da pessoa: o rótulo diz isso, para ninguém procurar "Mariana"
              e achar que ela não está na base. */}
          Nome da ficha (a empresa)
          <span className="relative block">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              autoFocus
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setVerTodas(false);
              }}
              placeholder="Ex.: Buffet Sabor Potiguar"
              className={cn(CAMPO, 'pl-9')}
            />
          </span>
        </label>
        <div className={ROTULO}>
          <span id="base-categoria">Categoria</span>
          <Select
            value={categoria}
            onValueChange={(v) => {
              setCategoria(v);
              setVerTodas(false);
            }}
          >
            <SelectTrigger
              aria-labelledby="base-categoria"
              className="toque h-11 w-full bg-background md:h-10"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={soQuemNuncaRecebeu}
          onChange={(e) => {
            setSoQuemNuncaRecebeu(e.target.checked);
            setVerTodas(false);
          }}
        />
        Só quem ainda não recebeu mensagem nossa
      </label>

      <div
        className={cn(
          'overflow-hidden rounded-xl border border-hairline bg-background transition-opacity',
          publico.isFetching && !publico.isPending && 'opacity-60',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2 text-sm">
          <span className="text-muted-foreground" aria-live="polite">
            {publico.isPending ? (
              'Procurando…'
            ) : (
              <>
                <span className="numerico font-medium text-foreground">
                  {formatarNumero(resultados.length)}
                </span>{' '}
                {resultados.length === 1 ? 'achada' : 'achadas'}
                {resultados.length >= 2000 ? ' (as 2.000 primeiras)' : ''}
              </>
            )}
          </span>
          {faltam.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {faltam.length > 1 ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!primeirasValidas) return;
                    aoMarcar(faltam.slice(0, primeiras).map((p) => p.organization_id));
                    setPrimeirasEscrito('');
                  }}
                >
                  <label htmlFor="base-primeiras" className="sr-only">
                    Quantas marcar, a partir do começo da lista
                  </label>
                  <Input
                    id="base-primeiras"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={faltam.length}
                    step={1}
                    value={primeirasEscrito}
                    onChange={(e) => setPrimeirasEscrito(e.target.value)}
                    placeholder="100"
                    className="numerico h-11 w-20 bg-background md:h-8"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    className="toque h-11 md:h-8"
                    disabled={!primeirasValidas}
                  >
                    Marcar as primeiras
                  </Button>
                </form>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="toque h-11 md:h-8"
                onClick={() => aoMarcar(faltam.map((p) => p.organization_id))}
              >
                Marcar todas ({formatarNumero(faltam.length)})
              </Button>
            </div>
          ) : naLista.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="toque h-11 md:h-8"
              onClick={() => aoTirar(naLista.map((p) => p.organization_id))}
            >
              Desmarcar todas
            </Button>
          ) : null}
        </div>
        {publico.isError ? (
          <p className="p-3 text-sm text-destructive">{mensagemDoErro(publico.error)}</p>
        ) : !publico.isPending && resultados.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            Ninguém na base com essa busca. Dá para cadastrar pelo botão “Adicionar contato”.
          </p>
        ) : (
          <ul
            className="max-h-72 divide-y divide-hairline overflow-y-auto"
            aria-label="Resultado da busca"
          >
            {visiveis.map((p) => {
              const bloqueada = p.bloqueio !== null;
              const marcada = idsNaLista.has(p.organization_id);
              return (
                <li key={p.organization_id}>
                  <label
                    className={cn(
                      'flex min-h-12 cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-muted/50',
                      bloqueada && !marcada && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      disabled={bloqueada && !marcada}
                      checked={marcada}
                      onChange={(e) =>
                        e.target.checked
                          ? aoMarcar([p.organization_id])
                          : aoTirar([p.organization_id])
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{p.nome}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[p.categoria, p.cidade].filter(Boolean).join(' · ') || 'Sem categoria'}
                      </span>
                      {bloqueada ? (
                        <span className="block text-xs text-destructive">
                          {fraseDoMotivo(p.bloqueio)}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {visiveis.length < resultados.length ? (
          <button
            type="button"
            onClick={() => setVerTodas(true)}
            className="toque min-h-11 w-full border-t border-hairline py-2 text-sm text-primary hover:bg-muted/50"
          >
            Mostrar as {formatarNumero(resultados.length)}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          <span className="numerico">{formatarNumero(naLista.length)}</span>{' '}
          {naLista.length === 1 ? 'desta busca está' : 'desta busca estão'} na lista
        </span>
        <Button variant="outline" className="toque h-11 md:h-9" onClick={aoFechar}>
          Pronto
        </Button>
      </div>
    </div>
  );
}
