"""
Dataset sintético TDAH — Riesgo Académico
500 registros: Sin TDAH (375) | Posible TDAH (75) | Con TDAH (50)

Lógica de etiquetado:
  prob_tdah    = max(DA_total, HI_total) / 15
  tdah_coded   = 0 si prob ≤ 0.30 | 1 si 0.31-0.70 | 2 si 0.71-1.00
  nota_coded   = 0 (AD 18-20) | 1 (A 15-17) | 2 (B 11-14) | 3 (C 0-10)
  social_coded = 0 (0-8) | 1 (9-16) | 2 (17-24)
  riesgo_score = 0.4*nota_coded + 0.3*tdah_coded + 0.3*social_coded
  nivel_riesgo_academico: Bajo (<1.0) | Medio (1.0-1.9) | Alto (>=2.0)
"""

import numpy as np
import pandas as pd
from pathlib import Path

rng = np.random.default_rng(42)
OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)


def _dist_items(total: int, n_items: int, max_item: int) -> np.ndarray:
    """Distribuye 'total' en n_items enteros, cada uno en [0, max_item]."""
    items = np.zeros(n_items, dtype=int)
    restante = int(total)
    for i in range(n_items - 1):
        upper = min(max_item, restante)
        lower = max(0, restante - max_item * (n_items - 1 - i))
        if lower > upper:
            lower = upper
        items[i] = int(rng.integers(lower, upper + 1))
        restante -= items[i]
    items[-1] = restante
    return items


def _gen_notas(spec: list) -> np.ndarray:
    """spec: lista de (count, lo, hi). Devuelve array mezclado."""
    parts = [np.round(rng.uniform(lo, hi, cnt), 1) for cnt, lo, hi in spec]
    arr = np.concatenate(parts)
    rng.shuffle(arr)
    return arr


def _gen_social(spec: list) -> np.ndarray:
    """spec: lista de (count, lo, hi) enteros inclusivos. Devuelve array mezclado."""
    parts = [rng.integers(lo, hi + 1, cnt) for cnt, lo, hi in spec]
    arr = np.concatenate(parts)
    rng.shuffle(arr)
    return arr


def _nota_coded(nota: float) -> int:
    if nota >= 18: return 0
    if nota >= 15: return 1
    if nota >= 11: return 2
    return 3


def _social_coded(s: int) -> int:
    if s <= 8: return 0
    if s <= 16: return 1
    return 2


def _tdah_coded(prob: float) -> int:
    if prob <= 0.30: return 0
    if prob <= 0.70: return 1
    return 2


def build_group(n: int, da_totals: np.ndarray, hi_totals: np.ndarray,
                notas: np.ndarray, social: np.ndarray, tc_mean: float) -> list:
    tc_matrix = np.clip(
        np.round(rng.normal(tc_mean, 0.7, (n, 10))).astype(int), 0, 3
    )
    rows = []
    for i in range(n):
        da_arr = _dist_items(int(da_totals[i]), 5, 3)
        hi_arr = _dist_items(int(hi_totals[i]), 5, 3)
        tc_arr = tc_matrix[i]
        da_t = int(da_arr.sum())
        hi_t = int(hi_arr.sum())
        tc_t = int(tc_arr.sum())
        nota = float(notas[i])
        soc = int(social[i])

        prob_tdah = round(max(da_t, hi_t) / 15.0, 4)
        td_c = _tdah_coded(prob_tdah)
        nc   = _nota_coded(nota)
        sc   = _social_coded(soc)
        score = round(0.4 * nc + 0.3 * td_c + 0.3 * sc, 4)
        riesgo = "Bajo" if score < 1.0 else ("Medio" if score < 2.0 else "Alto")

        row = {}
        for j, v in enumerate(da_arr, 1): row[f"DA{j}"] = int(v)
        for j, v in enumerate(hi_arr, 1): row[f"HI{j}"] = int(v)
        for j, v in enumerate(tc_arr, 1): row[f"TC{j}"] = int(v)
        row.update({
            "DA_total": da_t, "HI_total": hi_t, "TC_total": tc_t,
            "promedio_notas": nota, "condicion_social": soc,
            "prob_tdah": prob_tdah,
            "tdah_coded": td_c, "nota_coded": nc, "social_coded": sc,
            "riesgo_score": score, "nivel_riesgo_academico": riesgo,
        })
        rows.append(row)
    return rows


# ── Sin TDAH (375): max(DA,HI) en [0, 4] ─────────────────────────────────────
# 10% notas bajas (C) = 37 | 10% condición social alta (17-24) = 37
n_sin = 375
da_sin = rng.integers(0, 5, n_sin)
hi_sin = rng.integers(0, 5, n_sin)
notas_sin  = _gen_notas([(95, 18.0, 20.0), (150, 15.0, 17.9),
                          (93, 11.0, 14.9),  (37,  0.0, 10.9)])
social_sin = _gen_social([(223, 0, 8), (115, 9, 16), (37, 17, 24)])
rows_sin   = build_group(n_sin, da_sin, hi_sin, notas_sin, social_sin, tc_mean=0.5)

# ── Posible TDAH (75): 5 ≤ max(DA,HI) ≤ 10 ──────────────────────────────────
# 20% buenas notas (AD+A) = 15 | más C + social alta para casos Alto
n_pos = 75
dominant_p = rng.integers(5, 11, n_pos)   # 5-10
other_p    = rng.integers(0, 11, n_pos)   # 0-10
swap_p     = rng.random(n_pos) > 0.5
da_pos = np.where(swap_p, dominant_p, other_p)
hi_pos = np.where(swap_p, other_p,    dominant_p)
notas_pos  = _gen_notas([(5, 18.0, 20.0), (10, 15.0, 17.9),
                          (25, 11.0, 14.9), (35,  0.0, 10.9)])
