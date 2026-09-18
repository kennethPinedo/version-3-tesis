import csv
import io
from typing import Any, Dict, List, Optional, Sequence, Tuple

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database import get_db
from alumnos.models import Alumno, Nota
from alumnos.services import regenerar_predicciones

router = APIRouter()

CALIFICACIONES_VALIDAS = ("AD", "A", "B", "C")
BIMESTRES_VALIDOS = (1, 2, 3, 4)

# Áreas curriculares del nivel de secundaria (Currículo Nacional). El
# formulario ofrece justo estas; el servidor tiene que exigir lo mismo, porque
# el formulario no es una barrera: cualquiera puede llamar a la API.
ASIGNATURAS_VALIDAS = (
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
)

# Búsqueda indulgente con mayúsculas y espacios, estricta con el contenido.
_ASIGNATURAS_NORM = {a.strip().lower(): a for a in ASIGNATURAS_VALIDAS}


def normalizar_asignatura(valor: str):
    """Devuelve el nombre canónico del área, o None si no pertenece al plan."""
    return _ASIGNATURAS_NORM.get(str(valor or "").strip().lower())
COLUMNAS_ESPERADAS = "alumno_id,bimestre,asignatura,calificacion"
MAX_FILAS = 5000


class NotaCreate(BaseModel):
    alumno: int
    asignatura: str = Field(min_length=1, max_length=100)
    calificacion_literal: str
    bimestre: int = Field(default=1, ge=1, le=4)

    @field_validator("asignatura")
    @classmethod
    def _validar_asignatura(cls, v: str) -> str:
        canonica = normalizar_asignatura(v)
        if not canonica:
            raise ValueError(
                "El área curricular no pertenece al plan de estudios. "
                f"Válidas: {', '.join(ASIGNATURAS_VALIDAS)}."
            )
        return canonica

    @field_validator("calificacion_literal")
    @classmethod
    def _validar_calificacion(cls, v: str) -> str:
        lit = str(v).strip().upper()
        if lit not in CALIFICACIONES_VALIDAS:
            raise ValueError("La calificación debe ser AD, A, B o C.")
        return lit


def _nota_dict(n: Nota) -> dict:
    return {
        "id": n.id,
        "alumno": n.alumno_id,
        "asignatura": n.asignatura,
        "calificacion_literal": n.calificacion_literal,
        "bimestre": getattr(n, "bimestre", 1),
        "fecha_registro": str(n.fecha_registro) if n.fecha_registro else None,
    }


def _upsert_nota(db: Session, alumno_id: int, asignatura: str,
                 calificacion: str, bimestre: int) -> Nota:
    """Inserta o actualiza la nota de un curso en un bimestre (evita duplicados
    que distorsionarían el promedio)."""
    existente = (
        db.query(Nota)
        .filter(
            Nota.alumno_id == alumno_id,
            Nota.asignatura == asignatura,
            Nota.bimestre == bimestre,
        )
        .first()
    )
    if existente:
        existente.calificacion_literal = calificacion
        return existente
    n = Nota(
        alumno_id=alumno_id,
        asignatura=asignatura,
        calificacion_literal=calificacion,
        bimestre=bimestre,
    )
    db.add(n)
    return n


@router.get("/notas/")
def list_notas(alumno: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Nota).order_by(Nota.bimestre, Nota.asignatura)
    if alumno:
        q = q.filter(Nota.alumno_id == alumno)
    return [_nota_dict(n) for n in q.all()]


@router.post("/notas/", status_code=201)
def create_nota(data: NotaCreate, db: Session = Depends(get_db)):
    d = data.model_dump()
    alumno_id = d.pop("alumno")
    if not db.query(Alumno).filter(Alumno.id == alumno_id).first():
        raise HTTPException(status_code=404, detail="Alumno no encontrado.")
    n = _upsert_nota(db, alumno_id, d["asignatura"].strip(),
                     d["calificacion_literal"], d["bimestre"])
    db.commit()
    db.refresh(n)
    return _nota_dict(n)


# ══════════════════════════════════════════════════════════════════════════════
#  CARGA MASIVA (CSV / Excel)
# ══════════════════════════════════════════════════════════════════════════════

def _filas_desde_csv(contenido: bytes) -> List[List[str]]:
    """Lee CSV detectando el separador (coma o punto y coma) y el BOM de Excel."""
    try:
        texto = contenido.decode("utf-8-sig")
    except UnicodeDecodeError:
        texto = contenido.decode("latin-1")

    muestra = texto[:2048]
    try:
        dialecto = csv.Sniffer().sniff(muestra, delimiters=",;\t")
        delimitador = dialecto.delimiter
    except csv.Error:
        delimitador = ";" if muestra.count(";") > muestra.count(",") else ","

    lector = csv.reader(io.StringIO(texto), delimiter=delimitador)
    return [fila for fila in lector if any(str(c).strip() for c in fila)]


def _filas_desde_excel(contenido: bytes) -> List[List[str]]:
    try:
        from openpyxl import load_workbook
    except ImportError:
        raise HTTPException(
            status_code=400,
            detail=("Para leer archivos Excel instala la dependencia openpyxl "
                    "(pip install openpyxl) o exporta el archivo a CSV."),
        )
    wb = load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
    hoja = wb.active
    filas: List[List[str]] = []
    for fila in hoja.iter_rows(values_only=True):
        celdas = ["" if c is None else str(c).strip() for c in fila]
        if any(celdas):
            filas.append(celdas)
    wb.close()
    return filas


