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
| `worker-rotas`   | `workers`      | Ordem das visitas da tarde no OSRM e geocodificação (RF-ROT)         | —                |
| `metabase`       | (padrão)       | Painéis do PRD §7.8 (RF-REL)                                        | `127.0.0.1:3001` |
| `faster-whisper` | (padrão)       | Transcrição pt-BR do áudio recebido (RF-MET-07)                     | interna `9000`   |
| `osrm`           | `rotas`        | Matriz de tempos e ordem das visitas da tarde (RF-ROT-03)           | interna `5000`   |
| `osrm-preparo`   | `osrm-preparo` | Tarefa única: `.osm.pbf` → grafo do OSRM                            | —                |
| `cloudflared`    | `tunel`        | Opcional: Metabase fora do tailnet                                  | —                |
| `maps-scraper`   | `maps`         | Lista de prospecção raspada do Google Maps (ADR-12)                 | `127.0.0.1:8080` |

**Nenhum serviço abre porta para a internet.** A recepção de webhook (Meta, Komune) fica nas
Edge Functions do Supabase, que enfileiram em `pgmq`; aqui só se **consome** fila. Os dois
únicos `ports:` do arquivo — Metabase e `maps-scraper` — ficam presos em `127.0.0.1`; de fora
chega-se pela Tailscale.

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
- `data/maps/saida/` — CSV de cada rodada do `maps-scraper`. **É base de dados pessoais**:
  apague o arquivo assim que a importação terminar (passo 7 abaixo).

### Raspar o Google Maps (perfil `maps`, ADR-12)

A lista de prospecção vem daqui: o `gosom/google-maps-scraper` (MIT) devolve CSV **com
telefone**, e o CSV entra pela porta da planilha — nenhum caminho novo de escrita para a
base (ADR-08). Na máquina do Rafael a mesma coisa é operada pelo `google-maps-scraper-kit`,
um invólucro de conveniência do mesmo binário.

Isto **contraria os Termos de Serviço do Google** e revoga por escrito a recusa do
R06 §B.1 SCR-04. É decisão do Rafael de 24/09/2026, com o risco registrado em
`sources.terms_notes` da fonte `google_maps_raspado`. O que continua valendo, e é o que
limita o dano: sem login, sem burla de CAPTCHA, sem proxy rotativo, user-agent
identificado, 1 requisição a cada 5 s. Limite de conduta: **2 rodadas por semana, 600
lugares por rodada, só Natal e região metropolitana**. Deu bloqueio de IP ou CAPTCHA:
**pare e avise** — insistir com proxy ou login transforma quebra de contrato em acesso não
autorizado.

O ritmo de 5 s é **conduta de quem opera**, não flag: `-c 1` limita a concorrência a uma
aba por vez e não impõe intervalo nenhum. Se uma versão da imagem passar a ter flag de
atraso, ela entra no `command:` e este parágrafo muda.

O CRM **não** chama este contêiner. A web roda na Vercel e o `worker-wa` no Fly.io, e
nenhum dos dois alcança `127.0.0.1` em Natal. Com uma pessoa no meio, quem sobe o arquivo
nomeia o lote, lê a prévia e fica registrado em `import_batches.triggered_by`: a raspagem
vira decisão auditável em vez de cron silencioso.

```bash
# 1. subir (só durante a rodada; o perfil NÃO entra no COMPOSE_PROFILES do .env)
mkdir -p data/maps/saida
docker compose -f docker-compose.yml --profile maps up -d
open http://127.0.0.1:8080

# 2. pedir ao Claude Code a consulta: categoria + cidade ("buffet infantil em Natal RN"),
#    teto de 600 lugares, ritmo de 5 s

# 3. o kit escreve em ./data/maps/saida/, por exemplo:
ls data/maps/saida

# 7. terminada a importação, derrubar e APAGAR o arquivo
docker compose -f docker-compose.yml --profile maps down
rm data/maps/saida/*.csv
```

Entre os passos 3 e 7, no CRM: abrir `/importar`, escolher **Google Maps (raspagem local)**
no seletor de origem, arrastar o CSV, conferir o mapa de colunas (a tela diz se cada acerto
foi `exato` ou `parecido`), ler a prévia — quantas entram, quantas são duplicata **de quem**,
quantas vão para revisão, quantas pediram para parar — e gravar. 600 linhas cabem sem
ajuste: o cliente fatia em 200 para a prévia e 100 para a gravação.

**O passo 7 não é zelo.** Enquanto o CSV existe na pasta, é uma base de dados pessoais fora
do CRM: sem retenção, sem RLS e sem auditoria.

### Desenvolvimento: alcançar o OSRM de fora do Docker

Nesta máquina o OSRM **não publica porta** (é assim que ele fica fora do alcance da LAN e da
internet): quem fala com ele é o `worker-rotas`, pela rede do Compose. Quando o worker roda
FORA do Docker — `pnpm -C apps/workers dev` na máquina de quem programa — não existe essa
rede, e aí entra a sobreposição de desenvolvimento, que prende a porta em `127.0.0.1`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile rotas up -d osrm
curl 'http://127.0.0.1:5000/route/v1/driving/-35.1858,-5.8811;-35.2094,-5.7945?overview=false'
# e no ambiente do worker: OSRM_URL=http://127.0.0.1:5000
```

`docker-compose.dev.yml` **não é para subir aqui na máquina do Luiz**: lá o arquivo de
produção basta, e abrir porta é exatamente o que ele evita.

### Geocodificar a base (uma vez, e a cada bairro novo)

```bash
docker compose exec worker-rotas node dist/index.js rotas --geocodificar
```

Faz uma passada pelo Nominatim do OpenStreetMap, a **1 requisição por segundo** (a política
deles), com o `NOMINATIM_USER_AGENT` do `./.env` identificando a aplicação. Pergunta uma vez
por bairro, não uma vez por ficha: a base inteira de hoje são 21 perguntas, ~35 s. O resultado
fica em `public.geo_places` e não é perguntado de novo.

Preparar o grafo do OSRM (uma vez, e de novo quando quiser mapa mais novo):

```bash
curl -fL --create-dirs -o data/osrm/rio-grande-do-norte-latest.osm.pbf \
  https://download.openstreetmap.fr/extracts/south-america/brazil/northeast/rio-grande-do-norte-latest.osm.pbf
docker compose --profile osrm-preparo run --rm osrm-preparo
docker compose --profile rotas up -d osrm
```
