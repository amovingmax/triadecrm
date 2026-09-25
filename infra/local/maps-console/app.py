"""
A tela da raspagem, com a cara do Tríade.

POR QUE ISTO EXISTE
A interface que vem no `gosom/google-maps-scraper` é de terceiro: não dá para
mudar o CSS dela sem manter um garfo do projeto. Então ela deixa de publicar
porta e passa a ser um motor; quem fala com a pessoa é esta página, que é nossa.

TRÊS COISAS, E SÓ TRÊS
  1. serve `index.html` (e nada mais de estático: a página é um arquivo só);
  2. repassa `/api/v1/*` para o raspador, para o navegador nunca falar com dois
     endereços — sem CORS, sem porta extra aberta;
  3. COLHE: quando uma busca termina, copia o CSV de `/webdata/<id>.csv` para
     `/listas/<data>-<nome>.csv`. É o que tira o arquivo de uma pasta de quatro
     níveis com nome de código e põe na raiz do projeto com nome de gente.

Sem dependência nenhuma além da biblioteca padrão do Python: este contêiner
sobe em segundos e não tem o que atualizar por segurança.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RASPADOR = os.environ.get("RASPADOR_URL", "http://maps-scraper:8080")
WEBDATA = Path(os.environ.get("WEBDATA_DIR", "/webdata"))
LISTAS = Path(os.environ.get("LISTAS_DIR", "/listas"))
PAGINA = Path(__file__).with_name("index.html")
PORTA = int(os.environ.get("PORTA", "8080"))

# A colheita roda sozinha a cada 5 s. Não é fila nem cron: é um laço simples,
# porque o raspador não avisa quando termina e uma busca leva de 1 a 10 minutos.
INTERVALO = 5.0


def escorregadio(texto: str) -> str:
    """"Buffet Infantil em Natal RN" → "buffet-infantil-em-natal-rn".

    Sem acento, sem maiúscula, sem espaço: o nome do arquivo é lido no terminal,
    arrastado para o navegador e citado em conversa. Corta em 60 para não gerar
    nome que o Finder mostra pela metade.
    """
    limpo = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    limpo = re.sub(r"[^a-zA-Z0-9]+", "-", limpo).strip("-").lower()
    return (limpo or "busca")[:60]


def nome_do_arquivo(trabalho: dict) -> str:
    """`2026-09-25-buffet-infantil-natal.csv`, a partir do trabalho."""
    data = (trabalho.get("Date") or "")[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", data):
        data = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    nome = (trabalho.get("Name") or "").strip()
    if not nome:
        dados = trabalho.get("Data") or {}
        palavras = dados.get("keywords") or []
        nome = palavras[0] if palavras else "busca"
    return f"{data}-{escorregadio(nome)}.csv"


def pedir(caminho: str, corpo: bytes | None = None, metodo: str = "GET") -> tuple[int, bytes, str]:
    """Uma ida ao raspador. Devolve (status, corpo, tipo) e NUNCA lança."""
    req = urllib.request.Request(
        f"{RASPADOR}{caminho}",
        data=corpo,
        method=metodo,
        headers={"Content-Type": "application/json"} if corpo else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "application/json")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "application/json")
    except Exception as e:  # noqa: BLE001 — o motor fora do ar é estado normal da tela
        return 503, json.dumps({"erro": f"o raspador não respondeu: {e}"}).encode(), "application/json"


def colher_uma(trabalho: dict) -> str | None:
    """Copia o CSV de um trabalho terminado. Devolve o nome do arquivo, ou None."""
    ident = trabalho.get("ID") or ""
    origem = WEBDATA / f"{ident}.csv"
    if not ident or not origem.exists() or origem.stat().st_size == 0:
        return None
    destino = LISTAS / nome_do_arquivo(trabalho)
    # Mesmo tamanho: já colhido. Tamanho diferente: o raspador ainda escrevia
    # quando copiamos, e vale copiar de novo por cima.
    if destino.exists() and destino.stat().st_size == origem.stat().st_size:
        return destino.name
    LISTAS.mkdir(parents=True, exist_ok=True)
    shutil.copy2(origem, destino)
    return destino.name


def colher_sempre() -> None:
    while True:
        try:
            status, corpo, _ = pedir("/api/v1/jobs")
            if status == 200:
                for t in json.loads(corpo):
                    if (t.get("Status") or "").lower() in ("ok", "finished", "done", "completed"):
                        colher_uma(t)
        except Exception:  # noqa: BLE001 — o laço nunca pode morrer
            pass
        time.sleep(INTERVALO)


def listas() -> list[dict]:
    """O que já está em `listas/`, do mais novo para o mais velho."""
    if not LISTAS.exists():
        return []
    saida = []
    for f in sorted(LISTAS.glob("*.csv"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            # -1 pelo cabeçalho. Conta bytes de nova linha, que é barato e basta:
            # endereço com vírgula vem entre aspas, mas nunca com quebra de linha.
            linhas = max(sum(1 for _ in f.open("rb")) - 1, 0)
        except OSError:
            linhas = 0
        saida.append({"arquivo": f.name, "lugares": linhas, "bytes": f.stat().st_size})
    return saida


class Tela(BaseHTTPRequestHandler):
    server_version = "TriadeMapsConsole/1.0"

    def log_message(self, formato: str, *args) -> None:  # noqa: A002
        # O log padrão imprime uma linha por pedido, e a página consulta de 3 em
        # 3 segundos: em uma hora são 1.200 linhas que não dizem nada.
        return

    def responder(self, status: int, corpo: bytes, tipo: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self.responder(200, PAGINA.read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/listas":
            self.responder(200, json.dumps(listas()).encode(), "application/json")
        elif self.path.startswith("/api/"):
            status, corpo, tipo = pedir(self.path)
            self.responder(status, corpo, tipo)
        else:
            self.responder(404, b'{"erro":"nao existe"}', "application/json")

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/api/"):
            self.responder(404, b'{"erro":"nao existe"}', "application/json")
            return
        tamanho = int(self.headers.get("Content-Length", "0"))
        status, corpo, tipo = pedir(self.path, self.rfile.read(tamanho), "POST")
        self.responder(status, corpo, tipo)

    def do_DELETE(self) -> None:  # noqa: N802
        if not self.path.startswith("/api/"):
            self.responder(404, b'{"erro":"nao existe"}', "application/json")
            return
        status, corpo, tipo = pedir(self.path, None, "DELETE")
        self.responder(status, corpo, tipo)


if __name__ == "__main__":
    LISTAS.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=colher_sempre, daemon=True).start()
    print(f"A tela da raspagem está em http://127.0.0.1:{PORTA}", flush=True)
    print(f"Os arquivos caem em {LISTAS}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORTA), Tela).serve_forever()
