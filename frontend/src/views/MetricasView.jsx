import React, { useEffect, useState } from "react";
import { reqJson } from "../lib/api";

/**
 * Métricas del Modelo.
 *
 * Responde a dos preguntas que suelen confundirse:
 *   · ¿Cuánto acierta?      -> las métricas de validación
 *   · ¿En qué se fija?      -> la influencia de cada variable
 *
 * Y a una tercera que casi nunca se responde y es la que más importa cuando
 * la predicción cae sobre un menor: ¿qué significa equivocarse aquí?
 *
 * Deliberadamente NO muestra validación cruzada: no se usó para entrenar
 * estos modelos, y enseñarla sugeriría un rigor que no se aplicó.
 */

const PORCENTAJE = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

/** Barra horizontal de influencia. El ancho es el dato; el color, contexto. */
function Barra({ pct, color = "var(--marca)" }) {
  return (
    <div className="mm-barra" role="presentation">
      <span className="mm-barra-fill" style={{ width: `${Math.max(pct, 0.6)}%`, background: color }} />
    </div>
  );
}

function TarjetaMetrica({ clave, nombre, valor, glosario }) {
  const g = glosario.find((x) => x.clave === clave);
  return (
    <div className="mm-metrica">
      <div className="mm-metrica-cab">
        <span className="mm-metrica-nombre">{nombre}</span>
        <span className="mm-metrica-valor">{PORCENTAJE(valor)}</span>
      </div>
      {g && (
        <>
          <p className="mm-metrica-que">{g.que_mide}</p>
          <p className="mm-metrica-ojo"><strong>Ojo:</strong> {g.cuidado}</p>
        </>
      )}
    </div>
  );
}

