# Historias de Usuario — Sistema de Predicción Educativa (TDAH y Riesgo Académico)

**Actores:** Psicólogo y Docente (usuarios que prueban la mayoría de las utilidades del sistema).

**Formato:** *Como [rol], quiero [funcionalidad], para [beneficio].* + Criterios de aceptación (CA).

---

## Épica 1 — Acceso

### HU-01 — Inicio de sesión
**Como** psicólogo / docente, **quiero** iniciar sesión con mi usuario y contraseña, **para** acceder a las funciones de mi rol.
- CA: Accesos `psicologo/psico123` y `docente/docente123`; credenciales inválidas muestran error.

### HU-02 — Menú según rol
**Como** docente, **quiero** ver solo las opciones que me corresponden, **para** no acceder a información clínica reservada.
- CA: El docente no ve "Expediente Psicológico"; el psicólogo ve todo el menú.

### HU-03 — Cerrar sesión
**Como** psicólogo / docente, **quiero** cerrar sesión, **para** proteger la información al terminar.

---

## Épica 2 — Gestión de alumnos

### HU-04 — Registrar alumno
**Como** docente, **quiero** registrar a un alumno con sus datos (nombre, edad, grado, género, contacto), **para** incorporarlo al sistema.
- CA: Campos obligatorios validados; al guardar aparece en la lista.

### HU-05 — Listar alumnos
**Como** docente, **quiero** ver la lista de alumnos con su estado (Registrado / Con Predicción), **para** tener una visión general.

### HU-06 — Ver detalle del alumno
**Como** psicólogo, **quiero** ver los datos y el riesgo de un alumno en una ventana de detalle, **para** consultarlo sin cambiar de pantalla.

### HU-07 — Editar alumno
**Como** docente, **quiero** editar los datos de un alumno, **para** mantenerlos actualizados.
- CA: El formulario de edición ya no incluye condición social.

### HU-08 — Eliminar alumno
**Como** docente, **quiero** eliminar un alumno, **para** depurar registros que ya no corresponden.
- CA: Pide confirmación antes de eliminar.

---

## Épica 3 — Encuesta psicoeducativa (EDAH)

### HU-09 — Aplicar encuesta EDAH
**Como** psicólogo, **quiero** registrar la encuesta EDAH (atención, hiperactividad, conducta) de un alumno, **para** evaluar indicadores de TDAH.
- CA: Cada ítem se responde en escala 0–3; se calculan los totales DA/HI/TC.

### HU-10 — Registrar inasistencias
**Como** docente, **quiero** registrar los días de inasistencia del alumno, **para** que se consideren en la predicción.

### HU-11 — Ver respuestas de la encuesta
**Como** psicólogo, **quiero** ver las respuestas de la encuesta de un alumno con cada ítem y su valor, **para** revisar su evaluación.
- CA: Muestra ítems DA/HI/TC agrupados, totales, inasistencias y fecha.

---

## Épica 4 — Notas / rendimiento académico

### HU-12 — Registrar notas por asignatura
**Como** docente, **quiero** ingresar las notas de cada curso dentro de un bimestre, **para** registrar el rendimiento del alumno.
- CA: Se elige bimestre y se ingresan notas (AD/A/B/C) por asignatura.

### HU-13 — Promedio automático del bimestre
**Como** docente, **quiero** que el sistema calcule el promedio del bimestre automáticamente, **para** no hacerlo manualmente.
- CA: El promedio se muestra solo como letra (AD/A/B/C).

### HU-14 — Evitar notas duplicadas
**Como** docente, **quiero** que al volver a registrar la nota de un curso se actualice en lugar de duplicarse, **para** no distorsionar el promedio.
- CA: Upsert por (alumno, asignatura, bimestre).

### HU-15 — Ver historial de notas
**Como** docente, **quiero** ver el listado de notas del alumno por bimestre y asignatura, **para** revisar su rendimiento histórico.
- CA: Muestra promedio por bimestre y promedio general (en letra).