def _tiene_encabezado(fila: Sequence[str]) -> bool:
    """El archivo trae encabezado si la primera celda no es un id numérico."""
    try:
        int(str(fila[0]).strip())
        return False
    except (ValueError, IndexError):
        return True


def _validar_fila(fila: Sequence[str], nro: int,
                  ids_validos: set) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Valida una fila. Devuelve (registro, None) o (None, mensaje_de_error)."""
    if len(fila) < 4:
        return None, (f"Fila {nro}: se esperaban 4 columnas ({COLUMNAS_ESPERADAS}), "
                      f"se encontraron {len(fila)}.")

    crudo_alumno, crudo_bim, crudo_asig, crudo_calif = (str(c).strip() for c in fila[:4])

    try:
        alumno_id = int(float(crudo_alumno))
    except ValueError:
        return None, f"Fila {nro}: alumno_id inválido '{crudo_alumno}'. Debe ser un número entero."
    if alumno_id not in ids_validos:
        return None, f"Fila {nro}: no existe un alumno con id {alumno_id}."

    try:
        bimestre = int(float(crudo_bim))
    except ValueError:
        return None, f"Fila {nro}: bimestre inválido '{crudo_bim}'. Debe ser 1, 2, 3 o 4."
    if bimestre not in BIMESTRES_VALIDOS:
        return None, f"Fila {nro}: bimestre inválido '{crudo_bim}'. Debe ser 1, 2, 3 o 4."

    if not crudo_asig:
        return None, f"Fila {nro}: la asignatura no puede estar vacía."
    asignatura = normalizar_asignatura(crudo_asig)
    if not asignatura:
        return None, (f"Fila {nro}: el área '{crudo_asig}' no pertenece al plan de "
                      f"estudios. Válidas: {', '.join(ASIGNATURAS_VALIDAS)}.")

    calificacion = crudo_calif.upper()
    if calificacion not in CALIFICACIONES_VALIDAS:
        return None, (f"Fila {nro}: Calificación inválida '{crudo_calif}'. "
                      f"Debe ser AD, A, B o C")

    return {
        "alumno_id": alumno_id,
        "bimestre": bimestre,
        "asignatura": asignatura,
        "calificacion": calificacion,
    }, None


@router.post("/notas/carga-masiva/")
async def carga_masiva_notas(
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Carga masiva de notas desde CSV o Excel.

    Formato esperado (con o sin fila de encabezado):
        alumno_id,bimestre,asignatura,calificacion

    Valida fila por fila y devuelve el detalle de las rechazadas sin abortar el
    lote: las filas correctas se guardan igual. Al terminar, regenera la
    predicción de todos los alumnos afectados.
    """
    nombre = (archivo.filename or "").lower()
    contenido = await archivo.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")

    if nombre.endswith((".xlsx", ".xlsm")):
        filas = _filas_desde_excel(contenido)
    elif nombre.endswith(".csv") or nombre.endswith(".txt") or not nombre:
        filas = _filas_desde_csv(contenido)
    elif nombre.endswith(".xls"):
        raise HTTPException(
            status_code=400,
            detail="El formato .xls (Excel 97-2003) no es compatible. Guarda el archivo como .xlsx o .csv.",
        )
    else:
        raise HTTPException(
            status_code=400,
            detail="Formato no soportado. Sube un archivo .csv o .xlsx.",
        )

    if not filas:
        raise HTTPException(status_code=400, detail="El archivo no contiene filas de datos.")
    if len(filas) > MAX_FILAS:
        raise HTTPException(
            status_code=400,
            detail=f"El archivo supera el máximo de {MAX_FILAS} filas.",
        )

    # Descuenta el encabezado y conserva la numeración real del archivo para que
    # los mensajes de error apunten a la fila que ve el usuario en Excel.
    offset = 1
    if _tiene_encabezado(filas[0]):
        filas = filas[1:]
        offset = 2
    if not filas:
        raise HTTPException(
            status_code=400,
            detail="El archivo solo contiene el encabezado, sin filas de datos.",
        )

    ids_validos = {a.id for a in db.query(Alumno.id).all()}
    errores: List[str] = []
    procesados = 0
    alumnos_afectados: set = set()

    for i, fila in enumerate(filas):
        registro, error = _validar_fila(fila, i + offset, ids_validos)
        if error:
            errores.append(error)
            continue
        _upsert_nota(
            db,
            registro["alumno_id"],
            registro["asignatura"],
            registro["calificacion"],
            registro["bimestre"],
        )
        alumnos_afectados.add(registro["alumno_id"])
        procesados += 1

    if procesados:
        db.commit()
    else:
        db.rollback()

    predicciones = regenerar_predicciones(db, list(alumnos_afectados)) if procesados else 0

    return {
        "procesados": procesados,
        "rechazados": len(errores),
        "errores": errores,
        "alumnos_afectados": sorted(alumnos_afectados),
        "predicciones_actualizadas": predicciones,
        "mensaje": (
            f"{procesados} nota(s) registrada(s), {len(errores)} fila(s) rechazada(s). "
            f"{predicciones} predicción(es) actualizada(s)."
        ),
    }
