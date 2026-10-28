import { ambienteDoApp, montarConfig } from './src/ambiente';

// O ambiente vem de TRIADE_APP_AMBIENTE (local, local-android ou producao); ver src/ambiente.ts.
export default montarConfig(ambienteDoApp(process.env.TRIADE_APP_AMBIENTE));
