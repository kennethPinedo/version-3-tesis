from datetime import date, datetime
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, ForeignKey, Date, UniqueConstraint,
)
from database import Base


class Alumno(Base):
    __tablename__ = "alumnos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False)
    edad = Column(Integer, nullable=False)
    grado = Column(String(50), nullable=False)
    anio_cursada = Column(Integer, default=2024)
    contacto_emergente = Column(String(100), nullable=False)
    # LEGADO: la condición social ya no se captura ni se expone en la API
    # (depuración de datos sensibles). Se conserva la columna para no romper
    # bases de datos existentes.
    condicion_social = Column(String(50), default="NINGUNA")
    genero = Column(String(30), default="No especificado")
    # Nivel educativo, separado del grado para poder filtrar y agrupar.
    nivel = Column(String(20), default="Secundaria")

    # ── Documento de identidad ────────────────────────────────────────────
    # El número no se guarda en claro. Ver alumnos/services/cripto_service.py:
    # el cifrado es reversible pero no comparable, y la huella es comparable
    # pero no reversible; hacen falta las dos.
    tipo_documento = Column(String(20), nullable=True)      # DNI | CE | PASAPORTE
    documento_cifrado = Column(String(255), nullable=True)
    documento_huella = Column(String(64), unique=True, nullable=True, index=True)
    # Total que consume el modelo de riesgo. Ya no se escribe a mano: se
    # mantiene como la suma de «inasistencias_previas» más los días con estado
    # "No asistió" en la tabla asistencias.
    inasistencias = Column(Integer, default=0, nullable=False)
    # Días que constaban como total agregado ANTES de que existiera el registro
    # por fecha. No se pueden convertir en fechas concretas porque nadie las
    # anotó, y descartarlos falsearía el historial de 19 alumnos reales.
    inasistencias_previas = Column(Integer, default=0, nullable=False)


class Encuesta(Base):
    __tablename__ = "encuestas"

    id = Column(Integer, primary_key=True, index=True)
    alumno_id = Column(Integer, ForeignKey("alumnos.id"), nullable=False)
    # Déficit de Atención (DA1-DA5) — escala 0-3, max 15
    DA1 = Column(Integer, nullable=False)
    DA2 = Column(Integer, nullable=False)
    DA3 = Column(Integer, nullable=False)
    DA4 = Column(Integer, nullable=False)
    DA5 = Column(Integer, nullable=False)
    # Hiperactividad e Impulsividad (HI1-HI5) — escala 0-3, max 15
    HI1 = Column(Integer, nullable=False)
    HI2 = Column(Integer, nullable=False)
    HI3 = Column(Integer, nullable=False)
    HI4 = Column(Integer, nullable=False)
    HI5 = Column(Integer, nullable=False)
    # Trastorno de Conducta (TC1-TC10) — escala 0-3, max 30
    TC1 = Column(Integer, nullable=False)
    TC2 = Column(Integer, nullable=False)
    TC3 = Column(Integer, nullable=False)
    TC4 = Column(Integer, nullable=False)
    TC5 = Column(Integer, nullable=False)
    TC6 = Column(Integer, nullable=False)
    TC7 = Column(Integer, nullable=False)
    TC8 = Column(Integer, nullable=False)
    TC9 = Column(Integer, nullable=False)
    TC10 = Column(Integer, nullable=False)
    # LEGADO: las inasistencias se movieron a Alumno.inasistencias (módulo
    # independiente). La columna se conserva —y se sigue escribiendo en 0— para
    # no romper bases de datos ya creadas con NOT NULL.
    inasistencias = Column(Integer, default=0, nullable=False)
    # Quién respondió la escala. El EDAH no lo contesta el niño: lo rellena un
    # adulto que lo observa a diario, y la interpretación clínica depende de
    # quién sea. Un docente ve la conducta en clase y un familiar la ve en casa;
    # una misma puntuación no significa lo mismo según la fuente. Sin este dato
    # la encuesta no es interpretable ni reproducible.
    # Nullable porque las 35 encuestas ya registradas no lo tienen.
    informante = Column(String(30), nullable=True)
    # Se mantiene Date (no se migra el tipo para no romper BD existentes). El
    # desempate de dos encuestas del mismo día se resuelve ordenando además por
    # id descendente en las consultas.
    fecha_aplicacion = Column(Date, default=date.today)


class Nota(Base):
    __tablename__ = "notas"

    id = Column(Integer, primary_key=True, index=True)
    alumno_id = Column(Integer, ForeignKey("alumnos.id"), nullable=False)
    asignatura = Column(String(100), nullable=False)
    calificacion_literal = Column(String(2), nullable=False)
    # Bimestre al que corresponde la nota: 1, 2, 3 o 4
    bimestre = Column(Integer, default=1, nullable=False)
    fecha_registro = Column(Date, default=date.today)


class PrediccionAcademica(Base):
    __tablename__ = "predicciones"

    id = Column(Integer, primary_key=True, index=True)
    alumno_id = Column(Integer, ForeignKey("alumnos.id"), nullable=False)
    promedio_notas = Column(Float, nullable=False)
    nivel_riesgo = Column(String(10), nullable=False)
    probabilidad = Column(Float, nullable=True)
    prediccion_notas = Column(String, nullable=False)
    condiciones_psicoeducativas = Column(String, nullable=False)
    fecha_prediccion = Column(DateTime, default=datetime.utcnow)


class ExpedientePsicologico(Base):
    __tablename__ = "expedientes"

    id = Column(Integer, primary_key=True, index=True)
    alumno_id = Column(Integer, ForeignKey("alumnos.id"), nullable=False)
    nivel_preocupacion = Column(Integer, nullable=False)
    archivo_pdf = Column(String, nullable=False)
    fecha_registro = Column(DateTime, default=datetime.utcnow)


