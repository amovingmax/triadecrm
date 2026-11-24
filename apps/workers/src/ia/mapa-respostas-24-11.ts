/**
 * Respostas REAIS do Nominatim público em 24/11/2026 (busca com `addressdetails=1`,
 * `limit=3`, caixa do RN), para os testes dos consertos do mapa
 * (`busca-no-mapa-consertos.test.ts`). Chave: a consulta sem acento e minúscula.
 * Cortado para os campos que `lerLugares` lê. Data © OpenStreetMap contributors, ODbL 1.0.
 */
export const RESPOSTAS_DE_24_11: Record<string, unknown[]> = {
  'rotatoria do golfinho, natal, rn': [],
  'rotatoria do golfinho, rn': [
    {
      lat: '-6.0623325',
      lon: '-35.1018610',
      addresstype: 'primary',
      type: 'primary',
      name: 'Rotatória do Golfinho Tabatinga',
      display_name:
        'Rotatória do Golfinho Tabatinga, Tabatinga, Nísia Floresta, Rio Grande do Norte, Região Nordeste, 59164-000, Brasil',
      address: {
        village: 'Tabatinga',
        city_district: 'Nísia Floresta',
        town: 'Nísia Floresta',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
  ],
  'rotatoria do golfinho, ponta negra, rn': [],
  'golfinho, natal, rn': [
    {
      lat: '-5.8846381',
      lon: '-35.1756069',
      addresstype: 'residential',
      type: 'residential',
      name: 'Rua do Golfinho',
      display_name:
        'Rua do Golfinho, Ponta Negra, Zona Sul, Natal, Rio Grande do Norte, Região Nordeste, 59090-188, Brasil',
      address: {
        suburb: 'Ponta Negra',
        city: 'Natal',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
  ],
  'golfinho, rn': [
    {
      lat: '-6.2285124',
      lon: '-35.0503421',
      addresstype: 'amenity',
      type: 'restaurant',
      name: 'golfinho',
      display_name:
        'golfinho, Avenida Baía dos Golfinhos, Tibau do Sul, Rio Grande do Norte, Região Nordeste, 59179-000, Brasil',
      address: {
        city_district: 'Tibau do Sul',
        town: 'Tibau do Sul',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
    {
      lat: '-4.9289884',
      lon: '-37.1107792',
      addresstype: 'residential',
      type: 'residential',
      name: 'Rua Golfinho',
      display_name:
        'Rua Golfinho, Upanema, Areia Branca, Rio Grande do Norte, Região Nordeste, 59655-000, Brasil',
      address: {
        suburb: 'Upanema',
        neighbourhood: 'Upanema',
        city_district: 'Areia Branca',
        town: 'Areia Branca',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
    {
      lat: '-5.3380198',
      lon: '-35.3647820',
      addresstype: 'residential',
      type: 'residential',
      name: 'Rua do Golfinho',
      display_name:
        'Rua do Golfinho, Zumbi, Rio do Fogo, Rio Grande do Norte, Região Nordeste, Brasil',
      address: {
        hamlet: 'Zumbi',
        city_district: 'Rio do Fogo',
        town: 'Rio do Fogo',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
  ],
  'natal, rn': [
    {
      lat: '-5.8053980',
      lon: '-35.2080905',
      addresstype: 'city',
      type: 'administrative',
      name: 'Natal',
      display_name: 'Natal, Rio Grande do Norte, Região Nordeste, Brasil',
      address: {
        city: 'Natal',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
    {
      lat: '-5.8053980',
      lon: '-35.2080905',
      addresstype: 'city',
      type: 'administrative',
      name: 'Natal',
      display_name: 'Natal, Rio Grande do Norte, Região Nordeste, Brasil',
      address: {
        city: 'Natal',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
  ],
  'ponta negra, rn': [
    {
      lat: '-5.8736046',
      lon: '-35.1766302',
      addresstype: 'beach',
      type: 'beach',
      name: 'Praia de Ponta Negra',
      display_name:
        'Praia de Ponta Negra, Zona Sul, Natal, Rio Grande do Norte, Região Nordeste, Brasil',
      address: {
        suburb: 'Zona Sul',
        city: 'Natal',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
    {
      lat: '-5.8846468',
      lon: '-35.1775119',
      addresstype: 'suburb',
      type: 'administrative',
      name: 'Ponta Negra',
      display_name: 'Ponta Negra, Natal, Rio Grande do Norte, Região Nordeste, Brasil',
      address: {
        suburb: 'Ponta Negra',
        city: 'Natal',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
    {
      lat: '-5.8832137',
      lon: '-35.1540846',
      addresstype: 'cape',
      type: 'cape',
      name: 'Ponta Negra',
      display_name:
        'Ponta Negra, Zona Sul, Natal, Rio Grande do Norte, Região Nordeste, 59090-670, Brasil',
      address: {
        suburb: 'Zona Sul',
        city: 'Natal',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
  ],
  'capim macio, rn': [
    {
      lat: '-5.8576398',
      lon: '-35.2014489',
      addresstype: 'suburb',
      type: 'administrative',
      name: 'Capim Macio',
      display_name: 'Capim Macio, Natal, Rio Grande do Norte, Região Nordeste, Brasil',
      address: {
        suburb: 'Capim Macio',
        city: 'Natal',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
  ],
  'rua professor etelvino cunha, natal, rn': [],
  'avenida professor etelvino cunha, natal, rn': [
    {
      lat: '-5.8458491',
      lon: '-35.1993600',
      addresstype: 'residential',
      type: 'residential',
      name: 'Avenida Professor Etelvino Cunha',
      display_name:
        'Avenida Professor Etelvino Cunha, Cidade Jardim, Zona Sul, Natal, Rio Grande do Norte, Região Nordeste, 59078-400, Brasil',
      address: {
        suburb: 'Zona Sul',
        neighbourhood: 'Cidade Jardim',
        city: 'Natal',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
  ],
  'rua gustavo neves, natal, rn': [],
  'avenida gustavo neves, natal, rn': [
    {
      lat: '-5.8471811',
      lon: '-35.2019908',
      addresstype: 'residential',
      type: 'residential',
      name: 'Avenida Gustavo Neves',
      display_name:
        'Avenida Gustavo Neves, Cidade Jardim, Zona Sul, Natal, Rio Grande do Norte, Região Nordeste, 59078-380, Brasil',
      address: {
        suburb: 'Zona Sul',
        neighbourhood: 'Cidade Jardim',
        city: 'Natal',
      },
      licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    },
  ],
};
