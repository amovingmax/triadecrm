# infra/local — máquina dedicada

Docker Compose dos serviços que rodam na máquina dedicada (Luiz), fora da nuvem: os três workers e o Metabase OSS. A recepção (webhooks da Meta e da Komune) fica nas Edge Functions do Supabase; aqui só se **consome** as filas `pgmq` quando os workers estão ligados (ADR-04).

## Pré-requisitos

- Docker Engine com Compose v2 (Linux) ou OrbStack/Docker Desktop (macOS).
- `.env` preenchido na raiz do repositório (modelo em `.env.example`). Segredos nunca entram no git.
- Saída para a internet (Supabase, Meta, Anthropic). Nenhuma porta de entrada é aberta: administração pela Tailscale; Cloudflare Tunnel só se for expor o Metabase (R05).

## Comandos

```bash
cd infra/local
docker compose build                       # imagem dos workers (apps/workers/Dockerfile, contexto = raiz)
docker compose up -d                       # Metabase em http://localhost:3001
docker compose --profile workers up -d     # + worker-ingest, worker-wa, worker-ai
docker compose ps
docker compose logs -f worker-ingest
docker compose --profile workers down
```

Os workers ficam atrás do profile `workers` porque, até D4/D5/D6, só registram um heartbeat e encerram.

## Metabase

- Porta `3001` (mapeada para a `3000` do contêiner). Dados em `./data/metabase` (gitignored).
- Conexão ao banco do CRM sempre com role **somente leitura** (R05): em desenvolvimento, `host.docker.internal:54322`, banco `postgres`, usuário `postgres`, senha `postgres`; em produção, o pooler do Supabase em modo sessão com a role de leitura das migrações.
- Idioma `pt_BR` e fuso `America/Fortaleza` já configurados.

## Ainda por vir

- `osrm`/`vroom` para rotas de visita (D7, RF-ROT) e `faster-whisper` para transcrição de áudio recebido (v2).
- `cloudflared` (opcional) para expor o Metabase à equipe.
