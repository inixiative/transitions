import { registerEngineGlobals } from '@inixiative/json-rules';

// transitions' namespace in the one engine interaction point (json-rules' `engineGlobals`). Every
// option transitions takes is per call today, so it holds no path yet.
registerEngineGlobals('transitions', {});
