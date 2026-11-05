import { Check } from 'lucide-react';

import { VOLTA_DO_APP } from '@/lib/auth/entrada-pelo-app';
import { DESTINOS_DO_SELETOR } from '@/lib/empresa';

/**
 * A escolha da empresa no login do app de celular (05/11/2026).
 *
 * No navegador, cada empresa é um endereço, e quem trabalha na Imova abre o endereço da
 * Imova. O app abre um endereço só, então a escolha vem para a tela de login: tocar na
 * outra empresa abre o login DELA. Quem decide se a pessoa entra é aquele login, como no
 * navegador (e-mail fora da lista ou sem perfil é recusado lá). A casca guarda a última
 * empresa em que a pessoa entrou e abre nela da próxima vez (`apps/app/src/empresa.ts`).
 *
 * Só no app (`noApp` da tela de login): no navegador a tela segue como está.
 */
export function EscolhaDaEmpresa({ next }: { next: string }) {
  if (DESTINOS_DO_SELETOR.length < 2) return null;
  const sufixo = next && next !== VOLTA_DO_APP ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <nav aria-label="Empresa" className="mb-6">
      <p className="mb-2 text-xs font-medium text-grafite-500 dark:text-grafite-450">
        Entrar na empresa
      </p>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-full border border-border bg-card p-1">
        {DESTINOS_DO_SELETOR.map((destino) =>
          destino.atual ? (
            <span
              key={destino.slug}
              aria-current="page"
              className="flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full bg-foreground px-3 text-sm font-medium text-background"
            >
              <Check className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{destino.nome}</span>
            </span>
          ) : (
            <a
              key={destino.slug}
              href={`${destino.url}/login${sufixo}`}
              className="toque flex h-11 min-w-0 items-center justify-center rounded-full px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="truncate">{destino.nome}</span>
            </a>
          ),
        )}
      </div>
    </nav>
  );
}

/** Quando o login recusou, no app: talvez o acesso da pessoa seja na outra empresa. */
export const DICA_DA_OUTRA_EMPRESA =
  DESTINOS_DO_SELETOR.length >= 2
    ? 'Se o seu acesso é em outra empresa, escolha a empresa acima e entre de novo.'
    : null;