export default function MetricasView() {
  const [datos, setDatos] = useState(null);
  const [mTdah, setMTdah] = useState(null);
  const [mRiesgo, setMRiesgo] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [verTodos, setVerTodos] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      reqJson("/metricas/influencia/"),
      reqJson("/metricas/"),
      reqJson("/metricas-riesgo/"),
    ])
      .then(([inf, t, r]) => {
        if (!vivo) return;
        setDatos(inf);
        setMTdah(t);
        setMRiesgo(r);
      })
      .catch((e) => vivo && setError(e.message || "No se pudieron cargar las métricas."))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, []);

  if (cargando) return <div className="dashboard"><p className="muted">Cargando métricas…</p></div>;
  if (error) return <div className="dashboard"><p className="alert-error" role="alert">{error}</p></div>;

  const glosario = datos?.glosario ?? [];
  const items = datos?.tdah?.variables ?? [];
  const visibles = verTodos ? items : items.slice(0, 8);

  /** Matriz de confusión. La diagonal son los aciertos. */
  const Matriz = ({ datos }) => {
    if (!datos?.matriz_confusion) return null;
    const { clases, matriz } = datos.matriz_confusion;
    return (
      <div className="mm-matriz-wrap">
        <table className="mm-matriz">
          <caption>
            Filas: lo que dictaminó el profesional. Columnas: lo que predijo el modelo.
          </caption>
          <thead>
            <tr>
              <th scope="col"></th>
              {clases.map((c) => <th key={c} scope="col">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {matriz.map((fila, i) => (
              <tr key={clases[i]}>
                <th scope="row">{clases[i]}</th>
                {fila.map((n, j) => (
                  <td key={j} className={i === j ? "mm-acierto" : (n > 0 ? "mm-error-celda" : "")}>
                    {n}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  /** Bloque de la validación que sostiene la tesis: estudiantes reales. */
  const bloqueTest = (titulo, t, subtitulo) => {
    if (!t?.n) return null;
    const clases = Object.entries(t.por_clase ?? {});
    return (
      <section className="mm-bloque">
        <h2>{titulo}</h2>
        <p className="mm-sub">{subtitulo}</p>

        <div className="mm-titular">
          <span className="mm-titular-v">{PORCENTAJE(t.accuracy)}</span>
          <span className="mm-titular-l">
            de aciertos sobre {t.n} estudiantes reales
            {t.accuracy != null && ` · ${Math.round(t.accuracy * t.n)} de ${t.n}`}
          </span>
        </div>

        <Matriz datos={t} />

        <h3 className="mm-h3">Por nivel</h3>
        <table className="tabla mm-porclase">
          <thead>
            <tr><th>Nivel</th><th>Precisión</th><th>Sensibilidad</th><th>F1</th><th>Casos</th></tr>
          </thead>
          <tbody>
            {clases.map(([nombre, m]) => (
              <tr key={nombre}>
                <td>{nombre}</td>
                <td>{PORCENTAJE(m.precision)}</td>
                <td>{PORCENTAJE(m.recall)}</td>
                <td>{PORCENTAJE(m["f1-score"])}</td>
                <td>{m.soporte}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Un dato con 2 casos de soporte no sostiene un porcentaje: decir
            «100% de acierto» sobre dos personas induce a error. */}
        {clases.some(([, m]) => m.soporte < 5) && (
          <p className="mm-pie">
            Los niveles con pocos casos dan porcentajes poco fiables: con
            {" "}{clases.filter(([, m]) => m.soporte < 5).map(([n]) => n).join(" y ")}
            {" "}hay tan pocos estudiantes que un solo acierto o fallo mueve la
            cifra decenas de puntos.
          </p>
        )}
        {t.nota && <p className="mm-pie">{t.nota}</p>}
      </section>
    );
  };

  /** Validación durante el entrenamiento. Es contexto, no el titular. */
  const bloqueEntrenamiento = (titulo, m, subtitulo) => {
    const v = m?.val ?? {};
    return (
      <section className="mm-bloque mm-bloque--sec">
        <h2>{titulo}</h2>
        <p className="mm-sub">{subtitulo}</p>
        <div className="mm-metricas">
          <TarjetaMetrica clave="recall_macro"    nombre="Sensibilidad" valor={v.recall_macro}    glosario={glosario} />
          <TarjetaMetrica clave="precision_macro" nombre="Precisión"    valor={v.precision_macro} glosario={glosario} />
          <TarjetaMetrica clave="f1_macro"        nombre="F1"           valor={v.f1_macro}        glosario={glosario} />
          <TarjetaMetrica clave="accuracy"        nombre="Exactitud"    valor={v.accuracy}        glosario={glosario} />
        </div>
        <p className="mm-pie">
          Medido sobre la partición de validación
          {m?.n_val ? ` (${m.n_val} de los ${(m.n_train ?? 400) + m.n_val} registros sintéticos, los que el modelo no vio al entrenar)` : ""}
          {m?.train?.accuracy != null && v.accuracy != null && (
            <> · sobre los {m.n_train ?? 400} de entrenamiento la exactitud fue {PORCENTAJE(m.train.accuracy)}
              {m.train.accuracy - v.accuracy > 0.08
                ? ", una diferencia que indica cierto sobreajuste"
                : ", diferencia pequeña: el modelo generaliza"}</>
          )}
        </p>
      </section>
    );
  };

  return (
    <div className="dashboard">
      <h1 className="page-title">Métricas del Modelo</h1>

      <p className="mm-aviso" role="note">
        <strong>Esto es un tamizaje, no un diagnóstico.</strong>{" "}
        {datos?.aviso?.replace(/^El sistema es una herramienta de TAMIZAJE, no de diagnóstico\.\s*/, "")}
      </p>

      {bloqueTest(
        "Modelo 1 · Indicador de TDAH",
        datos?.test_real?.tdah,
        "Contrastado con el dictamen del psicólogo del centro sobre estudiantes reales."
      )}

      {bloqueTest(
        "Modelo 2 · Riesgo académico",
        datos?.test_real?.riesgo,
        "Contrastado con la valoración de los profesores sobre esos mismos estudiantes."
      )}

      {/* Estas cifras son distintas de las de arriba, y las dos son correctas:
          miden cosas diferentes. Explicarlo aquí evita la pregunta incómoda de
          «¿por qué la aplicación dice 80% y el documento 93%?». */}
      <section className="mm-bloque mm-bloque--sec">
        <h2>De dónde salen los datos</h2>
        <p className="mm-sub">
          Se usan dos conjuntos y ninguno sustituye al otro: miden cosas
          distintas.
        </p>

        <table className="tabla mm-origen">
          <thead>
            <tr><th>Conjunto</th><th>Qué es</th><th>Para qué sirve</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>500 registros</strong><br /><span className="muted">sintéticos</span></td>
              <td>
                Generados para entrenar. Se reparten de forma estratificada en
                <strong> 400 de entrenamiento</strong> y <strong>100 de
                validación</strong>, manteniendo la proporción de cada nivel.
              </td>
              <td>
                Comprobar que el modelo <strong>aprendió el patrón</strong> en
                lugar de memorizar los casos. No dice nada sobre personas reales.
              </td>
            </tr>
            <tr>
              <td><strong>30 estudiantes</strong><br /><span className="muted">reales</span></td>
              <td>
                Alumnos del centro, con el dictamen del psicólogo para el
                indicador de TDAH y la valoración de los profesores para el
                riesgo académico.
              </td>
              <td>
                Comprobar si <strong>acierta</strong> frente al criterio de un
                profesional. Es la cifra que sostiene la tesis.
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mm-pie">
          Los 30 estudiantes reales <strong>no participaron en el
          entrenamiento</strong>: el modelo los vio por primera vez al
          evaluarlos. Por eso su resultado es una medida independiente y no una
          comprobación sobre datos ya conocidos.
        </p>
      </section>

      {bloqueEntrenamiento(
        "Validación de entrenamiento · TDAH",
        mTdah,
        "Clasifica el nivel de sospecha a partir de los 20 ítems de la escala EDAH."
      )}

      {bloqueEntrenamiento(
        "Validación de entrenamiento · Riesgo académico",
        mRiesgo,
        "Estima el riesgo con el promedio de notas, las inasistencias y la probabilidad de TDAH."
      )}

      <section className="mm-bloque">
        <h2>En qué se fija el modelo de riesgo</h2>
        <p className="mm-sub">
          Peso de cada variable, medido por la ganancia total que aporta a los
          cortes del árbol. Explica el modelo en conjunto, no un caso concreto:
          para eso está el desglose SHAP de cada predicción.
        </p>
        <ul className="mm-lista">
          {(datos?.riesgo?.variables ?? []).map((v) => (
            <li key={v.variable}>
              <div className="mm-fila">
                <span className="mm-etq">{v.etiqueta}</span>
                <span className="mm-pct">{v.porcentaje.toFixed(1)}%</span>
              </div>
              <Barra pct={v.porcentaje} color="var(--dato)" />
            </li>
          ))}
        </ul>
      </section>

      <section className="mm-bloque">
        <h2>En qué se fija el modelo de TDAH</h2>
        <p className="mm-sub">
          El EDAH se interpreta por subescalas, así que conviene mirarlas antes
          que los ítems sueltos.
        </p>
        <ul className="mm-lista">
          {(datos?.tdah?.por_subescala ?? []).map((g) => (
            <li key={g.clave}>
              <div className="mm-fila">
                <span className="mm-etq">{g.nombre}</span>
                <span className="mm-pct">{g.porcentaje.toFixed(1)}%</span>
              </div>
              <Barra pct={g.porcentaje} color="var(--marca)" />
            </li>
          ))}
        </ul>

        <h3 className="mm-h3">Ítem por ítem</h3>
        <ul className="mm-lista">
          {visibles.map((v) => (
            <li key={v.variable}>
              <div className="mm-fila">
                <span className="mm-etq">{v.etiqueta}</span>
                <span className="mm-pct">{v.porcentaje.toFixed(1)}%</span>
              </div>
              <Barra pct={v.porcentaje} color="var(--marca-fuerte)" />
            </li>
          ))}
        </ul>
        {items.length > 8 && (
          <button type="button" className="enlace" onClick={() => setVerTodos(!verTodos)}>
            {verTodos ? "Ver solo los 8 más influyentes" : `Ver los ${items.length} ítems`}
          </button>
        )}
      </section>

      <section className="mm-bloque">
        <h2>Qué significa equivocarse aquí</h2>
        <div className="mm-errores">
          <div className="mm-error mm-error--fn">
            <h3>Falso negativo</h3>
            <p>Un estudiante que necesita apoyo y el sistema no señala.</p>
            <p className="mm-consecuencia">
              Es el error grave: nadie lo evalúa y el problema sigue. Por eso se
              prioriza la <strong>sensibilidad</strong> sobre la precisión.
            </p>
          </div>
          <div className="mm-error mm-error--fp">
            <h3>Falso positivo</h3>
            <p>Un estudiante señalado que, al evaluarlo, no presentaba indicios.</p>
            <p className="mm-consecuencia">
              Cuesta tiempo del psicólogo y puede generar inquietud en la
              familia, pero se corrige en la entrevista. Es el error asumible.
            </p>
          </div>
        </div>
        <p className="mm-pie">
          Los modelos se entrenaron con datos sintéticos y se validaron contra
          casos reales del centro. Las cifras de arriba son de esa validación:
          describen cómo se comportó con quienes ya se conocía el resultado, no
          una garantía sobre quienes vengan.
        </p>
      </section>
    </div>
  );
}
