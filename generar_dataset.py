import pandas as pd
import numpy as np

np.random.seed(7)

n_clase_0 = 250  # Sin TDAH (50%)
n_clase_1 = 108  # Sospechoso TDAH (21.65%)
n_clase_2 = 142  # Con TDAH confirmado (28.35%)
total_alumnos = n_clase_0 + n_clase_1 + n_clase_2

# Cuánto se traslapan las clases (↑ = más zona gris = métricas más bajas y realistas).
# 1.0 da métricas creíbles (~85-93%). Súbelo a 1.3 para más dificultad, bájalo a 0.7 para menos.
SOLAPE = 0.70

# ──────────────────────────────────────────────────────────────────────────────
# Utilidades
# ──────────────────────────────────────────────────────────────────────────────
_NUM = {"C": 0, "B": 1, "A": 2, "AD": 3}
_LET = ["C", "B", "A", "AD"]

def _letra(val: float) -> str:
    return _LET[int(round(np.clip(val, 0, 3)))]

def items_edah(base_hi: float, base_da: float, base_tc: float) -> dict:
    """20 ítems EDAH alrededor de niveles base, con ruido por ítem → genera traslape.

    El TDAH se define por Déficit de Atención (DA) e Hiperactividad (HI): por eso esos
    ítems llevan poco ruido y mucha separación entre clases. La Conducta (TC) es un
    indicador secundario/comórbido: lleva MÁS ruido para que separe menos y, así, el
    modelo otorgue mayor importancia a DA e HI.
    """
    ruido    = 0.55 * SOLAPE   # DA / HI → señal clara
    ruido_tc = 1.05 * SOLAPE   # TC → ruidosa, poco discriminante (secundaria)
    it = {}
    for i in range(1, 6):    # HI: ítems 01-05
        it[f"Item_{str(i).zfill(2)}"] = int(round(np.clip(base_hi + np.random.normal(0, ruido), 0, 3)))
    for i in range(6, 11):   # DA: ítems 06-10
        it[f"Item_{str(i).zfill(2)}"] = int(round(np.clip(base_da + np.random.normal(0, ruido), 0, 3)))
    for i in range(11, 21):  # TC: ítems 11-20
        it[f"Item_{str(i).zfill(2)}"] = int(round(np.clip(base_tc + np.random.normal(0, ruido_tc), 0, 3)))
    return it

def notas_bimestrales(nivel: float, tendencia: float) -> list:
    """Notas B1-B4 alrededor de un nivel académico, con tendencia y ruido por bimestre."""
    ruido = 0.55 * SOLAPE
    return [_letra(nivel + b * tendencia + np.random.normal(0, ruido)) for b in range(4)]

def _estado_riesgo(prom_num: float, inasist: int, estado_tdah: int) -> int:
    """Etiqueta de RIESGO ACADÉMICO (0=Bajo, 1=Medio, 2=Alto).

    Se construye a partir de: notas (histórico real de la institución),
    inasistencias y el estado de TDAH (factor de riesgo documentado en el paper).
    Se agrega ruido para generar traslape realista entre niveles.
    """
    acad = (3.0 - prom_num) / 3.0      # 0 (AD, mejor) … 1 (C, peor)  → notas (peso ALTO)
    inas = min(inasist / 20.0, 1.0)    # 0 … 1                         → inasistencias (peso menor)
    tdah = estado_tdah / 2.0           # 0, 0.5, 1                     → TDAH (peso ALTO)
    score = 0.50 * acad + 0.15 * inas + 0.35 * tdah + np.random.normal(0, 0.08)
    if score < 0.40:
        return 0  # Bajo
    if score < 0.66:
        return 1  # Medio
    return 2      # Alto


def cerrar_alumno(a: dict, notas: list, estado: int) -> dict:
    """Asigna B1-B4, CALCULA Promedio_Final y deriva Estado_Riesgo."""
    a["Nota_B1"], a["Nota_B2"], a["Nota_B3"], a["Nota_B4"] = notas
    prom = sum(_NUM[n] for n in notas) / 4.0
    a["Promedio_Final"] = _letra(prom)
    a["Estado_TDAH"] = estado
    a["Estado_Riesgo"] = _estado_riesgo(prom, a.get("Inasistencias", 0), estado)
    return a

data = []
alumno_id = 1

# ──────────────────────────────────────────────────────────────────────────────
# GRUPO 1: SIN TDAH (250) — EDAH bajo, buenas notas (con traslape hacia la clase 1)
# ──────────────────────────────────────────────────────────────────────────────
for _ in range(n_clase_0):
    a = {"ID_Alumno": f"ALU_{str(alumno_id).zfill(3)}"}; alumno_id += 1

    edah_base = np.clip(np.random.normal(0.70, 0.55 * SOLAPE), 0, 3)
    a.update(items_edah(
        np.clip(edah_base + np.random.normal(0, 0.25), 0, 3),
        np.clip(edah_base + np.random.normal(0, 0.25), 0, 3),
        np.clip(0.70 + np.random.normal(0, 0.35), 0, 3),   # TC bajo (secundario)
    ))

    # EXCEPCIÓN 1 (15%): sano pero con bajo rendimiento (riesgo académico alto)
    if np.random.rand() < 0.15:
        notas = notas_bimestrales(np.clip(np.random.normal(0.70, 0.50), 0, 3), -0.10)
        a["Inasistencias"] = int(np.clip(np.random.poisson(9), 0, 28))
    else:
        notas = notas_bimestrales(np.clip(np.random.normal(2.05, 0.55 * SOLAPE), 0, 3),
                                   np.random.choice([0.12, -0.10, 0.0], p=[0.20, 0.15, 0.65]))
        a["Inasistencias"] = int(np.clip(np.random.poisson(3), 0, 20))

    data.append(cerrar_alumno(a, notas, 0))

