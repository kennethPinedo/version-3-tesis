import os
import re
import unicodedata
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from alumnos.models import Alumno, ExpedientePsicologico

router = APIRouter()

# Sube tres niveles: routers/ -> alumnos/ -> backend_fastapi/
_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "media", "expedientes"
)
os.makedirs(_UPLOAD_DIR, exist_ok=True)

# Escala de preocupación del psicólogo: 1 (ninguna) a 5 (máxima).
NIVEL_MIN, NIVEL_MAX = 1, 5

# 10 MB: un informe psicopedagógico escaneado rara vez pasa de ahí, y el
# límite evita que una subida agote el disco del servidor.
MAX_BYTES = 10 * 1024 * 1024

# Los cuatro primeros bytes de todo PDF. Se comprueba el contenido, no el
# Content-Type ni la extensión, que los pone quien sube el archivo.
_FIRMA_PDF = b"%PDF"


def _nombre_seguro(nombre: str) -> str:
    """Reduce el nombre a algo que no pueda escapar del directorio.

    El nombre lo elige quien sube el archivo, así que se descarta cualquier
    ruta que traiga («../../passwd» o «C:\\Windows\\x») y se conservan solo
    letras, dígitos, guiones y puntos. Sin esto, concatenarlo a una ruta
    permite escribir fuera de la carpeta de subidas.
    """
    base = os.path.basename(nombre or "").replace("\\", "/").split("/")[-1]
    # Las tildes se transliteran: el nombre vive en el sistema de archivos.
    base = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._-")
    if not base.lower().endswith(".pdf"):
        base = f"{base or 'expediente'}.pdf"
    return base[:80]


def _exp_dict(e: ExpedientePsicologico) -> dict:
    return {
        "id": e.id,
        "alumno": e.alumno_id,
        "nivel_preocupacion": e.nivel_preocupacion,
        "archivo_pdf": e.archivo_pdf,
        "fecha_registro": e.fecha_registro.isoformat() if e.fecha_registro else None,
    }


@router.get("/expedientes/")
def list_expedientes(alumno: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(ExpedientePsicologico).order_by(ExpedientePsicologico.fecha_registro.desc())
    if alumno:
        q = q.filter(ExpedientePsicologico.alumno_id == alumno)
    return [_exp_dict(e) for e in q.all()]


@router.post("/expedientes/", status_code=201)
async def create_expediente(
    alumno: int = Form(...),
    nivel_preocupacion: int = Form(...),
    archivo_pdf: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Registra el informe psicológico de un estudiante.

    Todo se comprueba ANTES de tocar el disco. Antes el archivo se escribía
    primero y se validaba después, así que una petición que luego fallaba
    dejaba igualmente su archivo huérfano en `media/expedientes`.
    """
    if not db.query(Alumno).filter(Alumno.id == alumno).first():
        raise HTTPException(status_code=404, detail="Alumno no encontrado.")

    if not NIVEL_MIN <= nivel_preocupacion <= NIVEL_MAX:
        raise HTTPException(
            status_code=400,
            detail=(f"El nivel de preocupación debe estar entre {NIVEL_MIN} y "
                    f"{NIVEL_MAX}. Recibido: {nivel_preocupacion}."),
        )

    contenido = await archivo_pdf.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    if len(contenido) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(f"El archivo pesa {len(contenido) / 1048576:.1f} MB y el máximo "
                    f"es {MAX_BYTES // 1048576} MB."),
        )
    if not contenido.startswith(_FIRMA_PDF):
        raise HTTPException(
            status_code=400,
            detail="El expediente debe ser un PDF. El archivo enviado no lo es.",
        )

    # Prefijo aleatorio: dos informes con el mismo nombre ya no se pisan, y el
    # nombre resultante no depende de lo que enviara el cliente.
    filename = f"{alumno}_{uuid.uuid4().hex[:8]}_{_nombre_seguro(archivo_pdf.filename)}"
    filepath = os.path.join(_UPLOAD_DIR, filename)

    # Cinturón y tirantes: aunque _nombre_seguro ya lo impide, se comprueba que
    # la ruta final siga dentro del directorio de subidas.
    if os.path.commonpath([os.path.realpath(filepath), os.path.realpath(_UPLOAD_DIR)]) != os.path.realpath(_UPLOAD_DIR):
        raise HTTPException(status_code=400, detail="Nombre de archivo no permitido.")

    with open(filepath, "wb") as f:
        f.write(contenido)

    e = ExpedientePsicologico(
        alumno_id=alumno,
        nivel_preocupacion=nivel_preocupacion,
        archivo_pdf=f"expedientes/{filename}",
    )
    try:
        db.add(e)
        db.commit()
        db.refresh(e)
    except Exception:
        # Si la fila no llega a guardarse, el archivo tampoco se queda.
        db.rollback()
        try:
            os.remove(filepath)
        except OSError:
            pass
        raise
    return _exp_dict(e)
