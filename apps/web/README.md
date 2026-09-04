# apps/web — KOMUNE CRM (Next.js 16)

Aplicação web do CRM: App Router, TypeScript, Tailwind v4, shadcn/ui (Radix, tema neutro), PWA
instalável e mobile-first nas telas de campo (PRD §8). Textos em pt-BR.

## Rodar

```bash
# na raiz do monorepo
source scripts/dev-env.sh          # Node 22 + Docker do OrbStack
supabase start                     # stack local (API 54321, Postgres 54322)
cp apps/web/.env.example apps/web/.env.local   # e cole a anon key de `supabase status`
pnpm install
pnpm dev                           # http://localhost:3000
```

Scripts do pacote (`pnpm --filter web <script>`): `dev`, `build`, `start`, `lint`, `typecheck`
(`next typegen && tsc --noEmit`), `test` (Vitest).

## Variáveis de ambiente

Só variáveis públicas (`NEXT_PUBLIC_*`); nunca a `service_role`. Modelo em `.env.example`:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`.

## Autenticação (RF-ADM-01)

- `src/proxy.ts` (convenção do Next 16 que substitui `middleware.ts`) renova a sessão a cada requisição e
  redireciona quem não está logado para `/login` (exceto `/login`, `/auth/*` e assets).
- `/login` → `signInWithOAuth({ provider: 'google' })` → `/auth/callback` (`exchangeCodeForSession`) →
  destino (`?next=`, sempre um caminho interno) ou `/meu-dia`. `/auth/signout` (POST) encerra a sessão.
- Papel: `src/lib/auth/role.ts` lê `app_metadata.app_role` do JWT (injetado pelo Custom Access Token
  Hook a partir de `profiles.role`; `user_metadata` é ignorado), com fallback `leitura`.
  `requireSession()` / `requireRole('admin', 'gestor')` em `src/lib/auth/session.ts` protegem páginas.
- Para o login Google funcionar na stack local, o provedor precisa estar habilitado em
  `supabase/config.toml` (`[auth.external.google]`, com `client_id`/`secret` lidos de `supabase/.env`) e
  `http://localhost:3000/auth/callback` na lista `additional_redirect_urls`.

## Estrutura

```
src/proxy.ts                 sessão + proteção de rotas
src/app/layout.tsx           html lang="pt-BR", metadata, viewport, Toaster, TooltipProvider
src/app/manifest.ts          manifest da PWA (/manifest.webmanifest)
src/app/login, src/app/auth  login Google, callback e signout
src/app/(app)/*              área autenticada: meu-dia, parceiros, funis, conversas, radar, agenda,
                             metas, relatorios, admin (admin/gestor), sem-permissao
src/components/layout        AppShell, Sidebar (desktop), BottomNav + menu "Mais" (celular), Header, UserMenu
src/components/ui            shadcn/ui (button, input, label, card, table, badge, avatar, dropdown-menu,
                             dialog, sheet, select, field, skeleton, sonner, separator, tooltip)
src/lib/navegacao.ts         itens de navegação, ícones (lucide) e dia de entrega (PRD §11.2)
src/lib/supabase             clientes browser / server / middleware (@supabase/ssr)
public/icons                 ícones da PWA; regenerar com `node scripts/gerar-icones.mjs`
```

Componentes novos entram com `pnpm dlx shadcn@latest add <nome>` de dentro de `apps/web`.