class Usuario(Base):
    """Cuenta de acceso al sistema.

    Sustituye al diccionario de usuarios que vivía en el frontend con las
    contraseñas en texto plano. Aquí solo se guarda el hash.
    """
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    usuario = Column(String(50), unique=True, nullable=False, index=True)
    nombre = Column(String(120), nullable=False)
    rol = Column(String(30), nullable=False)          # Administrador | Psicólogo | Docente
    # PBKDF2-HMAC-SHA256 en formato "iteraciones$sal$hash", todo hexadecimal.
    password_hash = Column(String(255), nullable=False)
    activo = Column(Integer, default=1, nullable=False)
    # Obliga a definir una contraseña propia en el primer ingreso y después de
    # cada reposición hecha por el administrador.
    debe_cambiar = Column(Integer, default=0, nullable=False)
    ultimo_acceso = Column(DateTime, nullable=True)
    fecha_creacion = Column(DateTime, default=datetime.utcnow)


class Sesion(Base):
    """Sesión activa. Permite revocar el acceso sin esperar a que caduque."""
    __tablename__ = "sesiones"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    expira = Column(DateTime, nullable=False)
    fecha_creacion = Column(DateTime, default=datetime.utcnow)


class SolicitudRecuperacion(Base):
    """Petición de recuperación de contraseña, atendida por el administrador."""
    __tablename__ = "solicitudes_recuperacion"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    codigo = Column(String(30), unique=True, nullable=False, index=True)
    estado = Column(String(20), default="pendiente", nullable=False)  # pendiente | atendida | caducada
    fecha_solicitud = Column(DateTime, default=datetime.utcnow)
    expira = Column(DateTime, nullable=False)
    fecha_atencion = Column(DateTime, nullable=True)


class HistorialInasistencias(Base):
    """Cada cambio del contador de inasistencias de un estudiante.

    Alumno.inasistencias guarda un unico numero que se sobrescribe, asi que por
    si solo no permite responder ni «cuando subio» ni «quien lo cambio». Eso
    importa por dos motivos: las inasistencias pesan en el modelo de riesgo, y
    ante una correccion posterior hay que poder distinguir un error de captura
    de un empeoramiento real del estudiante.

    Es un registro de solo anadidura: nunca se modifica una fila existente.
    """
    __tablename__ = "historial_inasistencias"

    id = Column(Integer, primary_key=True, index=True)
    alumno_id = Column(Integer, ForeignKey("alumnos.id"), nullable=False, index=True)
    # Se guarda el antes y el despues, no la diferencia: asi una fila se
    # entiende sola, sin tener que reconstruir la cadena desde el principio.
    valor_anterior = Column(Integer, nullable=False)
    valor_nuevo = Column(Integer, nullable=False)
    # Periodo al que corresponden los dias. Sin el, «45 dias» no significa nada.
    anio_lectivo = Column(Integer, nullable=True)
    # Nombre de usuario, no su id: si la cuenta se borrara, el registro debe
    # seguir diciendo quien hizo el cambio.
    registrado_por = Column(String(50), nullable=True)
    fecha = Column(DateTime, default=datetime.utcnow, index=True)


class Asistencia(Base):
    """Asistencia de un alumno en UNA fecha concreta.

    Sustituye al contador agregado: antes solo se guardaba «N dias», sin saber
    cuales. Con la fecha se puede responder si las faltas estan repartidas o
    concentradas en una semana, que significa cosas distintas.

    Se registra tambien la asistencia, no solo la falta: «asistio» es un dato
    positivo que distingue «vino ese dia» de «nadie lo anoto».
    """
    __tablename__ = "asistencias"

    id = Column(Integer, primary_key=True, index=True)
    alumno_id = Column(Integer, ForeignKey("alumnos.id"), nullable=False, index=True)
    fecha = Column(Date, nullable=False, index=True)
    # "Asistio" | "No asistio"
    estado = Column(String(20), nullable=False)
    registrado_por = Column(String(50), nullable=True)
    fecha_registro = Column(DateTime, default=datetime.utcnow)

    # Un alumno no puede tener dos registros del mismo dia: si se corrige, se
    # actualiza el que ya existe en lugar de acumular contradicciones.
    __table_args__ = (
        UniqueConstraint("alumno_id", "fecha", name="uq_asistencia_alumno_fecha"),
    )


class EdicionEncuesta(Base):
    """Cada vez que se corrige una encuesta EDAH ya guardada.

    La encuesta era inmutable: si habia un error, solo cabia aplicarla de nuevo.
    Eso ensuciaba el historial —dos aplicaciones para un unico momento de
    evaluacion— asi que ahora se puede corregir, pero con limite y con
    constancia.

    El limite existe porque el EDAH es un instrumento psicometrico: si se
    pudiera reescribir sin restriccion, la puntuacion dejaria de reflejar lo que
    observo el informante y pasaria a reflejar lo que alguien decidio despues.
    Guardar la version anterior permite auditar que cambio y cuando.
    """
    __tablename__ = "ediciones_encuesta"

    id = Column(Integer, primary_key=True, index=True)
    encuesta_id = Column(Integer, ForeignKey("encuestas.id"), nullable=False, index=True)
    fecha_edicion = Column(DateTime, default=datetime.utcnow, index=True)
    editado_por = Column(String(50), nullable=True)
    # Que cambio, en texto legible: «DA3: 1 -> 2 | TC7: 0 -> 1». Se guarda el
    # resumen y no la encuesta entera para que el historial se pueda leer sin
    # tener que comparar dos filas de 20 columnas.
    resumen = Column(String, nullable=True)
