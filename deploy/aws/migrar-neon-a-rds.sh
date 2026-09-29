#!/usr/bin/env bash
# Copia la base de datos de Neon a RDS.
#
# Se ejecuta DENTRO DE LA INSTANCIA EC2, porque RDS no es accesible desde
# Internet: solo se llega desde dentro de la VPC.
#
#     scp -i clave.pem deploy/aws/migrar-neon-a-rds.sh ec2-user@IP:/tmp/
#     ssh -i clave.pem ec2-user@IP
#     export URL_NEON='postgresql://...neon.tech/...?sslmode=require'
#     export URL_RDS='postgresql://tesisadmin:CLAVE@...rds.amazonaws.com:5432/estudiantes'
#     bash /tmp/migrar-neon-a-rds.sh
#
# NO BORRA NADA EN NEON. Solo lee. Si algo sale mal, el origen sigue intacto y
# basta con devolver DATABASE_URL a la cadena de Neon.

set -euo pipefail

URL_NEON="${URL_NEON:-}"
URL_RDS="${URL_RDS:-}"
COPIA="/opt/tesis/respaldos/respaldo-neon-$(date +%Y%m%d-%H%M%S).sql"

if [[ -z "$URL_NEON" || -z "$URL_RDS" ]]; then
  echo "Faltan URL_NEON y URL_RDS. Mira la cabecera de este archivo."
  exit 1
fi

command -v psql >/dev/null || { echo "Falta psql: sudo dnf install -y postgresql16"; exit 1; }

# Neon corre PostgreSQL 18 y el cliente de Amazon Linux 2023 es el 16: pg_dump
# se niega a volcar un servidor mas nuevo que el ("server version mismatch").
# En vez de pelear con repositorios, se usa un contenedor con la version exacta
# del servidor de origen. Docker ya esta en la instancia.
VER_ORIGEN=$(psql "$URL_NEON" -tAc "SHOW server_version" | cut -d. -f1)
VER_DESTINO=$(psql "$URL_RDS"  -tAc "SHOW server_version" | cut -d. -f1)
echo "   origen PostgreSQL $VER_ORIGEN  ->  destino PostgreSQL $VER_DESTINO"

volcar() {
  if command -v pg_dump >/dev/null && [[ "$(pg_dump --version | grep -oE '[0-9]+' | head -1)" -ge "$VER_ORIGEN" ]]; then
    pg_dump "$@"
  else
    sudo docker run --rm -i "postgres:${VER_ORIGEN}-alpine" pg_dump "$@"
  fi
}

echo "══ 1/5 · Inventario del ORIGEN (Neon) ════════════════════════════════"
# Se cuentan las filas antes y después: es la única forma de saber si la copia
# quedó completa, más fiable que confiar en que el comando no dio error.
CONTEO_SQL="SELECT 'alumnos', COUNT(*) FROM alumnos
      UNION ALL SELECT 'notas', COUNT(*) FROM notas
      UNION ALL SELECT 'encuestas', COUNT(*) FROM encuestas
      UNION ALL SELECT 'predicciones', COUNT(*) FROM predicciones
      UNION ALL SELECT 'expedientes', COUNT(*) FROM expedientes
      UNION ALL SELECT 'usuarios', COUNT(*) FROM usuarios
      ORDER BY 1;"
psql "$URL_NEON" -c "$CONTEO_SQL" | tee /tmp/conteo-origen.txt

echo
echo "══ 2/5 · Volcando Neon a un archivo ══════════════════════════════════"
# Solo la carpeta de respaldos cambia de dueño. Antes se hacia chown de
# /opt/tesis entero, y ahi vive entorno.env con las claves de cifrado: no hay
# motivo para aflojar sus permisos.
sudo mkdir -p /opt/tesis/respaldos && sudo chown "$USER" /opt/tesis/respaldos
# --no-owner y --no-privileges: los roles de Neon no existen en RDS y, sin
# esto, la restauración falla con errores de propietario desconocido.
volcar "$URL_NEON" \
  --no-owner --no-privileges --no-acl \
  --format=plain --encoding=UTF8 > "$COPIA"

echo "   copia guardada en $COPIA ($(du -h "$COPIA" | cut -f1))"
echo "   GUÁRDALA. Es tu respaldo aunque la migración se tuerza."

# Restaurar de una version mayor a una menor no esta soportado oficialmente,
# pero para un esquema sin extensiones funciona salvo por las directivas que el
# destino no conoce. «transaction_timeout» se anadio en PostgreSQL 17: con
# ON_ERROR_STOP activo, esa sola linea aborta la restauracion entera.
if [[ "$VER_ORIGEN" -gt "$VER_DESTINO" ]]; then
  ANTES=$(wc -l < "$COPIA")
  grep -vE "^SET (transaction_timeout)" "$COPIA" > "$COPIA.tmp" && mv "$COPIA.tmp" "$COPIA"
  echo "   compatibilidad $VER_ORIGEN->$VER_DESTINO: $((ANTES - $(wc -l < "$COPIA"))) linea(s) retirada(s)"
