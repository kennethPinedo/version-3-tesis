# Backend FastAPI del sistema de detección temprana de TDAH.
#
# Construcción en dos etapas: las dependencias se instalan en la primera y solo
# los paquetes ya compilados pasan a la imagen final. Así la imagen que corre en
# EC2 no arrastra pip, las cachés ni las herramientas de compilación.
#
# Se construye DESDE LA RAÍZ del repositorio, no desde esta carpeta:
#     docker build -f deploy/aws/Dockerfile -t tesis-api .

# ─────────────────────────────── Etapa 1: dependencias ───────────────────────
FROM python:3.13-slim AS dependencias

# psycopg2-binary y las ruedas de xgboost/scipy no necesitan compilador, pero
# build-essential cubre el caso de que pip tenga que compilar alguna.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /instalacion
COPY backend_fastapi/requirements.txt .

# --user deja todo bajo /root/.local, que es lo único que se copia después.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir --user -r requirements.txt

# ─────────────────────────────── Etapa 2: imagen final ───────────────────────
FROM python:3.13-slim

# libgomp1 lo necesita xgboost en tiempo de ejecución (OpenMP). Sin él, el
# import falla con un error de biblioteca compartida que despista mucho.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 curl \
 && rm -rf /var/lib/apt/lists/*

# La aplicación no corre como root: si alguien logra ejecutar código a través
# de la subida de expedientes, se topa con un usuario sin privilegios.
RUN useradd --create-home --shell /bin/bash tesis

COPY --from=dependencias /root/.local /home/tesis/.local
ENV PATH=/home/tesis/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY --chown=tesis:tesis backend_fastapi/ /app/

# Los expedientes en PDF se escriben aquí. En EC2 se monta como volumen para
# que sobrevivan a un redespliegue del contenedor.
RUN mkdir -p /app/media/expedientes && chown -R tesis:tesis /app/media

USER tesis
EXPOSE 8000

# El contenedor se declara enfermo si la API deja de responder, y Docker lo
# reinicia. start-period de 40 s: la primera carga de los modelos es lenta.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8000/ || exit 1

# Un solo worker a propósito: cada uno carga su copia de xgboost y shap
# (cientos de MB). En una t3.small, dos workers se quedan sin memoria.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