### HU-16 — Carga masiva de notas (CSV)
**Como** docente, **quiero** subir notas de varios alumnos por archivo CSV, **para** ahorrar tiempo.
- CA: Formato `alumno_id,bimestre,asignatura,calificacion`; reporta errores por fila.

---

## Épica 5 — Predicción (TDAH y riesgo académico)

### HU-17 — Generar predicción
**Como** psicólogo, **quiero** generar la predicción de un alumno, **para** conocer su nivel de TDAH y riesgo académico.
- CA: Requiere encuesta EDAH; usa las 26 variables (EDAH + notas + inasistencias).

### HU-18 — Indicador de TDAH desde el modelo
**Como** psicólogo, **quiero** que el indicador de TDAH (Sin / Sospechoso / Con TDAH) lo determine el modelo de ML con su % de confianza, **para** una clasificación objetiva.
- CA: Sale de `predict_proba`/argmax; la regla clínica EDAH solo aparece como referencia informativa.

### HU-19 — Riesgo académico
**Como** docente, **quiero** ver el nivel de riesgo académico (Bajo/Medio/Alto) con su probabilidad, **para** priorizar apoyos.

### HU-20 — Recálculo automático al guardar notas
**Como** docente, **quiero** que al guardar las notas se recalcule el riesgo automáticamente, **para** tener el resultado al instante.

### HU-21 — Explicación de la predicción (SHAP)
**Como** psicólogo, **quiero** ver por qué el modelo predijo ese resultado, **para** sustentar mi evaluación.
- CA: Muestra los factores (EDAH, inasistencias, rendimiento) y una interpretación.

### HU-22 — Historial de predicciones
**Como** psicólogo, **quiero** ver el historial de predicciones de un alumno, **para** observar su evolución.
- CA: Lista con fecha legible; ya no muestra la cadena de "condiciones".

---

## Épica 6 — Dashboard individual

### HU-23 — Dashboard del alumno
**Como** docente, **quiero** un panel del alumno con riesgo académico, indicador de TDAH y rendimiento, **para** verlo de un vistazo.
- CA: Rendimiento se muestra como nota literal; la dona de riesgo es invertida (a menor riesgo, más verde).

### HU-24 — Factores que influyen en el riesgo
**Como** psicólogo, **quiero** ver los factores que más influyen (inatención, hiperactividad, rendimiento, inasistencias), **para** entender el riesgo.

### HU-25 — Recomendaciones generadas
**Como** docente, **quiero** recibir recomendaciones según el resultado, **para** saber qué acciones tomar.

---

## Épica 7 — Dashboard general y reportes

### HU-26 — Conteos generales
**Como** psicólogo, **quiero** ver cuántos alumnos tienen alta probabilidad de TDAH y riesgo académico alto, **para** dimensionar la situación.

### HU-27 — Filtros por grupo con lista de alumnos
**Como** psicólogo, **quiero** filtrar por nivel de riesgo o probabilidad de TDAH y, al hacer clic, ver la lista de alumnos de ese grupo, **para** atenderlos.
- CA: Cada tarjeta es clicable y despliega la lista filtrada.

### HU-28 — Métricas del modelo
**Como** psicólogo, **quiero** ver las métricas macro del modelo (accuracy, precisión, recall, F1 y especificidad), **para** confiar en su desempeño.
- CA: Se obtienen de `/api/metricas`; incluye nota de validación cruzada.

---

## Épica 8 — Expediente / reportes

### HU-29 — Descargar expediente psicológico
**Como** psicólogo, **quiero** descargar el expediente del alumno en PDF (datos, dashboard, encuesta y predicción), **para** archivarlo o compartirlo.

### HU-30 — Fecha legible en los reportes
**Como** psicólogo / docente, **quiero** que las fechas se muestren de forma clara (ej. "16 de junio de 2026, 14:30"), **para** interpretarlas fácilmente.

---

**Resumen:** 30 historias de usuario · 8 épicas · Actores: Psicólogo y Docente.