social_pos = _gen_social([(5, 0, 8), (25, 9, 16), (45, 17, 24)])
rows_pos   = build_group(n_pos, da_pos, hi_pos, notas_pos, social_pos, tc_mean=1.0)

# ── Con TDAH (50): max(DA,HI) ≥ 11 ───────────────────────────────────────────
# 20% buenas notas (AD+A) = 10 | alta condición social desfavorable → genera mayoría de casos Alto
n_con = 50
dominant_c = rng.integers(11, 16, n_con)  # 11-15
other_c    = rng.integers(0, 16, n_con)   # 0-15
swap_c     = rng.random(n_con) > 0.5
da_con = np.where(swap_c, dominant_c, other_c)
hi_con = np.where(swap_c, other_c,    dominant_c)
notas_con  = _gen_notas([(5, 18.0, 20.0), (5, 15.0, 17.9),
                          (20, 11.0, 14.9), (20, 0.0, 10.9)])
social_con = _gen_social([(2, 0, 8), (3, 9, 16), (45, 17, 24)])
rows_con   = build_group(n_con, da_con, hi_con, notas_con, social_con, tc_mean=1.5)

# ── Construir DataFrame ───────────────────────────────────────────────────────
df = (
    pd.DataFrame(rows_sin + rows_pos + rows_con)
    .sample(frac=1, random_state=42)
    .reset_index(drop=True)
)
df.insert(0, "id", range(1, len(df) + 1))

# ── Split 70 / 15 / 15 ───────────────────────────────────────────────────────
n       = len(df)
n_train = int(n * 0.70)   # 350
n_val   = int(n * 0.15)   # 75

df["split"] = "test"
df.loc[df.index[:n_train],              "split"] = "train"
df.loc[df.index[n_train:n_train+n_val], "split"] = "val"

# ── Guardar ───────────────────────────────────────────────────────────────────
df.to_csv(OUTPUT_DIR / "dataset_tdah_completo.csv", index=False)
df[df.split == "train"].drop(columns="split").to_csv(OUTPUT_DIR / "train.csv", index=False)
df[df.split == "val"  ].drop(columns="split").to_csv(OUTPUT_DIR / "val.csv",   index=False)
df[df.split == "test" ].drop(columns="split").to_csv(OUTPUT_DIR / "test.csv",  index=False)

# ── Reporte ───────────────────────────────────────────────────────────────────
print("=" * 60)
print("  DATASET TDAH — REPORTE DE GENERACIÓN")
print("=" * 60)
print(f"  Total registros : {len(df)}")
print(f"  Train           : {(df.split=='train').sum()} (70%)")
print(f"  Validación      : {(df.split=='val').sum()} (15%)")
print(f"  Test            : {(df.split=='test').sum()} (15%)")
print()
print("  Grupos TDAH:")
print(f"    Sin TDAH    (max DA/HI 0-4)  : {n_sin}")
print(f"    Posible TDAH(max DA/HI 5-10) : {n_pos}")
print(f"    Con TDAH    (max DA/HI 11-15): {n_con}")
print()
print("  Distribución Riesgo Académico:")
r = df["nivel_riesgo_academico"].value_counts()
for nivel in ["Bajo", "Medio", "Alto"]:
    cnt = r.get(nivel, 0)
    print(f"    {nivel:<6}: {cnt:>4} ({cnt/len(df)*100:.1f}%)")
print()
# Validación de constraints del diseño
df_sin  = df[df.DA_total.le(4) & df.HI_total.le(4)]
df_pos  = df[df[["DA_total","HI_total"]].max(axis=1).between(5, 10)]
df_con  = df[df[["DA_total","HI_total"]].max(axis=1).ge(11)]
notas_bajas_sin  = (df_sin.nota_coded == 3).sum()
social_alta_sin  = (df_sin.social_coded == 2).sum()
buenas_pos       = (df_pos.nota_coded.le(1)).sum()
buenas_con       = (df_con.nota_coded.le(1)).sum()
print("  Validación de constraints:")
print(f"    Sin TDAH — notas bajas (C):    {notas_bajas_sin}/{len(df_sin)} "
      f"({notas_bajas_sin/len(df_sin)*100:.1f}%)  [target ~10%]")
print(f"    Sin TDAH — social alta:         {social_alta_sin}/{len(df_sin)} "
      f"({social_alta_sin/len(df_sin)*100:.1f}%)  [target ~10%]")
print(f"    Posible TDAH — notas buenas:   {buenas_pos}/{len(df_pos)} "
      f"({buenas_pos/len(df_pos)*100:.1f}%)  [target 20%]")
print(f"    Con TDAH — notas buenas:       {buenas_con}/{len(df_con)} "
      f"({buenas_con/len(df_con)*100:.1f}%)  [target 20%]")
print(f"    Casos Riesgo Alto:             {r.get('Alto',0)}  [target 50-75]")
print()
print("  Estadísticas DA/HI totales:")
for col in ["DA_total", "HI_total"]:
    print(f"    {col}: media={df[col].mean():.2f}  SD={df[col].std():.2f}  "
          f"[{df[col].min()}, {df[col].max()}]")
print()
print(f"  Archivos guardados en: {OUTPUT_DIR.resolve()}")
print("=" * 60)
