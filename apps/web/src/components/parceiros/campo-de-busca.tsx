'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * A caixa de busca das listas (Prospectados e Revisão).
 *
 * Uma caixa só: nome, telefone em qualquer formato, @instagram, CNPJ ou bairro caem
 * no mesmo campo, porque em campo ninguém escolhe o tipo do que copiou do WhatsApp
 * antes de colar (RF-BAS-12). O texto vai para a tela com 300ms de atraso: rápido o
 * bastante para parecer instantâneo, lento o bastante para não mandar uma consulta
 * por tecla no 4G da rua.
 *
 * O rótulo é de leitor de tela e a lista de formatos aceitos é o placeholder; o
 * `aria-describedby` continua apontando para a dica, que segue no documento depois
 * que o placeholder some na primeira tecla.
 *
 * Desde o protótipo responsivo (24/11/2026) ela ocupa a largura toda, com o botão
 * Filtros ao lado, e tem a altura dos outros controles: 44px no celular, 40px no
 * computador.
 */
export function CampoDeBusca({
  valor,
  aoMudar,
  rotulo,
  placeholder,
  dica,
  className,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  /** O rótulo do leitor de tela ("Buscar parceiro"). */
  rotulo: string;
  placeholder: string;
  /** A frase inteira dos formatos aceitos, lida pelo leitor de tela. */
  dica: string;
  className?: string;
}) {
  const id = useId();
  const [texto, setTexto] = useState(valor);
  const ultimoEnviado = useRef(valor);

  // Espelha uma mudança vinda de fora (o botão "Limpar", por exemplo) sem
  // atropelar o que a pessoa está digitando.
  useEffect(() => {
    if (valor !== ultimoEnviado.current) {
      ultimoEnviado.current = valor;
      setTexto(valor);
    }
  }, [valor]);

  useEffect(() => {
    if (texto === ultimoEnviado.current) return;
    const relogio = window.setTimeout(() => {
      ultimoEnviado.current = texto;
      aoMudar(texto);
    }, 300);
    return () => window.clearTimeout(relogio);
  }, [texto, aoMudar]);

  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <label htmlFor={id} className="sr-only">
        {rotulo}
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={id}
        type="search"
        inputMode="search"
        autoComplete="off"
        enterKeyHint="search"
        placeholder={placeholder}
        aria-describedby={`${id}-dica`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        // `pr-12` e o X nativo do `type="search"` escondido (16/11/2026): o texto
        // corria por baixo do nosso "limpar", e o X azul do navegador aparecia
        // encavalado nele, dois "limpar" um em cima do outro. `text-ellipsis`: o
        // placeholder comprido termina em reticências em vez de cortado no meio.
        className="h-11 bg-card pr-12 pl-10 text-ellipsis md:h-10 md:pr-10 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {texto ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setTexto('')}
          className="absolute top-1/2 right-0 size-11 -translate-y-1/2 md:right-1 md:size-8"
        >
          <X aria-hidden="true" />
          <span className="sr-only">Limpar a busca</span>
        </Button>
      ) : null}
      <p id={`${id}-dica`} className="sr-only">
        {dica}
      </p>
    </div>
  );
}
