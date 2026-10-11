// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Multi-factor proficiency profile: renders the normalized factor scores and
// their per-occasion trend so progress reads as movement across constructs,
// not a single test score.
import { computeProfile, profileComposite, MIN_COMPOSITE_FACTORS, type FactorSeries, type ProfileRecord } from './logic';
import './vocab.css';

function Sparkline({ series }: { series: FactorSeries }) {
  if (series.points.length < 2) return null;
  const W = 96, H = 24, pad = 3;
  const xs = series.points.map((_, i) => pad + (W - 2 * pad) * (i / (series.points.length - 1)));
  const ys = series.points.map((p) => H - pad - (H - 2 * pad) * (p.score / 100));
  const pts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke="var(--vm-cardinal)" strokeWidth="1.5" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2.5" fill="var(--vm-cardinal)" />
    </svg>
  );
}

function FactorBar({ series }: { series: FactorSeries }) {
  const has = series.latest != null;
  return (
    <div className="py-3 border-b border-gray-100 dark:border-gray-700 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{series.label}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
            {series.sources.length ? series.sources.join(', ') : 'sin datos'}
          </span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          {series.delta != null && (
            <span className={`text-xs font-medium ${series.delta > 0.5 ? 'text-green-600 dark:text-green-400' : series.delta < -0.5 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
              {series.delta > 0.5 ? '▲' : series.delta < -0.5 ? '▼' : '■'} {Math.abs(series.delta).toFixed(0)}
            </span>
          )}
          <Sparkline series={series} />
          <span className="font-mono text-sm text-gray-900 dark:text-gray-100 w-8 text-right">
            {has ? Math.round(series.latest as number) : '—'}
          </span>
        </div>
      </div>
      <div className="mt-1.5 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-2 rounded-full bg-red-800 dark:bg-red-500 transition-all"
          style={{ width: has ? `${series.latest}%` : '0%' }}
        />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{series.blurb}</p>
    </div>
  );
}

export function ProfileView({ records, compact }: { records: ProfileRecord[]; compact?: boolean }) {
  const series = computeProfile(records);
  const composite = profileComposite(series);
  const measured = series.filter((s) => s.latest != null).length;
  const excluded = records.filter((r) => r.flagged).length;

  if (measured === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Aún no hay medidas suficientes para un perfil. Se construye a medida que se completan pruebas de distintos tipos
        (tamaño, dominio, auditiva, dictado, C-test, decisión cronometrada).
        {excluded > 0 && ` (${excluded} intento(s) excluido(s) por baja calidad.)`}
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-1">
        <div>
          <span className="font-mono text-2xl font-bold text-gray-900 dark:text-gray-100">
            {composite != null ? Math.round(composite) : '—'}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
            {composite != null
              ? `índice compuesto (0–100) · media de factores del núcleo (0–100)`
              : `sin índice compuesto — se necesitan ≥${MIN_COMPOSITE_FACTORS} factores (${measured} medido${measured === 1 ? '' : 's'})`}
          </span>
        </div>
        {excluded > 0 && (
          <span className="text-xs text-orange-500" title="Intentos marcados por baja calidad, excluidos del perfil">
            {excluded} excluido(s) por calidad
          </span>
        )}
      </div>
      {composite != null && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          No comparable entre estudiantes con distinta cobertura de factores; útil para seguir a un mismo estudiante.
        </p>
      )}
      {series.map((s) => <FactorBar key={s.key} series={s} />)}
      {!compact && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
          Cada factor se normaliza a 0–100 a partir de instrumentos distintos, así que el progreso se lee como
          movimiento entre construcciones (amplitud, profundidad, automaticidad, oído, producción, competencia
          integrada), no como una sola nota. Los intentos marcados por baja calidad se excluyen. Para un anclaje
          externo, complementa con una prueba estandarizada anual (AAPPL/STAMP).
        </p>
      )}
    </div>
  );
}

/** Adapt raw stored results (summaryJson + qualityJson) into ProfileRecords. */
export function recordsFromResults(rows: {
  userId?: number;
  userName?: string;
  mode: string;
  blk?: string | null;
  form?: string | null;
  occasion?: string | null;
  summaryJson: string;
  qualityJson?: string | null;
  completedAt: string | Date;
}[], fallbackName = ''): ProfileRecord[] {
  const out: ProfileRecord[] = [];
  for (const r of rows) {
    try {
      const summary = JSON.parse(r.summaryJson);
      let flagged = false;
      if (r.qualityJson) {
        try { flagged = JSON.parse(r.qualityJson).flagged === true; } catch { flagged = false; }
      }
      out.push({
        userId: r.userId ?? 0,
        name: r.userName ?? fallbackName,
        date: new Date(r.completedAt).toISOString().slice(0, 10),
        occ: r.occasion ?? '',
        mode: r.mode,
        summary,
        blk: r.blk,
        form: r.form,
        flagged,
      });
    } catch {
      continue;
    }
  }
  return out;
}
