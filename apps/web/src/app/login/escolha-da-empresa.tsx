import { Check } from 'lucide-react';

import type { EmpresaSlug } from '@komune/schema/empresas';

import { VOLTA_DO_APP } from '@/lib/auth/entrada-pelo-app';
import { DESTINOS_DO_SELETOR } from '@/lib/empresa';
import { cn } from '@/lib/utils';

/**
 * A escolha da empresa no login do app de celular (05/11/2026).
 *
 * No navegador, cada empresa é um endereço, e quem trabalha na Imova abre o endereço da
 * Imova. O app abre um endereço só, então a escolha vem para a tela de login: tocar na
 * outra empresa abre o login DELA. Quem decide se a pessoa entra é aquele login, como no
 * navegador (e-mail fora da lista ou sem perfil é recusado lá). A casca guarda a última
 * empresa em que a pessoa entrou e abre nela da próxima vez (`apps/app/src/empresa.ts`).
 *
 * Cada empresa aparece com a SUA logo (pedido do usuário em 06/11/2026), sobre um cartão
 * claro nos dois temas: as cores das marcas (o verde e o laranja) somem sobre o fundo
 * escuro do login. A escolhida ganha o contorno e o sinal de marcado.
 *
 * Só no app (`noApp` da tela de login): no navegador a tela segue como está.
 */

type Logo = {
  src: string;
  largura: number;
  altura: number;
  /** A Imova é um logotipo com o nome; a KOMUNE é um símbolo, que vai com o nome ao lado. */
  comNome: boolean;
};

const LOGOS: Partial<Record<EmpresaSlug, Logo>> = {
  komune: { src: '/marca/komune.png', largura: 160, altura: 160, comNome: true },
  imova: { src: '/marca/imova.png', largura: 640, altura: 238, comNome: false },
};

export function EscolhaDaEmpresa({ next }: { next: string }) {
  if (DESTINOS_DO_SELETOR.length < 2) return null;
  const sufixo = next && next !== VOLTA_DO_APP ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <nav aria-label="Empresa" className="mb-6">
      <p className="mb-2 text-xs font-medium text-grafite-500 dark:text-grafite-450">
        Entrar na empresa
      </p>
      <div className="grid auto-cols-fr grid-flow-col gap-2">
        {DESTINOS_DO_SELETOR.map((destino) => {
          const conteudo = <MarcaDaEmpresa slug={destino.slug} nome={destino.nome} />;
          const cartao =
            'relative flex h-16 min-w-0 items-center justify-center rounded-2xl bg-white px-3 transition';
          return destino.atual ? (
            <span
              key={destino.slug}
              aria-current="page"
              className={cn(cartao, 'ring-2 ring-foreground ring-offset-2 ring-offset-background')}
            >
              {conteudo}
              <span
                aria-hidden="true"
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
              >
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            </span>
          ) : (
            <a
              key={destino.slug}
              href={`${destino.url}/login${sufixo}`}
              className={cn(cartao, 'toque ring-1 ring-black/5 hover:brightness-95')}
            >
              {conteudo}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

function MarcaDaEmpresa({ slug, nome }: { slug: EmpresaSlug; nome: string }) {
  const logo = LOGOS[slug];
  if (!logo) return <span className="truncate text-sm font-medium text-grafite-900">{nome}</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- arquivo fixo, já no dobro do tamanho em que aparece: o CRM não usa o otimizador de imagens da Vercel. */}
      <img
        src={logo.src}
        width={logo.largura}
        height={logo.altura}
        alt={logo.comNome ? '' : nome}
        className={cn('w-auto shrink-0', logo.comNome ? 'h-8 rounded-lg' : 'h-8')}
      />
      {logo.comNome ? (
        <span className="truncate text-[15px] font-semibold text-grafite-900">{nome}</span>
      ) : null}
    </span>
  );
}

/** Quando o login recusou, no app: talvez o acesso da pessoa seja na outra empresa. */
export const DICA_DA_OUTRA_EMPRESA =
  DESTINOS_DO_SELETOR.length >= 2
    ? 'Se o seu acesso é em outra empresa, escolha a empresa acima e entre de novo.'
    : null;
