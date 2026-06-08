import { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const API = "http://127.0.0.1:8000/api";
const views = ["dashboard", "alumno", "encuesta", "predicciones", "notas", "expediente"];
const encuestaKeys = [
  "DA1", "DA2", "DA3", "DA4", "DA5",
  "HI1", "HI2", "HI3", "HI4", "HI5",
  "TC1", "TC2", "TC3", "TC4", "TC5", "TC6", "TC7", "TC8", "TC9", "TC10",
];

const encuestaKeysDA = encuestaKeys.filter((k) => k.startsWith("DA"));
const encuestaKeysHI = encuestaKeys.filter((k) => k.startsWith("HI"));
const encuestaKeysTC = encuestaKeys.filter((k) => k.startsWith("TC"));

const encuestaLabels = {
  DA1: "¿Se distrae fácilmente durante las actividades escolares o tareas cotidianas?",
  DA2: "¿Presenta dificultades para mantener la atención durante períodos prolongados?",
  DA3: "¿Parece no escuchar cuando se le habla directamente?",
  DA4: "¿Deja sin terminar las tareas o actividades que comienza?",
  DA5: "¿Tiene dificultades para organizar sus tareas, materiales o actividades escolares?",
  HI1: "¿Presenta excesiva inquietud motora o dificultad para permanecer quieto?",
  HI2: "¿Mueve constantemente las manos, los pies o cambia frecuentemente de posición?",
  HI3: "¿Tiene dificultades para permanecer sentado cuando la situación lo requiere?",
  HI4: "¿Actúa o responde impulsivamente sin pensar en las consecuencias?",
  HI5: "¿Tiene dificultades para esperar su turno o respetar los tiempos de los demás?",
  TC1: "¿Molesta frecuentemente a compañeros, familiares u otras personas?",
  TC2: "¿Tiene dificultades para trabajar o participar en actividades grupales de manera adecuada?",
  TC3: "¿Niega sus errores o culpa a otras personas por sus acciones?",
  TC4: "¿Grita o responde de forma inapropiada en situaciones que requieren autocontrol?",
  TC5: "¿Contesta de manera desafiante o irrespetuosa a figuras de autoridad?",
  TC6: "¿Discute frecuentemente con otras personas por situaciones menores?",
  TC7: "¿Se involucra en conflictos o peleas con otros compañeros o personas de su entorno?",
  TC8: "¿Presenta explosiones de enojo o cambios bruscos de comportamiento difíciles de controlar?",
  TC9: "¿Muestra dificultades para respetar normas, reglas o acuerdos establecidos?",
  TC10: "¿Es frecuentemente impulsivo, irritable o presenta problemas para controlar su comportamiento social?",
};

const encuestaEscalaOpciones = [
  { value: "0", label: "0 - Nunca" },
  { value: "1", label: "1 - Algunas veces" },
  { value: "2", label: "2 - Bastantes veces" },
  { value: "3", label: "3 - Siempre" },
];

const encuestaLeyendaAtencion = "0: Nunca | 1: Algunas veces | 2: Bastantes veces | 3: Siempre";

const ASIGNATURAS_VALIDAS = [
  "Matemática", "Comunicación", "Ciencias Sociales", "Ciencia y Tecnología",
  "Inglés", "Educación Física", "Arte", "Religión",
];

function normalizarCalificacionLiteral(texto) {
  const t = String(texto).trim().toUpperCase();
  if (t === "AD") return "AD";
  if (t === "A" || t === "B" || t === "C") return t;
  return null;
}

const evalSocialLabels = {
  c1: "C1: Asistencia y Participación Familiar",
  c2: "C2: Estabilidad Familiar",
  c3: "C3: Soporte Académico",
  c4: "C4: Cuidado y Atención",
  c5: "C5: Integración de Pares",
  c6: "C6: Riesgo de Aislamiento",
  c7: "C7: Conducta Prosocial",
  c8: "C8: Vulnerabilidad Social",
};

const socialSelectOptions = [
  { value: "0", label: "0 - Ningún Problema" },
  { value: "1", label: "1 - Leve" },
  { value: "2", label: "2 - Moderado" },
  { value: "3", label: "3 - Grave" },
];

const initialAlumno = {
  nombre: "", apellido: "", contacto_emergente: "", edad: "", grado: "",
  anio_cursada: "2025", genero: "",
  c1: "0", c2: "0", c3: "0", c4: "0", c5: "0", c6: "0", c7: "0", c8: "0",
};

const initialEncuesta = Object.fromEntries([["alumno", ""], ...encuestaKeys.map((k) => [k, "0"])]);
const initialNota = { alumno: "", asignatura: "", nota: "" };
const initialExpediente = { alumno: "", nivel_preocupacion: "3", archivo_pdf: null };

function socialToCondicion(maxSocial) {
  if (maxSocial <= 0) return "NINGUNA";
  if (maxSocial === 1) return "LEVE";
  if (maxSocial === 2) return "MODERADA";
  return "GRAVE";
}

async function req(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

/* ── Chart & dashboard helpers ─────────────────────────────────────────── */

const RIESGO_COLORS = { Alto: "#ef4444", Medio: "#f97316", Moderado: "#f97316", Bajo: "#22c55e" };
const FACTOR_COLORS = ["#f97316", "#fb923c", "#3b82f6", "#22c55e", "#a855f7", "#14b8a6"];

function buildAcadPieData(nivelRiesgo, probabilidad) {
  const top = Math.round(probabilidad * 100);
  const rem = 100 - top;
  if (nivelRiesgo === "Alto") return [
    { name: "Alto", value: top },
    { name: "Medio", value: Math.round(rem * 0.62) },
    { name: "Bajo", value: rem - Math.round(rem * 0.62) },
  ];
  if (nivelRiesgo === "Medio") return [
    { name: "Alto", value: Math.round(rem * 0.55) },
    { name: "Medio", value: top },
    { name: "Bajo", value: rem - Math.round(rem * 0.55) },
  ];
  return [
    { name: "Alto", value: Math.round(rem * 0.18) },
    { name: "Medio", value: rem - Math.round(rem * 0.18) },
    { name: "Bajo", value: top },
  ];
}

function buildTdahPieData(probTdah) {
  const pct = Math.round((probTdah ?? 0) * 100);
  return [
    { name: "Posible TDAH", value: pct },
    { name: "Sin TDAH",     value: 100 - pct },
  ].filter((d) => d.value > 0);
}

function parseSocialPct(condStr) {
  const m = condStr.match(/Condici[^\s:]+n social[:\s]+(\w+)/i);
  const val = m ? m[1].toUpperCase() : "NINGUNA";
  return { NINGUNA: 0, LEVE: 25, MODERADA: 60, GRAVE: 90 }[val] ?? 20;
}

function buildFactoresData(pred) {
  const socialPct = parseSocialPct(pred.condiciones_psicoeducativas || "");
  return [
    { name: "Inatención", valor: Math.round((pred.total_atencion / 15) * 100) },
    { name: "Hiperactividad", valor: Math.round((pred.total_hiperactividad / 15) * 100) },
    { name: "Rend. Académico", valor: Math.round(((20 - (pred.promedio_notas || 0)) / 20) * 100) },
    { name: "Cond. Social", valor: socialPct },
  ].sort((a, b) => b.valor - a.valor);
}

function deriveTdahLevel(nivelTdah) {
  if (!nivelTdah) return "Bajo";
  if (nivelTdah === "Posible TDAH") return "Moderado";
  return "Bajo";
}

function interpretacionTdah(nivelTdah) {
  if (nivelTdah === "Posible TDAH") {
    return "Se identifican indicadores compatibles con posible TDAH (DA > 10 o HI > 10). Se recomienda evaluación diagnóstica especializada.";
  }
  return "No se identifican indicadores significativos de TDAH (DA ≤ 10 y HI ≤ 10).";
}

function generarRecomendaciones(pred) {
  const recs = [];
  if (pred.total_atencion >= 11) {
    recs.push({ icon: "📚", text: "Refuerzo en técnicas de atención y concentración.", priority: "alta", priorityLabel: "Prioridad alta" });
    recs.push({ icon: "👤", text: "Seguimiento psicopedagógico individual.", priority: "alta", priorityLabel: "Prioridad alta" });
  }
  if (pred.total_hiperactividad >= 11) {
    recs.push({ icon: "👥", text: "Talleres de manejo de impulsos y autorregulación.", priority: "media", priorityLabel: "Prioridad media" });
  }
  if (pred.nivel_riesgo === "Alto") {
    recs.push({ icon: "📊", text: "Monitoreo continuo del rendimiento académico.", priority: "baja", priorityLabel: "Prioridad baja" });
    recs.push({ icon: "🏠", text: "Coordinación con familia para apoyo escolar.", priority: "alta", priorityLabel: "Prioridad alta" });
  } else if (pred.nivel_riesgo === "Medio") {
    recs.push({ icon: "📊", text: "Monitoreo periódico del rendimiento académico.", priority: "media", priorityLabel: "Prioridad media" });
  } else {
    recs.push({ icon: "✅", text: "Continuar con las actividades regulares.", priority: "baja", priorityLabel: "Prioridad baja" });
  }
  if (recs.length === 0) {
    recs.push({ icon: "📋", text: "Evaluar con más datos para generar recomendaciones.", priority: "baja", priorityLabel: "Prioridad baja" });
  }
  return recs.slice(0, 5);
}

/* ── App ───────────────────────────────────────────────────────────────── */

export default function App() {
  const [auth, setAuth] = useState({ usuario: "", password: "", logged: false });
  const [activeView, setActiveView] = useState("dashboard");
  const [status, setStatus] = useState({ msg: "", error: false });
  const [alumnos, setAlumnos] = useState([]);

  const [alumnoForm, setAlumnoForm] = useState(initialAlumno);
  const [encuestaForm, setEncuestaForm] = useState(initialEncuesta);
  const [notaForm, setNotaForm] = useState(initialNota);
  const [expForm, setExpForm] = useState(initialExpediente);
  const [predAlumno, setPredAlumno] = useState("");
  const [predicciones, setPredicciones] = useState([]);
  const [alumnoFormError, setAlumnoFormError] = useState("");
  const [encuestaStatus, setEncuestaStatus] = useState({ msg: "", error: false });
  const [notasModoLista, setNotasModoLista] = useState("actuales");
  const [notasModoCarga, setNotasModoCarga] = useState("individual");
  const [notasStatus, setNotasStatus] = useState({ msg: "", error: false });
  const [historicoNotas, setHistoricoNotas] = useState([]);
  const [archivoMasivo, setArchivoMasivo] = useState(null);

  // Dashboard states
  const [dashAlumno, setDashAlumno] = useState("");
  const [dashData, setDashData] = useState(null);

  const goToView = (v) => {
    setActiveView(v);
    setStatus({ msg: "", error: false });
    setAlumnoFormError("");
    setEncuestaStatus({ msg: "", error: false });
    setNotasStatus({ msg: "", error: false });
  };

  const alumnoOptions = useMemo(
    () => alumnos.map((a) => ({ value: a.id, label: `${a.nombre} ${a.apellido} - ${a.grado}` })),
    [alumnos]
  );

  async function loadAlumnos() {
    const data = await req("/alumnos/");
    setAlumnos(data);
  }

  async function loadPredicciones(alumnoId) {
    if (!alumnoId) return setPredicciones([]);
    const data = await req(`/predicciones/?alumno=${alumnoId}`);
    setPredicciones(data);
  }

  async function loadDashData(alumnoId) {
    if (!alumnoId) return setDashData(null);
    try {
      const data = await req(`/predicciones/?alumno=${alumnoId}`);
      setDashData(data.length > 0 ? data[0] : null);
    } catch {
      setDashData(null);
    }
  }

  useEffect(() => {
    if (auth.logged) {
      loadAlumnos().catch((e) => setStatus({ msg: e.message, error: true }));
    }
  }, [auth.logged]);

  useEffect(() => {
    if (!auth.logged || activeView !== "notas" || notasModoLista !== "historico") return;
    const id = notaForm.alumno;
    if (!id) { setHistoricoNotas([]); return; }
    let cancelled = false;
    req(`/notas/?alumno=${id}`)
      .then((data) => { if (!cancelled) { setHistoricoNotas(Array.isArray(data) ? data : []); setNotasStatus({ msg: "", error: false }); } })
      .catch((err) => { if (!cancelled) { setHistoricoNotas([]); setNotasStatus({ msg: err.message || "Error al cargar el histórico de notas.", error: true }); } });
    return () => { cancelled = true; };
  }, [auth.logged, activeView, notasModoLista, notaForm.alumno]);

  const notify = (msg, error = false) => setStatus({ msg, error });

  const onLogin = (e) => {
    e.preventDefault();
    if (auth.usuario === "admin" && auth.password === "admin123") {
      setAuth((s) => ({ ...s, logged: true }));
      notify("Sesión iniciada correctamente.");
    } else {
      notify("Credenciales inválidas.", true);
    }
  };

  const submitAlumno = async (e) => {
    e.preventDefault();
    setAlumnoFormError("");
    const socialVals = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map((k) => Number(alumnoForm[k]));
    const body = {
      nombre: alumnoForm.nombre, apellido: alumnoForm.apellido,
      contacto_emergente: alumnoForm.contacto_emergente, edad: Number(alumnoForm.edad),
      grado: alumnoForm.grado, anio_cursada: Number(alumnoForm.anio_cursada),
      condicion_social: socialToCondicion(Math.max(...socialVals)),
      genero: alumnoForm.genero || "No especificado",
    };
    try {
      await req("/alumnos/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setAlumnoForm(initialAlumno);
      await loadAlumnos();
      notify("Alumno registrado.");
    } catch (err) {
      setAlumnoFormError(err.message || "No se pudo registrar el alumno.");
    }
  };

  const submitEncuesta = async (e) => {
    e.preventDefault();
    setEncuestaStatus({ msg: "", error: false });
    const body = { alumno: Number(encuestaForm.alumno) };
    encuestaKeys.forEach((k) => { body[k] = Number(encuestaForm[k]); });
    try {
      await req("/encuestas/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setEncuestaStatus({ msg: "Encuesta guardada correctamente.", error: false });
    } catch (err) {
      setEncuestaStatus({ msg: err.message || "No se pudo guardar la encuesta.", error: true });
    }
  };

  const submitNota = async (e) => {
    e.preventDefault();
    setNotasStatus({ msg: "", error: false });
    const asignatura = notaForm.asignatura.trim();
    if (!ASIGNATURAS_VALIDAS.includes(asignatura)) {
      setNotasStatus({ msg: `Asignatura no válida. Use exactamente: ${ASIGNATURAS_VALIDAS.join(", ")}.`, error: true });
      return;
    }
    const calificacion_literal = normalizarCalificacionLiteral(notaForm.nota);
    if (!calificacion_literal) {
      setNotasStatus({ msg: "La nota debe ser AD, A, B o C.", error: true });
      return;
    }
    try {
      await req("/notas/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alumno: Number(notaForm.alumno), asignatura, calificacion_literal }) });
      setNotaForm({ ...notaForm, asignatura: "", nota: "" });
      setNotasStatus({ msg: "Nota registrada correctamente.", error: false });
    } catch (err) {
      setNotasStatus({ msg: err.message || "No se pudo registrar la nota.", error: true });
    }
  };

  const submitMasivaCsv = async (e) => {
    e.preventDefault();
    setNotasStatus({ msg: "", error: false });
    if (!archivoMasivo) { setNotasStatus({ msg: "Selecciona un archivo CSV.", error: true }); return; }
    const text = await archivoMasivo.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) { setNotasStatus({ msg: "El CSV debe tener encabezado y al menos una fila de datos.", error: true }); return; }
    let ok = 0;
    const errores = [];
    for (let i = 1; i < lines.length; i++) {
      const partes = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const [alumnoId, asig, notaVal] = partes;
      if (!alumnoId || !asig || notaVal === undefined) { errores.push(`Fila ${i + 1}: datos incompletos`); continue; }
      if (!ASIGNATURAS_VALIDAS.includes(asig)) { errores.push(`Fila ${i + 1}: asignatura no válida`); continue; }
      const lit = normalizarCalificacionLiteral(notaVal);
      if (!lit) { errores.push(`Fila ${i + 1}: calificación debe ser AD, A, B o C`); continue; }
      try {
        await req("/notas/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alumno: Number(alumnoId), asignatura: asig, calificacion_literal: lit }) });
        ok += 1;
      } catch (err) { errores.push(`Fila ${i + 1}: ${err.message || "error"}`); }
    }
    setArchivoMasivo(null);
    await loadAlumnos();
    if (errores.length) {
      setNotasStatus({ msg: `Procesadas ${ok} filas. Errores: ${errores.slice(0, 5).join("; ")}${errores.length > 5 ? "…" : ""}`, error: ok === 0 });
    } else {
      setNotasStatus({ msg: `Carga masiva: ${ok} nota(s) registrada(s).`, error: false });
    }
  };

  const submitExpediente = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append("alumno", expForm.alumno);
    fd.append("nivel_preocupacion", expForm.nivel_preocupacion);
    if (expForm.archivo_pdf) fd.append("archivo_pdf", expForm.archivo_pdf);
    await req("/expedientes/", { method: "POST", body: fd });
    notify("Expediente guardado.");
  };

  const generarPrediccion = async () => {
    if (!predAlumno) return notify("Selecciona un alumno para generar predicción.", true);
    try {
      await req("/predicciones/generar/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alumno: Number(predAlumno) }) });
      await loadPredicciones(predAlumno);
      notify("Predicción generada.");
    } catch (err) {
      let msg = err.message || "Error al generar predicción.";
      try { msg = JSON.parse(msg).detail ?? msg; } catch (_) {}
      notify(msg, true);
    }
  };

  /* ── Auth screen ─────────────────────────────────────────────────────── */

  if (!auth.logged) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Sistema de Predicción Educativa</h1>
          <p>Inicia sesión</p>
          <form onSubmit={onLogin}>
            <label>Usuario</label>
            <input value={auth.usuario} onChange={(e) => setAuth({ ...auth, usuario: e.target.value })} required />
            <label>Contraseña</label>
            <input type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} required />
            <button type="submit">Iniciar Sesión</button>
          </form>
          <small>Usuario: <strong>admin</strong> | Contraseña: <strong>admin123</strong></small>
          {status.msg && <p className="status" style={{ color: status.error ? "#d62828" : "#14732b" }}>{status.msg}</p>}
        </section>
      </main>
    );
  }

  /* ── Main app ────────────────────────────────────────────────────────── */

  const navLabels = {
    dashboard:    { icon: "⊞", label: "Dashboard" },
    alumno:       { icon: "◎", label: "Registrar Alumno" },
    encuesta:     { icon: "☰", label: "Encuesta" },
    predicciones: { icon: "↗", label: "Predicciones" },
    notas:        { icon: "✎", label: "Subir Notas" },
    expediente:   { icon: "⊡", label: "Expediente Psicológico" },
  };

  return (
    <div className="app-shell">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">📖</span>
          <div>
            <h2>Sistema</h2>
            <span>admin</span>
          </div>
        </div>
        <nav>
          {views.map((v) => {
            const { icon, label } = navLabels[v];
            return (
              <button
                key={v}
                type="button"
                className={activeView === v ? "nav-active" : ""}
                onClick={() => goToView(v)}
              >
                <span className="nav-icon">{icon}</span>
                {label}
              </button>
            );
          })}
          <button type="button" className="danger" onClick={() => window.location.reload()}>
            <span className="nav-icon">⊗</span>
            Cerrar Sesión
          </button>
        </nav>
      </aside>

      {/* ── Content ─────────────────────────────────── */}
      <section className="content">

        {/* ── Dashboard ──────────────────────────────── */}
        {activeView === "dashboard" && (() => {
          const riesgoColor = dashData
            ? (dashData.nivel_riesgo === "Alto" ? "#ef4444" : dashData.nivel_riesgo === "Medio" ? "#f97316" : "#22c55e")
            : "#94a3b8";

          const tdahLevel = dashData?.nivel_tdah ?? null;
          const tdahColor = tdahLevel?.startsWith("Posible") ? "#f97316" : "#22c55e";
          const tdahProbPct = dashData
            ? Math.round((dashData.prob_tdah ?? (dashData.total_atencion + dashData.total_hiperactividad) / 30) * 100)
            : 0;
          const rendimiento = dashData ? Math.round((dashData.promedio_notas / 20) * 100) : 0;
          const rendColor = rendimiento >= 75 ? "#22c55e" : rendimiento >= 50 ? "#f97316" : "#ef4444";

          const tdahProb    = dashData
            ? (dashData.prob_tdah ?? ((dashData.total_atencion ?? 0) + (dashData.total_hiperactividad ?? 0)) / 30)
            : 0;
          const acadPieData = dashData ? buildAcadPieData(dashData.nivel_riesgo, dashData.probabilidad) : [];
          const tdahPieData = dashData ? buildTdahPieData(tdahProb) : [];
          const factoresData = dashData ? buildFactoresData(dashData) : [];
          const recomendaciones = dashData ? generarRecomendaciones(dashData) : [];

          return (
            <div className="dashboard">
              <h1 className="page-title">Dashboard del Estudiante</h1>

              {/* Student selector */}
              <article className="panel dash-selector-panel">
                <label className="dash-selector-label">Selecciona un Estudiante</label>
                <select
                  className="dash-selector-select"
                  value={dashAlumno}
                  onChange={(e) => {
                    setDashAlumno(e.target.value);
                    loadDashData(e.target.value);
                  }}
                >
                  <option value="">-- Selecciona --</option>
                  {alumnoOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </article>

              {/* No prediction for selected student */}
              {dashAlumno && !dashData && (
                <p className="dash-empty">
                  No hay predicciones para este estudiante.{" "}
                  <button
                    type="button"
                    className="dash-link-btn"
                    onClick={() => goToView("predicciones")}
                  >
                    Generar predicción →
                  </button>
                </p>
              )}

              {/* Full dashboard when data is available */}
              {dashData && (
                <>
                  {/* KPI Cards */}
                  <div className="kpi-row">
                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon--person">👤</div>
                      <div className="kpi-body">
                        <span className="kpi-label">Riesgo Académico</span>
                        <span className="kpi-value" style={{ color: riesgoColor }}>
                          {dashData.nivel_riesgo}
                        </span>
                        <span className="kpi-sub">
                          Probabilidad: {Math.round(dashData.probabilidad * 100)}%
                          <span className="kpi-arrow" style={{ color: riesgoColor }}>
                            {dashData.nivel_riesgo === "Alto" ? " ↑" : dashData.nivel_riesgo === "Bajo" ? " ↓" : " →"}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon--brain">🧠</div>
                      <div className="kpi-body">
                        <span className="kpi-label">Riesgo TDAH</span>
                        <span className="kpi-value" style={{ color: tdahColor }}>
                          {tdahLevel}
                        </span>
                        <span className="kpi-sub">
                          Probabilidad: {tdahProbPct}%
                          <span className="kpi-arrow" style={{ color: tdahColor }}>
                            {tdahLevel?.startsWith("Posible") ? " ⚠" : " ✓"}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon--chart">📊</div>
                      <div className="kpi-body">
                        <span className="kpi-label">Rendimiento General</span>
                        <span className="kpi-value" style={{ color: rendColor }}>
                          {rendimiento} / 100
                        </span>
                        <span className="kpi-sub">Promedio ponderado</span>
                      </div>
                    </div>
                  </div>

                  {/* Donut Charts */}
                  <div className="charts-row">
                    <div className="chart-panel">
                      <h3 className="chart-title">Predicción Riesgo Académico</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie
                            data={acadPieData}
                            cx="50%" cy="50%"
                            innerRadius={58} outerRadius={90}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {acadPieData.map((entry) => (
                              <Cell key={entry.name} fill={RIESGO_COLORS[entry.name]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => `${v}%`} />
                          <Legend iconType="circle" iconSize={10} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="chart-panel">
                      <h3 className="chart-title">Predicción TDAH</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie
                            data={tdahPieData}
                            cx="50%" cy="50%"
                            innerRadius={58} outerRadius={90}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {tdahPieData.map((entry) => (
                              <Cell
                                key={entry.name}
                                fill={entry.name === "Posible TDAH" ? "#f97316" : "#22c55e"}
                              />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => `${v}%`} />
                          <Legend iconType="circle" iconSize={10} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Factors + Recommendations */}
                  <div className="bottom-row">
                    <div className="chart-panel">
                      <h3 className="chart-title">Factores que Influyen en el Riesgo</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart
                          data={factoresData}
                          layout="vertical"
                          margin={{ left: 8, right: 44, top: 4, bottom: 4 }}
                        >
                          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                          <Tooltip formatter={(v) => `${v}%`} />
                          <Bar
                            dataKey="valor"
                            radius={[0, 6, 6, 0]}
                            label={{ position: "right", formatter: (v) => `${v}%`, fontSize: 12, fill: "#334155" }}
                          >
                            {factoresData.map((_, i) => (
                              <Cell key={i} fill={FACTOR_COLORS[i % FACTOR_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="chart-panel">
                      <h3 className="chart-title">Recomendaciones Generadas</h3>
                      <ul className="rec-list">
                        {recomendaciones.map((r, i) => (
                          <li key={i} className="rec-item">
                            <span className="rec-icon">{r.icon}</span>
                            <span className="rec-text">{r.text}</span>
                            <span className={`priority-tag priority-tag--${r.priority}`}>{r.priorityLabel}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="ver-todas-btn"
                        onClick={() => goToView("predicciones")}
                      >
                        Ver todas las recomendaciones
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* ── Registrar Alumno ───────────────────────── */}
        {activeView === "alumno" && (
          <>
            <h1 className="page-title">Registrar Nuevo Alumno</h1>
            <article className="panel">
              <form className="grid" onSubmit={submitAlumno}>
                <div className="field-group">
                  <label htmlFor="alumno-nombre">Nombre</label>
                  <input id="alumno-nombre" type="text" value={alumnoForm.nombre} onChange={(e) => setAlumnoForm({ ...alumnoForm, nombre: e.target.value })} required />
                </div>
                <div className="field-group">
                  <label htmlFor="alumno-apellido">Apellido</label>
                  <input id="alumno-apellido" type="text" value={alumnoForm.apellido} onChange={(e) => setAlumnoForm({ ...alumnoForm, apellido: e.target.value })} required />
                </div>
                <div className="field-group">
                  <label htmlFor="alumno-contacto">Contacto de Emergencia</label>
                  <input id="alumno-contacto" type="text" value={alumnoForm.contacto_emergente} onChange={(e) => setAlumnoForm({ ...alumnoForm, contacto_emergente: e.target.value })} required />
                </div>
                <div className="field-group">
                  <label htmlFor="alumno-edad">Edad</label>
                  <input id="alumno-edad" type="number" min={5} max={30} value={alumnoForm.edad} onChange={(e) => setAlumnoForm({ ...alumnoForm, edad: e.target.value })} required />
                </div>
                <div className="field-group">
                  <label htmlFor="alumno-grado">Grado</label>
                  <select id="alumno-grado" value={alumnoForm.grado} onChange={(e) => setAlumnoForm({ ...alumnoForm, grado: e.target.value })} required>
                    <option value="">Selecciona (ej. 10mo)</option>
                    <option value="1°">1°</option>
                    <option value="2°">2°</option>
                    <option value="3°">3°</option>
                    <option value="4°">4°</option>
                    <option value="5°">5°</option>
                    <option value="10mo">10mo</option>
                    <option value="11vo">11vo</option>
                    <option value="12vo">12vo</option>
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="alumno-anio">Año de cursada</label>
                  <input id="alumno-anio" type="number" placeholder="2025" value={alumnoForm.anio_cursada} onChange={(e) => setAlumnoForm({ ...alumnoForm, anio_cursada: e.target.value })} required />
                </div>
                <div className="field-group">
                  <label htmlFor="alumno-genero">Género</label>
                  <select id="alumno-genero" value={alumnoForm.genero} onChange={(e) => setAlumnoForm({ ...alumnoForm, genero: e.target.value })} required>
                    <option value="">Selecciona</option>
                    <option value="Masculino">Masculino</option>
                    <option value="Femenino">Femenino</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
                <div className="form-section full">
                  <h3 className="form-section__title">Evaluación Social (0-3)</h3>
                  <p className="form-legend">0: Ningún Problema | 1: Leve | 2: Moderado | 3: Grave</p>
                  <div className="grid" style={{ marginTop: 8 }}>
                    {["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map((c) => (
                      <div key={c} className="field-group">
                        <label htmlFor={`alumno-${c}`}>{evalSocialLabels[c]}</label>
                        <select id={`alumno-${c}`} value={alumnoForm[c]} onChange={(e) => setAlumnoForm({ ...alumnoForm, [c]: e.target.value })}>
                          {socialSelectOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                {alumnoFormError && <div className="alert-error" role="alert">{alumnoFormError}</div>}
                <button className="full" type="submit">Registrar Alumno</button>
              </form>
            </article>
          </>
        )}

        {/* ── Encuesta ───────────────────────────────── */}
        {activeView === "encuesta" && (
          <div className="encuesta-layout">
            <h1 className="page-title">Encuesta Psicoeducativa</h1>
            <article className="panel panel-encuesta">
              <form className="grid encuesta-form" onSubmit={submitEncuesta}>
                <div className="field-group full">
                  <label htmlFor="encuesta-alumno">Selecciona Estudiante</label>
                  <select id="encuesta-alumno" value={encuestaForm.alumno} onChange={(e) => setEncuestaForm({ ...encuestaForm, alumno: e.target.value })} required>
                    <option value="">-- Selecciona --</option>
                    {alumnoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="form-section full encuesta-bloque">
                  <h3 className="form-section__title">Déficit de Atención (DA1-DA5)</h3>
                  <p className="form-legend">{encuestaLeyendaAtencion}</p>
                  <div className="grid encuesta-grid">
                    {encuestaKeysDA.map((k) => (
                      <div key={k} className="field-group">
                        <label htmlFor={`encuesta-${k}`}>{k}: {encuestaLabels[k]}</label>
                        <select id={`encuesta-${k}`} value={encuestaForm[k]} onChange={(e) => setEncuestaForm({ ...encuestaForm, [k]: e.target.value })}>
                          {encuestaEscalaOpciones.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="form-section full encuesta-bloque">
                  <h3 className="form-section__title">Hiperactividad e Impulsividad (HI1-HI5)</h3>
                  <div className="grid encuesta-grid">
                    {encuestaKeysHI.map((k) => (
                      <div key={k} className="field-group">
                        <label htmlFor={`encuesta-${k}`}>{k}: {encuestaLabels[k]}</label>
                        <select id={`encuesta-${k}`} value={encuestaForm[k]} onChange={(e) => setEncuestaForm({ ...encuestaForm, [k]: e.target.value })}>
                          {encuestaEscalaOpciones.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="form-section full encuesta-bloque">
                  <h3 className="form-section__title">Trastorno de Conducta (TC1-TC10)</h3>
                  <div className="grid encuesta-grid">
                    {encuestaKeysTC.map((k) => (
                      <div key={k} className="field-group">
                        <label htmlFor={`encuesta-${k}`}>{k}: {encuestaLabels[k]}</label>
                        <select id={`encuesta-${k}`} value={encuestaForm[k]} onChange={(e) => setEncuestaForm({ ...encuestaForm, [k]: e.target.value })}>
                          {encuestaEscalaOpciones.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                {encuestaStatus.msg && (
                  <div className={encuestaStatus.error ? "alert-error" : "alert-success"} role="status">
                    {encuestaStatus.msg}
                  </div>
                )}
                <button className="full" type="submit">Guardar Encuesta</button>
              </form>
            </article>
          </div>
        )}

        {/* ── Predicciones ───────────────────────────── */}
        {activeView === "predicciones" && (
          <article className="panel">
            <h2>Historial de Predicciones</h2>
            <div className="row">
              <select
                value={predAlumno}
                onChange={(e) => {
                  const id = e.target.value;
                  setPredAlumno(id);
                  loadPredicciones(id).catch(() => notify("Error al cargar predicciones", true));
                }}
              >
                <option value="">-- Selecciona --</option>
                {alumnoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button type="button" onClick={generarPrediccion}>Generar Predicción</button>
            </div>
            {predicciones.map((p) => (
              <div key={p.id} className="card">
                <strong>{p.alumno_nombre ?? "Alumno"}</strong><br />
                <b>Nivel de Riesgo Académico:</b>{" "}
                <span style={{ color: p.nivel_riesgo === "Alto" ? "#d62828" : p.nivel_riesgo === "Medio" ? "#e07b00" : "#14732b", fontWeight: "bold" }}>
                  {p.nivel_riesgo}
                </span>
                {p.probabilidad != null && <> ({(p.probabilidad * 100).toFixed(1)}%)</>}<br />
                <b>Indicador TDAH:</b>{" "}
                <span style={{ color: p.nivel_tdah === "Posible TDAH" ? "#d62828" : "#14732b", fontWeight: "bold" }}>
                  {p.nivel_tdah ?? "—"}
                </span><br />
                {p.total_atencion != null && (
                  <><b>Atención (DA):</b> {p.total_atencion}/15{"  "}<b>Hiperactividad (HI):</b> {p.total_hiperactividad}/15{"  "}{p.total_conducta != null && <><b>Conducta (TC):</b> {p.total_conducta}/30</>}<br /></>
                )}
                {p.prob_tdah != null && (
                  <><b>Prob. TDAH:</b> {Math.round(p.prob_tdah * 100)}%<br /></>
                )}
                <b>Promedio de Notas:</b> {p.prediccion_notas}<br />
                <b>Condiciones:</b> {p.condiciones_psicoeducativas}<br />
                <small style={{ color: "#888" }}>{p.fecha_prediccion}</small>
              </div>
            ))}
          </article>
        )}

        {/* ── Notas ──────────────────────────────────── */}
        {activeView === "notas" && (
          <div className="notas-layout">
            <h1 className="page-title">Subir/Actualizar Notas</h1>
            <article className="panel panel-notas">
              <div className="toggle-row">
                <button type="button" className={notasModoLista === "actuales" ? "toggle-btn toggle-btn--active" : "toggle-btn toggle-btn--inactive"} onClick={() => { setNotasModoLista("actuales"); setNotasStatus({ msg: "", error: false }); }}>Notas Actuales</button>
                <button type="button" className={notasModoLista === "historico" ? "toggle-btn toggle-btn--active" : "toggle-btn toggle-btn--inactive"} onClick={() => { setNotasModoLista("historico"); setNotasStatus({ msg: "", error: false }); }}>Histórico de Notas</button>
              </div>
              {notasModoLista === "actuales" && (
                <div className="toggle-row">
                  <button type="button" className={notasModoCarga === "individual" ? "toggle-btn toggle-btn--active" : "toggle-btn toggle-btn--inactive"} onClick={() => { setNotasModoCarga("individual"); setNotasStatus({ msg: "", error: false }); }}>Formulario Individual</button>
                  <button type="button" className={notasModoCarga === "masiva" ? "toggle-btn toggle-btn--active" : "toggle-btn toggle-btn--inactive"} onClick={() => { setNotasModoCarga("masiva"); setNotasStatus({ msg: "", error: false }); }}>Carga Masiva CSV/Excel</button>
                </div>
              )}
              {notasModoLista === "actuales" && notasModoCarga === "individual" && (
                <form className="grid notas-form" onSubmit={submitNota}>
                  <div className="field-group full">
                    <label htmlFor="nota-alumno">Estudiante</label>
                    <select id="nota-alumno" value={notaForm.alumno} onChange={(e) => setNotaForm({ ...notaForm, alumno: e.target.value })} required>
                      <option value="">Selecciona</option>
                      {alumnoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="field-group full">
                    <label htmlFor="nota-asignatura">Asignatura</label>
                    <input id="nota-asignatura" type="text" placeholder="Ej. Matemática" value={notaForm.asignatura} onChange={(e) => setNotaForm({ ...notaForm, asignatura: e.target.value })} list="lista-asignaturas" required />
                    <datalist id="lista-asignaturas">{ASIGNATURAS_VALIDAS.map((a) => <option key={a} value={a} />)}</datalist>
                  </div>
                  <div className="field-group full">
                    <label htmlFor="nota-calif">Nota</label>
                    <input id="nota-calif" type="text" placeholder="AD, A, B o C" value={notaForm.nota} onChange={(e) => setNotaForm({ ...notaForm, nota: e.target.value })} required />
                  </div>
                  {notasStatus.msg && <div className={notasStatus.error ? "alert-error" : "alert-success"} role="status">{notasStatus.msg}</div>}
                  <button className="full" type="submit">Actualizar Nota</button>
                </form>
              )}
              {notasModoLista === "actuales" && notasModoCarga === "masiva" && (
                <form className="grid notas-form" onSubmit={submitMasivaCsv}>
                  <p className="form-legend full">CSV con encabezado: <strong>alumno_id,asignatura,calificacion</strong> (calificacion: AD, A, B o C; asignatura exacta como en el sistema). Excel: exporta a CSV antes de subir.</p>
                  <input className="full" type="file" accept=".csv,text/csv" onChange={(e) => setArchivoMasivo(e.target.files?.[0] ?? null)} />
                  {notasStatus.msg && <div className={notasStatus.error ? "alert-error" : "alert-success"} role="status">{notasStatus.msg}</div>}
                  <button className="full" type="submit">Procesar archivo</button>
                </form>
              )}
              {notasModoLista === "historico" && (
                <div className="grid notas-form">
                  <div className="field-group full">
                    <label htmlFor="nota-hist-alumno">Estudiante</label>
                    <select id="nota-hist-alumno" value={notaForm.alumno} onChange={(e) => setNotaForm({ ...notaForm, alumno: e.target.value })}>
                      <option value="">Selecciona</option>
                      {alumnoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  {notasStatus.msg && <div className={notasStatus.error ? "alert-error" : "alert-success"} role="status">{notasStatus.msg}</div>}
                  {!notaForm.alumno && <p className="form-legend full">Selecciona un estudiante para ver su histórico.</p>}
                  {notaForm.alumno && historicoNotas.length === 0 && !notasStatus.error && <p className="form-legend full">No hay notas registradas para este estudiante.</p>}
                  {historicoNotas.map((n) => (
                    <div key={n.id} className="card full">
                      <strong>{n.asignatura}</strong>{" — "}Calificación: <strong>{n.calificacion_literal}</strong>
                      {n.fecha_registro && <>{" · "}Fecha: {n.fecha_registro}</>}
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        )}

        {/* ── Expediente ─────────────────────────────── */}
        {activeView === "expediente" && (
          <article className="panel">
            <h2>Expediente Psicológico</h2>
            <form className="grid" onSubmit={submitExpediente}>
              <select className="full" value={expForm.alumno} onChange={(e) => setExpForm({ ...expForm, alumno: e.target.value })} required>
                <option value="">-- Selecciona --</option>
                {alumnoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select className="full" value={expForm.nivel_preocupacion} onChange={(e) => setExpForm({ ...expForm, nivel_preocupacion: e.target.value })} required>
                <option value="1">1 - Muy baja preocupación</option>
                <option value="2">2 - Preocupación leve</option>
                <option value="3">3 - Preocupación moderada</option>
                <option value="4">4 - Preocupación alta</option>
                <option value="5">5 - Preocupación crítica</option>
              </select>
              <input className="full" type="file" accept="application/pdf" onChange={(e) => setExpForm({ ...expForm, archivo_pdf: e.target.files?.[0] ?? null })} required />
              <button className="full" type="submit">Guardar Expediente</button>
            </form>
          </article>
        )}

        {status.msg && activeView !== "encuesta" && activeView !== "notas" && (
          <p className="status" style={{ color: status.error ? "#d62828" : "#14732b" }}>{status.msg}</p>
        )}
      </section>
    </div>
  );
}
