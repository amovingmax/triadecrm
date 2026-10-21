# Comparar versões e medir velocidade

Duas perguntas antes de qualquer publicação que mexa em telas que a KOMUNE já usa:

1. **O que existia continua igual?** `apps/web/scripts/comparar-versoes.mjs`
2. **Ficou mais lento?** `apps/web/scripts/medir-velocidade.mjs`

As duas rodam no seu computador, contra o banco **local** (`supabase start`), com builds de produção. Nunca contra a produção: a sessão de teste (`sessao-dev.mjs`) só existe no banco local.

## Passo a passo

**1. A referência (A): a versão que está no ar**, numa cópia limpa do commit, porta 3200.

```bash
git worktree add --detach ../triadecrm-ref <commit-no-ar>
cd ../triadecrm-ref && pnpm install --offline --frozen-lockfile
cp ../triadecrm/apps/web/.env.local apps/web/.env.local
cd apps/web
NEXT_DIST_DIR=.next-ref pnpm exec next build
NEXT_DIST_DIR=.next-ref pnpm exec next start -p 3200
```

**2. A versão nova (B)**, na branch da mudança, porta 3201: o mesmo `build` e `start`, com `NEXT_DIST_DIR=.next-nova` e `-p 3201`.

**3. O banco local** com as migrações da branch nova. A referência precisa continuar funcionando com elas, porque é isso que acontece em produção entre a migração e o deploy (ver "Migrações em dois tempos" no plano).

**4. Comparar**, de `apps/web` da branch nova:

```bash
node scripts/comparar-versoes.mjs lado-a-lado --a http://localhost:3200 --b http://localhost:3201
```

O relatório sai em `~/triadecrm-capturas/<data>/relatorio.md`, e as fotos marcadas em `diferencas/`. Código de saída 1 = reprovado.

**5. Medir**, depois de comparar (as duas juntas disputam o processador e distorcem os tempos):

```bash
node scripts/medir-velocidade.mjs --a http://localhost:3200 --b http://localhost:3201 --rodadas 4
```

O resultado sai em `~/triadecrm-medicoes/<data>/velocidade.md`.

Use `localhost`, e não `127.0.0.1`: é o domínio dos cookies da sessão de teste.

## O que a comparação olha

São 22 telas, como gestor e como SDR, no PC (1440×900) e no celular (390×844, toque): 88 por versão. Os códigos de ficha, de lote e de conversa vêm do banco local (`banco-local.mjs`).

| Reprova (código 1) | Vai para "conferir" |
|---|---|
| endereço final diferente | título diferente |
| status HTTP diferente | linha de texto que só existe de um lado |
| itens visíveis do menu diferentes | foto com mais de 0,5% dos pixels diferentes |
| erro de JavaScript, aviso de console ou resposta ≥ 400 que só existe em B | |

**Ruído conhecido.** Estas diferenças aparecem mesmo sem mudança no código:
- o relógio ("há 8 h"), que a comparação de texto já ignora;
- o lote, porque abrir um lote reserva o próximo contato;
- a conversa aberta, porque abrir uma conversa marca como lida.

As duas versões são visitadas intercaladas, tela a tela, para o banco mudar o mínimo entre uma visita e outra.

## Linha de base guardada

`~/triadecrm-capturas/2026-10-21-main-c4b08eb` (15 MB): a `main` que estava no ar em 21/10/2026 (deploy `triade-5jll2hsyh`), comparada consigo mesma em duas portas. É o retrato de referência antes da etapa 2 do plano multiempresa.

- **Resultado:** 88 de 88 telas iguais, sem ruído. Nenhuma tela caiu no login. Nenhum erro de JavaScript, aviso de console ou resposta com erro na versão no ar.
- **Leitura:** qualquer diferença numa comparação futura vem da mudança, ou de dado que ela mesma criou no banco local.
- **Controle:** num teste com defeitos plantados em três telas (linha de texto nova e foto trocada no Funis, Metas caindo no login, erro de JavaScript na Revisão), a ferramenta acusou todos e saiu com código 1. Sem os defeitos, saiu com código 0.

`~/triadecrm-medicoes/2026-10-21-main-c4b08eb`: os tempos da mesma versão, no celular com 4G e CPU 4×. Medianas de 4 rodadas, em ms:

| Toque | Gestor: pronto | SDR: pronto | Resposta ao toque |
|---|---|---|---|
| 1ª abertura do Meu dia | 977 | 982 | — |
| Prospectados | 163 | — | 25 |
| Abrir a ficha | 539 | — | 23 |
| Voltar à lista | 116 | — | 16 |
| Conversas | 139 | — | 18 |
| Lotes | 72 | 84 | 23–26 |
| Abrir o lote | 448 | 444 | 15–22 |
| Meu dia de novo | 117 | 103 | 16–18 |

O código baixado na 1ª abertura (797 KB para o gestor, 762 KB para o SDR) inclui o código das outras telas, que o CRM adianta enquanto o aparelho está ocioso. Não é só o Meu dia. Nenhum erro na tela em nenhuma rodada.
