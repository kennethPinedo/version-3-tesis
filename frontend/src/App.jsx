import { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

import { req } from "./lib/api";
import { NAV_LABELS, puedeGestionarAlumnos, puedeVer, viewsDeRol, vistaInicial } from "./lib/rbac";
import {
  FILTROS_INICIALES, PROB_COLORS, RIESGO_COLORS, contarPorGrupo, filtrarPredicciones,
  formatFecha, hayFiltroActivo, tdahNivelProb, tdahTexto, ultimaPorAlumno,
} from "./lib/predicciones";
import FiltrosPrediccion from "./components/FiltrosPrediccion";
import RecomendacionesPanel from "./components/RecomendacionesPanel";
import CargaMasivaNotas from "./components/CargaMasivaNotas";
import InasistenciasView from "./views/InasistenciasView";

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

// Usuarios y roles que pueden acceder al sistema (Director / Psicólogo / Docente)
const USUARIOS = {
  admin:     { password: "admin123",   rol: "Administrador" },
  psicologo: { password: "psico123",   rol: "Psicólogo" },
  docente:   { password: "docente123", rol: "Docente" },
};

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

const initialAlumno = {
  nombre: "", apellido: "", contacto_emergente: "", edad: "", grado: "",
  anio_cursada: "2025", genero: "",
};

const initialEncuesta = Object.fromEntries([["alumno", ""], ...encuestaKeys.map((k) => [k, "0"])]);
const initialNota = { alumno: "", bimestre: "1" };

/* ── Chart & dashboard helpers ─────────────────────────────────────────── */

const FACTOR_COLORS = ["#f97316", "#fb923c", "#3b82f6", "#22c55e", "#a855f7", "#14b8a6"];

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

// Dona de TDAH en 3 niveles (Probabilidad Alta/Media/Baja). El nivel que predijo
// el modelo es el gajo dominante (= su confianza); el resto se reparte.
function buildTdahPieData(nivelProb, conf) {
  const top = Math.round((conf ?? 0) * 100);
  const rem = 100 - top;
  if (nivelProb === "Alta") return [
    { name: "Sospecha Alta",  value: top },
    { name: "Sospecha Media", value: Math.round(rem * 0.6) },
    { name: "Sospecha Baja",  value: rem - Math.round(rem * 0.6) },
  ];
  if (nivelProb === "Media") return [
    { name: "Sospecha Alta",  value: Math.round(rem * 0.45) },
    { name: "Sospecha Media", value: top },
    { name: "Sospecha Baja",  value: rem - Math.round(rem * 0.45) },
  ];
  return [
    { name: "Sospecha Alta",  value: Math.round(rem * 0.18) },
    { name: "Sospecha Media", value: rem - Math.round(rem * 0.18) },
    { name: "Sospecha Baja",  value: top },
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

  // ── 2. Dashboard ─────────────────────────────────────────────────────────
  let dashboardHTML;
  if (pred) {
    const riesgoColor = pred.nivel_riesgo === "Alto" ? "#ef4444" : pred.nivel_riesgo === "Medio" ? "#f97316" : "#22c55e";
    const tdahLevel = tdahTexto(pred.nivel_tdah);
    const esTdah = !!pred.nivel_tdah && pred.nivel_tdah !== "Sospecha Baja" && pred.nivel_tdah !== "Sin TDAH";
    const tdahColor = esTdah ? "#f97316" : "#22c55e";
    const tdahConfPct = pred.confianza_tdah != null
      ? Math.round(pred.confianza_tdah * 100)
      : Math.round((pred.prob_tdah ?? 0) * 100);
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

/* ── Visualización SHAP: cada factor como barra (peso + dirección) ───────── */
function ShapFactores({ features }) {
  if (!features || !features.length)
    return <p style={{ color: "#94a3b8", fontSize: "0.84rem", fontStyle: "italic", margin: 0 }}>Sin factores disponibles.</p>;
  const maxAbs = Math.max(...features.map((f) => Math.abs(f.shap)), 0.0001);
  return (
    <div style={{ marginTop: 4 }}>
      {features.map((f) => {
        const pct = Math.max(Math.round((Math.abs(f.shap) / maxAbs) * 100), 4);
        const up = f.shap > 0;
        const color = up ? "#ef4444" : "#22c55e";
        return (
          <div key={f.feature} style={{ display: "flex", alignItems: "center", gap: 10, margin: "7px 0" }}>
            <div style={{ width: 210, flexShrink: 0, fontSize: "0.82rem", color: "#334155" }}>
              {f.label} <span style={{ color: "#94a3b8", fontWeight: 600 }}>({f.value_fmt})</span>
            </div>
            <div style={{ flex: 1, background: "#eef2f7", borderRadius: 7, height: 20, overflow: "hidden" }}>
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

/* ── App ───────────────────────────────────────────────────────────────── */

export default function App() {
  const [auth, setAuth] = useState({ usuario: "", password: "", logged: false, rol: "" });
  const [activeView, setActiveView] = useState("dashboard");
  const [status, setStatus] = useState({ msg: "", error: false });
  const [alumnos, setAlumnos] = useState([]);

  const [alumnoForm, setAlumnoForm] = useState(initialAlumno);
  const [encuestaForm, setEncuestaForm] = useState(initialEncuesta);
  const [notaForm, setNotaForm] = useState(initialNota);
  const [notasAsig, setNotasAsig] = useState({});  // { asignatura: "AD"|"A"|"B"|"C"|"" }
  const [expAlumno, setExpAlumno] = useState("");
  const [predAlumno, setPredAlumno] = useState("");
  const [todosPredicciones, setTodosPredicciones] = useState([]);
  const [listaVerAlumno, setListaVerAlumno] = useState(null);
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
    setFiltrosGeneral({ ...FILTROS_INICIALES });
    if (v === "lista") loadTodosPredicciones();
    if (v === "general") { loadTodosPredicciones(); loadMetricas(); }
  };

  // Seguridad: si el rol activo no tiene permiso para la vista actual, se le
  // devuelve a la primera vista que sí tiene permitida.
  useEffect(() => {
    if (auth.logged && !puedeVer(auth.rol, activeView)) setActiveView(vistaInicial(auth.rol));
  }, [activeView, auth.rol, auth.logged]);

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

  const notify = (msg, error = false) => setStatus({ msg, error });

  const onLogin = (e) => {
    e.preventDefault();
    const u = USUARIOS[auth.usuario.trim().toLowerCase()];
    if (u && u.password === auth.password) {
      setAuth((s) => ({ ...s, logged: true, rol: u.rol }));
      setActiveView(vistaInicial(u.rol));
      notify(`Sesión iniciada como ${u.rol}.`);
    } else {
      notify("Credenciales inválidas.", true);
    }
  };

  const submitAlumno = async (e) => {
    e.preventDefault();
    setAlumnoFormError("");
    const body = {
      nombre: alumnoForm.nombre, apellido: alumnoForm.apellido,
      contacto_emergente: alumnoForm.contacto_emergente, edad: Number(alumnoForm.edad),
      grado: alumnoForm.grado, anio_cursada: Number(alumnoForm.anio_cursada),
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
    try {
      const alumno = alumnos.find((a) => String(a.id) === String(expAlumno)) ?? null;
      const [encuestas, preds] = await Promise.all([
        req(`/encuestas/?alumno=${expAlumno}`).catch(() => []),
        req(`/predicciones/?alumno=${expAlumno}`).catch(() => []),
      ]);
      const encuesta = Array.isArray(encuestas) && encuestas.length ? encuestas[0] : null;
      const pred = Array.isArray(preds) && preds.length ? preds[0] : null;
      const [shap, shapRiesgo, recomendaciones] = pred
        ? await Promise.all([
            req(`/predicciones/${pred.id}/shap/`).catch(() => null),
            req(`/predicciones/${pred.id}/shap-riesgo/`).catch(() => null),
            req(`/predicciones/${pred.id}/recomendaciones/`).catch(() => null),
          ])
        : [null, null, null];

      const win = window.open("", "_blank");
      if (!win) return notify("Permite las ventanas emergentes para descargar el expediente.", true);
      win.document.open();
      win.document.write(buildExpedienteHTML({ alumno, encuesta, pred, shap, shapRiesgo, recomendaciones }));
      win.document.close();
      notify("Expediente generado. Usa «Guardar como PDF» en el diálogo de impresión.");
    } catch (err) {
      notify(err.message || "No se pudo generar el expediente.", true);
    }
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
          <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 6, lineHeight: 1.7 }}>
            <div><strong>Accesos:</strong></div>
            <div>👤 Administrador — <strong>admin</strong> / admin123 <em>(acceso completo)</em></div>
            <div>🧠 Psicólogo — <strong>psicologo</strong> / psico123 <em>(clínico completo)</em></div>
            <div>📚 Docente — <strong>docente</strong> / docente123 <em>(académico)</em></div>
          </div>
          {status.msg && <p className="status" style={{ color: status.error ? "#d62828" : "#14732b" }}>{status.msg}</p>}
        </section>
      </main>
    );
  }

  /* ── Main app ────────────────────────────────────────────────────────── */

  const viewsPermitidas = viewsDeRol(auth.rol);
  const soloLectura = !puedeGestionarAlumnos(auth.rol);

  return (
    <div className="app-shell">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">📖</span>
          <div>
            <h2>Sistema</h2>
            <span>{auth.rol || "Usuario"}</span>
          </div>
        </div>
        <nav>
          {viewsPermitidas.map((v) => {
            const { icon, label } = NAV_LABELS[v];
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

          // Nivel de TDAH del modelo, mostrado como Sospecha Baja/Media/Alta
          const tdahNivel = dashData ? tdahNivelProb(dashData.nivel_tdah) : "Baja";
          const tdahLevel = dashData ? `Probabilidad ${tdahNivel}` : null;
          const esTdahPositivo = tdahNivel !== "Baja";
          const tdahColor = PROB_COLORS[`Sospecha ${tdahNivel}`] ?? "#22c55e";
          // % junto al nivel = confianza del modelo en la clase predicha
          const tdahConf = dashData?.confianza_tdah ?? dashData?.prob_tdah ?? 0;
          const tdahConfPct = Math.round(tdahConf * 100);
          // Rendimiento general como nota literal (AD / A / B / C)
          const rendLetra = dashData?.promedio_final ?? dashData?.prediccion_notas ?? "—";
          const rendColor = (rendLetra === "AD" || rendLetra === "A") ? "#22c55e"
            : rendLetra === "B" ? "#f97316"
            : rendLetra === "C" ? "#ef4444" : "#94a3b8";

          const acadPieData = dashData ? buildAcadPieData(dashData.nivel_riesgo, dashData.probabilidad) : [];
          const tdahPieData = dashData ? buildTdahPieData(tdahNivel, tdahConf) : [];
          const factoresData = dashData ? buildFactoresData(dashData) : [];

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
                          Probabilidad: {tdahConfPct}%
                          <span className="kpi-arrow" style={{ color: tdahColor }}>
                            {esTdahPositivo ? " ⚠" : " ✓"}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon--chart">📊</div>
                      <div className="kpi-body">
                        <span className="kpi-label">Rendimiento General</span>
                        <span className="kpi-value" style={{ color: rendColor }}>
                          {rendLetra}
                        </span>
                        <span className="kpi-sub">Promedio (nota literal)</span>
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
                              <Cell key={entry.name} fill={PROB_COLORS[entry.name]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v, n) => [`${v}%`, tdahTexto(n)]} />
                          <Legend iconType="circle" iconSize={10} formatter={(value) => tdahTexto(value)} />
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
                      <h3 className="chart-title">Plan de Acción (analítica prescriptiva)</h3>
                      <RecomendacionesPanel predId={dashData.id} />
                    </div>
                  </div>
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
                  <p style={{ color: "#64748b" }}>
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
                ) : <p style={{ color: "#64748b" }}>Métricas no disponibles (ejecuta el entrenamiento).</p>}
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

          const iniciarEdicion = (a) => {
            setListaEditAlumno(a.id);
            setListaEditForm({
              nombre: a.nombre, apellido: a.apellido, edad: a.edad,
              grado: a.grado, anio_cursada: a.anio_cursada,
              contacto_emergente: a.contacto_emergente,
              genero: a.genero ?? "No especificado",
            });
          };

          const guardarEdicion = async () => {
            try {
              await req(`/alumnos/${listaEditAlumno}/`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...listaEditForm, edad: Number(listaEditForm.edad), anio_cursada: Number(listaEditForm.anio_cursada) }),
              });
              await loadAlumnos();
              setListaEditAlumno(null);
              setListaStatus({ msg: "Alumno actualizado correctamente.", error: false });
            } catch (err) {
              setListaStatus({ msg: err.message || "Error al actualizar.", error: true });
            }
          };

          const eliminarAlumno = async (id, nombre) => {
            if (!window.confirm(`¿Eliminar a ${nombre}? Esta acción no se puede deshacer.`)) return;
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
                      {[["Nombre", "nombre"], ["Apellido", "apellido"], ["Edad", "edad"], ["Grado", "grado"], ["Año", "anio_cursada"], ["Contacto", "contacto_emergente"]].map(([lbl, key]) => (
                        <div key={key} className="field-group">
                          <label>{lbl}</label>
                          <input value={listaEditForm[key] ?? ""} onChange={(e) => setListaEditForm({ ...listaEditForm, [key]: e.target.value })} />
                        </div>
                      ))}
                      <div className="field-group">
                        <label>Género</label>
                        <select value={listaEditForm.genero} onChange={(e) => setListaEditForm({ ...listaEditForm, genero: e.target.value })}>
                          <option value="Masculino">Masculino</option>
                          <option value="Femenino">Femenino</option>
                          <option value="Otro">Otro</option>
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
                  <p style={{ color: "#64748b" }}>No hay alumnos registrados.</p>
                ) : (
                  <table className="lista-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Nombre</th>
                        <th>Apellido</th>
                        <th>Grado</th>
                        <th>Edad</th>
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

        {/* ── Control de Inasistencias ───────────────── */}
        {activeView === "inasistencias" && (
          <InasistenciasView
            alumnos={alumnos}
            notify={notify}
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
                    <span style={{ color: "#475569" }}> ({(p.confianza_tdah * 100).toFixed(2)}% de confianza)</span>
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
                  <small style={{ color: "#64748b" }}>📅 {formatFecha(p.fecha_prediccion)}</small>

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
                    <div style={{ marginTop: 12, padding: "18px 20px", background: "#f8faff", borderRadius: 10, border: "1px solid #dbe7f3" }}>
                      {shapLoading ? (
                        <span style={{ color: "#64748b", fontSize: "0.88rem" }}>Generando explicación...</span>
                      ) : (shapData?.tdah || shapData?.riesgo) ? (
                        <>
                          <p style={{ margin: "0 0 4px", fontWeight: 800, color: "#1e3a5f", fontSize: "1rem" }}>
                            🧠 ¿Por qué el modelo predijo esto?
                          </p>
                          <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "0.78rem" }}>
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
                                <div style={{ marginTop: 10, color: "#475569", fontSize: "0.84rem", lineHeight: 1.7, background: "#fff", borderRadius: 8, padding: "10px 12px", border: "1px solid #eef2f7" }}>
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
                                <div style={{ marginTop: 10, color: "#475569", fontSize: "0.84rem", lineHeight: 1.7, background: "#fff", borderRadius: 8, padding: "10px 12px", border: "1px solid #eef2f7" }}>
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
                      <div className="full" style={{ padding: "10px 14px", background: "#f1f5f9", borderRadius: 8, fontSize: "0.92rem" }}>
                        <b>Promedio del bimestre (vista previa):</b>{" "}
                        {prev ? <span style={{ fontWeight: 700, color: "#1e3a5f" }}>{prev.letra}</span>
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
                        <div className="card full" style={{ background: "#eef2ff", borderColor: "#c7d2fe" }}>
                          <strong>Promedio general:</strong>{" "}
                          <b style={{ color: "#1e3a5f", fontSize: "1.05rem" }}>{promGeneral.letra}</b>
                          <span style={{ color: "#64748b" }}> · promedio de todos los cursos y bimestres registrados</span>
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
              <button className="full" type="button" onClick={descargarExpediente}>
                ⬇ Descargar Expediente
              </button>
            </div>
          </article>
        )}

        {status.msg && activeView !== "encuesta" && activeView !== "notas" && (
          <p className="status" style={{ color: status.error ? "#d62828" : "#14732b" }}>{status.msg}</p>
        )}
      </section>
    </div>
  );
}
