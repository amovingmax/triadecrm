'use client';

import { useEffect, useId, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2, PhoneOff, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { carregarSugestoes } from '@/components/registro/alvos';
import type { SugestaoDeAlvo } from '@/components/registro/tipos';

import { trechosDestacados } from './autocompletar';
import { buscarParceirosParaAgenda } from './consultas';

/**
 * Escolher o parceiro do compromisso, com autocompletar.
 *
 * - Campo vazio e em foco: as sugestões de quem está marcando (tarefas de hoje,
 *   registros recentes, ou quem está há mais tempo sem contato), as mesmas do
 *   Registrar contato.
 * - A cada letra: os parceiros cadastrados que CONTÊM o que foi digitado em qualquer
 *   parte do nome, sem acento e sem maiúscula, mais os que a busca geral acha por
 *   telefone, @, CNPJ ou bairro. O trecho que casou aparece em destaque.
 * - Teclado: setas para andar, Enter para escolher, Esc para fechar. O Enter nunca
 *   envia o formulário enquanto a lista está aberta.
 *
 * Quem pediu para não ser contatado aparece, mas não dá para escolher: o banco
 * recusaria o compromisso.
 */
export function CampoParceiro({
  id,
  usuarioId,
  aoEscolher,
}: {
  id: string;
  usuarioId: string;
  aoEscolher: (alvo: SugestaoDeAlvo) => void;
}) {
  const idDaLista = useId();
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState('');
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);

  // Espera a pessoa parar de digitar por um instante antes de perguntar ao banco.
  useEffect(() => {
    const espera = setTimeout(() => setConsulta(texto.trim()), 150);
    return () => clearTimeout(espera);
  }, [texto]);

  const vazio = texto.trim() === '';

  const sugestoes = useQuery({
    queryKey: ['agenda', 'sugestoes-parceiro', usuarioId],
    queryFn: () => carregarSugestoes(usuarioId),
    enabled: aberto && vazio,
    staleTime: 60_000,
  });

  const busca = useQuery({
    queryKey: ['agenda', 'autocompletar-parceiro', consulta],
    queryFn: () => buscarParceirosParaAgenda(consulta),
    enabled: consulta.length >= 1,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const lista: SugestaoDeAlvo[] = vazio ? (sugestoes.data ?? []) : (busca.data ?? []);
  const escolhiveis = lista.filter((a) => !a.naoContatar);
  const procurando = vazio ? sugestoes.isPending : busca.isFetching || consulta !== texto.trim();
  const indiceAtivo = Math.min(ativo, Math.max(0, escolhiveis.length - 1));
  const alvoAtivo = aberto ? (escolhiveis[indiceAtivo] ?? null) : null;

  function escolher(alvo: SugestaoDeAlvo) {
    if (alvo.naoContatar) return;
    setAberto(false);
    setTexto('');
    aoEscolher(alvo);
  }

  function aoTeclar(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setAberto(true);
      setAtivo((i) => Math.min(i + 1, Math.max(0, escolhiveis.length - 1)));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (evento.key === 'Enter') {
      // Com a lista aberta, Enter escolhe; nunca envia o formulário daqui.
      evento.preventDefault();
      if (alvoAtivo) escolher(alvoAtivo);
    } else if (evento.key === 'Escape' && aberto) {
      evento.preventDefault();
      evento.stopPropagation();
      setAberto(false);
    }
  }

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={aberto}
        aria-controls={idDaLista}
        aria-activedescendant={alvoAtivo ? `${idDaLista}-${alvoAtivo.id}` : undefined}
        className="h-11 pr-9 pl-9"
        placeholder="Digite o nome, telefone, @ ou bairro"
        autoComplete="off"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAtivo(0);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => setAberto(false)}
        onKeyDown={aoTeclar}
      />
      {procurando && aberto ? (
        <Loader2
          className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}

      {aberto ? (
        <div
          id={idDaLista}
          role="listbox"
          aria-label="Parceiros"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-hairline bg-popover shadow-lg"
          // Clicar na lista não tira o foco do campo: o clique chega à opção antes
          // de o `onBlur` fechar a lista.
          onMouseDown={(e) => e.preventDefault()}
        >
          {vazio && lista.length > 0 ? (
            <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              Sugestões para você
            </p>
          ) : null}

          {lista.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              {procurando ? (
                'Procurando...'
              ) : vazio ? (
                'Digite para procurar entre os parceiros cadastrados.'
              ) : busca.isError ? (
                'A busca falhou. Tente de novo.'
              ) : (
                <>
                  Nenhum parceiro com &ldquo;{texto.trim()}&rdquo;.{' '}
                  <a
                    href="/parceiros?novo=1"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline underline-offset-2"
                  >
                    Cadastrar parceiro
                  </a>
                </>
              )}
            </p>
          ) : (
            <ul className="flex flex-col py-1">
              {lista.map((alvo) => {
                const selecionado = alvoAtivo?.id === alvo.id;
                return (
                  <li
                    key={alvo.id}
                    id={`${idDaLista}-${alvo.id}`}
                    role="option"
                    aria-selected={selecionado}
                    aria-disabled={alvo.naoContatar}
                    onMouseEnter={() => {
                      const i = escolhiveis.findIndex((a) => a.id === alvo.id);
                      if (i >= 0) setAtivo(i);
                    }}
                    onClick={() => escolher(alvo)}
                    className={cn(
                      'flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1.5',
                      selecionado && 'bg-muted',
                      alvo.naoContatar && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <span className="truncate text-sm">
                      {trechosDestacados(alvo.nome, vazio ? '' : texto).map((p, i) =>
                        p.destaque ? (
                          <mark key={i} className="bg-transparent font-semibold text-foreground">
                            {p.texto}
                          </mark>
                        ) : (
                          <span key={i}>{p.texto}</span>
                        ),
                      )}
                    </span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      {alvo.naoContatar ? (
                        <>
                          <PhoneOff className="size-3 shrink-0" aria-hidden="true" />
                          Pediu para não ser contatado
                        </>
                      ) : (
                        detalheDoAlvo(alvo)
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Por que a sugestão está ali (só no campo vazio), e depois categoria, bairro e etapa. */
const POR_QUE_SUGERIU: Partial<Record<SugestaoDeAlvo['origem'], string>> = {
  tarefa: 'Tarefa para hoje',
  recente: 'Registrado há pouco',
  parado: 'Há mais tempo sem contato',
};

function detalheDoAlvo(alvo: SugestaoDeAlvo): string {
  const partes = [
    POR_QUE_SUGERIU[alvo.origem],
    alvo.categoria,
    alvo.bairro,
    alvo.origem === 'busca' ? alvo.etapa : null,
  ].filter(Boolean);
  return partes.join(' · ') || 'Sem categoria e sem bairro';
}
