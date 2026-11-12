import type { ReactNode } from 'react';

/**
 * As peças das páginas de texto abertas sem login: a política de privacidade da
 * empresa (`/privacidade`) e as páginas do app de celular (`/aplicativo`). Mesma
 * tipografia nas três, para quem chega por um link da loja ou da Meta ler igual.
 */

export function Secao({
  id,
  titulo,
  children,
}: {
  id: string;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-6">
      <h2 className="font-heading text-lg font-semibold">{titulo}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-7">{children}</div>
    </section>
  );
}

export function Lista({ itens, ordenada = false }: { itens: ReactNode[]; ordenada?: boolean }) {
  const Tag = ordenada ? 'ol' : 'ul';
  return (
    <Tag className={`space-y-2 pl-5 ${ordenada ? 'list-decimal' : 'list-disc'}`}>
      {itens.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </Tag>
  );
}

export function Email({ endereco }: { endereco: string }) {
  return (
    <a className="underline underline-offset-4" href={`mailto:${endereco}`}>
      {endereco}
    </a>
  );
}

export function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="underline underline-offset-4" href={href}>
      {children}
    </a>
  );
}
