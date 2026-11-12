'use client';

import { useState } from 'react';
import { Check, ClipboardList, RotateCw, Search, Trash2, UserPlus, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DialogoExcluir } from '@/components/exclusao/dialogo-excluir';
import { formatarTelefone } from '@/components/parceiros/formatos';
import type { OpcaoCategoria } from '@/components/parceiros/tipos';

import { AdicionarContato, ColarLista, EscolherDaBase, type Entrada } from './adicionar-pessoas';
import { avisoSemEmpresa, formatarNumero, fraseDoMotivo, primeiroNome } from './formatos';
import type { PessoaDoDisparo } from './tipos';

/** O aviso em cima da lista: o que acabou de acontecer, com "Desfazer" quando dá. */
export type AvisoDaLista = { texto: string; tom: 'ok' | 'neutro'; podeDesfazer: boolean };

type Painel = 'contato' | 'colar' | 'base';

/** Quantas linhas a lista desenha de cada vez. Quem recebe vale para todas. */
const LINHAS_DA_LISTA = 150;

/** Como a lista chama a pessoa: o nome dela ou, sem nome, o da empresa. */
export function nomeNaLista(p: PessoaDoDisparo): string {
  return p.nome ?? p.empresa;
}

export function primeiroNomeNaLista(p: PessoaDoDisparo): string {
  return p.primeiro_nome ?? (primeiroNome(p.nome ?? p.empresa) || p.empresa);
}

/**
 * "1. Quem recebe": a lista sempre aberta, com os três jeitos de pôr gente
 * nela logo acima (protótipo B, 12/11/2026). A lista guarda só os ids; o resto
 * vem de `disparo_pessoas`. Clicar numa pessoa mostra a mensagem dela no
 * celular; o × tira da lista, com "Desfazer". Em quem ganhou ficha agora,
 * neste disparo, o × também oferece apagar a ficha (cadastro por engano).
 */
