import { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

import { req, reqJson } from "./lib/api";
import { guardarToken, borrarToken, leerToken } from "./lib/sesion";
import { NAV_LABELS, puedeGestionarAlumnos, puedeVer, viewsDeRol, vistaInicial } from "./lib/rbac";
import {
  FILTROS_INICIALES, PROB_COLORS, RIESGO_COLORS, contarPorGrupo, filtrarPredicciones,
  formatFecha, hayFiltroActivo, tdahNivelProb, tdahTexto, ultimaPorAlumno,
} from "./lib/predicciones";
import FiltrosPrediccion from "./components/FiltrosPrediccion";
import RecomendacionesPanel from "./components/RecomendacionesPanel";
import CargaMasivaNotas from "./components/CargaMasivaNotas";
import InasistenciasView from "./views/InasistenciasView";
import { useConfirmacion } from "./lib/useConfirmacion";

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
  "Desarrollo Personal, Ciudadanía y Cívica",
  "Ciencias Sociales",
  "Educación Física",
  "Arte y Cultura",
  "Comunicación",
  "Inglés como Lengua Extranjera",
  "Matemática",
  "Ciencia y Tecnología",
  "Educación para el Trabajo",
  "Competencia Transversal",
  "Formación Integral",
];

// Las cuentas viven en la tabla `usuarios` del servidor, con la contraseña
// cifrada (PBKDF2-HMAC-SHA256). Antes estaban aquí, en texto plano y visibles
// para cualquiera que abriera el código fuente de la página.

function normalizarCalificacionLiteral(texto) {
  const t = String(texto).trim().toUpperCase();
  if (t === "AD") return "AD";
  if (t === "A" || t === "B" || t === "C") return t;
  return null;
}

const NOTA_NUM = { C: 0, B: 1, A: 2, AD: 3 };
const NOTA_LET = ["C", "B", "A", "AD"];

// Promedio de una lista de notas literales → { num, letra } (o null si no hay notas)
function promedioLiteral(literales) {
  const vals = (literales || [])
    .map((l) => NOTA_NUM[normalizarCalificacionLiteral(l)])
    .filter((v) => v !== undefined);
  if (!vals.length) return null;
  const num = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { num: Math.round(num * 100) / 100, letra: NOTA_LET[Math.round(num)] };
}

// Longitudes oficiales de los documentos peruanos. El backend valida lo mismo;
// aquí se replican para poder avisar antes de enviar el formulario.
const TIPOS_DOCUMENTO = {
  DNI:       { etiqueta: "DNI",                  longitud: 8, patron: /^\d{8}$/,        ayuda: "8 dígitos, sin puntos ni guiones." },
  CE:        { etiqueta: "Carné de Extranjería", longitud: 9, patron: /^\d{9}$/,        ayuda: "9 dígitos." },
  PASAPORTE: { etiqueta: "Pasaporte",            longitud: 9, patron: /^[A-Z0-9]{9}$/,  ayuda: "9 caracteres: letras mayúsculas y dígitos." },
};

// Primaria llega a 6°, secundaria a 5°.
const NIVELES = { Primaria: 6, Secundaria: 5 };

// Mismo enmascarado que aplica el backend, para que el diálogo de confirmación
// muestre el documento sin exhibirlo entero.
const enmascararDoc = (n) => {
  if (!n) return "—";
  return n.length <= 4 ? "•".repeat(n.length) : "•".repeat(n.length - 4) + n.slice(-4);
};

// Nombres: letras con tildes y ñ, dígitos, espacios, apóstrofo y guion.
// Se bloquean los signos, no los números (hay alumnos registrados como «Alumno 01»).
const RE_NOMBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9'\- ]*$/;

const initialAlumno = {
  nombre: "", apellido: "", contacto_emergente: "", edad: "",
  nivel: "Secundaria", grado: "", anio_cursada: "2025", genero: "",
  tipo_documento: "DNI", numero_documento: "",
};

const initialEncuesta = Object.fromEntries([["alumno", ""], ...encuestaKeys.map((k) => [k, "0"])]);
const initialNota = { alumno: "", bimestre: "1" };

/* ── Chart & dashboard helpers ─────────────────────────────────────────── */

const FACTOR_COLORS = ["#a78bfa", "#34d399", "#60a5fa", "#fbbf24", "#f87171", "#22d3ee"];

function buildAcadPieData(nivelRiesgo, probabilidad) {
  // Dona invertida (medidor de seguridad): el verde ("Bajo") es la parte SIN
  // riesgo = 100 − probabilidad. Si el riesgo es 0% toda la dona es verde;
  // a menor probabilidad de riesgo, más verde se llena.
  const riesgo = Math.max(0, Math.min(100, Math.round((probabilidad ?? 0) * 100)));
  const data = [{ name: "Bajo", value: 100 - riesgo }];
  if (riesgo > 0) {
    const nombre = nivelRiesgo === "Alto" ? "Alto" : "Medio";  // color del riesgo restante
    data.unshift({ name: nombre, value: riesgo });
  }
  return data.filter((d) => d.value > 0);
}

// Dona de TDAH: las TRES probabilidades que devuelve el modelo, tal cual.
// Antes se dibujaba solo la clase ganadora y las otras dos porciones se
// repartían con constantes arbitrarias (0.6 / 0.45 / 0.18), de modo que el
// gráfico mostraba cifras que el modelo nunca produjo.
function buildTdahPieData(pred) {
  const p = pred?.proba_tdah;
  if (p && p.alta != null && p.media != null && p.baja != null) {
    return [
      { name: "Sospecha Alta",  value: Math.round(p.alta * 100) },
      { name: "Sospecha Media", value: Math.round(p.media * 100) },
      { name: "Sospecha Baja",  value: Math.round(p.baja * 100) },
    ].filter((d) => d.value > 0);
  }
  // Predicción generada antes de que se guardara la distribución completa:
  // se muestra la clase predicha frente al resto, sin repartir ese resto
  // entre las otras dos clases (eso volvería a inventar datos).
  const nivel = tdahNivelProb(pred?.nivel_tdah);
  const conf = Math.round((pred?.confianza_tdah ?? 0) * 100);
  return [
    { name: `Sospecha ${nivel}`, value: conf },
    { name: "Resto de clases", value: Math.max(0, 100 - conf) },
  ];
}

function buildFactoresData(pred) {
  // El promedio se expresa en la escala literal 0-3 (C=0 … AD=3): el déficit
  // académico es (3 - promedio) / 3, no (20 - promedio) / 20.
  const deficitAcademico = Math.max(0, Math.min(100,
    Math.round(((3 - (pred.promedio_notas ?? 0)) / 3) * 100)));
  return [
    { name: "Inatención", valor: Math.round((pred.total_atencion / 15) * 100) },
    { name: "Hiperactividad", valor: Math.round((pred.total_hiperactividad / 15) * 100) },
    { name: "Rend. Académico", valor: deficitAcademico },
    { name: "Inasistencias", valor: Math.min(100, Math.round(((pred.inasistencias ?? 0) / 20) * 100)) },
  ].sort((a, b) => b.valor - a.valor);
}

/* ── Expediente (reporte descargable) ──────────────────────────────────── */

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const _ESCALA_TXT = { 0: "Nunca", 1: "Algunas veces", 2: "Bastantes veces", 3: "Siempre" };