fi

echo
echo "══ 3/5 · Preparando RDS ══════════════════════════════════════════════"
# Al arrancar, el backend ejecuta create_all() y deja las tablas creadas pero
# vacias. El volcado de Neon trae sus propios CREATE TABLE, asi que restaurar
# encima aborta con «ya existe». Y no basta con ignorarlo: el esquema de Neon
# puede tener columnas que create_all() no reproduce.
#
# La solucion es recrear el esquema de RDS desde cero, pero SOLO si esta vacio.
# Si hubiera una sola fila, se para: podria ser trabajo real.
EXISTENTES=$(psql "$URL_RDS" -tAc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")

if [[ "$EXISTENTES" -eq 0 ]]; then
  echo "   RDS esta vacio: se restaura directamente."
else
  echo "   RDS tiene $EXISTENTES tabla(s). Contando filas..."
  # Se excluye «usuarios» y «sesiones»: al arrancar, el backend siembra las tres
  # cuentas por defecto (admin, docente, psicologo) y abre sesiones. Contarlas
  # como datos reales haria abortar una migracion sobre una base recien creada.
  # Cualquier fila en las demas tablas si es trabajo de alguien.
  FILAS=$(psql "$URL_RDS" -tAc "
    SELECT COALESCE(SUM(n),0) FROM (
      SELECT (xpath('/row/c/text()',
              query_to_xml(format('SELECT COUNT(*) AS c FROM %I.%I', table_schema, table_name),
                           false, true, '')))[1]::text::bigint AS n
      FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
        AND table_name NOT IN ('usuarios','sesiones')
    ) t;")
  SEMBRADOS=$(psql "$URL_RDS" -tAc "SELECT COUNT(*) FROM usuarios;" 2>/dev/null || echo 0)
  echo "   filas de datos: $FILAS   (mas $SEMBRADOS usuario(s) por defecto)"

  if [[ "$FILAS" -gt 0 ]]; then
    echo
    echo "   ALTO: RDS ya contiene datos ($FILAS filas de alumnos, notas, etc.)."
    echo "   Este script no sobrescribe datos existentes. Revisa que hay ahi"
    echo "   antes de seguir. Neon no se ha tocado."
    exit 1
  fi

  echo "   Todas vacias: se recrea el esquema para que sea identico al de Neon."
  if [[ "${SIN_PREGUNTAR:-}" != "1" ]]; then
    read -rp "   Borrar las tablas VACIAS de RDS y restaurar? (escribe SI): " RESPUESTA
    [[ "$RESPUESTA" == "SI" ]] || { echo "   cancelado, no se ha tocado nada"; exit 1; }
  fi
  # Solo afecta a RDS. Neon no aparece en esta linea.
  psql "$URL_RDS" --set ON_ERROR_STOP=on -qc "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  echo "   esquema de RDS recreado, vacio"
fi

echo
echo "══ 4/5 · Restaurando en RDS ══════════════════════════════════════════"
# ON_ERROR_STOP: si una sentencia falla, se detiene ahí en lugar de seguir y
# dejar una base a medias que parece correcta.
psql "$URL_RDS" --set ON_ERROR_STOP=on --quiet --file="$COPIA"

echo
echo "══ 5/5 · Comparando origen y destino ═════════════════════════════════"
psql "$URL_RDS" -c "$CONTEO_SQL" | tee /tmp/conteo-destino.txt

# Se comparan los datos, no como los dibuja psql. Antes se recortaba la tabla
# con una expresion regular sobre los bordes «|», que depende del ancho de las
# columnas: bastaba una cifra mas larga para que dos conteos iguales parecieran
# distintos.
psql "$URL_NEON" -tAF, -c "$CONTEO_SQL" > /tmp/cmp-origen.csv
psql "$URL_RDS"  -tAF, -c "$CONTEO_SQL" > /tmp/cmp-destino.csv

echo
if diff /tmp/cmp-origen.csv /tmp/cmp-destino.csv >/dev/null; then
  echo "   LAS CIFRAS COINCIDEN. La migración está completa."
  echo
  echo "   Siguiente paso: pon la cadena de RDS en /opt/tesis/entorno.env"
  echo "   y reinicia:  cd /opt/tesis && sudo docker compose up -d --force-recreate api"
  echo
  echo "   NO borres nada en Neon hasta haber probado la aplicación entera"
  echo "   contra RDS: entrar, ver el panel, generar una predicción."
else
  echo "   LAS CIFRAS NO COINCIDEN (< Neon, > RDS):"
  diff /tmp/cmp-origen.csv /tmp/cmp-destino.csv || true
  echo
  echo "   Neon sigue intacto. No cambies DATABASE_URL hasta resolverlo."
  exit 1
fi
