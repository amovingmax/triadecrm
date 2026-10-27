'use client';

import { useState } from 'react';
import { LocateFixed, MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { fraseDasCoordenadas, lerCoordenadas, linkDoMapa } from './conteudo';
import {
  CAMPO,
  Campo,
  JanelaDoAnexo,
  useEnvioDoAnexo,
  type DestinoDoAnexo,
} from './janela-do-anexo';

/**
 * Mandar uma localização (27/10/2026): a de onde a pessoa está, pelo GPS do
 * aparelho, ou a de um lugar, colando o link do Google Maps ou as coordenadas.
 * O nome e o endereço são opcionais — é o que aparece no cartão do contato.
 */
export function EnviarLocalizacao({
  aberto,
  aoFechar,
  destino,
}: {
  aberto: boolean;
  aoFechar: () => void;
  destino: DestinoDoAnexo;
}) {
  return (
    <JanelaDoAnexo aberto={aberto} aoFechar={aoFechar} titulo="Mandar localização">
      <Formulario destino={destino} aoFechar={aoFechar} />
    </JanelaDoAnexo>
  );
}

function Formulario({ destino, aoFechar }: { destino: DestinoDoAnexo; aoFechar: () => void }) {
  const [ponto, setPonto] = useState('');
  const [nome, setNome] = useState('');
  const [endereco, setEndereco] = useState('');
  const [procurando, setProcurando] = useState(false);
  const [erroDoGps, setErroDoGps] = useState<string | null>(null);
  const { enviar, indo } = useEnvioDoAnexo({
    ...destino,
    aoEnviar: () => {
      destino.aoEnviar();
      aoFechar();
    },
  });

  const lido = lerCoordenadas(ponto);

  function usarOndeEstou() {
    if (!('geolocation' in navigator)) {
      setErroDoGps('Este navegador não dá a localização.');
      return;
    }
    setProcurando(true);
    setErroDoGps(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setProcurando(false);
        setPonto(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`);
      },
      (erro) => {
        setProcurando(false);
        setErroDoGps(
          erro.code === erro.PERMISSION_DENIED
            ? 'O navegador não deixou usar a localização. Libere nas permissões do site ou cole um link.'
            : 'Não deu para achar onde você está. Cole um link do Maps.',
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!lido.ok || indo) return;
        void enviar({
          tipo: 'location',
          conteudo: {
            latitude: lido.latitude,
            longitude: lido.longitude,
            ...(nome.trim() ? { nome: nome.trim() } : {}),
            ...(endereco.trim() ? { endereco: endereco.trim() } : {}),
          },
        });
      }}
    >
      <Button
        type="button"
        variant="outline"
        onClick={usarOndeEstou}
        disabled={procurando}
        className="toque h-11 justify-start md:h-9"
      >
        <LocateFixed aria-hidden="true" />
        {procurando ? 'Procurando onde você está...' : 'Usar minha localização'}
      </Button>
      {erroDoGps ? <p className="text-xs text-destructive-texto">{erroDoGps}</p> : null}

      <Campo
        rotulo="Ou cole o lugar"
        dica={
          ponto.trim() === '' ? (
            'Link do Google Maps ou coordenadas, como -5.79, -35.21.'
          ) : lido.ok ? (
            <a
              href={linkDoMapa(lido.latitude, lido.longitude)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              <MapPin className="size-3" aria-hidden="true" />
              Conferir no mapa
            </a>
          ) : (
            <span className="text-destructive-texto">{fraseDasCoordenadas(lido.motivo)}</span>
          )
        }
      >
        <input
          value={ponto}
          onChange={(e) => setPonto(e.target.value)}
          inputMode="url"
          autoComplete="off"
          className={CAMPO}
        />
      </Campo>
      <Campo rotulo="Nome do lugar (se quiser)">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Buffet Aurora"
          maxLength={100}
          className={CAMPO}
        />
      </Campo>
      <Campo rotulo="Endereço (se quiser)">
        <input
          value={endereco}
          onChange={(e) => setEndereco(e.target.value)}
          placeholder="Av. Roberto Freire, 100 — Ponta Negra"
          maxLength={200}
          className={CAMPO}
        />
      </Campo>

      <Button type="submit" disabled={!lido.ok || indo} className="toque h-11 md:h-9">
        <MapPin aria-hidden="true" />
        {indo ? 'Mandando...' : 'Mandar localização'}
      </Button>
    </form>
  );
}
