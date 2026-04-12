/** Resposta de diagnóstico de `GET /api/kpi-flask-health` (dev ou `?debug=1`). */
export type KpiFlaskHealthDebug = {
  probeUrl: string;
  headOk: boolean;
  headBuildLen: number;
  getHdrBuildLen: number;
  contentType: string;
  bodyLength: number;
  bodyPreview: string;
};
