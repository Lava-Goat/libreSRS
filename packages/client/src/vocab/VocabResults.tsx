// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Result views for a completed Vocabulómetro attempt, ported from the standalone
// app's finish()/finishProtocol(). SVG meters are generated as strings by logic.ts
// (numeric inputs only) and injected via dangerouslySetInnerHTML.
import {
  DATA, bandOfIdx, cefrEstimate, cefrLadderSVG, fmt, meterSVG, pct, wilson, ynEstimates,
  type DictadoResponse, type McResponse, type YnResponse,
} from './logic';

function Stat({ n, l }: { n: React.ReactNode; l: string }) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}

export function VocabResultView({ mode, resp, occasion, stopped, totalItems, timeouts }: {
  mode: 'size' | 'mastery' | 'listen' | 'listen2' | 'dictado' | 'ldt';
  resp: (YnResponse | McResponse | DictadoResponse)[];
  occasion?: string;
  stopped?: number;
  totalItems: number;
  timeouts?: number;
}) {
  const header = (
    <span className="eyebrow">Resultados{occasion ? ` · ${occasion}` : ''}</span>
  );

  if (mode === 'mastery') {
    const rs = resp as McResponse[];
    const n = rs.length, c = rs.filter((r) => r.correct).length, w = rs.filter((r) => !r.correct && !r.omit).length, o = n - c - w;
    const raw = c / n, corr = Math.max(0, (c - w / 3) / n), [lo, hi] = wilson(raw, n);
    const D5 = DATA.masteryDomain.length, projected = Math.round(corr * D5);
    const covTop = DATA.bands[0].mass * corr;
    return (
      <div>
        {header}
        <div className="res-head">
          <Stat n={<>{fmt(100 * corr)}<small>%</small></>} l="dominio corregido · top 500" />
          <Stat n={<>{fmt(projected)}<small> / {D5}</small></>} l="palabras proyectadas" />
          <Stat n={pct(covTop)} l="cobertura del habla vía top 500" />
        </div>
        <p className="ci">
          raw {pct(raw)} (IC 95% {pct(lo)}–{pct(hi)}) · {c} correctas, {w} incorrectas, {o} omitidas · corrección de adivinación −⅓ por error
        </p>
        <div dangerouslySetInnerHTML={{ __html: meterSVG(covTop) }} />
        {corr < 0.98 && (
          <p className="note">Meta CI: dominio ≥ 98% del núcleo top-500 antes de pasar el peso del input a las bandas 501–2.000.</p>
        )}
        <p className="note">
          Esta forma no estima nivel CEFR: mide solo el núcleo top-500 (territorio A1→A2). Para la estimación CEFR usa la
          prueba de tamaño y cobertura, que muestrea las cinco bandas.
        </p>
      </div>
    );
  }

  // Dictation responses map onto the Sí/No estimator with yes = correctly
  // transcribed; ps=[0,0] means f=0 and k=h (verified, no overclaiming term).
  const ynResp: YnResponse[] = mode === 'dictado'
    ? (resp as DictadoResponse[]).map((r) => ({ w: r.w, b: r.b, t: 'real', yes: r.ok, ms: r.ms }))
    : (resp as YnResponse[]);
  const E = ynEstimates(ynResp);
  const ciS = 1.96 * E.seSize, ciC = 1.96 * E.seCov;
  const C = cefrEstimate(E.size, E.seSize);
  // A CEFR claim needs enough data to be stable: with under 40 real items or
  // under 8 pseudowords the interval spans multiple levels and misleads.
  // Exception: an adaptive stop means the precision target was already met,
  // so the early finish is not thin data.
  const realN = E.rows.reduce((a, r) => a + r.n, 0);
  // listen2 never reports CEFR: the audio bank truncates the 0–5000 domain to
  // covered bands, so the absolute X_Lex ladder does not apply.
  const cefrReliable = mode !== 'listen2' && mode !== 'ldt' && E.pseudoN >= 8 && (realN >= 40 || Boolean(stopped));
  // automaticity: median RT of "sí" on high-frequency real words (bands 1-2),
  // excluding timeouts and sub-200ms anticipations — matches summaryFromLdt.
  const ldtRts = mode === 'ldt'
    ? (resp as YnResponse[])
      .filter((x) => x.yes && !x.timedOut && x.t === 'real' && x.b <= 1 && x.ms >= 200)
      .map((x) => x.ms).sort((a, b) => a - b)
    : [];
  const ldtMed = ldtRts.length ? ldtRts[Math.floor(ldtRts.length / 2)] : null;
  return (
    <div>
      {header}
      <div className="res-head">
        <Stat
          n={<>{fmt(E.size)}<small> / {fmt(E.domainN)}</small></>}
          l={(mode === 'listen' || mode === 'listen2' ? 'palabras (auditivo)'
            : mode === 'dictado' ? 'palabras transcribibles (dictado)'
              : 'palabras conocidas') + ' · top 5.000'}
        />
        <Stat n={pct(E.cov)} l={mode === 'dictado' ? 'cobertura del habla transcribible' : 'cobertura estimada del habla'} />
        {E.pseudoN > 0 && <Stat n={pct(E.f, 0)} l="tasa de falsa alarma" />}
        {mode === 'ldt' && ldtMed !== null && <Stat n={<>{fmt(ldtMed)}<small> ms</small></>} l="automaticidad (mediana sí · top 1.000)" />}
      </div>
      {mode === 'ldt' && (
        <p className="note">
          Prueba cronometrada: mide la <em>automaticidad</em> del acceso léxico además del conocimiento.
          {timeouts ? ` ${timeouts} ítem(s) sin respuesta dentro del plazo — no cuentan como error.` : ''}
        </p>
      )}
      {stopped ? (
        <p className="note">Parada adaptativa: objetivo de precisión alcanzado tras {stopped} de {totalItems} ítems.</p>
      ) : null}
      <p className="ci">
        IC 95%: {fmt(Math.max(0, E.size - ciS))}–{fmt(Math.min(E.domainN, E.size + ciS))} palabras · cobertura
        ±{(100 * ciC).toFixed(1)} pts · corrección k̂=(h−f)/(1−f), f de {E.pseudoN} pseudopalabras
      </p>
      <div dangerouslySetInnerHTML={{ __html: meterSVG(E.cov, { thresholds: mode !== 'dictado' }) }} />
      {/* A phone scrolls the table sideways: focusable and named, so a keyboard can scroll it too. */}
      <div className="vm-table-scroll" role="region" aria-label="Resultados por banda" tabIndex={0}>
        <table className="vm-table">
          <thead>
            <tr>
              <th>Banda</th>
              <th className="num">Ítems</th>
              <th className="num">"Sí" bruto</th>
              <th className="num">Conocido (corr.)</th>
              <th className="num">Peso del habla</th>
              <th className="num">Aporte a cobertura</th>
            </tr>
          </thead>
          <tbody>
            {E.rows.map((r) => (
              <tr key={r.band}>
                <td>{r.band}</td>
                <td className="num">{r.n}</td>
                <td className="num">{pct(r.h, 0)}</td>
                <td className="num">{pct(r.k, 0)}</td>
                <td className="num">{pct(r.M)}</td>
                <td className="num">{pct(r.M * r.k)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Las 5.000 palabras más frecuentes concentran {pct(E.domainMass)} de los tokens del habla; la cobertura más allá
        del rango 5.000 no se mide aquí. Umbrales de lectura: ~95% adecuado, ~98% cómodo.
      </p>
      {mode === 'dictado' ? null : mode === 'ldt' ? (
        <p className="note" style={{ marginTop: 26 }}>
          Sin estimación CEFR: las bandas X_Lex están calibradas para respuesta sin límite de tiempo; bajo presión
          temporal la tasa de aciertos baja y el nivel se subestimaría.
        </p>
      ) : mode === 'listen2' ? (
        <p className="note" style={{ marginTop: 26 }}>
          Sin estimación CEFR: la prueba auditiva del banco TTS mide solo las bandas cubiertas por el banco, así que la
          escala léxica absoluta 0–5.000 no es aplicable. Usa la prueba escrita de tamaño y cobertura para el nivel.
        </p>
      ) : cefrReliable ? (
        <>
          <span className="eyebrow" style={{ display: 'block', marginTop: 26 }}>
            Nivel CEFR estimado · {mode === 'listen' ? 'léxico auditivo' : 'léxico receptivo'}
          </span>
          <div className="res-head" style={{ marginTop: 6 }}>
            <Stat n={<>{C.pt.l}{C.range ? <small> ({C.range})</small> : null}</>} l="estimación léxica CEFR" />
          </div>
          <div dangerouslySetInnerHTML={{ __html: cefrLadderSVG(C) }} />
          <p className="note">
            <strong>{C.pt.l}:</strong> {C.pt.d}
            {C.range ? ` El intervalo de confianza cruza un límite de nivel (${C.range}): trata el nivel como provisional y vuelve a evaluar con más ítems por banda.` : ''}
          </p>
          <p className="note">
            Qué significa — y qué no: esto es un <em>indicador léxico</em> del CEFR (bandas X_Lex, Milton &amp; Alexiou 2009,
            lenguas romances), no una calificación CEFR. Úsalo para situar el input y elegir lecturas, no para certificar.
          </p>
        </>
      ) : (
        <p className="note" style={{ marginTop: 26 }}>
          Estimación CEFR omitida: con menos de 40 ítems reales o menos de 8 pseudopalabras el intervalo cruza varios
          niveles y resulta engañoso. Usa la prueba con más ítems por banda para obtener un nivel estimado.
        </p>
      )}
      {mode !== 'dictado' && E.f > 0.3 && (
        <div className="flag">
          Tasa de falsa alarma superior al 30% — dijiste «sí» a muchas palabras inventadas, así que la estimación
          corregida es inestable. Repite la prueba recordando que algunas palabras no existen.
        </div>
      )}
      {mode !== 'dictado' && E.pseudoN < 8 && (
        <div className="flag">Menos de 8 pseudopalabras — la corrección de falsa alarma es gruesa.</div>
      )}
    </div>
  );
}

export function VocabProtocolResultView({ mode, state, ps, blk, form, occasion }: {
  mode: 'c500' | 'a500' | 's5000';
  state: Record<number, number>;
  ps: [number, number];
  blk: number | 'P';
  form: string;
  occasion?: string;
}) {
  const idxs = Object.keys(state).map(Number);
  const count = (s: number) => idxs.filter((i) => state[i] === s).length;
  const total = idxs.length;
  return (
    <div>
      <span className="eyebrow">Resultados{occasion ? ` · ${occasion}` : ''}</span>
      <div className="res-head">
        {mode === 'a500' ? (
          <Stat n={<>{count(3)}<small> / {total}</small></>} l="producidas correctamente (activo)" />
        ) : (
          <>
            {/* s5000 only verifies band 2 (bands 3–5 are screened, never
                meaning-checked), so the stat names that rank range instead of
                claiming it also covers the bands 3–5 "sí" count beside it. */}
            <Stat
              n={<>{count(2)}<small> / {total}</small></>}
              l={'verificadas' + (mode === 's5000' ? ' (501–1.000)' : '')}
            />
            {mode === 's5000' ? (
              <Stat n={idxs.filter((i) => state[i] >= 1 && bandOfIdx(i) >= 2).length} l={'"sí" en bandas 3–5'} />
            ) : (
              <Stat n={count(1)} l="sí sin verificar" />
            )}
            {ps[0] ? <Stat n={pct(ps[1] / ps[0], 0)} l="falsa alarma del bloque" /> : null}
          </>
        )}
      </div>
      <p className="note">
        Bloque {String(blk)}{form ? ` · forma ${form}` : ''} completado. El resultado se ha guardado en tu cuenta:
        tu ficha anual acumula los bloques palabra por palabra.
      </p>
    </div>
  );
}

export function CtestResultView({ entries, occasion }: {
  entries: { gap: { word: string; stem: string }; typed: string; exact: boolean; lenient: boolean }[];
  occasion?: string;
}) {
  const n = entries.length;
  const c = entries.filter((e) => e.exact).length;
  const cl = entries.filter((e) => e.lenient).length;
  const [lo, hi] = n > 0 ? wilson(c / n, n) : [0, 0];
  return (
    <div>
      <span className="eyebrow">Resultados{occasion ? ` · ${occasion}` : ''}</span>
      <div className="res-head">
        <Stat n={<>{n ? fmt((100 * c) / n) : '0'}<small>%</small></>} l="restauraciones exactas" />
        <Stat n={<>{n ? fmt((100 * cl) / n) : '0'}<small>%</small></>} l="con acentos tolerados" />
        <Stat n={<>{c}<small> / {n}</small></>} l="exactas / huecos totales" />
      </div>
      {n > 0 && (
        <p className="ci">IC 95% (exactas): {pct(lo)}–{pct(hi)} · el C-test mide competencia general integrada (léxico + gramática + ortografía)</p>
      )}
      <p className="note">
        El C-test restaura palabras cortadas en textos de clase: correlaciona fuertemente con la competencia global y
        sirve para seguir el progreso del grupo con formas generadas de los propios materiales del curso.
      </p>
    </div>
  );
}