export function QuemRecebe({
  pessoas,
  esperando,
  carregando,
  erro,
  novas,
  vendoId,
  idsNaLista,
  aviso,
  categorias,
  aoVer,
  aoTirar,
  aoTirarVarias,
  aoLimpar,
  aoDesfazer,
  aoEntrar,
  vagas,
  maximo,
  usaEmpresa,
  apagando,
  aoApagarFicha,
  aoTentarDeNovo,
}: {
  pessoas: readonly PessoaDoDisparo[];
  /** Ids que já estão na lista e ainda não voltaram do banco. */
  esperando: number;
  carregando: boolean;
  erro: string | null;
  novas: ReadonlySet<string>;
  vendoId: string | null;
  idsNaLista: ReadonlySet<string>;
  aviso: AvisoDaLista | null;
  categorias: readonly OpcaoCategoria[];
  aoVer: (id: string) => void;
  aoTirar: (id: string) => void;
  aoTirarVarias: (ids: string[]) => void;
  aoLimpar: () => void;
  aoDesfazer: () => void;
  aoEntrar: (e: Entrada) => void;
  /** Quantas ainda cabem na lista (o máximo de um disparo menos quem já está). */
  vagas: number;
  maximo: number;
  /** A mensagem escolhida fala da empresa (puxa `empresa` da ficha). */
  usaEmpresa: boolean;
  /** A ficha que está sendo apagada agora, se alguma. */
  apagando: string | null;
  /** Tira da lista e apaga a ficha nascida neste disparo; `aoTerminar` fecha o diálogo. */
  aoApagarFicha: (id: string, aoTerminar: () => void) => void;
  aoTentarDeNovo: () => void;
}) {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [paraApagar, setParaApagar] = useState<PessoaDoDisparo | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const total = pessoas.length;
  const deFora = pessoas.filter((p) => p.bloqueio !== null || p.aviso !== null).length;
  const visiveis = verTodas ? pessoas : pessoas.slice(0, LINHAS_DA_LISTA);

  function alternar(p: Painel) {
    setPainel((atual) => (atual === p ? null : p));
  }

  return (
    <section
      aria-labelledby="bloco-quem"
      className="sombra-base min-w-0 space-y-4 rounded-xl bg-card p-4 md:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2
          id="bloco-quem"
          className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.01em]"
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[13px] font-semibold text-background"
          >
            1
          </span>
          Quem recebe
        </h2>
        <p className="text-sm font-medium text-muted-foreground">
          {total === 0 && esperando === 0 ? (
            'ninguém ainda'
          ) : (
            <>
              <span className="numerico">{formatarNumero(total)}</span>{' '}
              {total === 1 ? 'pessoa' : 'pessoas'}
              {deFora > 0 ? (
                <>
                  {' '}
                  · <span className="numerico">{formatarNumero(deFora)}</span>{' '}
                  {deFora === 1 ? 'fica' : 'ficam'} de fora
                </>
              ) : null}
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          aria-expanded={painel === 'contato'}
          aria-controls="painel-quem"
          className="toque h-11 px-4 md:h-9"
          onClick={() => alternar('contato')}
        >
          <UserPlus aria-hidden="true" />
          Adicionar contato
        </Button>
        <Button
          variant="outline"
          aria-expanded={painel === 'colar'}
          aria-controls="painel-quem"
          className="toque h-11 px-4 md:h-9"
          onClick={() => alternar('colar')}
        >
          <ClipboardList aria-hidden="true" />
          Colar lista
        </Button>
        <Button
          variant="outline"
          aria-expanded={painel === 'base'}
          aria-controls="painel-quem"
          className="toque h-11 px-4 md:h-9"
          onClick={() => alternar('base')}
        >
          <Search aria-hidden="true" />
          Escolher da base
        </Button>
      </div>

      <div id="painel-quem">
        {painel === 'contato' ? (
          <AdicionarContato idsNaLista={idsNaLista} aoEntrar={aoEntrar} />
        ) : null}
        {painel === 'colar' ? (
          <ColarLista
            idsNaLista={idsNaLista}
            vagas={vagas}
            maximo={maximo}
            aoEntrar={aoEntrar}
            aoFechar={() => setPainel(null)}
          />
        ) : null}
        {painel === 'base' ? (
          <EscolherDaBase
            categorias={categorias}
            idsNaLista={idsNaLista}
            aoMarcar={(ids) => aoEntrar({ ids, novas: [], aviso: '' })}
            aoTirar={aoTirarVarias}
            aoFechar={() => setPainel(null)}
          />
        ) : null}
      </div>

      <div role="status" aria-live="polite" className="empty:hidden">
        {aviso && aviso.texto ? (
          <p
            className={cn(
              'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium',
              aviso.tom === 'ok' ? 'text-menta-texto' : 'text-muted-foreground',
            )}
          >
            {aviso.tom === 'ok' ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
            <span>{aviso.texto}</span>
            {aviso.podeDesfazer ? (
              <button
                type="button"
                onClick={aoDesfazer}
                className="toque min-h-11 font-semibold text-foreground underline underline-offset-2 md:min-h-0"
              >
                Desfazer
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="border-t border-hairline pt-3">
        {erro ? (
          <p
            className="flex flex-wrap items-center gap-x-2 px-2 pb-2 text-sm text-destructive"
            role="alert"
          >
            {erro}
            <Button
              variant="ghost"
              size="sm"
              className="toque h-11 text-foreground md:h-8"
              onClick={aoTentarDeNovo}
            >
              <RotateCw aria-hidden="true" />
              Tentar de novo
            </Button>
          </p>
        ) : null}
        {total === 0 && esperando === 0 ? (
          erro ? null : (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              Ninguém ainda. Adicione um contato, cole uma lista ou escolha da base.
            </p>
          )
        ) : (
          <>
            <ul aria-label="Quem vai receber" className="max-h-[22rem] space-y-0.5 overflow-y-auto">
              {visiveis.map((p) => (
                <LinhaDaPessoa
                  key={p.organization_id}
                  pessoa={p}
                  nova={novas.has(p.organization_id)}
                  vendo={p.organization_id === vendoId}
                  semEmpresa={avisoSemEmpresa(p, usaEmpresa)}
                  aoVer={() => aoVer(p.organization_id)}
                  aoTirar={() => aoTirar(p.organization_id)}
                  aoApagar={() => setParaApagar(p)}
                />
              ))}
            </ul>
            {carregando || esperando > 0 ? (
              <p className="px-2 pt-2 text-sm text-muted-foreground" aria-live="polite">
                {esperando > 0
                  ? `Buscando ${formatarNumero(esperando)} ${esperando === 1 ? 'pessoa' : 'pessoas'}…`
                  : 'Carregando…'}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              {visiveis.length < total ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="toque h-11 md:h-8"
                  onClick={() => setVerTodas(true)}
                >
                  Mostrar as {formatarNumero(total)}
                </Button>
              ) : (
                <span />
              )}
              {total > 1 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="toque h-11 text-muted-foreground md:h-8"
                  onClick={aoLimpar}
                >
                  Tirar todas
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>

      <DialogoExcluir
        aberto={paraApagar !== null}
        aoFechar={() => setParaApagar(null)}
        titulo={`Apagar a ficha de ${paraApagar ? primeiroNomeNaLista(paraApagar) : ''}?`}
        descricao={
          <>
            <p>
              Esta ficha nasceu agora, quando{' '}
              {paraApagar ? primeiroNomeNaLista(paraApagar) : 'a pessoa'} entrou no disparo. Apagar
              tira da lista e de Prospectados.
            </p>
            <p>
              A ficha vai para Excluídos com o motivo “Cadastrada por engano no disparo”, e dá para
              restaurar de lá. Para só tirar do disparo e manter a ficha, use “Tirar da lista”.
            </p>
          </>
        }
        rotuloConfirmar="Apagar a ficha"
        motivo="nenhum"
        ocupado={paraApagar !== null && apagando === paraApagar.organization_id}
        aoConfirmar={() => {
          if (paraApagar) aoApagarFicha(paraApagar.organization_id, () => setParaApagar(null));
        }}
      />
    </section>
  );
}

function LinhaDaPessoa({
  pessoa: p,
  nova,
  vendo,
  semEmpresa,
  aoVer,
  aoTirar,
  aoApagar,
}: {
  pessoa: PessoaDoDisparo;
  nova: boolean;
  vendo: boolean;
  /** O aviso de quem não tem empresa e vai receber mensagem que fala dela. */
  semEmpresa: string | null;
  aoVer: () => void;
  aoTirar: () => void;
  /** Só em ficha nascida neste disparo. */
  aoApagar: () => void;
}) {
  const primeiro = primeiroNomeNaLista(p);
  // A empresa só quando diz algo a mais que o nome (sem empresa, a ficha leva o
  // nome da pessoa), e o WhatsApp como se escreve: "(84) 98877-6655".
  const detalhe = [
    p.nome && p.empresa !== p.nome ? p.empresa : null,
    p.telefone ? formatarTelefone(p.telefone) : 'sem WhatsApp',
    p.categoria,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li
      className={cn(
        'flex items-center gap-1 rounded-xl pr-1 transition-colors',
        vendo && 'bg-muted/70',
      )}
    >
      <button
        type="button"
        onClick={aoVer}
        aria-current={vendo ? 'true' : undefined}
        className="toque flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="sr-only">Ver no celular a mensagem de {primeiro}: </span>
        <span
          aria-hidden="true"
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            vendo ? 'bg-menta text-menta-tinta' : 'bg-muted text-foreground',
          )}
        >
          {(primeiro.charAt(0) || '?').toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={cn('min-w-0 truncate font-medium', p.bloqueio && 'text-muted-foreground')}
            >
              {nomeNaLista(p)}
            </span>
            {nova ? (
              <span className="rounded-full bg-menta-fundo px-2 py-0.5 text-[11px] font-medium text-menta-texto">
                Ficha nova
              </span>
            ) : null}
          </span>
          <span className="numerico block truncate text-xs text-muted-foreground">{detalhe}</span>
          {p.bloqueio ? (
            <span className="block text-xs text-destructive">
              Não vai receber: {fraseDoMotivo(p.bloqueio)}
            </span>
          ) : p.aviso ? (
            <span className="block text-xs text-muted-foreground">
              Vai ser pulada: {fraseDoMotivo(p.aviso)}
            </span>
          ) : semEmpresa ? (
            <span className="block text-xs text-foreground">{semEmpresa}</span>
          ) : null}
        </span>
        {vendo ? (
          <span className="hidden shrink-0 text-xs font-medium text-menta-texto sm:inline">
            <span className="lg:hidden">No celular abaixo</span>
            <span className="hidden lg:inline">No celular ao lado</span>
          </span>
        ) : null}
      </button>
      {nova ? (
        // Ficha nascida agora: o × pergunta se é só tirar ou se foi engano.
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="toque size-11 shrink-0 text-muted-foreground md:size-8"
              aria-label={`Tirar ${primeiro} da lista ou apagar a ficha`}
              title="Tirar da lista"
            >
              <X aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem className="min-h-11 md:min-h-8" onSelect={aoTirar}>
              <X aria-hidden="true" />
              Tirar da lista
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              className="min-h-11 md:min-h-8"
              onSelect={aoApagar}
            >
              <Trash2 aria-hidden="true" />
              Tirar e apagar a ficha…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="toque size-11 shrink-0 text-muted-foreground md:size-8"
          aria-label={`Tirar ${primeiro} da lista`}
          title="Tirar da lista"
          onClick={aoTirar}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}