function buildExpedienteHTML({ alumno, encuesta, pred, shap, shapRiesgo, recomendaciones }) {
  const fecha = new Date().toLocaleDateString("es-PE", { year: "numeric", month: "long", day: "numeric" });
  const nombre = alumno ? `${alumno.nombre} ${alumno.apellido}` : "—";

  // Barras SHAP (cada factor con su peso y dirección) para el PDF.
  const shapBarsHTML = (features) => {
    if (!features || !features.length) return `<p class="muted">Sin factores disponibles.</p>`;
    const maxAbs = Math.max(...features.map((f) => Math.abs(f.shap)), 0.0001);
    return `<table class="shap">${features.map((f) => {
      const pct = Math.max(Math.round((Math.abs(f.shap) / maxAbs) * 100), 4);
      const up = f.shap > 0;
      const color = up ? "#ef4444" : "#22c55e";
      return `<tr>
        <td class="shap-name">${esc(f.label)} <span class="muted">(${esc(f.value_fmt)})</span></td>
        <td class="shap-bar"><span class="sbar" style="width:${pct}%;background:${color}"></span></td>
        <td class="shap-dir" style="color:${color}">${esc(f.direccion)}</td>
      </tr>`;
    }).join("")}</table>`;
  };

  // ── 1. Datos del alumno ──────────────────────────────────────────────────
  const datosAlumno = alumno ? `
    <table class="info">
      <tr><td class="k">Nombre</td><td>${esc(nombre)}</td><td class="k">ID</td><td>${String(alumno.id).padStart(3, "0")}</td></tr>
      <tr><td class="k">Grado</td><td>${esc(alumno.grado)}</td><td class="k">Edad</td><td>${esc(alumno.edad)}</td></tr>
      <tr><td class="k">Género</td><td>${esc(alumno.genero)}</td><td class="k">Año de cursada</td><td>${esc(alumno.anio_cursada)}</td></tr>
      <tr><td class="k">Contacto</td><td>${esc(alumno.contacto_emergente)}</td><td class="k">Inasistencias</td><td>${esc(pred?.inasistencias ?? alumno.inasistencias ?? 0)} día(s)</td></tr>
    </table>` : `<p class="muted">Datos del alumno no disponibles.</p>`;

  // Confianza del modelo en la clase de TDAH predicha. Se declara aquí, en el
  // ámbito de la función, porque la consumen DOS secciones del documento (el
  // resumen y la ficha de predicción); dentro de un bloque `if` quedaba fuera
  // de alcance para la segunda y lanzaba ReferenceError.
  const tdahConfPct = pred
    ? (pred.confianza_tdah != null
        ? Math.round(pred.confianza_tdah * 100)
        : Math.round((pred.prob_tdah ?? 0) * 100))
    : 0;

  // ── 2. Dashboard ─────────────────────────────────────────────────────────
  let dashboardHTML;
  if (pred) {
    const riesgoColor = pred.nivel_riesgo === "Alto" ? "#ef4444" : pred.nivel_riesgo === "Medio" ? "#f97316" : "#22c55e";
    const tdahLevel = tdahTexto(pred.nivel_tdah);
    const esTdah = !!pred.nivel_tdah && pred.nivel_tdah !== "Sospecha Baja" && pred.nivel_tdah !== "Sin TDAH";
    const tdahColor = esTdah ? "#f97316" : "#22c55e";
    const rendLetra = pred.promedio_final ?? pred.prediccion_notas ?? "—";
    const rendColor = (rendLetra === "AD" || rendLetra === "A") ? "#22c55e"
      : rendLetra === "B" ? "#f97316"
      : rendLetra === "C" ? "#ef4444" : "#94a3b8";
    const factores = buildFactoresData(pred);

    dashboardHTML = `
      <div class="kpis">
        <div class="kpi"><span class="kpi-l">Riesgo Académico</span><span class="kpi-v" style="color:${riesgoColor}">${esc(pred.nivel_riesgo)}</span><span class="kpi-s">Probabilidad: ${Math.round((pred.probabilidad ?? 0) * 100)}%</span></div>
        <div class="kpi"><span class="kpi-l">Indicador TDAH (modelo IA)</span><span class="kpi-v" style="color:${tdahColor}">${esc(tdahLevel)}</span><span class="kpi-s">Confianza: ${tdahConfPct}%</span></div>
        <div class="kpi"><span class="kpi-l">Rendimiento General</span><span class="kpi-v" style="color:${rendColor}">${esc(rendLetra)}</span><span class="kpi-s">Promedio (nota literal)</span></div>
      </div>
      <h3>Factores que influyen en el riesgo</h3>
      <table class="bars">
        ${factores.map((f) => `<tr><td class="bar-name">${esc(f.name)}</td><td class="bar-cell"><span class="bar" style="width:${f.valor}%"></span></td><td class="bar-val">${f.valor}%</td></tr>`).join("")}
      </table>
      `;
  } else {
    dashboardHTML = `<p class="muted">No hay predicción registrada. Genera una predicción para incluir el resumen del dashboard.</p>`;
  }

  // ── 3. Encuesta EDAH ─────────────────────────────────────────────────────
  let encuestaHTML;
  if (encuesta) {
    const bloque = (titulo, keys, total, max) => `
      <h3>${titulo} <span class="block-total">(${total}/${max})</span></h3>
      <table class="enc">
        <thead><tr><th>Ítem</th><th>Pregunta</th><th>Valor</th></tr></thead>
        <tbody>${keys.map((k) => `<tr><td>${k}</td><td>${esc(encuestaLabels[k])}</td><td class="v">${encuesta[k]} – ${_ESCALA_TXT[encuesta[k]] ?? ""}</td></tr>`).join("")}</tbody>
      </table>`;
    const suma = (keys) => keys.reduce((s, k) => s + (encuesta[k] ?? 0), 0);
    encuestaHTML =
      bloque("Déficit de Atención (DA)", encuestaKeysDA, suma(encuestaKeysDA), 15) +
      bloque("Hiperactividad e Impulsividad (HI)", encuestaKeysHI, suma(encuestaKeysHI), 15) +
      bloque("Trastorno de Conducta (TC)", encuestaKeysTC, suma(encuestaKeysTC), 30);
  } else {
    encuestaHTML = `<p class="muted">No hay encuesta registrada para este estudiante.</p>`;
  }

  // ── 4. Predicción ────────────────────────────────────────────────────────
  let prediccionHTML;
  if (pred) {
    const interp = shap?.interpretacion
      ? shap.interpretacion.split("\n\n").map((p) => `<p>${esc(p)}</p>`).join("")
      : `<p class="muted">Sin interpretación disponible.</p>`;
    const bimNota = (v) => (v && v !== "—") ? esc(v) : `<span class="muted">Sin registrar</span>`;
    prediccionHTML = `
      <table class="info">
        <tr><td class="k">Nivel de Riesgo Académico</td><td>${esc(pred.nivel_riesgo)} (${Math.round((pred.probabilidad ?? 0) * 100)}%)</td></tr>
        <tr><td class="k">Indicador TDAH (modelo IA)</td><td>${esc(tdahTexto(pred.nivel_tdah))} (${tdahConfPct}% de confianza)</td></tr>
        ${pred.referencia_psicometrica ? `<tr><td class="k">Referencia psicométrica</td><td><span class="muted">${esc(pred.referencia_psicometrica)} — no decide la clasificación</span></td></tr>` : ""}
        <tr><td class="k">Atención (DA)</td><td>${pred.da_total ?? "—"}/15</td></tr>
        <tr><td class="k">Hiperactividad (HI)</td><td>${pred.hi_total ?? "—"}/15</td></tr>
        <tr><td class="k">Conducta (TC)</td><td>${pred.tc_total ?? "—"}/30</td></tr>
        <tr><td class="k">Bimestre 1</td><td>${bimNota(pred.nota_b1)}</td></tr>
        <tr><td class="k">Bimestre 2</td><td>${bimNota(pred.nota_b2)}</td></tr>
        <tr><td class="k">Bimestre 3</td><td>${bimNota(pred.nota_b3)}</td></tr>
        <tr><td class="k">Bimestre 4</td><td>${bimNota(pred.nota_b4)}</td></tr>
        <tr><td class="k">Promedio Final</td><td>${esc(pred.promedio_final ?? pred.prediccion_notas ?? "—")} <span class="muted">(solo bimestres con nota)</span></td></tr>
        <tr><td class="k">Fecha de predicción</td><td>${esc(formatFecha(pred.fecha_prediccion))}</td></tr>
      </table>
      <h3>Explicabilidad del modelo (SHAP)</h3>
      <p class="shap-legend"><span class="dot up"></span> rojo = el factor <b>aumenta</b> el indicador &nbsp;·&nbsp; <span class="dot down"></span> verde = el factor lo <b>reduce</b></p>
      <h4 class="shap-h tdah">Indicador de TDAH — ${esc(tdahTexto(shap?.nivel ?? pred.nivel_tdah))}</h4>
      ${shapBarsHTML(shap?.features)}
      <h4 class="shap-h riesgo">Riesgo Académico — ${esc(shapRiesgo?.nivel ?? pred.nivel_riesgo ?? "—")}</h4>
      ${shapBarsHTML(shapRiesgo?.features)}
      <div class="interp">${interp}</div>`;
  } else {
    prediccionHTML = `<p class="muted">No hay predicción registrada para este estudiante.</p>`;
  }

  // ── 5. Plan de acción (analítica prescriptiva, resuelta en el backend) ──
  const listaRecs = recomendaciones?.recomendaciones ?? [];
  const recomendacionesHTML = listaRecs.length
    ? `<ul class="recs">
        ${listaRecs.map((r) => `
          <li>
            <div class="rec-head">
              <span class="rec-title">${r.icono} ${esc(r.titulo)}</span>
              <span class="tag tag-${r.prioridad === "critica" ? "alta" : r.prioridad}">${esc(r.prioridad_label)}</span>
            </div>
            <div class="rec-meta">Regla: ${esc(r.regla)} · Responsable: ${esc(r.responsable)}</div>
            <ul class="rec-acciones">${(r.acciones ?? []).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
          </li>`).join("")}
      </ul>
      ${recomendaciones?.aviso ? `<p class="aviso"><b>Aviso:</b> ${esc(recomendaciones.aviso)}</p>` : ""}`
    : `<p class="muted">No hay un plan de acción disponible para este estudiante.</p>`;

  const styles = `
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 0; padding: 32px 40px; font-size: 13px; line-height: 1.5; }
    .doc-head { border-bottom: 3px solid #2563eb; padding-bottom: 12px; margin-bottom: 22px; }
    .doc-head h1 { margin: 0; color: #1e3a5f; font-size: 24px; }
    .doc-head .sub { margin: 4px 0 0; color: #64748b; font-size: 12px; }
    section { margin-bottom: 22px; page-break-inside: avoid; }
    h2 { font-size: 15px; color: #2563eb; border-left: 4px solid #2563eb; padding-left: 8px; margin: 0 0 10px; }
    h3 { font-size: 13px; color: #334155; margin: 14px 0 6px; }
    table { width: 100%; border-collapse: collapse; }
    table.info td { padding: 5px 8px; border: 1px solid #e2e8f0; }
    table.info td.k { background: #f1f5f9; font-weight: 600; width: 18%; color: #475569; }
    .muted { color: #94a3b8; font-style: italic; }
    .kpis { display: flex; gap: 12px; margin: 8px 0 4px; }
    .kpi { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
    .kpi-l { display: block; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .03em; }
    .kpi-v { display: block; font-size: 20px; font-weight: 700; margin: 4px 0; }
    .kpi-s { display: block; font-size: 11px; color: #64748b; }
    table.bars td { padding: 4px 6px; vertical-align: middle; }
    .bar-name { width: 28%; font-size: 12px; }
    .bar-cell { width: 60%; }
    .bar { display: inline-block; height: 14px; background: #3b82f6; border-radius: 4px; min-width: 2px; }
    .bar-val { width: 12%; text-align: right; font-weight: 600; font-size: 12px; }
    ul.recs { list-style: none; padding: 0; margin: 0; }
    ul.recs li { display: flex; justify-content: space-between; align-items: center; gap: 10px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 10px; margin-bottom: 6px; }
    .tag { font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600; white-space: nowrap; }
    .tag-alta { background: #fee2e2; color: #b91c1c; }
    .tag-media { background: #fef3c7; color: #b45309; }
    .tag-baja { background: #dcfce7; color: #15803d; }
    table.enc { margin-bottom: 8px; }
    table.enc th, table.enc td { border: 1px solid #e2e8f0; padding: 5px 8px; text-align: left; font-size: 12px; }
    table.enc th { background: #f1f5f9; color: #475569; }
    table.enc td.v { white-space: nowrap; font-weight: 600; }
    .block-total { color: #2563eb; font-weight: 600; }
    .inasist { margin: 8px 0 0; }
    .interp p { margin: 0 0 8px; text-align: justify; }
    .shap-legend { font-size: 11px; color: #64748b; margin: 0 0 10px; }
    .shap-legend .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; margin-right: 2px; }
    .shap-legend .dot.up { background: #ef4444; } .shap-legend .dot.down { background: #22c55e; }
    h4.shap-h { font-size: 12px; margin: 12px 0 6px; padding-left: 8px; }
    h4.shap-h.tdah { color: #6366f1; border-left: 3px solid #6366f1; }
    h4.shap-h.riesgo { color: #0ea5e9; border-left: 3px solid #0ea5e9; }
    table.shap { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    table.shap td { padding: 4px 6px; vertical-align: middle; border: none; }
    .shap-name { width: 38%; font-size: 11.5px; color: #334155; }
    .shap-bar { width: 40%; background: #eef2f7; border-radius: 6px; }
    .shap-bar .sbar { display: inline-block; height: 14px; border-radius: 6px; min-width: 3px; vertical-align: middle; }
    .shap-dir { width: 22%; font-size: 11px; font-weight: 700; text-align: right; }
    .doc-foot { margin-top: 26px; border-top: 1px solid #e2e8f0; padding-top: 10px; color: #94a3b8; font-size: 11px; text-align: center; }
    ul.recs li { display: block; }
    .rec-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .rec-title { font-weight: 700; color: #1e3a5f; }
    .rec-meta { color: #94a3b8; font-size: 10.5px; margin: 3px 0 5px; }
    ul.rec-acciones { margin: 0; padding-left: 18px; color: #475569; }
    ul.rec-acciones li { display: list-item; border: none; padding: 1px 0; margin: 0; }
    .aviso { margin-top: 12px; padding: 8px 10px; background: #fffbeb; border: 1px solid #fde68a;
             border-radius: 6px; color: #92400e; font-size: 10.5px; line-height: 1.6; }
    /* Impresión: evita cortes a mitad de tabla/recomendación y repite cabeceras. */
    @media print {
      body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { margin: 1.5cm; size: A4; }
      section { break-inside: avoid; page-break-inside: avoid; }
      h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
      table { break-inside: auto; }
      tr { break-inside: avoid; page-break-inside: avoid; }
      thead { display: table-header-group; }
      ul.recs li { break-inside: avoid; page-break-inside: avoid; }
      .doc-foot { position: fixed; bottom: 0; left: 0; right: 0; }
    }`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Expediente_${esc(nombre.replace(/\s+/g, "_"))}</title>
<style>${styles}</style>
</head><body>
  <header class="doc-head">
    <h1>Expediente Psicológico</h1>
    <p class="sub">Sistema de Predicción Educativa · Emitido el ${fecha}</p>
  </header>
  <section><h2>1. Datos del Estudiante</h2>${datosAlumno}</section>
  <section><h2>2. Resumen del Dashboard</h2>${dashboardHTML}</section>
  <section><h2>3. Encuesta Psicoeducativa (EDAH)</h2>${encuestaHTML}</section>
  <section><h2>4. Predicción Académica</h2>${prediccionHTML}</section>
  <section><h2>5. Plan de Acción (analítica prescriptiva)</h2>${recomendacionesHTML}</section>
  <footer class="doc-foot">Documento generado automáticamente — Sistema de Predicción Educativa</footer>
  <script>window.addEventListener('load',function(){setTimeout(function(){window.print();},350);});</script>
</body></html>`;
}

/* ── Expediente: ventana de espera y descarga de respaldo ───────────────── */

// Se pinta en la ventana ANTES de pedir los datos, para poder abrirla dentro de
// la activación del clic (ver descargarExpediente).
const EXPEDIENTE_CARGANDO = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Generando expediente…</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; display: grid;
         place-content: center; height: 100vh; margin: 0; text-align: center; }
  h1 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
  p  { font-size: 13px; color: #64748b; margin: 0; max-width: 34ch; line-height: 1.6; }
  .dot { width: 34px; height: 34px; margin: 0 auto 18px; border-radius: 50%;
         border: 3px solid #e2e8f0; border-top-color: #2563eb; animation: spin .9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
</style></head><body>
  <div>
    <div class="dot"></div>
    <h1>Generando expediente…</h1>
    <p>Recuperando la evaluación y la predicción del estudiante. La primera consulta
       puede tardar si el servidor estaba inactivo.</p>
  </div>
</body></html>`;

// Respaldo cuando el navegador bloquea la ventana emergente: se entrega el
// expediente como archivo HTML que el usuario abre e imprime a PDF.
function descargarExpedienteComoArchivo(html, nombreArchivo) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── Visualización SHAP: cada factor como barra (peso + dirección) ───────── */
function ShapFactores({ features }) {
  if (!features || !features.length)
    return <p style={{ color: "var(--tinta-suave)", fontSize: "0.84rem", fontStyle: "italic", margin: 0 }}>Sin factores disponibles.</p>;
  const maxAbs = Math.max(...features.map((f) => Math.abs(f.shap)), 0.0001);
  return (
    <div style={{ marginTop: 4 }}>
      {features.map((f) => {
        const pct = Math.max(Math.round((Math.abs(f.shap) / maxAbs) * 100), 4);
        const up = f.shap > 0;
        const color = up ? "#ef4444" : "#22c55e";
        return (
          <div key={f.feature} style={{ display: "flex", alignItems: "center", gap: 10, margin: "7px 0" }}>
            <div style={{ width: 210, flexShrink: 0, fontSize: "0.82rem", color: "var(--tinta-media)" }}>
              {f.label} <span style={{ color: "var(--tinta-suave)", fontWeight: 600 }}>({f.value_fmt})</span>
            </div>
            <div style={{ flex: 1, background: "var(--superficie-2)", borderRadius: 7, height: 20, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 7, transition: "width .4s ease" }} />
            </div>
            <div style={{ width: 140, flexShrink: 0, fontSize: "0.78rem", color, fontWeight: 700, textAlign: "right" }}>
              {f.direccion}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Pantalla de acceso: fotografía a la izquierda, formulario a la derecha ── */
function PantallaAcceso({ children }) {
  return (
    <main className="auth-shell">
      {/* Decorativa: el lector de pantalla no gana nada describiéndola. */}
      <div className="auth-foto" aria-hidden="true">
        <div className="auth-foto-texto">
          <h2>Detectar a tiempo para poder acompañar</h2>
          <p>
            Evaluación psicoeducativa, seguimiento académico y modelos predictivos
            explicables, reunidos en un solo lugar.
          </p>
        </div>
      </div>
      <div className="auth-panel">{children}</div>
    </main>
  );
}

/* ── App ───────────────────────────────────────────────────────────────── */

export default function App() {
  // Toda acción que escriba en la base pasa antes por aquí. `dialogo` se
  // renderiza en las tres ramas de la aplicación (acceso, cambio de clave y
  // pantalla principal), porque desde las tres se puede modificar algo.
  const { confirmar, dialogo } = useConfirmacion();

  const [auth, setAuth] = useState({
    usuario: "", password: "", logged: false, rol: "",
    nombre: "", debeCambiar: false,
  });
  const [autenticando, setAutenticando] = useState(false);
  const [restaurando, setRestaurando] = useState(Boolean(leerToken()));
  const [cambioClave, setCambioClave] = useState({ actual: "", nueva: "", repetir: "", error: "", enviando: false });

  // Bandeja del administrador: solicitudes de recuperación por atender.
  const [solicitudes, setSolicitudes] = useState([]);
  const [solicitudesCargando, setSolicitudesCargando] = useState(false);
  const [claveRepuesta, setClaveRepuesta] = useState(null);

  const cargarSolicitudes = async () => {
    setSolicitudesCargando(true);
    try {
      setSolicitudes(await req("/auth/recuperacion/pendientes"));
    } catch (err) {
      notify(err.message || "No se pudieron cargar las solicitudes.", true);
      setSolicitudes([]);
    } finally {
      setSolicitudesCargando(false);
    }
  };

  const atenderSolicitud = async (sol) => {
    if (!await confirmar({
      titulo: `¿Reponer la contraseña de «${sol.usuario}»?`,
      mensaje: "Se generará una contraseña temporal y se cerrarán todas las sesiones "
             + "abiertas de esa persona. La contraseña se muestra una sola vez: "
             + "anótala antes de cerrar el aviso.",
      detalles: [
        { etiqueta: "Usuario", valor: sol.usuario },
        { etiqueta: "Referencia", valor: sol.codigo ?? String(sol.id) },
      ],
      tono: "peligro",
      textoConfirmar: "Sí, reponer la contraseña",
    })) return;
    try {
      const r = await reqJson(`/auth/recuperacion/${sol.id}/atender`, "POST");
      setClaveRepuesta(r);
      await cargarSolicitudes();
    } catch (err) {
      notify(err.message || "No se pudo atender la solicitud.", true);
    }
  };
  const [activeView, setActiveView] = useState("dashboard");
  const [status, setStatus] = useState({ msg: "", error: false });
  const [alumnos, setAlumnos] = useState([]);

  const [alumnoForm, setAlumnoForm] = useState(initialAlumno);
  const [encuestaForm, setEncuestaForm] = useState(initialEncuesta);
  const [notaForm, setNotaForm] = useState(initialNota);
  const [notasAsig, setNotasAsig] = useState({});  // { asignatura: "AD"|"A"|"B"|"C"|"" }
  const [expAlumno, setExpAlumno] = useState("");
  const [expLoading, setExpLoading] = useState(false);
  const [predAlumno, setPredAlumno] = useState("");
  const [todosPredicciones, setTodosPredicciones] = useState([]);
  const [listaVerAlumno, setListaVerAlumno] = useState(null);
  // Documentos revelados en esta sesión de pantalla; se olvidan al cerrar el modal.
  const [docRevelado, setDocRevelado] = useState({});
  const [listaEditAlumno, setListaEditAlumno] = useState(null);
  const [listaEditForm, setListaEditForm] = useState({});
  const [listaStatus, setListaStatus] = useState({ msg: "", error: false });
  const [predicciones, setPredicciones] = useState([]);
  const [alumnoFormError, setAlumnoFormError] = useState("");
  const [encuestaStatus, setEncuestaStatus] = useState({ msg: "", error: false });
  const [notasModoLista, setNotasModoLista] = useState("actuales");
  const [notasModoCarga, setNotasModoCarga] = useState("individual");
  const [notasStatus, setNotasStatus] = useState({ msg: "", error: false });
  const [historicoNotas, setHistoricoNotas] = useState([]);


  // Dashboard states
  const [dashAlumno, setDashAlumno] = useState("");
  const [dashData, setDashData] = useState(null);
  const [dashHistorial, setDashHistorial] = useState([]);
  const [shapData, setShapData] = useState(null);
  const [shapPredId, setShapPredId] = useState(null);
  const [shapLoading, setShapLoading] = useState(false);

  // Dashboard general + métricas + encuesta (ver respuestas)
  const [metricas, setMetricas] = useState(null);
  // Filtros cruzados (TDAH AND riesgo) del Dashboard General.
  const [filtrosGeneral, setFiltrosGeneral] = useState({ ...FILTROS_INICIALES });
  const [encuestaModo, setEncuestaModo] = useState("registrar");  // registrar | respuestas
  const [encuestaVerAlumno, setEncuestaVerAlumno] = useState("");
  const [encuestaRespuestas, setEncuestaRespuestas] = useState([]);

  const goToView = (v) => {
    // Control de acceso: el rol no puede navegar a vistas que no tiene permitidas.
    if (!puedeVer(auth.rol, v)) return;
    setActiveView(v);
    setStatus({ msg: "", error: false });
    setAlumnoFormError("");
    setEncuestaStatus({ msg: "", error: false });
    setNotasStatus({ msg: "", error: false });
    setListaStatus({ msg: "", error: false });
    setListaVerAlumno(null);
    setListaEditAlumno(null);
    setDocRevelado({});
    setFiltrosGeneral({ ...FILTROS_INICIALES });
    if (v === "cuentas") { setClaveRepuesta(null); cargarSolicitudes(); }
  };

  // Seguridad: si el rol activo no tiene permiso para la vista actual, se le
  // devuelve a la primera vista que sí tiene permitida.
  useEffect(() => {
    if (auth.logged && !puedeVer(auth.rol, activeView)) setActiveView(vistaInicial(auth.rol));
  }, [activeView, auth.rol, auth.logged]);

  // Las vistas de panorama y listado necesitan las predicciones de todos los
  // alumnos. Se cargan aquí, atendiendo a la vista activa, y no dentro de
  // goToView: tras iniciar sesión se entra directamente a una pantalla sin
  // pasar por el menú, y los filtros se quedaban sin datos que filtrar.
  useEffect(() => {
    if (!auth.logged) return;
    if (activeView === "dashboard" || activeView === "general" || activeView === "lista") {
      loadTodosPredicciones();
    }
    if (activeView === "general") loadMetricas();
  }, [auth.logged, activeView]);

  async function loadMetricas() {
    try { setMetricas(await req("/metricas/")); } catch { setMetricas(null); }
  }

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

  async function loadTodosPredicciones() {
    try {
      const data = await req("/predicciones/");
      setTodosPredicciones(Array.isArray(data) ? data : []);
    } catch {
      setTodosPredicciones([]);
    }
  }

  // Filtros del panel: acotan la lista de estudiantes antes de elegir uno.
  // Dos estados a propósito: `dashFiltros` es lo que filtra la lista y
  // `dashBorrador` lo que el usuario está componiendo. Se igualan al pulsar
  // Buscar; mientras difieran se avisa de que hay cambios sin aplicar.
  const DASH_FILTROS_VACIOS = { texto: "", grado: "", riesgo: "Todos", tdah: "Todos" };
  const [dashFiltros, setDashFiltros] = useState({ ...DASH_FILTROS_VACIOS });
  const [dashBorrador, setDashBorrador] = useState({ ...DASH_FILTROS_VACIOS });

  // SHAP del alumno mostrado en el panel: la explicación deja de estar
  // escondida detrás de un botón en otra pantalla (SUS, ítem 5).
  const [dashShap, setDashShap] = useState(null);
  const [dashShapCargando, setDashShapCargando] = useState(false);

  useEffect(() => {
    const pid = dashData?.id;
    if (!pid) { setDashShap(null); return; }
    let cancelado = false;
    setDashShapCargando(true);
    Promise.all([
      req(`/predicciones/${pid}/shap/`).catch(() => null),
      req(`/predicciones/${pid}/shap-riesgo/`).catch(() => null),
    ])
      .then(([tdah, riesgo]) => { if (!cancelado) setDashShap({ tdah, riesgo }); })
      .finally(() => { if (!cancelado) setDashShapCargando(false); });
    return () => { cancelado = true; };
  }, [dashData?.id]);

  async function loadDashData(alumnoId) {
    if (!alumnoId) { setDashData(null); setDashHistorial([]); return; }
    try {
      const data = await req(`/predicciones/?alumno=${alumnoId}`);
      setDashData(data.length > 0 ? data[0] : null);
      setDashHistorial(Array.isArray(data) ? data : []);
    } catch {
      setDashData(null);
      setDashHistorial([]);
    }
  }

  useEffect(() => {
    if (auth.logged) {
      loadAlumnos().catch((e) => setStatus({ msg: e.message, error: true }));
    }
  }, [auth.logged]);

  // Carga las respuestas de la encuesta del alumno seleccionado (modo "ver respuestas").
  useEffect(() => {
    if (!auth.logged || activeView !== "encuesta" || encuestaModo !== "respuestas") return;
    if (!encuestaVerAlumno) { setEncuestaRespuestas([]); return; }
    let cancelled = false;
    req(`/encuestas/?alumno=${encuestaVerAlumno}`)
      .then((data) => { if (!cancelled) setEncuestaRespuestas(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setEncuestaRespuestas([]); });
    return () => { cancelled = true; };
  }, [auth.logged, activeView, encuestaModo, encuestaVerAlumno]);

  // Carga las notas del alumno seleccionado (sirve tanto al histórico como al
  // formulario individual, que precarga la grilla del bimestre).
  useEffect(() => {
    if (!auth.logged || activeView !== "notas") return;
    const id = notaForm.alumno;
    if (!id) { setHistoricoNotas([]); return; }
    let cancelled = false;
    req(`/notas/?alumno=${id}`)
      .then((data) => { if (!cancelled) { setHistoricoNotas(Array.isArray(data) ? data : []); setNotasStatus({ msg: "", error: false }); } })
      .catch((err) => { if (!cancelled) { setHistoricoNotas([]); setNotasStatus({ msg: err.message || "Error al cargar las notas.", error: true }); } });
    return () => { cancelled = true; };
  }, [auth.logged, activeView, notaForm.alumno]);

  // Precarga la grilla de asignaturas con las notas ya guardadas del bimestre.
  useEffect(() => {
    if (activeView !== "notas" || notasModoLista !== "actuales" || notasModoCarga !== "individual") return;
    const b = Number(notaForm.bimestre);
    const map = {};
    ASIGNATURAS_VALIDAS.forEach((a) => { map[a] = ""; });
    historicoNotas
      .filter((n) => Number(n.bimestre ?? 1) === b)
      .forEach((n) => { map[n.asignatura] = n.calificacion_literal; });
    setNotasAsig(map);
  }, [historicoNotas, notaForm.bimestre, notasModoLista, notasModoCarga, activeView]);

  // Escape cierra el modal abierto — «salida de emergencia» de Nielsen y
  // requisito de no atrapar el teclado (WCAG 2.1.2).
  useEffect(() => {
    if (!listaVerAlumno && !listaEditAlumno) return;
    const alPulsar = (e) => {
      if (e.key === "Escape") { setListaVerAlumno(null); setListaEditAlumno(null); }
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [listaVerAlumno, listaEditAlumno]);

  const notify = (msg, error = false) => setStatus({ msg, error });

  // Cierra la sesión limpiando el estado en memoria. Antes se recargaba la
  // página entera, lo que no es un cierre de sesión sino un reinicio.
  const cerrarSesion = async () => {
    if (!await confirmar({
      titulo: "¿Cerrar la sesión?",
      mensaje: "Volverás a la pantalla de acceso y tendrás que identificarte de nuevo "
             + "para seguir trabajando.",
      detalles: [{ etiqueta: "Sesión de", valor: `${auth.nombre || auth.usuario} · ${auth.rol}` }],
      tono: "aviso",
      textoConfirmar: "Sí, cerrar sesión",
    })) return;

    try { await reqJson("/auth/logout", "POST"); } catch { /* el token ya no valía */ }
    borrarToken();
    setAuth({ usuario: "", password: "", logged: false, rol: "", nombre: "", debeCambiar: false });
    setActiveView("dashboard");
    setAlumnos([]);
    setPredicciones([]);
    setTodosPredicciones([]);
    setDashData(null);
    setDashAlumno("");
    setHistoricoNotas([]);
    setStatus({ msg: "Sesión cerrada.", error: false });
  };

  // Recuperación de acceso. `vista` alterna entre el formulario de entrada y
  // el de solicitud; `resultado` guarda lo que se muestra tras solicitarla.
  const [recuperar, setRecuperar] = useState({ abierto: false, usuario: "", resultado: null, error: "", enviando: false });

  const solicitarRecuperacion = async (e) => {
    e.preventDefault();
    if (!recuperar.usuario.trim()) {
      setRecuperar({ ...recuperar, error: "Escribe el usuario con el que ingresas al sistema.", resultado: null });
      return;
    }
    if (!await confirmar({
      titulo: "¿Enviar la solicitud de recuperación?",
      mensaje: "El administrador verá tu solicitud y repondrá tu contraseña. "
             + "Recibirás un código de referencia para hacer el seguimiento.",
      detalles: [{ etiqueta: "Usuario", valor: recuperar.usuario.trim() }],
      tono: "aviso",
      textoConfirmar: "Sí, enviar solicitud",
    })) return;

    setRecuperar((r) => ({ ...r, enviando: true, error: "" }));
    try {
      const res = await reqJson("/auth/recuperacion/solicitar", "POST", { usuario: recuperar.usuario.trim() });
      setRecuperar((r) => ({
        ...r, enviando: false, error: "",
        resultado: { mensaje: res.mensaje, ref: res.codigo, dias: res.vigencia_dias,
                     fecha: new Date().toLocaleString("es-PE") },
      }));
    } catch (err) {
      setRecuperar((r) => ({ ...r, enviando: false, resultado: null,
                             error: err.message || "No se pudo registrar la solicitud." }));
    }
  };

  const volverAlAcceso = () => {
    setRecuperar({ abierto: false, usuario: "", resultado: null, error: "" });
    setStatus({ msg: "", error: false });
  };

  // Al recargar la página se recupera la sesión desde el token guardado, en
  // lugar de devolver al usuario a la pantalla de acceso.
  useEffect(() => {
    if (!leerToken()) return;
    let cancelado = false;
    req("/auth/yo")
      .then((u) => {
        if (cancelado) return;
        setAuth({ usuario: u.usuario, password: "", logged: true, rol: u.rol,
                  nombre: u.nombre, debeCambiar: u.debe_cambiar });
        setActiveView(vistaInicial(u.rol));
      })
      .catch(() => { if (!cancelado) borrarToken(); })
      .finally(() => { if (!cancelado) setRestaurando(false); });
    return () => { cancelado = true; };
  }, []);

  const onLogin = async (e) => {
    e.preventDefault();
    setAutenticando(true);
    setStatus({ msg: "", error: false });
    try {
      const r = await reqJson("/auth/login", "POST", {
        usuario: auth.usuario.trim(),
        password: auth.password,
      });
      guardarToken(r.token);
      setAuth({
        usuario: r.usuario.usuario, password: "", logged: true, rol: r.usuario.rol,
        nombre: r.usuario.nombre, debeCambiar: r.usuario.debe_cambiar,
      });
      setActiveView(vistaInicial(r.usuario.rol));
      notify(r.usuario.debe_cambiar
        ? "Debes definir una contraseña propia antes de continuar."
        : `Sesión iniciada como ${r.usuario.rol}.`);
    } catch (err) {
      notify(err.message || "No se pudo iniciar sesión.", true);
    } finally {
      setAutenticando(false);
    }
  };

  // Cambio de contraseña, obligatorio en el primer ingreso y tras una reposición.
  const enviarCambioClave = async (e) => {
    e.preventDefault();
    if (cambioClave.nueva !== cambioClave.repetir) {
      setCambioClave({ ...cambioClave, error: "Las dos contraseñas nuevas no coinciden." });
      return;
    }
    if (!await confirmar({
      titulo: "¿Cambiar tu contraseña?",
      mensaje: "A partir de ahora entrarás al sistema con la contraseña nueva. "
             + "La anterior dejará de funcionar de inmediato.",
      detalles: [{ etiqueta: "Usuario", valor: auth.usuario || auth.nombre || "—" }],
      tono: "aviso",
      textoConfirmar: "Sí, cambiarla",
    })) return;

    setCambioClave({ ...cambioClave, enviando: true, error: "" });
    try {
      await reqJson("/auth/cambiar-password", "POST", {
        password_actual: cambioClave.actual,
        password_nueva: cambioClave.nueva,
      });
      setAuth((a) => ({ ...a, debeCambiar: false }));
      setCambioClave({ actual: "", nueva: "", repetir: "", error: "", enviando: false });
      notify("Contraseña actualizada. Ya puedes usar el sistema.");
    } catch (err) {
      setCambioClave((c) => ({ ...c, enviando: false, error: err.message || "No se pudo cambiar la contraseña." }));
    }
  };

  const submitAlumno = async (e) => {
    e.preventDefault();
    setAlumnoFormError("");
    // Validación en el cliente: el backend vuelve a comprobarlo todo, pero
    // avisar aquí evita un viaje al servidor para decir lo obvio.
    const doc = TIPOS_DOCUMENTO[alumnoForm.tipo_documento];
    const numero = (alumnoForm.numero_documento || "").trim().toUpperCase();
    if (!RE_NOMBRE.test(alumnoForm.nombre.trim()) || !RE_NOMBRE.test(alumnoForm.apellido.trim())) {
      setAlumnoFormError("El nombre y el apellido solo admiten letras, números, espacios, apóstrofo y guion.");
      return;
    }
    if (!doc.patron.test(numero)) {
      setAlumnoFormError(`${doc.etiqueta}: ${doc.ayuda} Has escrito ${numero.length} de ${doc.longitud}.`);
      return;
    }

    const body = {
      nombre: alumnoForm.nombre, apellido: alumnoForm.apellido,
      contacto_emergente: alumnoForm.contacto_emergente, edad: Number(alumnoForm.edad),
      nivel: alumnoForm.nivel, grado: Number(alumnoForm.grado),
      anio_cursada: Number(alumnoForm.anio_cursada),
      genero: alumnoForm.genero || "No especificado",
      tipo_documento: alumnoForm.tipo_documento,
      numero_documento: numero,
    };
    if (!await confirmar({
      titulo: `¿Registrar a ${body.nombre} ${body.apellido}?`,
      mensaje: "Se creará el expediente del estudiante con estos datos. El documento "
             + "de identidad quedará cifrado y no podrá repetirse en otro alumno.",
      detalles: [
        { etiqueta: "Estudiante", valor: `${body.nombre} ${body.apellido}` },
        { etiqueta: "Edad", valor: `${body.edad} años` },
        { etiqueta: "Grado", valor: `${body.grado}° de ${body.nivel}` },
        { etiqueta: TIPOS_DOCUMENTO[body.tipo_documento].etiqueta, valor: enmascararDoc(numero) },
        { etiqueta: "Contacto", valor: body.contacto_emergente },
      ],
      textoConfirmar: "Sí, registrar",
    })) return;

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

    const evaluado = alumnos.find((a) => String(a.id) === String(encuestaForm.alumno));
    if (!await confirmar({
      titulo: `¿Guardar la encuesta EDAH de ${evaluado ? `${evaluado.nombre} ${evaluado.apellido}` : "el estudiante"}?`,
      mensaje: "Con esta encuesta el sistema estimará la probabilidad de TDAH del "
             + "estudiante. Es una orientación psicoeducativa, nunca un diagnóstico clínico.",
      detalles: [
        { etiqueta: "Estudiante", valor: evaluado ? `${evaluado.nombre} ${evaluado.apellido}` : "—" },
        { etiqueta: "Ítems respondidos", valor: `${encuestaKeys.length} de ${encuestaKeys.length}` },
      ],
      tono: "aviso",
      textoConfirmar: "Sí, guardar la encuesta",
    })) return;

    try {
      await req("/encuestas/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setEncuestaStatus({ msg: "Encuesta guardada correctamente.", error: false });
    } catch (err) {
      setEncuestaStatus({ msg: err.message || "No se pudo guardar la encuesta.", error: true });
    }
  };

  // Recalcula el riesgo del alumno (auto-generar predicción). Devuelve un texto
  // para mostrar, o un aviso si aún falta la encuesta EDAH.
  const recalcularRiesgo = async (alumnoId) => {
    try {
      const pred = await req("/predicciones/generar/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alumno: Number(alumnoId) }),
      });
      await loadDashData(alumnoId);
      return ` Riesgo académico: ${pred.nivel_riesgo} (${Math.round((pred.probabilidad ?? 0) * 100)}%).`;
    } catch {
      return " (Para calcular el riesgo académico, registra primero la encuesta EDAH del estudiante.)";
    }
  };

  const submitNota = async (e) => {
    e.preventDefault();
    setNotasStatus({ msg: "", error: false });
    if (!notaForm.alumno) {
      setNotasStatus({ msg: "Selecciona un estudiante.", error: true });
      return;
    }
    const bimestre = Number(notaForm.bimestre ?? 1);
    const entradas = ASIGNATURAS_VALIDAS
      .map((a) => [a, normalizarCalificacionLiteral(notasAsig[a] || "")])
      .filter(([, lit]) => lit);  // solo cursos con nota válida
    if (entradas.length === 0) {
      setNotasStatus({ msg: "Ingresa al menos una nota de curso (AD, A, B o C).", error: true });
      return;
    }
    const evaluadoNotas = alumnos.find((a) => String(a.id) === String(notaForm.alumno));
    if (!await confirmar({
      titulo: `¿Guardar las notas del Bimestre ${bimestre}?`,
      mensaje: "Al guardarlas, el sistema recalculará automáticamente el riesgo "
             + "académico del estudiante con el nuevo promedio.",
      detalles: [
        { etiqueta: "Estudiante", valor: evaluadoNotas ? `${evaluadoNotas.nombre} ${evaluadoNotas.apellido}` : "—" },
        { etiqueta: "Bimestre", valor: String(bimestre) },
        { etiqueta: "Cursos", valor: entradas.map(([a, l]) => `${a}: ${l}`).join(" · ") },
      ],
      tono: "aviso",
      textoConfirmar: "Sí, guardar las notas",
    })) return;

    try {
      for (const [asignatura, calificacion_literal] of entradas) {
        await req("/notas/", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alumno: Number(notaForm.alumno), asignatura, calificacion_literal, bimestre }),
        });
      }
      const prom = promedioLiteral(entradas.map(([, l]) => l));
      // Refresca las notas del alumno (para histórico y grilla)
      const data = await req(`/notas/?alumno=${notaForm.alumno}`).catch(() => []);
      setHistoricoNotas(Array.isArray(data) ? data : []);
      // Cálculo automático del riesgo
      const riesgoMsg = await recalcularRiesgo(notaForm.alumno);
      setNotasStatus({
        msg: `Notas del Bimestre ${bimestre} guardadas (${entradas.length} curso(s)). `
           + `Promedio del bimestre: ${prom.letra}.${riesgoMsg}`,
        error: false,
      });
    } catch (err) {
      setNotasStatus({ msg: err.message || "No se pudieron registrar las notas.", error: true });
    }
  };

  const descargarExpediente = async () => {
    if (!expAlumno) return notify("Selecciona un estudiante para descargar el expediente.", true);

    // La ventana se abre AQUÍ, de forma síncrona. window.open() solo funciona
    // mientras dura la activación transitoria del clic (~5 s en Chrome); si se
    // llama después de un await la bloquea el navegador. En local no se notaba
    // porque la API responde en milisegundos, pero en producción la petición
    // viaja al backend —que además puede estar despertando— y la activación ya
    // ha expirado. Mientras llegan los datos, la ventana muestra un aviso.
    let win = window.open("", "_blank");
    if (win) {
      win.document.open();
      win.document.write(EXPEDIENTE_CARGANDO);
      win.document.close();
    }

    setExpLoading(true);
    try {
      const alumno = alumnos.find((a) => String(a.id) === String(expAlumno)) ?? null;
      // Sin .catch(): si estas dos fallan no hay expediente que emitir y el
      // usuario debe enterarse, en vez de recibir un documento vacío.
      const [encuestas, preds] = await Promise.all([
        req(`/encuestas/?alumno=${expAlumno}`),
        req(`/predicciones/?alumno=${expAlumno}`),
      ]);
      const encuesta = Array.isArray(encuestas) && encuestas.length ? encuestas[0] : null;
      const pred = Array.isArray(preds) && preds.length ? preds[0] : null;
      // Estas tres sí son complementarias: el expediente se emite sin ellas.
      const [shap, shapRiesgo, recomendaciones] = pred
        ? await Promise.all([
            req(`/predicciones/${pred.id}/shap/`).catch(() => null),
            req(`/predicciones/${pred.id}/shap-riesgo/`).catch(() => null),
            req(`/predicciones/${pred.id}/recomendaciones/`).catch(() => null),
          ])
        : [null, null, null];

      const html = buildExpedienteHTML({ alumno, encuesta, pred, shap, shapRiesgo, recomendaciones });

      if (win && !win.closed) {
        win.document.open();
        win.document.write(html);
        win.document.close();
        notify("Expediente generado. Usa «Guardar como PDF» en el diálogo de impresión.");
      } else {
        // Ventana bloqueada o cerrada por el usuario: se entrega como archivo.
        const nombre = alumno ? `${alumno.nombre}_${alumno.apellido}` : `alumno_${expAlumno}`;
        descargarExpedienteComoArchivo(html, `Expediente_${nombre.replace(/\s+/g, "_")}.html`);
        notify("Ventana emergente bloqueada: el expediente se descargó como archivo. Ábrelo y usa «Guardar como PDF».");
      }
    } catch (err) {
      if (win && !win.closed) win.close();
      notify(err.message || "No se pudo generar el expediente.", true);
    } finally {
      setExpLoading(false);
    }
  };

  const generarPrediccion = async () => {
    if (!predAlumno) return notify("Selecciona un alumno para generar predicción.", true);

    const objetivo = alumnos.find((a) => String(a.id) === String(predAlumno));
    if (!await confirmar({
      titulo: `¿Generar una predicción para ${objetivo ? `${objetivo.nombre} ${objetivo.apellido}` : "el estudiante"}?`,
      mensaje: "Se ejecutarán los dos modelos con los datos vigentes y el resultado "
             + "quedará guardado en el historial del estudiante.",
      detalles: [
        { etiqueta: "Estudiante", valor: objetivo ? `${objetivo.nombre} ${objetivo.apellido}` : "—" },
        { etiqueta: "Grado", valor: objetivo?.grado ?? "—" },
      ],
      textoConfirmar: "Sí, generar",
    })) return;

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

  // Mientras se valida el token guardado no se decide nada: mostrar el acceso
  // aquí haría parpadear el formulario en cada recarga.
  if (restaurando) {
    return (
      <PantallaAcceso>
        <section className="auth-card" style={{ textAlign: "center" }}>
          <p className="cargando" role="status" aria-live="polite" style={{ justifyContent: "center" }}>
            <span className="spinner" aria-hidden="true" />Restaurando tu sesión…
          </p>
        </section>
      </PantallaAcceso>
    );
  }

  // Primer ingreso o contraseña repuesta por el administrador: no se entra al
  // sistema hasta definir una propia.
  if (auth.logged && auth.debeCambiar) {
    return (
      <PantallaAcceso>
        {dialogo}
        <section className="auth-card">
          <h1>Define tu contraseña</h1>
          <p>Hola, {auth.nombre}</p>
          <p className="form-legend">
            Estás usando una contraseña asignada. Elige una propia para continuar:
            al menos 8 caracteres, combinando letras y números.
          </p>

          <form onSubmit={enviarCambioClave}>
            <label htmlFor="clave-actual">Contraseña actual</label>
            <input
              id="clave-actual" type="password" autoComplete="current-password" required
              value={cambioClave.actual}
              onChange={(e) => setCambioClave({ ...cambioClave, actual: e.target.value, error: "" })}
            />

            <label htmlFor="clave-nueva">Contraseña nueva</label>
            <input
              id="clave-nueva" type="password" autoComplete="new-password" required minLength={8}
              value={cambioClave.nueva}
              onChange={(e) => setCambioClave({ ...cambioClave, nueva: e.target.value, error: "" })}
            />

            <label htmlFor="clave-repetir">Repite la contraseña nueva</label>
            <input
              id="clave-repetir" type="password" autoComplete="new-password" required minLength={8}
              value={cambioClave.repetir}
              onChange={(e) => setCambioClave({ ...cambioClave, repetir: e.target.value, error: "" })}
            />

            {cambioClave.error && (
              <div className="alert-error" role="alert" style={{ marginTop: "var(--e3)" }}>
                {cambioClave.error}
              </div>
            )}

            <button type="submit" style={{ marginTop: "var(--e4)" }} disabled={cambioClave.enviando}>
              {cambioClave.enviando
                ? (<><span className="spinner" aria-hidden="true" style={{ marginRight: 8, verticalAlign: "-2px" }} />Guardando…</>)
                : "Guardar y entrar"}
            </button>
          </form>

          <p style={{ textAlign: "center", margin: "var(--e3) 0 0" }}>
            <button type="button" className="dash-link-btn" onClick={cerrarSesion}>
              Cancelar y salir
            </button>
          </p>
        </section>
      </PantallaAcceso>
    );
  }

  if (!auth.logged) {
    return (
      <PantallaAcceso>
        {dialogo}
        <section className="auth-card">
          <h1>Sistema de Predicción Educativa</h1>

          {!recuperar.abierto ? (
            <>
              <p>Inicia sesión</p>
              <form onSubmit={onLogin}>
                <label htmlFor="acceso-usuario">Usuario</label>
                <input
                  id="acceso-usuario"
                  autoComplete="username"
                  value={auth.usuario}
                  onChange={(e) => setAuth({ ...auth, usuario: e.target.value })}
                  required
                />
                <label htmlFor="acceso-clave">Contraseña</label>
                <input
                  id="acceso-clave"
                  type="password"
                  autoComplete="current-password"
                  value={auth.password}
                  onChange={(e) => setAuth({ ...auth, password: e.target.value })}
                  required
                />
                <button type="submit" style={{ marginTop: "var(--e4)" }} disabled={autenticando}>
                  {autenticando
                    ? (<><span className="spinner" aria-hidden="true" style={{ marginRight: 8, verticalAlign: "-2px" }} />Verificando…</>)
                    : "Iniciar Sesión"}
                </button>
              </form>

              <p style={{ textAlign: "center", margin: "var(--e3) 0 0" }}>
                <button
                  type="button"
                  className="dash-link-btn"
                  onClick={() => setRecuperar({ abierto: true, usuario: auth.usuario, resultado: null, error: "" })}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </p>

              <p className="form-legend" style={{ marginTop: "var(--e4)", textAlign: "center" }}>
                Las cuentas las asigna el administrador del sistema.
              </p>
            </>
          ) : (
            <>
              <p>Recuperar el acceso</p>

              {!recuperar.resultado ? (
                <form onSubmit={solicitarRecuperacion}>
                  <p className="form-legend">
                    Las cuentas las asigna el administrador del sistema. Indica tu usuario y te
                    mostraremos cómo solicitar una contraseña nueva.
                  </p>

                  <label htmlFor="recuperar-usuario">Usuario</label>
                  <input
                    id="recuperar-usuario"
                    autoComplete="username"
                    aria-describedby="recuperar-ayuda"
                    placeholder="Por ejemplo: psicologo"
                    value={recuperar.usuario}
                    onChange={(e) => setRecuperar({ ...recuperar, usuario: e.target.value, error: "" })}
                    required
                  />
                  <span id="recuperar-ayuda" className="form-legend" style={{ marginTop: 6 }}>
                    El mismo con el que ingresas, no tu correo.
                  </span>

                  {recuperar.error && (
                    <div className="alert-error" role="alert" style={{ marginTop: "var(--e3)" }}>
                      {recuperar.error}
                    </div>
                  )}

                  <button type="submit" style={{ marginTop: "var(--e4)" }} disabled={recuperar.enviando}>
                    {recuperar.enviando
                      ? (<><span className="spinner" aria-hidden="true" style={{ marginRight: 8, verticalAlign: "-2px" }} />Registrando…</>)
                      : "Solicitar recuperación"}
                  </button>
                </form>
              ) : (
                <div role="status" aria-live="polite">
                  <div className="alert-success">{recuperar.resultado.mensaje}</div>

                  <div className="card" style={{ marginTop: "var(--e3)" }}>
                    <p style={{ margin: "0 0 var(--e2)", fontSize: "var(--t-md)" }}>
                      <strong>Qué hacer ahora</strong>
                    </p>
                    <ol style={{ margin: 0, paddingLeft: "var(--e5)", fontSize: "var(--t-md)",
                                 color: "var(--tinta-media)", lineHeight: 1.7 }}>
                      <li>Comunica al administrador el código de referencia.</li>
                      <li>El administrador repone tu contraseña y te entrega una temporal.</li>
                      <li>Al ingresar con ella, el sistema te pedirá definir la tuya.</li>
                    </ol>

                    {recuperar.resultado.ref && (
                      <>
                        <p style={{ margin: "var(--e3) 0 0", fontSize: "var(--t-md)" }}>
                          Código de referencia:{" "}
                          <strong style={{ fontFamily: "ui-monospace, Consolas, monospace",
                                           letterSpacing: ".04em" }}>{recuperar.resultado.ref}</strong>
                        </p>
                        <p className="form-legend" style={{ margin: "var(--e1) 0 0" }}>
                          Generado el {recuperar.resultado.fecha} · vigente {recuperar.resultado.dias} días
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              <p style={{ textAlign: "center", margin: "var(--e4) 0 0" }}>
                <button type="button" className="dash-link-btn" onClick={volverAlAcceso}>
                  ← Volver al inicio de sesión
                </button>
              </p>
            </>
          )}

          {status.msg && (
            <p
              className={status.error ? "alert-error" : "alert-success"}
              role={status.error ? "alert" : "status"}
              aria-live="polite"
              style={{ marginTop: "var(--e3)" }}
            >
              {status.msg}
            </p>
          )}
        </section>
      </PantallaAcceso>
    );
  }

  /* ── Main app ────────────────────────────────────────────────────────── */

  const viewsPermitidas = viewsDeRol(auth.rol);
  const soloLectura = !puedeGestionarAlumnos(auth.rol);

  return (
    <div className="app-shell">
      {dialogo}
      {/* Primer tabulador de la página: salta la navegación repetida. */}
      <a className="skip-link" href="#contenido">Saltar al contenido principal</a>

      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">📖</span>
          <div>
            <h2>Sistema</h2>
            <span>{auth.rol || "Usuario"}</span>
          </div>
        </div>
        <nav aria-label="Navegación principal">
          {viewsPermitidas.map((v) => {
            const { icon, label } = NAV_LABELS[v];
            return (
              <button
                key={v}
                type="button"
                className={activeView === v ? "nav-active" : ""}
                aria-current={activeView === v ? "page" : undefined}
                onClick={() => goToView(v)}
              >
                <span className="nav-icon" aria-hidden="true">{icon}</span>
                {label}
              </button>
            );
          })}
          <button type="button" className="danger" onClick={cerrarSesion}>
            <span className="nav-icon" aria-hidden="true">⊗</span>
            Cerrar Sesión
          </button>
        </nav>
      </aside>

      {/* ── Content ─────────────────────────────────── */}
      <main className="content" id="contenido" tabIndex={-1}>

        {/* ── Dashboard ──────────────────────────────── */}
        {activeView === "dashboard" && (() => {
          const color = { Alto: "var(--alto)", Medio: "var(--medio)", Bajo: "var(--bajo)" };
          const colorTdah = { Alta: "var(--alto)", Media: "var(--medio)", Baja: "var(--bajo)" };

          // Última predicción de cada alumno, para poder filtrar por resultado.
          const ultimaDe = {};
          (todosPredicciones ?? []).forEach((p) => { if (!ultimaDe[p.alumno]) ultimaDe[p.alumno] = p; });

          const grados = [...new Set(alumnos.map((a) => a.grado).filter(Boolean))].sort();
          const f = dashFiltros;
          const texto = f.texto.trim().toLowerCase();

          const alumnosFiltrados = alumnos.filter((a) => {
            if (texto && !`${a.nombre} ${a.apellido}`.toLowerCase().includes(texto)) return false;
            if (f.grado && a.grado !== f.grado) return false;
            const p = ultimaDe[a.id];
            if (f.riesgo !== "Todos" && p?.nivel_riesgo !== f.riesgo) return false;
            if (f.tdah !== "Todos" && (!p || tdahNivelProb(p.nivel_tdah) !== f.tdah)) return false;
            return true;
          });

          const hayFiltro = Boolean(texto) || Boolean(f.grado) || f.riesgo !== "Todos" || f.tdah !== "Todos";

          // ¿El borrador difiere de lo aplicado? Sirve para avisar al usuario
          // de que lo que ve en pantalla aún no se ha buscado.
          const hayCambios = ["texto", "grado", "riesgo", "tdah"]
            .some((k) => String(dashBorrador[k]).trim() !== String(dashFiltros[k]).trim());

          const aplicarFiltros = () => setDashFiltros({ ...dashBorrador });
          const limpiarFiltros = () => {
            setDashBorrador({ ...DASH_FILTROS_VACIOS });
            setDashFiltros({ ...DASH_FILTROS_VACIOS });
          };
          const idx = alumnosFiltrados.findIndex((a) => String(a.id) === String(dashAlumno));
          const irA = (nuevoIdx) => {
            const a = alumnosFiltrados[nuevoIdx];
            if (!a) return;
            setDashAlumno(String(a.id));
            loadDashData(String(a.id));
          };

          // Media institucional del índice de riesgo: da referencia a la cifra
          // del estudiante, que por sí sola no dice si es mucho o poco.
          const evaluados = Object.values(ultimaDe);
          const mediaRiesgo = evaluados.length
            ? Math.round(evaluados.reduce((acc, p) => acc + (p.probabilidad ?? 0), 0) / evaluados.length * 100)
            : null;

          const acadPieData = dashData ? buildAcadPieData(dashData.nivel_riesgo, dashData.probabilidad) : [];
          const tdahPieData = dashData ? buildTdahPieData(dashData) : [];
          const factoresData = dashData ? buildFactoresData(dashData) : [];

          const tdahNivel = dashData ? tdahNivelProb(dashData.nivel_tdah) : "Baja";
          const riesgo = dashData?.nivel_riesgo ?? "Bajo";
          const rendLetra = dashData?.promedio_final ?? dashData?.prediccion_notas ?? "—";
          const confPct = Math.round((dashData?.confianza_tdah ?? 0) * 100);
          const riesgoPct = Math.round((dashData?.probabilidad ?? 0) * 100);

          // Distribución real del modelo; null en predicciones antiguas.
          const pr = dashData?.proba_tdah;
          const tieneDistribucion = pr && pr.alta != null;
          const pct = (v) => Math.round((v ?? 0) * 100);

          // Evolución: el sistema guarda todas las predicciones y hasta ahora
          // no se mostraba ninguna. Orden cronológico ascendente.
          const serie = [...(dashHistorial ?? [])].reverse()
            .map((p) => ({ v: Math.round((p.probabilidad ?? 0) * 100), f: p.fecha_prediccion }));

          const Etiqueta = ({ children }) => (
            <span style={{ fontSize: "var(--t-xs)", fontWeight: 700, letterSpacing: ".06em",
                           textTransform: "uppercase", color: "var(--tinta-suave)" }}>{children}</span>
          );

          return (
            <div className="dashboard">
              <h1 className="page-title">Dashboard del Estudiante</h1>

              {/* Buscador y filtros: acotan la lista antes de elegir. Con 34
                  estudiantes, encontrar «los de riesgo alto de 2°» era leer
                  el desplegable entero (SUS, ítem 8). */}
              <article className="panel" style={{ marginBottom: "var(--e4)" }}>
                {/* Formulario de verdad: así «Buscar» responde también al Enter
                    desde cualquier campo, sin atajos de teclado inventados. */}
                <form onSubmit={(e) => { e.preventDefault(); aplicarFiltros(); }}>
                  <div className="grid">
                    <div className="field-group">
                      <label htmlFor="dash-buscar">Buscar por nombre</label>
                      <input
                        id="dash-buscar"
                        type="search"
                        placeholder="Escribe un nombre o apellido…"
                        value={dashBorrador.texto}
                        onChange={(e) => setDashBorrador({ ...dashBorrador, texto: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label htmlFor="dash-grado">Grado</label>
                      <select id="dash-grado" value={dashBorrador.grado}
                              onChange={(e) => setDashBorrador({ ...dashBorrador, grado: e.target.value })}>
                        <option value="">Todos los grados</option>
                        {grados.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div className="field-group">
                      <label htmlFor="dash-friesgo">Riesgo académico</label>
                      <select id="dash-friesgo" value={dashBorrador.riesgo}
                              onChange={(e) => setDashBorrador({ ...dashBorrador, riesgo: e.target.value })}>
                        <option value="Todos">Todos</option>
                        <option value="Alto">Alto</option>
                        <option value="Medio">Medio</option>
                        <option value="Bajo">Bajo</option>
                      </select>
                    </div>
                    <div className="field-group">
                      <label htmlFor="dash-ftdah">Probabilidad de TDAH</label>
                      <select id="dash-ftdah" value={dashBorrador.tdah}
                              onChange={(e) => setDashBorrador({ ...dashBorrador, tdah: e.target.value })}>
                        <option value="Todos">Todas</option>
                        <option value="Alta">Alta</option>
                        <option value="Media">Media</option>
                        <option value="Baja">Baja</option>
                      </select>
                    </div>
                  </div>

                  <div className="row" style={{ marginTop: "var(--e3)", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--e2)" }}>
                    <p className="form-legend" style={{ margin: 0 }} role="status" aria-live="polite">
                      {hayFiltro
                        ? `${alumnosFiltrados.length} de ${alumnos.length} estudiantes cumplen los filtros.`
                        : `${alumnos.length} estudiantes registrados.`}
                    </p>

                    <div className="row" style={{ gap: "var(--e2)", alignItems: "center" }}>
                      {hayCambios && (
                        <span className="form-legend" style={{ margin: 0, color: "var(--medio)" }}>
                          Cambios sin aplicar
                        </span>
                      )}
                      <button type="submit" style={{ width: "auto", padding: "10px 22px" }}>
                        Buscar
                      </button>
                      {(hayFiltro || hayCambios) && (
                        <button type="button" className="dash-link-btn" onClick={limpiarFiltros}>
                          Limpiar filtros
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </article>

              {/* Selector como en la versión anterior. Se conserva el
                  desplegable y se añade solo la asociación label/campo, que es
                  invisible pero necesaria para lector de pantalla. */}
              <article className="panel dash-selector-panel">
                <label className="dash-selector-label" htmlFor="dash-alumno">Selecciona un Estudiante</label>
                <select
                  id="dash-alumno"
                  className="dash-selector-select"
                  value={dashAlumno}
                  onChange={(e) => {
                    setDashAlumno(e.target.value);
                    loadDashData(e.target.value);
                  }}
                >
                  <option value="">-- Selecciona --</option>
                  {alumnosFiltrados.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre} {a.apellido} - {a.grado}
                      {ultimaDe[a.id] ? ` · ${ultimaDe[a.id].nivel_riesgo}` : " · sin predicción"}
                    </option>
                  ))}
                </select>

                {/* Recorrer la selección sin volver al desplegable cada vez. */}
                {alumnosFiltrados.length > 1 && (
                  <div className="row" style={{ gap: "var(--e2)" }}>
                    <button type="button" className="lista-btn lista-btn--edit"
                            onClick={() => irA(idx - 1)} disabled={idx <= 0}
                            aria-label="Estudiante anterior">‹ Anterior</button>
                    <span style={{ fontSize: "var(--t-sm)", color: "var(--tinta-suave)", whiteSpace: "nowrap" }}>
                      {idx >= 0 ? `${idx + 1} de ${alumnosFiltrados.length}` : `${alumnosFiltrados.length} disponibles`}
                    </span>
                    <button type="button" className="lista-btn lista-btn--edit"
                            onClick={() => irA(idx + 1)} disabled={idx < 0 || idx >= alumnosFiltrados.length - 1}
                            aria-label="Estudiante siguiente">Siguiente ›</button>
                  </div>
                )}
              </article>

              {hayFiltro && alumnosFiltrados.length === 0 && (
                <div className="vacio">
                  <strong>Ningún estudiante cumple los filtros</strong>
                  <span>Prueba a quitar alguno o revisa que tengan predicción generada.</span>
                </div>
              )}

              {dashAlumno && !dashData && (
                <p className="dash-empty">
                  No hay predicciones para este estudiante.{" "}
                  <button type="button" className="dash-link-btn" onClick={() => goToView("predicciones")}>
                    Generar predicción →
                  </button>
                </p>
              )}

              {dashData && (
                <>
                  {/* Tres tarjetas, como en la versión anterior. */}
                  <div className="kpi-row">
                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon--person" aria-hidden="true">👤</div>
                      <div className="kpi-body">
                        <span className="kpi-label">Riesgo Académico</span>
                        <span className="kpi-value" style={{ color: color[riesgo] }}>{riesgo}</span>
                        <span className="kpi-sub">
                          Probabilidad: {riesgoPct}%
                          <span className="kpi-arrow" style={{ color: color[riesgo] }} aria-hidden="true">
                            {riesgo === "Alto" ? " ↑" : riesgo === "Bajo" ? " ↓" : " →"}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon--brain" aria-hidden="true">🧠</div>
                      <div className="kpi-body">
                        <span className="kpi-label">Riesgo TDAH</span>
                        <span className="kpi-value" style={{ color: colorTdah[tdahNivel] }}>
                          Probabilidad {tdahNivel}
                        </span>
                        <span className="kpi-sub">
                          Probabilidad: {confPct}%
                          <span className="kpi-arrow" style={{ color: colorTdah[tdahNivel] }} aria-hidden="true">
                            {tdahNivel !== "Baja" ? " ⚠" : " ✓"}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon--chart" aria-hidden="true">📊</div>
                      <div className="kpi-body">
                        <span className="kpi-label">Rendimiento General</span>
                        <span className="kpi-value">{rendLetra}</span>
                        <span className="kpi-sub">Promedio (nota literal)</span>
                      </div>
                    </div>
                  </div>

                  {/* Procedencia del dato: no altera el apartado inicial, lo
                      acompaña. Responde al ítem 9 de SUS (confianza al usarlo). */}
                  <p className="form-legend" style={{ marginTop: "calc(-1 * var(--e2))" }}>
                    Predicción del {formatFecha(dashData.fecha_prediccion)} · encuesta EDAH de 20 ítems,
                    promedio {rendLetra} y {dashData.inasistencias ?? 0} día(s) de inasistencia.
                  </p>

                  {/* ── Donas de predicción ── */}
                  <div className="charts-row">
                    <div className="chart-panel">
                      <h3 className="chart-title">Predicción Riesgo Académico</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={acadPieData} cx="50%" cy="50%" innerRadius={58} outerRadius={90}
                               paddingAngle={2} dataKey="value" stroke="none">
                            {acadPieData.map((entry) => (
                              <Cell key={entry.name} fill={RIESGO_COLORS[entry.name]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: "var(--superficie-2)", border: "1px solid var(--linea-fuerte)", borderRadius: 8, color: "var(--tinta)" }} />
                          <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: "0.78rem", color: "var(--tinta-media)" }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <p className="form-legend" style={{ margin: 0 }}>
                        La parte verde es lo que falta para el riesgo máximo: índice {riesgoPct} de 100.
                      </p>
                    </div>

                    <div className="chart-panel">
                      <h3 className="chart-title">Predicción TDAH</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={tdahPieData} cx="50%" cy="50%" innerRadius={58} outerRadius={90}
                               paddingAngle={2} dataKey="value" stroke="none">
                            {tdahPieData.map((entry) => (
                              <Cell key={entry.name} fill={PROB_COLORS[entry.name]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v, n) => [`${v}%`, tdahTexto(n)]} contentStyle={{ background: "var(--superficie-2)", border: "1px solid var(--linea-fuerte)", borderRadius: 8, color: "var(--tinta)" }} />
                          <Legend iconType="circle" iconSize={10} formatter={(value) => tdahTexto(value)} wrapperStyle={{ fontSize: "0.78rem", color: "var(--tinta-media)" }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <p className="form-legend" style={{ margin: 0 }}>
                        {tieneDistribucion
                          ? "Cada porción es la probabilidad que el modelo asigna a esa clase. Suman 100%."
                          : "Predicción anterior al registro de la distribución completa: solo la clase predicha y su confianza."}
                      </p>
                    </div>
                  </div>

                  <div className="charts-row">
                    <div className="chart-panel">
                      <h3 className="chart-title">Factores que Influyen en el Riesgo</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={factoresData} layout="vertical"
                                  margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
                          <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`}
                                 tick={{ fontSize: 11, fill: "var(--tinta-suave)" }}
                                 axisLine={{ stroke: "var(--linea)" }} tickLine={{ stroke: "var(--linea)" }} />
                          <YAxis type="category" dataKey="name" width={124} tickLine={false}
                                 tick={{ fontSize: 12, fill: "var(--tinta-media)" }}
                                 axisLine={{ stroke: "var(--linea)" }} />
                          <Tooltip formatter={(v) => `${v}%`} cursor={{ fill: "rgba(255,255,255,.04)" }} contentStyle={{ background: "var(--superficie-2)", border: "1px solid var(--linea-fuerte)", borderRadius: 8, color: "var(--tinta)" }} />
                          <Bar dataKey="valor" radius={[0, 6, 6, 0]}
                               label={{ position: "right", formatter: (v) => `${v}%`, fontSize: 12, fill: "var(--tinta-media)" }}>
                            {factoresData.map((_, i) => (
                              <Cell key={i} fill={FACTOR_COLORS[i % FACTOR_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <p className="form-legend" style={{ margin: 0 }}>
                        Cada factor en su propia escala, expresado como porcentaje de su máximo.
                      </p>
                    </div>

                    {/* ── El porqué, en la misma pantalla ── */}
                    <div className="chart-panel">
                      <h3 className="chart-title">Por qué el modelo estimó esto</h3>
                      {dashShapCargando && (
                        <p className="cargando" role="status" aria-live="polite">
                          <span className="spinner" aria-hidden="true" />Calculando la explicación…
                        </p>
                      )}
                      {!dashShapCargando && dashShap?.tdah?.features?.length > 0 && (
                        <>
                          <ShapFactores features={dashShap.tdah.features} />
                          {dashShap.riesgo?.features?.length > 0 && (
                            <div style={{ marginTop: "var(--e4)", paddingTop: "var(--e3)",
                                          borderTop: "1px dashed var(--linea-fuerte)" }}>
                              <Etiqueta>Riesgo académico</Etiqueta>
                              <ShapFactores features={dashShap.riesgo.features} />
                            </div>
                          )}
                          <p className="form-legend" style={{ marginTop: "var(--e3)", marginBottom: 0 }}>
                            Cada barra indica cuánto empujó ese factor el resultado, en rojo hacia arriba y en verde hacia abajo.
                          </p>
                        </>
                      )}
                      {!dashShapCargando && !dashShap?.tdah?.features?.length && (
                        <p className="form-legend" style={{ margin: 0 }}>No se pudo obtener la explicación.</p>
                      )}
                    </div>
                  </div>

                  <div className="bottom-row">
                    {/* ── Evolución: dato que ya se guardaba y nunca se mostraba ── */}
                    <div className="chart-panel">
                      <h3 className="chart-title">Cómo ha evolucionado su riesgo</h3>
                      {serie.length < 2 ? (
                        <p className="form-legend" style={{ margin: 0 }}>
                          Solo hay una evaluación. La línea aparecerá cuando se genere una segunda,
                          y permitirá ver si el estudiante mejora o empeora.
                        </p>
                      ) : (
                        <>
                          <svg viewBox="0 0 320 110" width="100%" height="120" role="img"
                               aria-label={`Evolución del índice de riesgo en ${serie.length} evaluaciones, de ${serie[0].v} a ${serie[serie.length - 1].v} sobre 100`}>
                            <line x1="0" y1="100" x2="320" y2="100" stroke="var(--linea)" strokeWidth="1" />
                            <line x1="0" y1="10" x2="320" y2="10" stroke="var(--linea)" strokeWidth="1" strokeDasharray="3 3" />
                            {mediaRiesgo != null && (
                              <>
                                <line x1="0" y1={100 - (mediaRiesgo / 100) * 90} x2="320" y2={100 - (mediaRiesgo / 100) * 90}
                                      stroke="var(--tinta-suave)" strokeWidth="1.5" strokeDasharray="5 4" />
                                <text x="4" y={100 - (mediaRiesgo / 100) * 90 - 5} fontSize="9" fill="var(--tinta-suave)">
                                  media institucional {mediaRiesgo}
                                </text>
                              </>
                            )}
                            <polyline
                              fill="none" stroke="var(--marca)" strokeWidth="2.5"
                              strokeLinejoin="round" strokeLinecap="round"
                              points={serie.map((p, i) =>
                                `${(i / Math.max(1, serie.length - 1)) * 310 + 5},${100 - (p.v / 100) * 90}`).join(" ")}
                            />
                            {serie.map((p, i) => (
                              <circle key={i}
                                cx={(i / Math.max(1, serie.length - 1)) * 310 + 5}
                                cy={100 - (p.v / 100) * 90}
                                r={i === serie.length - 1 ? 4.5 : 3}
                                fill={i === serie.length - 1 ? "var(--marca-oscura)" : "var(--marca)"} />
                            ))}
                          </svg>
                          <div style={{ display: "flex", justifyContent: "space-between",
                                        fontSize: "var(--t-sm)", color: "var(--tinta-suave)" }}>
                            <span>Primera: {serie[0].v} de 100</span>
                            <span style={{ fontWeight: 700, color: "var(--tinta)" }}>
                              Actual: {serie[serie.length - 1].v} de 100
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="chart-panel">
                      <h3 className="chart-title">Qué se recomienda hacer</h3>
                      <RecomendacionesPanel predId={dashData.id} />
                    </div>
                  </div>

                  {/* Acciones de salida: el panel deja de ser un punto muerto. */}
                  <article className="panel" style={{ marginTop: "var(--e4)" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <p className="form-legend" style={{ margin: 0 }}>
                        ¿Los datos del estudiante cambiaron? Vuelve a calcular la predicción con la información actual.
                      </p>
                      <div className="row" style={{ gap: "var(--e2)" }}>
                        <button
                          type="button"
                          style={{ width: "auto" }}
                          onClick={async () => {
                            const msg = await recalcularRiesgo(dashAlumno);
                            notify(`Predicción actualizada.${msg}`);
                            await loadTodosPredicciones();
                          }}
                        >
                          Recalcular predicción
                        </button>
                        {puedeVer(auth.rol, "expediente") && (
                          <button
                            type="button"
                            className="lista-btn lista-btn--edit"
                            onClick={() => { setExpAlumno(String(dashAlumno)); goToView("expediente"); }}
                          >
                            Ir al expediente
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                </>
              )}
            </div>
          );
        })()}

        {/* ── Dashboard General ──────────────────────── */}
        {activeView === "general" && (() => {
          // Filtrado cruzado (AND). Los contadores KPI se calculan sobre el
          // conjunto YA filtrado, de modo que reaccionan en tiempo real.
          const latest = ultimaPorAlumno(todosPredicciones);
          const filtrados = filtrarPredicciones(latest, filtrosGeneral);
          const { riesgo: riesgoCount, tdah: tdahCount } = contarPorGrupo(filtrados);
          const filtroActivo = hayFiltroActivo(filtrosGeneral);
          const m = metricas?.val;

          const chip = (valor, count, color, tipo) => (
            <div key={valor}
              style={{ flex: 1, minWidth: 90, padding: "12px", borderRadius: 10, textAlign: "center",
                border: "1px solid #e2e8f0", background: "#fff" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color }}>{count}</div>
              <div style={{ fontSize: "0.82rem", color: "#64748b" }}>{tipo === "tdah" ? `Probabilidad ${valor}` : valor}</div>
            </div>
          );

          return (
            <div className="dashboard">
              <h1 className="page-title">Dashboard General</h1>

              <FiltrosPrediccion
                filtros={filtrosGeneral}
                onChange={setFiltrosGeneral}
                total={latest.length}
                mostrados={filtrados.length}
              />

              {/* Resumen — reacciona al filtro cruzado */}
              <div className="kpi-row">
                <div className="kpi-card"><div className="kpi-body"><span className="kpi-label">Alumnos registrados</span><span className="kpi-value" style={{ color: "#2563eb" }}>{alumnos.length}</span></div></div>
                <div className="kpi-card"><div className="kpi-body"><span className="kpi-label">{filtroActivo ? "Alumnos filtrados" : "Alumnos evaluados"}</span><span className="kpi-value" style={{ color: "#0ea5e9" }}>{filtrados.length}</span></div></div>
                <div className="kpi-card"><div className="kpi-body"><span className="kpi-label">Riesgo Académico Alto</span><span className="kpi-value" style={{ color: "#ef4444" }}>{riesgoCount.Alto}</span></div></div>
                <div className="kpi-card"><div className="kpi-body"><span className="kpi-label">Prob. Alta de TDAH</span><span className="kpi-value" style={{ color: "#ef4444" }}>{tdahCount.Alta}</span></div></div>
              </div>

              {/* Distribución dentro de la selección filtrada */}
              <div className="charts-row">
                <div className="chart-panel">
                  <h3 className="chart-title">Riesgo Académico</h3>
                  <div style={{ display: "flex", gap: 10 }}>
                    {["Alto", "Medio", "Bajo"].map((nv) => chip(nv, riesgoCount[nv], RIESGO_COLORS[nv], "riesgo"))}
                  </div>
                </div>
                <div className="chart-panel">
                  <h3 className="chart-title">Probabilidad de TDAH</h3>
                  <div style={{ display: "flex", gap: 10 }}>
                    {["Alta", "Media", "Baja"].map((nv) => chip(nv, tdahCount[nv], PROB_COLORS["Sospecha " + nv], "tdah"))}
                  </div>
                </div>
              </div>

              {/* Lista de estudiantes filtrada */}
              <article className="panel" style={{ marginTop: 16, overflowX: "auto" }}>
                <h3 style={{ margin: "0 0 8px" }}>
                  Estudiantes evaluados ({filtrados.length})
                </h3>
                {filtrados.length === 0 ? (
                  <p style={{ color: "var(--tinta-suave)" }}>
                    {filtroActivo
                      ? "Ningún estudiante cumple los filtros seleccionados."
                      : "Todavía no hay estudiantes con predicción generada."}
                  </p>
                ) : (
                  <table className="lista-table">
                    <thead><tr><th>Alumno</th><th>Riesgo Académico</th><th>Probabilidad TDAH</th><th>Inasistencias</th><th>Fecha</th></tr></thead>
                    <tbody>
                      {filtrados.map((p) => (
                        <tr key={p.id}>
                          <td>{p.alumno_nombre ?? `Alumno ${p.alumno}`}</td>
                          <td><b style={{ color: RIESGO_COLORS[p.nivel_riesgo] }}>{p.nivel_riesgo}</b></td>
                          <td><b style={{ color: PROB_COLORS["Sospecha " + tdahNivelProb(p.nivel_tdah)] }}>Probabilidad {tdahNivelProb(p.nivel_tdah)}</b></td>
                          <td>{p.inasistencias ?? 0}</td>
                          <td style={{ fontSize: "0.8rem", color: "#64748b" }}>{formatFecha(p.fecha_prediccion)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </article>

              {/* Métricas del modelo */}
              <article className="panel" style={{ marginTop: 16 }}>
                <h3 className="chart-title">Métricas del Modelo (macro · conjunto de validación)</h3>
                {m ? (
                  <div className="kpi-row">
                    {[["Accuracy", m.accuracy], ["Precisión", m.precision_macro], ["Recall", m.recall_macro], ["F1-Score", m.f1_macro], ["Especificidad", m.especificidad_macro]].map(([lbl, val]) => (
                      <div key={lbl} className="kpi-card"><div className="kpi-body"><span className="kpi-label">{lbl}</span><span className="kpi-value" style={{ color: "#2563eb" }}>{(val * 100).toFixed(1)}%</span></div></div>
                    ))}
                  </div>
                ) : <p style={{ color: "var(--tinta-suave)" }}>Métricas no disponibles (ejecuta el entrenamiento).</p>}
                {metricas?.cv && (
                  <p style={{ color: "#64748b", fontSize: "0.82rem", marginTop: 8 }}>
                    Validación cruzada (5 folds): accuracy {(metricas.cv.accuracy * 100).toFixed(1)}% ± {(metricas.cv.accuracy_std * 100).toFixed(1)} · recall «Con TDAH» {(metricas.cv.recall_con_tdah * 100).toFixed(1)}%
                  </p>
                )}
              </article>
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
                  <input id="alumno-nombre" type="text" value={alumnoForm.nombre}
                         pattern="[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9'\- ]*"
                         title="Solo letras, números, espacios, apóstrofo y guion"
                         onChange={(e) => setAlumnoForm({ ...alumnoForm, nombre: e.target.value })} required />
                </div>
                <div className="field-group">
                  <label htmlFor="alumno-apellido">Apellido</label>
                  <input id="alumno-apellido" type="text" value={alumnoForm.apellido}
                         pattern="[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9'\- ]*"
                         title="Solo letras, números, espacios, apóstrofo y guion"
                         onChange={(e) => setAlumnoForm({ ...alumnoForm, apellido: e.target.value })} required />
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
                  <label htmlFor="alumno-nivel">Nivel</label>
                  <select
                    id="alumno-nivel"
                    value={alumnoForm.nivel}
                    onChange={(e) => setAlumnoForm({ ...alumnoForm, nivel: e.target.value, grado: "" })}
                    required
                  >
                    <option value="Primaria">Primaria</option>
                    <option value="Secundaria">Secundaria</option>
                  </select>
                </div>

                <div className="field-group">
                  <label htmlFor="alumno-grado">Grado</label>
                  <select
                    id="alumno-grado"
                    value={alumnoForm.grado}
                    onChange={(e) => setAlumnoForm({ ...alumnoForm, grado: e.target.value })}
                    required
                  >
                    <option value="">Selecciona</option>
                    {Array.from({ length: NIVELES[alumnoForm.nivel] ?? 5 }, (_, i) => i + 1).map((g) => (
                      <option key={g} value={g}>{g}° de {alumnoForm.nivel}</option>
                    ))}
                  </select>
                </div>

                <div className="field-group">
                  <label htmlFor="alumno-tipo-doc">Tipo de documento</label>
                  <select
                    id="alumno-tipo-doc"
                    value={alumnoForm.tipo_documento}
                    onChange={(e) => setAlumnoForm({ ...alumnoForm, tipo_documento: e.target.value, numero_documento: "" })}
                    required
                  >
                    {Object.entries(TIPOS_DOCUMENTO).map(([k, v]) => (
                      <option key={k} value={k}>{v.etiqueta}</option>
                    ))}
                  </select>
                </div>

                <div className="field-group">
                  <label htmlFor="alumno-num-doc">Número de documento</label>
                  <input
                    id="alumno-num-doc"
                    type="text"
                    inputMode={alumnoForm.tipo_documento === "PASAPORTE" ? "text" : "numeric"}
                    maxLength={TIPOS_DOCUMENTO[alumnoForm.tipo_documento].longitud}
                    aria-describedby="alumno-doc-ayuda"
                    value={alumnoForm.numero_documento}
                    onChange={(e) => {
                      // Se filtra al teclear: dígitos siempre, letras solo en pasaporte.
                      const permitido = alumnoForm.tipo_documento === "PASAPORTE"
                        ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                        : e.target.value.replace(/\D/g, "");
                      setAlumnoForm({ ...alumnoForm, numero_documento: permitido });
                    }}
                    required
                  />
                  <span id="alumno-doc-ayuda" className="form-legend" style={{ marginTop: 6 }}>
                    {TIPOS_DOCUMENTO[alumnoForm.tipo_documento].ayuda}{" "}
                    {alumnoForm.numero_documento.length}/{TIPOS_DOCUMENTO[alumnoForm.tipo_documento].longitud}.
                    Se guarda cifrado y solo se muestran los 4 últimos dígitos.
                  </span>
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

                {alumnoFormError && <div className="alert-error" role="alert">{alumnoFormError}</div>}
                <button className="full" type="submit">Registrar Alumno</button>
              </form>
            </article>
          </>
        )}

        {/* ── Lista de Alumnos ───────────────────────── */}
        {activeView === "lista" && (() => {
          const predsPorAlumno = {};
          todosPredicciones.forEach((p) => { predsPorAlumno[p.alumno] = p; });

          const estadoAlumno = (id) => {
            const p = predsPorAlumno[id];
            if (!p) return { label: "Registrado", color: "#64748b" };
            if (p.nivel_riesgo) return { label: "Con Predicción", color: "#0093c4" };
            return { label: "Evaluado", color: "#16a34a" };
          };

          const iniciarEdicion = async (a) => {
            // El grado se guarda como texto ("2° de Secundaria"); el formulario
            // lo maneja separado en nivel + número.
            const numeroGrado = parseInt(String(a.grado ?? "").match(/\d+/)?.[0] ?? "1", 10);
            const nivel = /primaria/i.test(a.grado ?? "") ? "Primaria" : (a.nivel ?? "Secundaria");

            // El documento está cifrado: hay que pedirlo aparte para poder editarlo.
            let numero = "";
            if (a.documento_enmascarado && a.documento_enmascarado !== "\u2014") {
              try {
                numero = (await req(`/alumnos/${a.id}/documento`)).numero ?? "";
              } catch {
                /* sin documento legible: el campo queda vacío y habrá que escribirlo */
              }
            }

            setListaEditAlumno(a.id);
            setListaEditForm({
              nombre: a.nombre, apellido: a.apellido, edad: a.edad,
              nivel, grado: numeroGrado, anio_cursada: a.anio_cursada,
              contacto_emergente: a.contacto_emergente,
              genero: a.genero ?? "No especificado",
              tipo_documento: a.tipo_documento ?? "DNI",
              numero_documento: numero,
              // Copia del valor de partida: permite detectar un cambio de
              // documento aunque coincidan los cuatro últimos dígitos.
              numero_documento_previo: numero,
            });
          };

          const guardarEdicion = async () => {
            const doc = TIPOS_DOCUMENTO[listaEditForm.tipo_documento ?? "DNI"];
            const numero = (listaEditForm.numero_documento || "").trim().toUpperCase();
            if (!RE_NOMBRE.test((listaEditForm.nombre || "").trim()) ||
                !RE_NOMBRE.test((listaEditForm.apellido || "").trim())) {
              setListaStatus({ msg: "El nombre y el apellido solo admiten letras, números, espacios, apóstrofo y guion.", error: true });
              return;
            }
            if (!doc.patron.test(numero)) {
              setListaStatus({ msg: `${doc.etiqueta}: ${doc.ayuda} Has escrito ${numero.length} de ${doc.longitud}.`, error: true });
              return;
            }
            // El diálogo enumera exactamente qué campos cambian y con qué valores,
            // que es lo que el usuario necesita revisar antes de aceptar.
            const original = alumnos.find((a) => String(a.id) === String(listaEditAlumno));
            const cambios = [];
            const anota = (etiqueta, antes, despues) => {
              if (String(antes ?? "") !== String(despues ?? "")) {
                cambios.push({ etiqueta, antes: String(antes ?? "—"), valor: String(despues ?? "—") });
              }
            };
            anota("Nombre", original?.nombre, listaEditForm.nombre);
            anota("Apellido", original?.apellido, listaEditForm.apellido);
            anota("Edad", original?.edad, listaEditForm.edad);
            anota("Grado", original?.grado, `${listaEditForm.grado}° de ${listaEditForm.nivel}`);
            anota("Año de cursada", original?.anio_cursada, listaEditForm.anio_cursada);
            anota("Contacto", original?.contacto_emergente, listaEditForm.contacto_emergente);
            anota("Género", original?.genero, listaEditForm.genero);
            anota("Tipo de documento", original?.tipo_documento, listaEditForm.tipo_documento);
            if ((listaEditForm.numero_documento_previo ?? "") !== numero) {
              cambios.push({
                etiqueta: "Documento",
                antes: enmascararDoc(listaEditForm.numero_documento_previo),
                valor: enmascararDoc(numero),
              });
            }

            if (cambios.length === 0) {
              setListaStatus({ msg: "No hay ningún cambio que guardar.", error: false });
              return;
            }

            if (!await confirmar({
              titulo: `¿Guardar los cambios de ${listaEditForm.nombre} ${listaEditForm.apellido}?`,
              mensaje: cambios.length === 1
                ? "Se modificará 1 campo del expediente del estudiante."
                : `Se modificarán ${cambios.length} campos del expediente del estudiante.`,
              detalles: cambios,
              textoConfirmar: "Sí, guardar cambios",
            })) return;

            try {
              await req(`/alumnos/${listaEditAlumno}/`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...listaEditForm,
                  numero_documento_previo: undefined,   // auxiliar de la interfaz
                  edad: Number(listaEditForm.edad),
                  grado: Number(listaEditForm.grado),
                  anio_cursada: Number(listaEditForm.anio_cursada),
                  numero_documento: (listaEditForm.numero_documento || "").trim().toUpperCase(),
                }),
              });
              await loadAlumnos();
              setListaEditAlumno(null);
              setListaStatus({ msg: "Alumno actualizado correctamente.", error: false });
            } catch (err) {
              setListaStatus({ msg: err.message || "Error al actualizar.", error: true });
            }
          };

          const eliminarAlumno = async (id, nombre) => {
            const victima = alumnos.find((a) => String(a.id) === String(id));
            const suPrediccion = (todosPredicciones ?? []).filter((p) => String(p.alumno) === String(id)).length;
            // Un alumno con historial no se puede borrar: el servidor lo
            // rechaza. Se avisa aquí para no prometer algo que no va a ocurrir.
            const tieneHistorial = suPrediccion > 0;

            if (!await confirmar({
              titulo: tieneHistorial
                ? `${nombre} no se puede eliminar`
                : `¿Eliminar a ${nombre}?`,
              mensaje: tieneHistorial
                ? "El estudiante tiene registros en su historial y el sistema no "
                + "permite borrarlo: esos datos sostienen las predicciones y no se "
                + "podrían recuperar. Para darlo de baja hay que retirar antes su "
                + "historial, de forma deliberada."
                : "Se eliminará la ficha del estudiante. No tiene historial "
                + "asociado, así que no se pierde ningún dato de evaluación. "
                + "Esta acción no se puede deshacer.",
              detalles: [
                { etiqueta: "Estudiante", valor: nombre },
                { etiqueta: "Grado", valor: victima?.grado ?? "—" },
                { etiqueta: "Predicciones", valor: suPrediccion === 0
                    ? "ninguna registrada"
                    : `${suPrediccion} en su historial` },
              ],
              tono: "peligro",
              textoConfirmar: tieneHistorial ? "Intentar igualmente" : "Sí, eliminar",
            })) return;
            try {
              await req(`/alumnos/${id}/`, { method: "DELETE" });
              await loadAlumnos();
              await loadTodosPredicciones();
              setListaStatus({ msg: "Alumno eliminado.", error: false });
            } catch (err) {
              setListaStatus({ msg: err.message || "Error al eliminar.", error: true });
            }
          };

          return (
            <div>
              <h1 className="page-title">Listado de Alumnos</h1>
              {soloLectura && (
                <p className="form-legend" style={{ marginTop: -6 }}>
                  🔒 Modo consulta: tu rol ({auth.rol}) accede al listado en solo lectura.
                </p>
              )}
              {listaStatus.msg && (
                <div className={listaStatus.error ? "alert-error" : "alert-success"} style={{ marginBottom: 14 }}>
                  {listaStatus.msg}
                </div>
              )}

              {/* Modal Ver */}
              {listaVerAlumno && (() => {
                const a = alumnos.find((x) => x.id === listaVerAlumno);
                const pred = predsPorAlumno[listaVerAlumno];
                if (!a) return null;
                return (
                  <div className="lista-modal-overlay" onClick={() => setListaVerAlumno(null)}>
                    <div className="lista-modal" onClick={(e) => e.stopPropagation()}>
                      <h3 style={{ margin: "0 0 14px" }}>{a.nombre} {a.apellido}</h3>
                      <p><b>ID:</b> {String(a.id).padStart(3, "0")}</p>
                      <p><b>Grado:</b> {a.grado} &nbsp; <b>Edad:</b> {a.edad}</p>
                      <p><b>Género:</b> {a.genero}</p>
                      <p><b>Año:</b> {a.anio_cursada}</p>
                      <p>
                        <b>{a.tipo_documento ?? "Documento"}:</b>{" "}
                        <span style={{ fontFamily: "ui-monospace, Consolas, monospace", letterSpacing: ".06em" }}>
                          {docRevelado[a.id] ?? a.documento_enmascarado}
                        </span>
                        {a.documento_enmascarado !== "—" && !docRevelado[a.id] && (
                          <button
                            type="button"
                            className="dash-link-btn"
                            style={{ marginLeft: 10 }}
                            onClick={async () => {
                              try {
                                const r = await req(`/alumnos/${a.id}/documento`);
                                setDocRevelado((d) => ({ ...d, [a.id]: r.numero }));
                              } catch (err) {
                                notify(err.message || "No se pudo obtener el documento.", true);
                              }
                            }}
                          >
                            Mostrar
                          </button>
                        )}
                      </p>
                      <p><b>Contacto:</b> {a.contacto_emergente}</p>
                      <p><b>Inasistencias acumuladas:</b> {a.inasistencias ?? 0} día(s)</p>
                      {pred && <><hr style={{ margin: "12px 0" }} /><p><b>Riesgo académico:</b> <span style={{ color: pred.nivel_riesgo === "Alto" ? "#d62828" : pred.nivel_riesgo === "Medio" ? "#e07b00" : "#14732b", fontWeight: 700 }}>{pred.nivel_riesgo}</span></p><p><b>Indicador TDAH:</b> {tdahTexto(pred.nivel_tdah)}</p></>}
                      <button style={{ marginTop: 16 }} onClick={() => setListaVerAlumno(null)}>Cerrar</button>
                    </div>
                  </div>
                );
              })()}

              {/* Modal Editar */}
              {listaEditAlumno && (
                <div className="lista-modal-overlay" onClick={() => setListaEditAlumno(null)}>
                  <div className="lista-modal" onClick={(e) => e.stopPropagation()}>
                    <h3 style={{ margin: "0 0 14px" }}>Editar Alumno</h3>
                    <div className="grid" style={{ gap: 10 }}>
                      {[["Nombre", "nombre"], ["Apellido", "apellido"], ["Edad", "edad"], ["Año", "anio_cursada"], ["Contacto", "contacto_emergente"]].map(([lbl, key]) => (
                        <div key={key} className="field-group">
                          <label htmlFor={`edit-${key}`}>{lbl}</label>
                          <input
                            id={`edit-${key}`}
                            value={listaEditForm[key] ?? ""}
                            onChange={(e) => setListaEditForm({ ...listaEditForm, [key]: e.target.value })}
                          />
                        </div>
                      ))}

                      <div className="field-group">
                        <label htmlFor="edit-nivel">Nivel</label>
                        <select
                          id="edit-nivel"
                          value={listaEditForm.nivel ?? "Secundaria"}
                          onChange={(e) => setListaEditForm({ ...listaEditForm, nivel: e.target.value, grado: 1 })}
                        >
                          <option value="Primaria">Primaria</option>
                          <option value="Secundaria">Secundaria</option>
                        </select>
                      </div>

                      <div className="field-group">
                        <label htmlFor="edit-grado">Grado</label>
                        <select
                          id="edit-grado"
                          value={listaEditForm.grado ?? 1}
                          onChange={(e) => setListaEditForm({ ...listaEditForm, grado: e.target.value })}
                        >
                          {Array.from({ length: NIVELES[listaEditForm.nivel ?? "Secundaria"] ?? 5 }, (_, i) => i + 1).map((g) => (
                            <option key={g} value={g}>{g}° de {listaEditForm.nivel ?? "Secundaria"}</option>
                          ))}
                        </select>
                      </div>

                      <div className="field-group">
                        <label htmlFor="edit-tipo-doc">Tipo de documento</label>
                        <select
                          id="edit-tipo-doc"
                          value={listaEditForm.tipo_documento ?? "DNI"}
                          onChange={(e) => setListaEditForm({ ...listaEditForm, tipo_documento: e.target.value, numero_documento: "" })}
                        >
                          {Object.entries(TIPOS_DOCUMENTO).map(([k, v]) => (
                            <option key={k} value={k}>{v.etiqueta}</option>
                          ))}
                        </select>
                      </div>

                      <div className="field-group">
                        <label htmlFor="edit-num-doc">Número de documento</label>
                        <input
                          id="edit-num-doc"
                          aria-describedby="edit-doc-ayuda"
                          maxLength={TIPOS_DOCUMENTO[listaEditForm.tipo_documento ?? "DNI"].longitud}
                          value={listaEditForm.numero_documento ?? ""}
                          onChange={(e) => {
                            const tipo = listaEditForm.tipo_documento ?? "DNI";
                            const permitido = tipo === "PASAPORTE"
                              ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                              : e.target.value.replace(/\D/g, "");
                            setListaEditForm({ ...listaEditForm, numero_documento: permitido });
                          }}
                        />
                        <span id="edit-doc-ayuda" className="form-legend" style={{ marginTop: 6 }}>
                          {TIPOS_DOCUMENTO[listaEditForm.tipo_documento ?? "DNI"].ayuda}{" "}
                          {(listaEditForm.numero_documento ?? "").length}/{TIPOS_DOCUMENTO[listaEditForm.tipo_documento ?? "DNI"].longitud}
                        </span>
                      </div>

                      <div className="field-group">
                        <label htmlFor="edit-genero">Género</label>
                        <select
                          id="edit-genero"
                          value={listaEditForm.genero}
                          onChange={(e) => setListaEditForm({ ...listaEditForm, genero: e.target.value })}
                        >
                          <option value="Masculino">Masculino</option>
                          <option value="Femenino">Femenino</option>
                          <option value="Otro">Otro</option>
                          <option value="No especificado">No especificado</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                      <button onClick={guardarEdicion}>Guardar</button>
                      <button className="danger" onClick={() => setListaEditAlumno(null)}>Cancelar</button>
                    </div>
                  </div>
                </div>
              )}

              <article className="panel" style={{ overflowX: "auto" }}>
                {alumnos.length === 0 ? (
                  <p style={{ color: "var(--tinta-suave)" }}>No hay alumnos registrados.</p>
                ) : (
                  <table className="lista-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Nombre</th>
                        <th>Apellido</th>
                        <th>Grado</th>
                        <th>Edad</th>
                        <th>Documento</th>
                        <th>Inasist.</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alumnos.map((a) => {
                        const est = estadoAlumno(a.id);
                        return (
                          <tr key={a.id}>
                            <td>{String(a.id).padStart(3, "0")}</td>
                            <td>{a.nombre}</td>
                            <td>{a.apellido}</td>
                            <td>{a.grado}</td>
                            <td>{a.edad}</td>
                            <td style={{ fontFamily: "ui-monospace, Consolas, monospace", whiteSpace: "nowrap" }}>
                              {a.documento_enmascarado ?? "\u2014"}
                            </td>
                            <td>{a.inasistencias ?? 0}</td>
                            <td><span className="lista-badge" style={{ background: est.color }}>{est.label}</span></td>
                            <td>
                              <div className="lista-actions">
                                <button className="lista-btn lista-btn--ver" onClick={() => setListaVerAlumno(a.id)}>Ver</button>
                                {/* Escritura: solo Docente/Administrador. El Psicólogo consulta. */}
                                {!soloLectura && (
                                  <>
                                    <button className="lista-btn lista-btn--edit" onClick={() => iniciarEdicion(a)}>Editar</button>
                                    <button className="lista-btn lista-btn--del" onClick={() => eliminarAlumno(a.id, `${a.nombre} ${a.apellido}`)}>Eliminar</button>
                                  </>
                                )}
                                {puedeVer(auth.rol, "encuesta") && (
                                  <button className="lista-btn lista-btn--enc" onClick={() => { setEncuestaForm({ ...initialEncuesta, alumno: String(a.id) }); goToView("encuesta"); }}>Encuesta</button>
                                )}
                                {puedeVer(auth.rol, "inasistencias") && (
                                  <button className="lista-btn lista-btn--enc" onClick={() => goToView("inasistencias")}>Inasistencias</button>
                                )}
                                <button className="lista-btn lista-btn--pred" onClick={() => { setPredAlumno(String(a.id)); loadPredicciones(a.id); goToView("predicciones"); }}>Predicción</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </article>
            </div>
          );
        })()}

        {/* ── Encuesta ───────────────────────────────── */}
        {activeView === "encuesta" && (
          <div className="encuesta-layout">
            <h1 className="page-title">Encuesta Psicoeducativa</h1>
            <div className="toggle-row">
              <button type="button" className={encuestaModo === "registrar" ? "toggle-btn toggle-btn--active" : "toggle-btn toggle-btn--inactive"} onClick={() => setEncuestaModo("registrar")}>Registrar Encuesta</button>
              <button type="button" className={encuestaModo === "respuestas" ? "toggle-btn toggle-btn--active" : "toggle-btn toggle-btn--inactive"} onClick={() => setEncuestaModo("respuestas")}>Ver Respuestas</button>
            </div>
            {encuestaModo === "registrar" && (
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
            )}

            {encuestaModo === "respuestas" && (
              <article className="panel panel-encuesta">
                <div className="field-group full">
                  <label htmlFor="enc-ver-alumno">Selecciona Estudiante</label>
                  <select id="enc-ver-alumno" value={encuestaVerAlumno} onChange={(e) => setEncuestaVerAlumno(e.target.value)}>
                    <option value="">-- Selecciona --</option>
                    {alumnoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {!encuestaVerAlumno && <p className="form-legend">Selecciona un estudiante para ver sus respuestas.</p>}
                {encuestaVerAlumno && encuestaRespuestas.length === 0 && <p className="form-legend">No hay encuestas registradas para este estudiante.</p>}
                {encuestaRespuestas.map((enc) => {
                  const suma = (keys) => keys.reduce((s, k) => s + (enc[k] ?? 0), 0);
                  const bloque = (titulo, keys, max) => (
                    <div key={titulo} style={{ marginBottom: 14 }}>
                      <h3 className="form-section__title">{titulo} <span style={{ color: "#2563eb" }}>({suma(keys)}/{max})</span></h3>
                      <table className="lista-table" style={{ width: "100%" }}>
                        <thead><tr><th style={{ width: 55 }}>Ítem</th><th>Pregunta</th><th style={{ width: 170 }}>Respuesta</th></tr></thead>
                        <tbody>
                          {keys.map((k) => (
                            <tr key={k}><td>{k}</td><td style={{ fontSize: "0.8rem" }}>{encuestaLabels[k]}</td><td><b>{enc[k]}</b> – {_ESCALA_TXT[enc[k]] ?? ""}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                  return (
                    <div key={enc.id} className="card full" style={{ marginTop: 12 }}>
                      <div style={{ marginBottom: 8, color: "#64748b", fontWeight: 600 }}>📅 {formatFecha(enc.fecha_aplicacion)}</div>
                      {bloque("Déficit de Atención (DA)", encuestaKeysDA, 15)}
                      {bloque("Hiperactividad e Impulsividad (HI)", encuestaKeysHI, 15)}
                      {bloque("Trastorno de Conducta (TC)", encuestaKeysTC, 30)}
                      <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: "0.8rem" }}>
                        Total EDAH: {suma(encuestaKeysDA) + suma(encuestaKeysHI) + suma(encuestaKeysTC)}/60
                      </p>
                    </div>
                  );
                })}
              </article>
            )}
          </div>
        )}

        {/* ── Cuentas y accesos (solo Administrador) ──── */}
        {activeView === "cuentas" && (
          <div className="notas-layout">
            <h1 className="page-title">Cuentas y accesos</h1>

            <article className="panel">
              <h2 style={{ margin: "0 0 4px", fontSize: "var(--t-lg)" }}>Solicitudes de recuperación</h2>
              <p className="form-legend">
                Cuando alguien olvida su contraseña, su solicitud aparece aquí. Al atenderla se genera
                una contraseña temporal que debes entregarle en persona: el sistema no la envía por
                ningún medio y no vuelve a mostrarla.
              </p>

              {claveRepuesta && (
                <div className="alert-success" role="status" aria-live="polite"
                     style={{ display: "block", marginBottom: "var(--e4)" }}>
                  <div style={{ marginBottom: "var(--e2)" }}>{claveRepuesta.mensaje}</div>
                  <div style={{ fontSize: "var(--t-lg)", fontWeight: 800,
                                fontFamily: "ui-monospace, Consolas, monospace", letterSpacing: ".08em" }}>
                    {claveRepuesta.password_temporal}
                  </div>
                  <div className="form-legend" style={{ marginTop: "var(--e2)", marginBottom: 0 }}>
                    {claveRepuesta.aviso}
                  </div>
                </div>
              )}

              {solicitudesCargando && (
                <p className="cargando" role="status" aria-live="polite">
                  <span className="spinner" aria-hidden="true" />Cargando solicitudes…
                </p>
              )}

              {!solicitudesCargando && solicitudes.length === 0 && (
                <div className="vacio">
                  <strong>No hay solicitudes pendientes</strong>
                  <span>Aparecerán aquí en cuanto alguien pida recuperar su contraseña.</span>
                </div>
              )}

              {!solicitudesCargando && solicitudes.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table className="lista-table">
                    <caption>{solicitudes.length} solicitud(es) por atender</caption>
                    <thead>
                      <tr>
                        <th scope="col">Código</th>
                        <th scope="col">Usuario</th>
                        <th scope="col">Nombre</th>
                        <th scope="col">Rol</th>
                        <th scope="col">Solicitada</th>
                        <th scope="col">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {solicitudes.map((sol) => (
                        <tr key={sol.id}>
                          <td style={{ fontFamily: "ui-monospace, Consolas, monospace" }}>{sol.codigo}</td>
                          <td><strong>{sol.usuario}</strong></td>
                          <td>{sol.nombre}</td>
                          <td>{sol.rol}</td>
                          <td style={{ fontSize: "var(--t-sm)", color: "var(--tinta-suave)" }}>
                            {formatFecha(sol.fecha_solicitud)}
                          </td>
                          <td>
                            {sol.caducada ? (
                              <span className="lista-badge" style={{ color: "var(--tinta-suave)" }}>Caducada</span>
                            ) : (
                              <button type="button" className="lista-btn lista-btn--ver"
                                      onClick={() => atenderSolicitud(sol)}>
                                Reponer contraseña
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>

            <article className="panel" style={{ marginTop: "var(--e4)" }}>
              <h2 style={{ margin: "0 0 4px", fontSize: "var(--t-lg)" }}>Cómo funciona</h2>
              <p className="form-legend" style={{ marginBottom: 0 }}>
                Las contraseñas se guardan cifradas con PBKDF2-HMAC-SHA256 y 200 000 iteraciones;
                el sistema nunca las almacena ni las muestra en claro. La reposición la hace el
                administrador en persona, sin correo electrónico: así el acceso no depende de un
                servicio externo ni de que el usuario tenga cuenta de correo institucional.
              </p>
            </article>
          </div>
        )}

        {/* ── Control de Inasistencias ───────────────── */}
        {activeView === "inasistencias" && (
          <InasistenciasView
            alumnos={alumnos}
            notify={notify}
            confirmar={confirmar}
            onGuardado={async () => {
              await loadAlumnos();
              await loadTodosPredicciones();
              if (dashAlumno) await loadDashData(dashAlumno);
            }}
          />
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
            {predicciones.map((p) => {
              const isShapOpen = shapPredId === p.id;
              const rColor = p.nivel_riesgo === "Alto" ? "#d62828" : p.nivel_riesgo === "Medio" ? "#e07b00" : "#14732b";
              return (
                <div key={p.id} className="card">
                  <strong>{p.alumno_nombre ?? "Alumno"}</strong><br />
                  <b>Nivel de Riesgo Académico:</b>{" "}
                  <span style={{ color: rColor, fontWeight: "bold" }}>{p.nivel_riesgo}</span>
                  {p.probabilidad != null && <> ({(p.probabilidad * 100).toFixed(1)}%)</>}<br />
                  <b>Indicador TDAH (modelo IA):</b>{" "}
                  <span style={{ color: (p.nivel_tdah && p.nivel_tdah !== "Sospecha Baja" && p.nivel_tdah !== "Sin TDAH") ? "#d62828" : "#14732b", fontWeight: "bold" }}>
                    {tdahTexto(p.nivel_tdah)}
                  </span>
                  {p.confianza_tdah != null && (
                    <span style={{ color: "var(--tinta-media)" }}> ({(p.confianza_tdah * 100).toFixed(2)}% de confianza)</span>
                  )}<br />
                  {p.total_atencion != null && (
                    <><b>Atención (DA):</b> {p.total_atencion}/15{"  "}<b>Hiperactividad (HI):</b> {p.total_hiperactividad}/15{"  "}{p.total_conducta != null && <><b>Conducta (TC):</b> {p.total_conducta}/30</>}<br /></>
                  )}
                  {p.prob_tdah != null && (
                    <><b>Prob. de TDAH (modelo):</b> {Math.round(p.prob_tdah * 100)}%<br /></>
                  )}
                  {p.referencia_psicometrica && (
                    <small style={{ color: "#94a3b8", fontStyle: "italic" }}>
                      Referencia psicométrica (no decide): {p.referencia_psicometrica}<br />
                    </small>
                  )}
                  <b>Promedio de Notas:</b> {p.prediccion_notas}<br />
                  <small style={{ color: "var(--tinta-suave)" }}>📅 {formatFecha(p.fecha_prediccion)}</small>

                  {/* Botón SHAP */}
                  <div style={{ marginTop: 10 }}>
                    <button
                      style={{ width: "auto", background: isShapOpen ? "#475569" : "#6366f1", padding: "6px 14px", fontSize: "0.82rem" }}
                      onClick={async () => {
                        if (isShapOpen) { setShapPredId(null); setShapData(null); return; }
                        setShapLoading(true); setShapPredId(p.id); setShapData(null);
                        try {
                          const [tdah, riesgo] = await Promise.all([
                            req(`/predicciones/${p.id}/shap/`).catch(() => null),
                            req(`/predicciones/${p.id}/shap-riesgo/`).catch(() => null),
                          ]);
                          setShapData({ tdah, riesgo });
                        } catch { setShapData(null); }
                        setShapLoading(false);
                      }}
                    >
                      {isShapOpen ? "▲ Ocultar explicación SHAP" : "▼ Explicar con SHAP (IA)"}
                    </button>
                  </div>

                  {/* Panel SHAP */}
                  {isShapOpen && (
                    <div style={{ marginTop: 12, padding: "18px 20px", background: "var(--superficie-2)", borderRadius: 10, border: "1px solid var(--linea)" }}>
                      {shapLoading ? (
                        <span style={{ color: "#64748b", fontSize: "0.88rem" }}>Generando explicación...</span>
                      ) : (shapData?.tdah || shapData?.riesgo) ? (
                        <>
                          <p style={{ margin: "0 0 4px", fontWeight: 800, color: "var(--marca-oscura)", fontSize: "1rem" }}>
                            🧠 ¿Por qué el modelo predijo esto?
                          </p>
                          <p style={{ margin: "0 0 16px", color: "var(--tinta-suave)", fontSize: "0.78rem" }}>
                            Cada barra muestra cuánto influyó cada factor.{" "}
                            <span style={{ color: "#ef4444", fontWeight: 700 }}>● rojo = aumenta</span>{"  ·  "}
                            <span style={{ color: "#22c55e", fontWeight: 700 }}>● verde = reduce</span>
                          </p>

                          {shapData?.tdah && (
                            <div style={{ marginBottom: 16 }}>
                              <p style={{ margin: "0 0 8px", fontWeight: 700, color: "#6366f1", fontSize: "0.88rem", borderLeft: "3px solid #6366f1", paddingLeft: 8 }}>
                                Indicador de TDAH — {shapData.tdah.nivel}
                              </p>
                              <ShapFactores features={shapData.tdah.features} />
                              {shapData.tdah.interpretacion && (
                                <div style={{ marginTop: 10, color: "var(--tinta-media)", fontSize: "0.84rem", lineHeight: 1.7, background: "var(--superficie)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--linea)" }}>
                                  {shapData.tdah.interpretacion.split("\n\n").map((para, i) => (
                                    <p key={i} style={{ margin: i === 0 ? "0 0 8px" : 0 }}>{para}</p>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {shapData?.riesgo && (
                            <div style={{ borderTop: "1px dashed #cbd5e1", paddingTop: 14 }}>
                              <p style={{ margin: "0 0 8px", fontWeight: 700, color: "#0ea5e9", fontSize: "0.88rem", borderLeft: "3px solid #0ea5e9", paddingLeft: 8 }}>
                                Riesgo Académico — {shapData.riesgo.nivel}
                              </p>
                              <ShapFactores features={shapData.riesgo.features} />
                              {shapData.riesgo.interpretacion && (
                                <div style={{ marginTop: 10, color: "var(--tinta-media)", fontSize: "0.84rem", lineHeight: 1.7, background: "var(--superficie)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--linea)" }}>
                                  <p style={{ margin: 0 }}>{shapData.riesgo.interpretacion}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "#d62828", fontSize: "0.88rem" }}>No se pudo obtener la explicación.</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
                    <label htmlFor="nota-bimestre">Bimestre</label>
                    <select id="nota-bimestre" value={notaForm.bimestre ?? "1"} onChange={(e) => setNotaForm({ ...notaForm, bimestre: e.target.value })} required>
                      <option value="1">Bimestre 1</option>
                      <option value="2">Bimestre 2</option>
                      <option value="3">Bimestre 3</option>
                      <option value="4">Bimestre 4</option>
                    </select>
                  </div>
                  <p className="form-legend full">
                    Ingresa la nota de cada curso (AD, A, B o C). El sistema calcula automáticamente
                    el promedio del bimestre y el riesgo académico. Deja en «—» los cursos sin nota.
                  </p>
                  <div className="full" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
                    {ASIGNATURAS_VALIDAS.map((a) => (
                      <div key={a} className="field-group">
                        <label htmlFor={`nota-asig-${a}`}>{a}</label>
                        <select
                          id={`nota-asig-${a}`}
                          value={notasAsig[a] ?? ""}
                          onChange={(e) => setNotasAsig({ ...notasAsig, [a]: e.target.value })}
                        >
                          <option value="">—</option>
                          <option value="AD">AD</option>
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="C">C</option>
                        </select>
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const prev = promedioLiteral(ASIGNATURAS_VALIDAS.map((a) => notasAsig[a]));
                    return (
                      <div className="full" style={{ padding: "10px 14px", background: "var(--superficie-2)", borderRadius: 8, fontSize: "0.92rem" }}>
                        <b>Promedio del bimestre (vista previa):</b>{" "}
                        {prev ? <span style={{ fontWeight: 700, color: "var(--marca-oscura)" }}>{prev.letra}</span>
                              : <span style={{ color: "#94a3b8" }}>sin notas ingresadas</span>}
                      </div>
                    );
                  })()}
                  {notasStatus.msg && <div className={notasStatus.error ? "alert-error" : "alert-success"} role="status">{notasStatus.msg}</div>}
                  <button className="full" type="submit">Guardar notas del bimestre</button>
                </form>
              )}
              {notasModoLista === "actuales" && notasModoCarga === "masiva" && (
                <CargaMasivaNotas
                  notify={notify}
                  confirmar={confirmar}
                  onProcesado={async () => {
                    await loadAlumnos();
                    await loadTodosPredicciones();
                    if (notaForm.alumno) {
                      const data = await req(`/notas/?alumno=${notaForm.alumno}`).catch(() => []);
                      setHistoricoNotas(Array.isArray(data) ? data : []);
                    }
                  }}
                />
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
                  {notaForm.alumno && historicoNotas.length > 0 && (() => {
                    const porBim = { 1: [], 2: [], 3: [], 4: [] };
                    historicoNotas.forEach((n) => { (porBim[n.bimestre ?? 1] ?? porBim[1]).push(n); });
                    const bimestres = [1, 2, 3, 4].filter((b) => porBim[b].length);
                    const promGeneral = promedioLiteral(historicoNotas.map((n) => n.calificacion_literal));
                    return (
                      <>
                        {bimestres.map((b) => {
                          const prom = promedioLiteral(porBim[b].map((n) => n.calificacion_literal));
                          return (
                            <div key={b} className="card full">
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                <strong>Bimestre {b}</strong>
                                <span>Promedio: <b style={{ color: "#1e3a5f" }}>{prom.letra}</b></span>
                              </div>
                              <table className="lista-table" style={{ width: "100%" }}>
                                <thead><tr><th>Curso</th><th>Nota</th></tr></thead>
                                <tbody>
                                  {porBim[b].map((n) => (
                                    <tr key={n.id}><td>{n.asignatura}</td><td><b>{n.calificacion_literal}</b></td></tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                        <div className="card full" style={{ background: "var(--superficie-2)", borderColor: "var(--linea)" }}>
                          <strong>Promedio general:</strong>{" "}
                          <b style={{ color: "var(--marca-oscura)", fontSize: "1.05rem" }}>{promGeneral.letra}</b>
                          <span style={{ color: "var(--tinta-suave)" }}> · promedio de todos los cursos y bimestres registrados</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </article>
          </div>
        )}

        {/* ── Expediente (descarga) ──────────────────── */}
        {activeView === "expediente" && (
          <article className="panel">
            <h2>Expediente Psicológico</h2>
            <p style={{ color: "#64748b", marginTop: 0 }}>
              Genera y descarga el expediente del estudiante en PDF. Incluye el resumen del
              dashboard, la encuesta psicoeducativa (EDAH) y la predicción académica.
            </p>
            <div className="grid">
              <select className="full" value={expAlumno} onChange={(e) => setExpAlumno(e.target.value)}>
                <option value="">-- Selecciona un estudiante --</option>
                {alumnoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button className="full" type="button" onClick={descargarExpediente} disabled={expLoading || !expAlumno}>
                {expLoading ? "Generando expediente…" : "⬇ Descargar Expediente"}
              </button>
            </div>
          </article>
        )}

        {status.msg && activeView !== "encuesta" && activeView !== "notas" && (
          <p
            className={status.error ? "alert-error" : "alert-success"}
            role={status.error ? "alert" : "status"}
            aria-live={status.error ? "assertive" : "polite"}
          >
            {status.msg}
          </p>
        )}
      </main>
    </div>
  );
}
