# A máquina dedicada do TRÍADE — montar do zero e manter de pé

Este documento é para o **Luiz**. Não presume nada sobre o projeto: dá para seguir de cima a
baixo sem saber o que é o TRÍADE. Cada passo tem o comando e o que você deve ver na tela.

Se algo já parou de funcionar e você só quer resolver, pule para
[§10 — Quando parar de funcionar](#10-quando-parar-de-funcionar).

---

## 1. O que essa máquina é (e o que ela não é)

O TRÍADE é o CRM de captação de fornecedores da Komune. Ele mora na nuvem (Supabase + Vercel)
e é ali que a Heloísa e o Matheus trabalham. **Esta máquina não é o CRM.** Ela é o operário:
puxa tarefas de uma fila que vive no banco na nuvem, faz o trabalho pesado e devolve o resultado.

O que roda aqui:

| Serviço          | O que faz                                                                       |
| ---------------- | ------------------------------------------------------------------------------- |
| `worker-ingest`  | Vasculha fontes públicas e planilhas atrás de fornecedores novos                 |
| `worker-wa`      | Manda e recebe as mensagens de WhatsApp pela API oficial da Meta                 |
| `worker-ai`      | Classifica respostas, escreve rascunhos e resumos com a IA                       |
| `metabase`       | Painéis e relatórios                                                             |
| `osrm`           | Calcula a ordem e o tempo das visitas da tarde                                   |
| `faster-whisper` | Transcreve para texto os áudios que os fornecedores mandam                       |

**O que essa máquina NÃO faz: receber conexão de fora.** Nenhuma porta é aberta no seu roteador,
nenhum `port forwarding`, nenhum IP fixo. Quem recebe os webhooks da Meta e da plataforma Komune
são funções que rodam na nuvem, do lado do Supabase; elas guardam o recado numa fila, e esta
máquina **vai buscar**. É uma decisão de arquitetura fechada do projeto (ADR-04), e é por isso
que dá para rodar isso num computador na sua casa sem transformá-lo em alvo.

**Se a máquina desligar, nada se perde.** As tarefas ficam esperando na fila, no banco, e são
processadas quando ela voltar. O que acontece é atraso: mensagem de fornecedor sem resposta,
áudio sem transcrever, painel desatualizado. Por isso o objetivo é que ela fique ligada — mas um
apagão de duas horas não é emergência.

---

## 2. O que você precisa antes de começar

**Hardware** (o mínimo confortável):

- 4 núcleos de CPU, **16 GB de RAM**, 100 GB de SSD.
  Com 8 GB dá para rodar, mas leia a nota de memória em `infra/local/.env.example` e reduza
  os limites antes de subir.
- Internet cabeada e um no-break. A máquina não precisa de IP fixo nem de porta aberta.

**Software**: **Ubuntu Server 24.04 LTS**, instalação limpa, com OpenSSH marcado no instalador.

**Acessos que você precisa pedir antes** (todos ao **Matheus**):

1. Acesso ao repositório `amovingmax/triadecrm` no GitHub (ou uma chave de deploy).
2. O arquivo **`.env`** com os segredos de operação (Supabase, WhatsApp, Anthropic). Ele **não**
   está no repositório de propósito. Peça por um canal privado — nunca por WhatsApp de grupo.

**Conta Tailscale** (grátis) para você e para o Matheus — §5.

---

## 3. Ubuntu: os ajustes de antes

Entre por SSH na máquina e rode, na ordem:

```bash
# Fuso horário — todo o CRM trabalha em horário de Natal; se a máquina estiver em outro fuso,
# as janelas de envio de WhatsApp e os relatórios saem na hora errada.
sudo timedatectl set-timezone America/Fortaleza
timedatectl        # confirme: Time zone: America/Fortaleza (-03)

# Atualizações de segurança sozinhas (a máquina fica ligada meses; ninguém vai lembrar)
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades curl git
sudo dpkg-reconfigure --priority=low unattended-upgrades   # responda "Sim"

# Firewall: nega tudo que vem de fora e libera só o SSH. Nada aqui precisa receber conexão
# da internet — o firewall é a segunda tranca, depois da de não publicar porta nenhuma.
sudo apt -y install ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw --force enable
sudo ufw status verbose      # confirme: Default: deny (incoming), allow (outgoing)
```

> **Atenção ao UFW com Docker:** o Docker escreve direto no `iptables` e passa por cima do UFW
> quando um contêiner publica porta. No nosso compose só um contêiner publica porta (o Metabase)
> e ele está preso em `127.0.0.1`, que o Docker **não** expõe para fora. Ou seja: a combinação
> está segura como está. Se um dia alguém trocar `127.0.0.1:3001:3000` por `3001:3000`, o painel
> vai para a LAN inteira sem o UFW reclamar. Não faça isso.

---

## 4. Docker

Repositório oficial da Docker (o `docker.io` do Ubuntu é velho e vem sem o Compose v2):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Rodar docker sem sudo (saia e entre de novo no SSH depois desta linha)
sudo usermod -aG docker "$USER"

# Subir sozinho quando a máquina ligar — é o que faz os serviços voltarem depois de um apagão
sudo systemctl enable --now docker
```

Confira (depois de reconectar o SSH):

```bash
docker version --format '{{.Server.Version}}'   # 27 ou mais novo
docker compose version                          # v2.x ou mais novo
docker run --rm hello-world                     # "Hello from Docker!"
```

---

## 5. Tailscale — para administrar sem abrir porta

**Por que:** você precisa entrar nessa máquina de onde estiver, e o Matheus precisa abrir o
Metabase. O jeito antigo seria abrir uma porta no roteador e torcer. A Tailscale monta uma rede
privada (VPN WireGuard) entre os seus aparelhos: a máquina **disca para fora** e passa a ter um
endereço que só quem está na sua rede enxerga. Nada é aberto no roteador, nada aparece num
scanner da internet, e o acesso morre no dia em que você remover o aparelho do painel.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname=triade-workers
tailscale ip -4        # anote este IP: 100.x.y.z
tailscale status
```

- `--ssh` faz o SSH passar pela Tailscale com a identidade da sua conta (sem senha, sem porta 22
  aberta). Depois que isso estiver funcionando, dá para tirar o `allow OpenSSH` do UFW.
- Convide o Matheus para o tailnet (painel da Tailscale → *Users* → *Invite*), ou compartilhe só
  esta máquina com ele (*Machines* → `triade-workers` → *Share*).

**Publicar o Metabase no tailnet** — depois que ele estiver de pé (§8):

```bash
sudo tailscale serve --bg 3001
tailscale serve status     # mostra a URL https://triade-workers.<seu-tailnet>.ts.net
```

Isso pega o Metabase, que está preso em `127.0.0.1:3001`, e entrega com HTTPS **só** para quem
está no tailnet. Continua sem porta aberta para a internet.

---

## 6. Clonar o repositório

```bash
mkdir -p ~/apps && cd ~/apps
git clone git@github.com:amovingmax/triadecrm.git triade
cd ~/apps/triade
```

Se o `git clone` pedir senha, é porque a máquina ainda não tem chave. Gere uma e mande a parte
pública para o Matheus cadastrar como *deploy key* (só leitura) no repositório:

```bash
ssh-keygen -t ed25519 -C "triade-workers" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub      # mande ESTA linha para o Matheus (é a pública; pode circular)
```

---

## 7. Os dois arquivos de configuração

São dois, e a diferença importa:

### 7.1 `.env` na raiz — os segredos (vem do Matheus)

```bash
cd ~/apps/triade
cp .env.example .env
nano .env          # cole os valores que o Matheus mandou
chmod 600 .env     # só o seu usuário lê
```

O que **precisa** estar preenchido para os workers subirem:

| Variável                    | Quem entrega | Para quê                          |
| --------------------------- | ------------ | --------------------------------- |
| `SUPABASE_URL`              | Matheus      | endereço do banco na nuvem        |
| `SUPABASE_SERVICE_ROLE_KEY` | Matheus      | credencial dos workers            |
| `META_WA_ACCESS_TOKEN`      | você/Meta    | mandar WhatsApp (`worker-wa`)     |
| `META_WA_PHONE_NUMBER_ID`   | você/Meta    | número da Heloísa (`worker-wa`)   |
| `ANTHROPIC_API_KEY`         | Matheus      | a IA (`worker-ai`)                |

Se faltar alguma, o worker correspondente **não sobe** e escreve no log exatamente qual é —
essa é a mensagem que começa com `Ambiente inválido para o worker`.

> Esse arquivo tem chave de produção. Nunca commite, nunca cole em chat, nunca mande por e-mail.
> Ele está no `.gitignore`, então o `git` já se recusa a versioná-lo — mas o cuidado é seu.

### 7.2 `infra/local/.env` — os ajustes só desta máquina

```bash
cd ~/apps/triade/infra/local
cp .env.example .env
nano .env
```

Aqui **não tem segredo nenhum**: só quais serviços subir, a porta do Metabase e quanta memória
cada contêiner pode usar. O arquivo é comentado linha a linha. O que você provavelmente vai mexer:

```ini
COMPOSE_PROFILES=workers    # acrescente ",rotas" depois de preparar o mapa (§8.1), não antes
METABASE_PORT=3001
MEM_WHISPER=3g              # numa máquina de 8 GB, baixe para 2g
```

Ligar o perfil `rotas` antes de preparar o mapa deixa o `osrm` reiniciando em laço — por isso a
ordem é: subir sem ele (§8), preparar o mapa (§8.1), e só então acrescentá-lo.

---

## 8. Subir

```bash
cd ~/apps/triade/infra/local

docker compose build      # constrói a imagem dos workers (na primeira vez demora ~5 min)
docker compose up -d      # sobe o que estiver em COMPOSE_PROFILES
docker compose ps
```

Espere uns dois minutos e rode `docker compose ps` de novo. **O que você quer ver:**

```
SERVICE          STATUS
faster-whisper   Up 3 minutes (healthy)
metabase         Up 3 minutes (healthy)
worker-ai        Up 3 minutes (healthy)
worker-ingest    Up 3 minutes (healthy)
worker-wa        Up 3 minutes (healthy)
```

O que cada palavra quer dizer:

| Status                   | Significado                                                                |
| ------------------------ | -------------------------------------------------------------------------- |
| `Up ... (healthy)`       | Funcionando de verdade. É o único estado bom.                              |
| `Up ... (health: starting)` | Ainda subindo. Normal nos primeiros minutos (no whisper, até 15 min).   |
| `Up ... (unhealthy)`     | O processo está de pé mas **não está trabalhando**. Vá para a §10.         |
| `Restarting (1)`         | Está caindo e voltando em laço. Vá para a §10.                             |
| `Exited (0)`             | Terminou e não voltou. Vá para a §10.                                      |

`healthy` aqui não é "a porta abriu". Cada serviço tem uma verificação que faz o trabalho de
verdade — o worker é dado como saudável só quando **bateu ponto no banco na nuvem**, o OSRM só
quando **calcula uma rota dentro de Natal**, o whisper só quando **transcreve um áudio**.

### 8.1 Preparar o OSRM (uma vez)

O serviço `osrm` do perfil `rotas` precisa do mapa já processado, senão fica reiniciando. Rode
uma vez, e de novo quando quiser mapa mais novo (uma vez por semestre é de sobra):

```bash
cd ~/apps/triade/infra/local
curl -fL --create-dirs -o data/osrm/rio-grande-do-norte-latest.osm.pbf \
  https://download.openstreetmap.fr/extracts/south-america/brazil/northeast/rio-grande-do-norte-latest.osm.pbf
docker compose --profile osrm-preparo run --rm osrm-preparo

# agora sim, ligue o perfil: acrescente ",rotas" ao COMPOSE_PROFILES de infra/local/.env
nano .env
docker compose up -d
docker compose ps          # osrm tem que ficar (healthy) em menos de um minuto
```

A última linha do preparo tem que ser `grafo pronto: /data/rio-grande-do-norte-latest.osrm`.
O download tem ~23 MB e o processamento leva menos de um minuto.

### 8.2 A primeira transcrição do whisper

Na primeira vez que alguém pede uma transcrição, o serviço baixa o modelo (~500 MB) e só então
responde. Por isso ele fica `health: starting` por vários minutos no primeiro dia. Para forçar
o download agora, em vez de esperar o primeiro áudio de fornecedor:

```bash
docker compose exec faster-whisper python3 /opt/healthchecks/whisper-transcreve.py
```

Resposta boa: uma linha começando com `ok whisper: transcreveu 0.4s de audio de teste`.

---

## 9. Como saber que está funcionando de verdade

Três provas, da mais rápida para a mais convincente.

### 9.1 O Docker diz

```bash
cd ~/apps/triade/infra/local && docker compose ps
```

Todos `(healthy)` (§8).

### 9.2 A verificação na mão, com a mensagem por extenso

O `docker compose ps` só mostra saudável/não saudável. Para ver **o motivo**:

```bash
docker compose exec worker-ingest node /opt/healthchecks/worker-heartbeat.mjs ingest
```

- Bom: `ok ingest/default: batida há 12s, status=ok, processados=0, falhas=0`
- Ruim: uma frase em português dizendo exatamente o que está errado — chave recusada, Supabase
  fora do ar, migrações não aplicadas, ou "o processo está de pé mas parou de trabalhar".

Troque `ingest` por `wa` ou `ai` para os outros dois.

### 9.3 O CRM vê a máquina

Esta é a prova que interessa: a máquina aparece **dentro do produto**. Cada worker escreve uma
"batida de ponto" na tabela `worker_heartbeats` do banco na nuvem, e a tela do **Radar** no CRM
lê dali para dizer se o coletor está vivo. Peça ao Matheus ou à Heloísa para abrir o Radar: se
o coletor aparecer como ativo, a máquina que você montou está entregando trabalho ao CRM.

Se você tiver acesso ao painel do Supabase, dá para conferir sozinho — *SQL Editor*:

```sql
select worker, instance, status, last_beat_at, now() - last_beat_at as ha_quanto_tempo
from public.worker_heartbeats
order by last_beat_at desc;
```

Três linhas (`ingest`, `wa`, `ai`) com `ha_quanto_tempo` de poucos minutos = tudo certo.

### 9.4 O Metabase abre

Do seu computador, já no tailnet: `https://triade-workers.<seu-tailnet>.ts.net`.
Da própria máquina: `curl -s http://127.0.0.1:3001/api/health` → `{"status":"ok"}`.

---

## 10. Quando parar de funcionar

### 10.1 Primeira pergunta: é a máquina ou é o Supabase?

Quase todo problema cai num dos dois lados, e a resposta muda quem resolve. Rode, na máquina:

```bash
cd ~/apps/triade/infra/local
docker compose ps                                   # (1) os contêineres estão de pé?
docker compose exec worker-ingest node /opt/healthchecks/worker-heartbeat.mjs ingest   # (2)
```

Leia assim:

| O que você vê                                                        | Onde está o problema | O que fazer                                                                 |
| -------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------- |
| Contêineres `Exited` / `Restarting`                                    | **máquina**          | §10.2 (log) e §10.3 (reiniciar)                                              |
| `unhealthy` + "não consegui falar com o Supabase"                      | **rede ou Supabase** | `ping 1.1.1.1` funciona? Se sim, veja https://status.supabase.com            |
| `unhealthy` + "Supabase respondeu 401 — chave recusada"                | **credencial**       | A `SUPABASE_SERVICE_ROLE_KEY` mudou. Chame o Matheus.                        |
| `unhealthy` + "a tabela worker_heartbeats não existe"                  | **Supabase**         | As migrações não foram aplicadas nesse projeto. Chame o Matheus.             |
| `unhealthy` + "o processo está de pé mas parou de trabalhar"           | **máquina**          | O worker travou. §10.3, reinicie **só ele**, e mande o log ao Matheus.       |
| Tudo `healthy`, mas a Heloísa diz que nada acontece                    | **CRM/nuvem**        | Não é a máquina. Mostre esta saída ao Matheus e pare por aqui.               |

Teste de rede de 10 segundos, se desconfiar da internet:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.anthropic.com   # espera-se 401 ou 404, não erro
tailscale status                                                      # a máquina ainda está no tailnet?
```

### 10.2 Onde olhar log

```bash
cd ~/apps/triade/infra/local

docker compose logs --tail=100 worker-wa        # últimas 100 linhas de um serviço
docker compose logs -f worker-ai                # acompanhando ao vivo (Ctrl+C sai)
docker compose logs --since=30m                 # tudo, dos últimos 30 minutos
docker compose logs --tail=50 | grep -i erro    # procurando erro em todos
```

Os workers escrevem uma linha JSON por evento. Os campos que interessam são `level` (`error` é o
que dói), `msg` e `worker`.

Para ver **por que** um contêiner foi marcado como não saudável (o Docker guarda a saída das
últimas verificações):

```bash
docker inspect --format '{{json .State.Health}}' komune-crm-worker-wa-1 | python3 -m json.tool
```

### 10.3 Reiniciar (do menos ao mais agressivo)

```bash
cd ~/apps/triade/infra/local

docker compose restart worker-wa     # 1) um serviço só — resolve a maioria dos travamentos
docker compose up -d --force-recreate worker-wa   # 2) recria o contêiner (relê o .env)
docker compose down && docker compose up -d       # 3) tudo. Os dados de ./data continuam.
sudo reboot                                        # 4) a máquina. Os serviços voltam sozinhos.
```

Depois de mexer em **qualquer** `.env`, o `restart` não basta — o Docker só relê o arquivo ao
recriar o contêiner. Use a opção 2 ou 3.

### 10.4 Sintomas específicos

| Sintoma                                                          | Causa provável                                                    | Conserto                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `env file .../.env not found`                                     | Faltou o `.env` da raiz (§7.1) ou o `infra/local/.env` (§7.2)      | Crie o que faltar a partir do `.env.example` correspondente                                |
| Log: `Ambiente inválido para o worker "wa"`                       | Falta variável no `.env` da raiz                                   | A própria mensagem lista quais. Preencha e `up -d --force-recreate`                        |
| `osrm` em `Restarting` com `Could not open .osrm`                 | O mapa não foi preparado                                           | §8.1                                                                                       |
| `faster-whisper` em `health: starting` há mais de 20 min          | O download do modelo travou                                        | `docker compose logs faster-whisper`; se não houver progresso, `docker compose restart faster-whisper` |
| Contêiner sumindo com `Exited (137)`                              | Estourou o limite de memória (o kernel matou)                      | Aumente o `MEM_*` daquele serviço em `infra/local/.env`, ou baixe os outros. §7.2          |
| `metabase` em laço com `adduser: Operation not permitted`         | Alguém tirou o bloco `cap_add` do compose                          | Restaure o `docker-compose.yml` do git                                                     |
| Disco cheio                                                       | Imagens velhas acumuladas                                          | `docker system df` e depois `docker image prune -a` (§11)                                  |
| Nada responde e o `ssh` também não                                | Máquina caiu ou a internet caiu                                    | Acesso físico. Depois `journalctl -b -1 -p err` para ver o que houve antes de cair         |

> Um erro de leitura comum: `docker compose ps` mostrando `Exited (0)` num worker **não** é
> defeito seu se isso acontecer antes de o projeto entregar os laços de fila (fase D4/D5/D6).
> Nessa fase o worker bate o ponto e termina de propósito. Depois disso, `Exited (0)` é problema.

### 10.5 O que mandar para o Matheus quando pedir socorro

```bash
cd ~/apps/triade/infra/local
docker compose ps
docker compose logs --tail=80 --timestamps
docker compose exec worker-ingest node /opt/healthchecks/worker-heartbeat.mjs ingest
```

> **Nunca** mande a saída de `docker compose config`: ela imprime o conteúdo dos arquivos de
> ambiente, ou seja, as chaves de produção em texto puro. Se precisar conferir a sintaxe do
> compose, use `docker compose config --no-env-resolution -q`, que não imprime nada.

---

## 11. Rotina de manutenção

**Toda semana** (dois minutos):

```bash
cd ~/apps/triade/infra/local
docker compose ps          # todos (healthy)?
df -h /                    # menos de 80% usado?
docker system df           # quanto o Docker está ocupando
```

**Quando o Matheus avisar que subiu versão nova:**

```bash
cd ~/apps/triade
git pull
cd infra/local
docker compose build
docker compose up -d
docker compose ps          # confirme os (healthy) antes de sair
```

**Backup** — a única coisa insubstituível nesta máquina são os painéis do Metabase (o resto é
reconstruível: o código está no git, o mapa se baixa de novo, o modelo do whisper também):

```bash
cd ~/apps/triade/infra/local
docker compose stop metabase
tar czf ~/backup-metabase-$(date +%F).tar.gz data/metabase
docker compose start metabase
```

Guarde o `.tar.gz` fora da máquina.

**Limpar disco** quando passar de 80%:

```bash
docker image prune -a       # imagens que nenhum contêiner usa
docker builder prune        # cache de build
```

Os logs já se limpam sozinhos: cada serviço guarda no máximo 5 arquivos de 10 MB.

**Depois de um apagão:** não precisa fazer nada. O Docker sobe no boot e os contêineres têm
política `unless-stopped`. Confira com `docker compose ps` quando a máquina voltar.

---

## 12. Cloudflare Tunnel — só se precisar, e com cuidado

**Não ligue por padrão.** A Tailscale (§5) já resolve o acesso do Matheus e o seu. O túnel só
existe para um caso: alguém precisa abrir o Metabase num aparelho onde não dá para instalar a
Tailscale.

**Por que ele é aceitável mesmo assim:** o `cloudflared` faz uma conexão **de saída** para a
Cloudflare e o tráfego volta por dentro dela. Continua sem porta aberta no roteador e sem IP
fixo. O que muda é que o painel passa a ter um endereço na internet pública.

**O risco, dito com todas as letras:** sem proteção na frente, esse endereço mostra dados de
parceiros — nomes, telefones, conversas — para quem descobrir a URL. Então:

1. No painel Cloudflare Zero Trust, crie o túnel e aponte o *public hostname* para
   `http://metabase:3000`.
2. **Antes de ligar**, crie uma *Access application* para esse hostname com política de e-mail
   permitindo só as pessoas da Komune. Sem esse passo, não ligue.
3. Guarde o token:
   ```bash
   cd ~/apps/triade/infra/local
   printf 'TUNNEL_TOKEN=cole-o-token-aqui\n' > .env.cloudflared
   chmod 600 .env.cloudflared
   ```
4. Ligue o perfil, acrescentando `tunel` ao `COMPOSE_PROFILES` do `infra/local/.env`, e suba:
   ```bash
   docker compose up -d
   docker compose exec metabase curl -fsS http://cloudflared:2000/ready
   ```
   Resposta boa: um JSON com `"status":200`. (O `cloudflared` não tem verificação de saúde
   própria porque a imagem não traz shell nenhum por dentro — por isso a checagem é feita de fora.)

Para desligar: tire `tunel` do `COMPOSE_PROFILES` e rode `docker compose down cloudflared`.

---

## 13. Referência rápida

```bash
cd ~/apps/triade/infra/local

docker compose ps                       # como está tudo
docker compose logs -f <serviço>        # log ao vivo
docker compose restart <serviço>        # reinicia um só
docker compose up -d --force-recreate <serviço>   # recria (depois de mexer no .env)
docker compose down && docker compose up -d       # tudo
docker compose exec worker-ingest node /opt/healthchecks/worker-heartbeat.mjs ingest
docker compose exec faster-whisper python3 /opt/healthchecks/whisper-transcreve.py
```

Serviços: `worker-ingest` · `worker-wa` · `worker-ai` · `metabase` · `osrm` · `faster-whisper` · `cloudflared`

**Quem chamar:** problema de máquina, rede, Docker ou Tailscale é seu. Chave, migração, fila
parada ou comportamento errado do CRM é do **Matheus**. A tabela da §10.1 diz de quem é.

Detalhe técnico de cada serviço: [`infra/local/README.md`](../../infra/local/README.md).
