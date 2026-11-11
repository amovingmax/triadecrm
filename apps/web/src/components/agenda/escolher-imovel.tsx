'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search, TriangleAlert, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SeletorDeAba } from '@/components/ui/abas';
import { SITUACOES } from '@/components/anuncios/tipos';

import {
  avisoDoAnuncioForaDoAr,
  filtrarAnuncios,
  ROTULO_SEM_ANUNCIO,
  type AnuncioDaEscolha,
  type EscolhaDoImovel,
} from './imovel-da-visita';
import { useAnunciosDaEscolha } from './imovel-da-visita-dados';

/**
 * O imóvel da visita (11/11/2026, só na Imova): a mesma escolha no "Novo
 * compromisso", no "Definir imóvel" do cartão e na folha do link da agenda em
 * Conversas.
 *
 * Duas opções, quando a visita pode ser de imóvel sem anúncio:
 *
 *   · **Anúncio:** a lista dos anúncios da Imova (no ar primeiro), com busca por
 *     código e título. Escolhido, vira um resumo com "Trocar", como o parceiro da
 *     folha de novo compromisso. O anúncio fora do ar ganha o aviso.
 *   · **Imóvel sem anúncio (avaliação de proprietário):** o endereço, obrigatório.
 *
 * O link da agenda só leva anúncio (o banco monta o endereço dele): lá a segunda
 * opção não aparece.
 */

/** Quantos anúncios a lista mostra de uma vez: o resto vem pela busca. */
const NA_LISTA = 30;

