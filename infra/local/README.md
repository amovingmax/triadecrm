# infra/local — a máquina dedicada

Docker Compose do que roda **fora da nuvem**, na máquina dedicada (ADR-04: recepção em nuvem,
processamento local). Se você é o Luiz e está montando a máquina do zero, o documento é outro:
[`docs/operacao/maquina-do-luiz.md`](../../docs/operacao/maquina-do-luiz.md). Este README é a
referência curta para quem desenvolve.

## O que sobe aqui

| Serviço          | Perfil         | Para quê                                                            | Porta            |
| ---------------- | -------------- | ------------------------------------------------------------------- | ---------------- |
| `worker-ingest`  | `workers`      | Radar: scrapers, planilhas, base CNPJ (D4, RF-RAD)                  | —                |
| `worker-wa`      | `workers`      | WhatsApp Cloud API: envios, cadências, áudios (D5, RF-CON)          | —                |
| `worker-ai`      | `workers`      | Haiku 4.5 e Sonnet 5: classificação, rascunhos, Assistente (ADR-10) | —                |
| `metabase`       | (padrão)       | Painéis do PRD §7.8 (RF-REL)                                        | `127.0.0.1:3001` |
| `faster-whisper` | (padrão)       | Transcrição pt-BR do áudio recebido (RF-MET-07)                     | interna `9000`   |
| `osrm`           | `rotas`        | Matriz de tempos e ordem das visitas da tarde (RF-ROT-03)           | interna `5000`   |
| `osrm-preparo`   | `osrm-preparo` | Tarefa única: `.osm.pbf` → grafo do OSRM                            | —                |
| `cloudflared`    | `tunel`        | Opcional: Metabase fora do tailnet                                  | —                |

**Nenhum serviço abre porta para a internet.** A recepção de webhook (Meta, Komune) fica nas
Edge Functions do Supabase, que enfileiram em `pgmq`; aqui só se **consome** fila. O único
`ports:` do arquivo é o do Metabase, preso em `127.0.0.1` — de fora chega-se pela Tailscale.

## Comandos

```bash
cd infra/local
cp .env.example .env                     # ajustes só desta máquina (sem segredo nenhum)

docker compose build                     # imagem dos workers (apps/workers/Dockerfile, contexto = raiz)
docker compose up -d                     # perfis do COMPOSE_PROFILES do .env
docker compose ps                        # STATUS mostra (healthy) / (unhealthy)
docker compose logs -f worker-ingest
docker compose restart worker-wa         # reinicia um serviço só
docker compose down                      # derruba (dados em ./data ficam)

# Uma verificação de saúde, na mão, com a mensagem de erro por extenso:
docker compose exec worker-ingest node /opt/healthchecks/worker-heartbeat.mjs ingest
docker compose exec faster-whisper python3 /opt/healthchecks/whisper-transcreve.py
```

> `docker compose config` **imprime o conteúdo dos `env_file`** — ou seja, as chaves de produção.
> Nunca cole essa saída num chat, issue ou PR. Para conferir só a sintaxe:
> `docker compose config --no-env-resolution -q`.

## Healthchecks: por que não são checagem de porta

Cada um verifica o trabalho, não o socket. Uma porta aberta engana:

- **workers** — o script pergunta ao Supabase se aquele worker bateu ponto em
  `public.worker_heartbeats` nos últimos `WORKER_HEARTBEAT_MAX_AGE_S` segundos (600 por padrão,
  o mesmo limite do alerta do RF-ADM-07). Cobre processo + rede + credencial + trabalho de
  verdade de uma vez: worker vivo sem internet, com `service_role` errada ou travado num laço
  aparece como `unhealthy`.
- **metabase** — `GET /api/health` **e** `grep '"status":"ok"'` no corpo. A porta 3000 abre
  antes de o banco interno migrar; o corpo só vira `ok` quando a aplicação está de fato pronta.
- **osrm** — calcula uma rota real dentro de Natal (Ponta Negra → Cidade Alta) e exige
  `"code":"Ok"`. Se o grafo não carregou, o `osrm-routed` responde na porta e devolve erro.
- **faster-whisper** — manda 0,4 s de áudio para `/asr` e exige transcrição de volta. O FastAPI
  responde na 9000 muito antes de o modelo carregar; só a transcrição prova que dá para usar.
- **cloudflared** — não tem. A imagem é distroless (sem shell), então nada roda de dentro dela.
  Confira de fora, pela rede do Compose: `docker compose exec metabase curl -fsS http://cloudflared:2000/ready`.

Os scripts estão em [`healthchecks/`](healthchecks) e são montados nos contêineres em
`/opt/healthchecks:ro`. Só usam o que já existe na imagem (Node 22 nos workers, Python 3.10 no
whisper): nada é instalado dentro do contêiner.

## Segredos

| Arquivo                        | Guarda                                                      | No git? |
| ------------------------------ | ----------------------------------------------------------- | ------- |
| `../../.env`                   | Supabase, Meta/WhatsApp, Anthropic, HMAC da Komune          | não     |
| `../../.env.example`           | os nomes das variáveis acima, sem valor                     | sim     |
| `infra/local/.env`             | perfis, porta do Metabase, limites de memória (sem segredo) | não     |
| `infra/local/.env.example`     | modelo do anterior                                          | sim     |
| `infra/local/.env.cloudflared` | `TUNNEL_TOKEN` (só com o perfil `tunel`)                    | não     |

## Dados locais (`./data`, gitignored)

- `data/metabase/` — banco interno do Metabase (H2). É o que se copia num backup.
- `data/osrm/` — `.osm.pbf` do Rio Grande do Norte e o grafo gerado (~280 MB).
- `data/whisper/` — cache do modelo (~500 MB no `small`), baixado na primeira transcrição.

Preparar o grafo do OSRM (uma vez, e de novo quando quiser mapa mais novo):

```bash
curl -fL --create-dirs -o data/osrm/rio-grande-do-norte-latest.osm.pbf \
  https://download.openstreetmap.fr/extracts/south-america/brazil/northeast/rio-grande-do-norte-latest.osm.pbf
docker compose --profile osrm-preparo run --rm osrm-preparo
docker compose --profile rotas up -d osrm
```