# ──────────────────────────────────────────────────────────────────────────────
# GRUPO 2: SOSPECHOSO (108) — EDAH moderado con MUCHA varianza (zona de traslape)
# DA tiende a ser algo mayor que HI; notas medias que se cruzan con ambas clases
# ──────────────────────────────────────────────────────────────────────────────
for _ in range(n_clase_1):
    a = {"ID_Alumno": f"ALU_{str(alumno_id).zfill(3)}"}; alumno_id += 1

    edah_base = np.clip(np.random.normal(1.50, 0.70 * SOLAPE), 0, 3)
    a.update(items_edah(
        np.clip(edah_base - 0.20 + np.random.normal(0, 0.30), 0, 3),
        np.clip(edah_base + 0.30 + np.random.normal(0, 0.30), 0, 3),
        np.clip(0.85 + np.random.normal(0, 0.50), 0, 3),   # TC comprimido (secundario)
    ))

    notas = notas_bimestrales(np.clip(np.random.normal(1.40, 0.60 * SOLAPE), 0, 3),
                              np.random.choice([0.10, -0.12, 0.0], p=[0.15, 0.30, 0.55]))
    a["Inasistencias"] = int(np.clip(np.random.poisson(7), 0, 28))
    data.append(cerrar_alumno(a, notas, 1))

# ──────────────────────────────────────────────────────────────────────────────
# GRUPO 3: CON TDAH (142) — EDAH alto (con traslape hacia la clase 1), notas bajas
# ──────────────────────────────────────────────────────────────────────────────
for _ in range(n_clase_2):
    a = {"ID_Alumno": f"ALU_{str(alumno_id).zfill(3)}"}; alumno_id += 1

    edah_base = np.clip(np.random.normal(2.25, 0.60 * SOLAPE), 0, 3)
    a.update(items_edah(
        np.clip(edah_base + np.random.normal(0, 0.30), 0, 3),
        np.clip(edah_base + np.random.normal(0, 0.30), 0, 3),
        np.clip(1.05 + np.random.normal(0, 0.50), 0, 3),   # TC moderado, no alto (secundario)
    ))

    # EXCEPCIÓN 2 (10%): con TDAH pero notas excelentes (riesgo académico bajo)
    if np.random.rand() < 0.10:
        notas = notas_bimestrales(np.clip(np.random.normal(2.20, 0.50), 0, 3), 0.0)
        a["Inasistencias"] = int(np.clip(np.random.poisson(3), 0, 28))
    else:
        notas = notas_bimestrales(np.clip(np.random.normal(0.85, 0.55 * SOLAPE), 0, 3),
                                  np.random.choice([0.08, -0.13, 0.0], p=[0.10, 0.40, 0.50]))
        a["Inasistencias"] = int(np.clip(np.random.poisson(13), 0, 35))

    data.append(cerrar_alumno(a, notas, 2))

# ──────────────────────────────────────────────────────────────────────────────
# ENSAMBLAJE, CODIFICACIÓN Y EXPORTACIÓN
# ──────────────────────────────────────────────────────────────────────────────
df_final = pd.DataFrame(data)
for col in ["Nota_B1", "Nota_B2", "Nota_B3", "Nota_B4", "Promedio_Final"]:
    df_final[f"{col}_Num"] = df_final[col].map(_NUM)

df_final = df_final.sample(frac=1, random_state=42).reset_index(drop=True)
df_final.to_csv("dataset_tdah_bimestral_500.csv", index=False)

print("¡Dataset realista generado! (SOLAPE = %.2f)" % SOLAPE)
print(f"\nTotal: {len(df_final)}  |  Distribución:")
print(df_final["Estado_TDAH"].value_counts().sort_index()
      .rename({0: "0 - Sin TDAH", 1: "1 - Sospechoso", 2: "2 - Con TDAH"}).to_string())
print("\nPromedio_Final vs Clase (ya NO es 1-a-1 → sin fuga):")
print(pd.crosstab(df_final["Promedio_Final"], df_final["Estado_TDAH"]))
print("\nMedia de ítems EDAH por clase (con traslape):")
items = [f"Item_{str(i).zfill(2)}" for i in range(1, 21)]
for c, lbl in [(0, "Sin TDAH"), (1, "Sospechoso"), (2, "Con TDAH")]:
    print(f"  {lbl:<12} {df_final[df_final['Estado_TDAH']==c][items].values.mean():.2f}")