export function EscolherImovel({
  valor,
  aoMudar,
  permiteSemAnuncio,
  erro = null,
}: {
  valor: EscolhaDoImovel;
  aoMudar: (escolha: EscolhaDoImovel) => void;
  /** A avaliação do imóvel de um proprietário, que ainda não tem anúncio. */
  permiteSemAnuncio: boolean;
  /** A recusa da régua ou do banco, embaixo do campo. */
  erro?: string | null;
}) {
  const id = useId();
  const anuncios = useAnunciosDaEscolha();
  // O que foi escolhido sobrevive à troca de aba: ir para "sem anúncio" e voltar não
  // apaga o anúncio, nem o endereço que a pessoa digitou.
  const [enderecoDigitado, setEnderecoDigitado] = useState(
    valor.modo === 'sem_anuncio' ? valor.endereco : '',
  );
  const [anuncioLembrado, setAnuncioLembrado] = useState(
    valor.modo === 'anuncio' ? valor.anuncioId : null,
  );

  return (
    <div className="flex flex-col gap-2">
      <p id={`${id}-rotulo`} className="text-sm font-medium">
        Imóvel
      </p>

      {permiteSemAnuncio ? (
        <SeletorDeAba
          rotulo="De onde é o imóvel"
          ativo={valor.modo}
          aoTrocar={(modo) =>
            aoMudar(
              modo === 'anuncio'
                ? { modo: 'anuncio', anuncioId: anuncioLembrado }
                : { modo: 'sem_anuncio', endereco: enderecoDigitado },
            )
          }
          itens={[
            { id: 'anuncio', rotulo: 'Um anúncio' },
            { id: 'sem_anuncio', rotulo: 'Imóvel sem anúncio' },
          ]}
        />
      ) : null}

      {valor.modo === 'sem_anuncio' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-endereco`} className="text-xs text-muted-foreground">
            {ROTULO_SEM_ANUNCIO}: escreva onde é a visita.
          </label>
          <Input
            id={`${id}-endereco`}
            value={valor.endereco}
            maxLength={300}
            autoComplete="off"
            onChange={(e) => {
              setEnderecoDigitado(e.target.value);
              aoMudar({ modo: 'sem_anuncio', endereco: e.target.value });
            }}
            placeholder="Rua, número, bairro e cidade"
            aria-invalid={erro !== null}
            className="h-11 md:h-9"
          />
        </div>
      ) : anuncios.isPending ? (
        <p className="py-3 text-sm text-muted-foreground">
          <Loader2 className="inline size-4 animate-spin" aria-hidden="true" /> Carregando os
          anúncios…
        </p>
      ) : anuncios.isError ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/45 px-3 py-2.5 text-sm text-muted-foreground">
          Os anúncios não carregaram agora.
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="toque h-11 md:h-8"
            onClick={() => void anuncios.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : (
        <EscolherAnuncio
          anuncios={anuncios.data}
          anuncioId={valor.anuncioId}
          aoEscolher={(anuncioId) => {
            setAnuncioLembrado(anuncioId);
            aoMudar({ modo: 'anuncio', anuncioId });
          }}
          rotuloId={`${id}-rotulo`}
          semAnuncioAoLado={permiteSemAnuncio}
        />
      )}

      {erro ? (
        <p role="alert" className="text-xs text-destructive-texto">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

function EscolherAnuncio({
  anuncios,
  anuncioId,
  aoEscolher,
  rotuloId,
  semAnuncioAoLado,
}: {
  anuncios: readonly AnuncioDaEscolha[];
  anuncioId: string | null;
  aoEscolher: (anuncioId: string | null) => void;
  rotuloId: string;
  semAnuncioAoLado: boolean;
}) {
  const [busca, setBusca] = useState('');
  const escolhido = anuncioId ? (anuncios.find((a) => a.id === anuncioId) ?? null) : null;

  if (escolhido) {
    const aviso = avisoDoAnuncioForaDoAr(escolhido.situacao);
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/45 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium break-words">
              <span className="numerico">{escolhido.codigo}</span> · {escolhido.titulo}
            </p>
            <p className="text-xs break-words text-muted-foreground">
              {escolhido.endereco ?? 'Sem endereço no anúncio'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="toque h-11 shrink-0 md:h-8"
            onClick={() => aoEscolher(null)}
            aria-label="Trocar o imóvel"
          >
            <X aria-hidden="true" />
            Trocar
          </Button>
        </div>
        {aviso ? <AvisoDoImovel>{aviso}</AvisoDoImovel> : null}
        {escolhido.endereco ? null : (
          <AvisoDoImovel>
            Este anúncio não tem endereço. Complete no anúncio para o cliente e o Maps saberem onde
            é a visita.{' '}
            <Link
              href={`/anuncios/${escolhido.id}`}
              className="font-medium underline underline-offset-2"
            >
              Abrir o anúncio
            </Link>
          </AvisoDoImovel>
        )}
      </div>
    );
  }

  const achados = filtrarAnuncios(anuncios, busca);
  const vistos = achados.slice(0, NA_LISTA);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por código ou título"
          aria-label="Buscar o anúncio por código ou título"
          autoComplete="off"
          className="h-11 pl-9 md:h-9"
        />
      </div>

      {anuncios.length === 0 ? (
        <p className="rounded-lg bg-muted/45 px-3 py-3 text-sm text-muted-foreground">
          Nenhum anúncio cadastrado ainda.
          {semAnuncioAoLado ? ' Na avaliação de proprietário, use "Imóvel sem anúncio".' : ''}
        </p>
      ) : vistos.length === 0 ? (
        <p className="rounded-lg bg-muted/45 px-3 py-3 text-sm text-muted-foreground">
          Nenhum anúncio com &ldquo;{busca.trim()}&rdquo; no código, no título ou no endereço.
        </p>
      ) : (
        <ul
          aria-labelledby={rotuloId}
          className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg"
        >
          {vistos.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => aoEscolher(a.id)}
                className="toque flex min-h-11 w-full items-start gap-3 rounded-lg px-3 py-2 text-left outline-none hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="numerico w-[4.5rem] shrink-0 pt-px text-sm font-medium">
                  {a.codigo}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm">{a.titulo}</span>
                    {a.situacao === 'no_ar' ? null : (
                      <Badge variant="pilula" className="font-normal text-muted-foreground">
                        {SITUACOES[a.situacao]}
                      </Badge>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {a.endereco ?? 'Sem endereço no anúncio'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {achados.length > vistos.length ? (
        <p className="text-xs text-muted-foreground">
          Mostrando <span className="numerico">{vistos.length}</span> de{' '}
          <span className="numerico">{achados.length}</span>. Busque pelo código para achar os
          outros.
        </p>
      ) : null}
    </div>
  );
}

/** O aviso âmbar da escolha: o anúncio fora do ar, ou sem endereço. */
function AvisoDoImovel({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2.5 rounded-lg bg-morno-fundo px-3 py-2.5 text-sm text-morno-texto"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
