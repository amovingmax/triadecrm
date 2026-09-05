#!/usr/bin/env python3
"""Healthcheck do faster-whisper do TRIADE (RF-MET-07, R05).

Por que nao basta "a porta 9000 abriu": o FastAPI responde na porta muito antes de o modelo
estar carregado, e um modelo corrompido no cache ou um download interrompido deixa a porta
aberta e a transcricao quebrada. O que a Heloisa precisa e que o audio do fornecedor vire
texto -- entao o healthcheck manda um audio de verdade para /asr e exige uma transcricao de volta.

Gera 0,4 s de um tom senoidal de 440 Hz em WAV PCM 16 bits / 16 kHz (sem arquivo no disco,
sem dependencia externa), faz o POST multipart e exige HTTP 200. Como /asr so responde 200
depois de rodar o modelo, um 200 prova que o modelo esta carregado e transcrevendo.

Saida: 0 saudavel - 1 nao saudavel (o Docker marca o conteiner como unhealthy).
Usa apenas a biblioteca padrao do Python 3.10 que ja vem na imagem.
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys
import urllib.error
import urllib.request

BASE_URL = os.environ.get("WHISPER_HEALTHCHECK_URL", "http://127.0.0.1:9000").rstrip("/")
TIMEOUT_S = float(os.environ.get("WHISPER_HEALTHCHECK_TIMEOUT_S", "45"))
SAMPLE_RATE = 16000
DURACAO_S = 0.4
FREQUENCIA_HZ = 440.0


def falhar(mensagem: str) -> None:
    sys.stderr.write(mensagem + "\n")
    raise SystemExit(1)


def wav_de_teste() -> bytes:
    """WAV PCM mono 16 bits com um tom curto -- pequeno o bastante para rodar a cada minuto."""
    total = int(SAMPLE_RATE * DURACAO_S)
    amostras = bytearray()
    for i in range(total):
        valor = int(12000 * math.sin(2 * math.pi * FREQUENCIA_HZ * i / SAMPLE_RATE))
        amostras += struct.pack("<h", valor)
    dados = bytes(amostras)
    cabecalho = b"RIFF" + struct.pack("<I", 36 + len(dados)) + b"WAVE"
    cabecalho += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16)
    cabecalho += b"data" + struct.pack("<I", len(dados))
    return cabecalho + dados


def corpo_multipart(wav: bytes, fronteira: str) -> bytes:
    marca = f"--{fronteira}".encode()
    partes = [
        marca,
        b'Content-Disposition: form-data; name="audio_file"; filename="healthcheck.wav"',
        b"Content-Type: audio/wav",
        b"",
        wav,
        f"--{fronteira}--".encode(),
        b"",
    ]
    return b"\r\n".join(partes)


def main() -> None:
    fronteira = "----triade-healthcheck-boundary"
    corpo = corpo_multipart(wav_de_teste(), fronteira)
    url = f"{BASE_URL}/asr?task=transcribe&language=pt&output=json&encode=true"
    requisicao = urllib.request.Request(  # noqa: S310 - URL fixa, sempre http local
        url,
        data=corpo,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={fronteira}",
            "Content-Length": str(len(corpo)),
        },
    )

    try:
        with urllib.request.urlopen(requisicao, timeout=TIMEOUT_S) as resposta:  # noqa: S310
            status = resposta.status
            texto = resposta.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as erro:
        detalhe = erro.read().decode("utf-8", errors="replace")[:300]
        falhar(f"healthcheck whisper: /asr respondeu {erro.code}: {detalhe}")
        return
    except (urllib.error.URLError, TimeoutError, OSError) as erro:
        falhar(
            f"healthcheck whisper: nao consegui falar com {BASE_URL}/asr ({erro}). "
            "Se o conteiner acabou de subir, o modelo ainda pode estar baixando."
        )
        return

    if status != 200:
        falhar(f"healthcheck whisper: /asr respondeu {status} (esperado 200): {texto[:300]}")

    try:
        transcricao = json.loads(texto)
    except json.JSONDecodeError:
        falhar(f"healthcheck whisper: /asr devolveu algo que nao e JSON: {texto[:300]}")
        return

    if "text" not in transcricao:
        falhar(f"healthcheck whisper: resposta sem o campo 'text': {texto[:300]}")

    sys.stdout.write(
        f"ok whisper: transcreveu {DURACAO_S:.1f}s de audio de teste "
        f"(idioma={transcricao.get('language', '?')}, caracteres={len(transcricao.get('text') or '')})\n"
    )


if __name__ == "__main__":
    main()
