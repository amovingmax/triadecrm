'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { Plus } from 'lucide-react';

import { FolhaEditarFicha, type FichaParaEditar, type ValoresDaFicha } from './folha-editar-ficha';
import type { CampoQueFalta } from './resumo-da-ficha';
import type { Catalogos } from './tipos';

/**
 * Uma folha de edição, várias portas.
 *
 * Na ficha nova a folha "Editar ficha" abre por três lugares: o menu "⋯" do
 * cabeçalho e os botões "+ Instagram", "+ Site" do cartão de contato. Em vez de
 * montar um formulário por porta, a ficha tem UMA folha, guardada aqui, e quem
 * quer abri-la pede por `useEditarFicha()`, dizendo em que campo ela abre.
 *
 * Só existe para quem escreve. Para o papel de leitura a página não monta este
 * provedor: `useEditarFicha()` devolve `null`, e os botões que dependem dele
 * não aparecem — o banco recusaria a gravação de qualquer jeito.
 */
type Abrir = (campo?: keyof ValoresDaFicha) => void;

const Contexto = createContext<Abrir | null>(null);

export function EdicaoDaFicha({
  ficha,
  catalogos,
  children,
}: {
  ficha: FichaParaEditar;
  catalogos: Catalogos;
  children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);
  const [campo, setCampo] = useState<keyof ValoresDaFicha | null>(null);

  const abrir = useCallback<Abrir>((qual) => {
    setCampo(qual ?? null);
    setAberta(true);
  }, []);

  return (
    <Contexto.Provider value={abrir}>
      {children}
      <FolhaEditarFicha
        ficha={ficha}
        catalogos={catalogos}
        aberta={aberta}
        aoMudar={setAberta}
        campoInicial={campo}
      />
    </Contexto.Provider>
  );
}

/** Como abrir a folha de edição; `null` para quem não pode editar. */
export function useEditarFicha(): Abrir | null {
  return useContext(Contexto);
}

/**
 * O que falta na ficha, como botões: "+ Instagram", "+ Site".
 *
 * O cartão de contato tinha uma linha "Não informado" por campo vazio. Aqui a
 * falta ocupa uma linha só e já é o caminho para resolvê-la: o toque abre a
 * folha de edição com o cursor no campo. Para quem só lê, vira uma frase.
 */
export function CompletarAFicha({
  faltam,
}: {
  faltam: readonly { campo: CampoQueFalta; rotulo: string }[];
}) {
  const abrir = useEditarFicha();
  if (faltam.length === 0) return null;

  if (!abrir) {
    return (
      <p className="text-sm text-muted-foreground">
        Ainda não informado: {faltam.map((f) => f.rotulo).join(', ')}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] leading-4 font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        Completar a ficha
      </p>
      <ul className="flex flex-wrap gap-2">
        {faltam.map((f) => (
          <li key={f.campo}>
            <button
              type="button"
              onClick={() => abrir(f.campo)}
              className="toque inline-flex h-11 items-center gap-1.5 rounded-full border border-dashed border-foreground/25 pr-3.5 pl-2.5 text-[13px] text-muted-foreground transition-colors outline-none hover:border-foreground/45 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8"
            >
              <Plus className="size-3.5" aria-hidden="true" strokeWidth={2} />
              {f.rotulo}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
