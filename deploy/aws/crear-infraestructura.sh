#!/usr/bin/env bash
# Crea toda la infraestructura de AWS en un solo paso.
#
#     bash deploy/aws/crear-infraestructura.sh
#
# Comprueba los requisitos, descubre la red por su cuenta, muestra lo que se va
# a facturar y pide confirmacion ANTES de crear nada. Es idempotente: si la pila
# ya existe, lo dice y no la duplica.

set -euo pipefail

# La plantilla lleva acentos y recuadros en los comentarios. En Windows la AWS
# CLI lee los archivos «file://» con la codificacion del sistema (cp1252) y
# falla con «text contents could not be decoded». Esto la obliga a UTF-8.
export AWS_CLI_FILE_ENCODING=UTF-8

PILA="${PILA:-tesis-tdah}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Ruta de la plantilla tal y como la entiende la AWS CLI. En Git Bash «pwd»
# devuelve /c/Users/..., que la CLI nativa de Windows no sabe abrir: da
# «No such file or directory» aunque el archivo este ahi. cygpath -m la
# convierte a C:/Users/..., con barras normales y admitiendo espacios.
PLANTILLA="$RAIZ/deploy/aws/infraestructura.yaml"
if command -v cygpath >/dev/null 2>&1; then
  PLANTILLA="$(cygpath -m "$PLANTILLA")"
fi

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }

echo
echo "══ 1/6 · Requisitos ══════════════════════════════════════════════════"

faltan=0
if command -v aws >/dev/null 2>&1; then
  verde "  ok    AWS CLI $(aws --version 2>&1 | cut -d' ' -f1 | cut -d/ -f2)"
else
  rojo  "  falta AWS CLI  ->  winget install --id Amazon.AWSCLI"
  faltan=1
fi

if aws sts get-caller-identity >/dev/null 2>&1; then
  CUENTA=$(aws sts get-caller-identity --query Account --output text)
  QUIEN=$(aws sts get-caller-identity --query Arn --output text)
  verde "  ok    credenciales · cuenta $CUENTA"
  gris  "        $QUIEN"
  case "$QUIEN" in
    *":root") rojo "  AVISO: estas usando la cuenta RAIZ. Crea un usuario IAM." ;;
  esac
else
  rojo  "  falta configurar credenciales  ->  aws configure"
  faltan=1
fi

REGION="$(aws configure get region 2>/dev/null || true)"
if [[ -n "$REGION" ]]; then
  verde "  ok    region $REGION"
else
  rojo  "  falta region  ->  aws configure set region us-east-1"
  faltan=1
fi

# ── CloudFront: ¿esta verificada la cuenta? ──────────────────────────────────
# AWS bloquea CloudFront en cuentas nuevas hasta revisarlas a mano (es antiabuso)
# y solo se descubre AL CREAR la distribucion: la pila entera se cae a los ocho
# minutos. Se comprueba antes enviando una peticion que AWS siempre rechaza —el
# dominio de origen lleva espacios— para ver QUE error devuelve.
if [[ -n "${CREAR_CLOUDFRONT:-}" ]]; then
  gris "  usando CREAR_CLOUDFRONT=$CREAR_CLOUDFRONT del entorno"
elif [[ $faltan -ne 0 ]]; then
  CREAR_CLOUDFRONT="si"          # sin credenciales no se puede sondear
else
  SONDA="$(mktemp)"
  cat > "$SONDA" <<'JSON'
{
  "CallerReference": "sonda-verificacion-cloudfront",
  "Comment": "sonda", "Enabled": false,
  "Origins": {"Quantity": 1,
              "Items": [{"Id": "x", "DomainName": "dominio invalido con espacios"}]},
  "DefaultCacheBehavior": {"TargetOriginId": "x", "ViewerProtocolPolicy": "https-only",
                           "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6"}
}
JSON
  RESPUESTA_CF="$(aws cloudfront create-distribution \
                    --distribution-config "file://$(cygpath -m "$SONDA" 2>/dev/null || echo "$SONDA")" 2>&1 || true)"
  rm -f "$SONDA"

  if grep -q "must be verified" <<<"$RESPUESTA_CF"; then
    CREAR_CLOUDFRONT="no"
    rojo  "  aviso CloudFront esta bloqueado: AWS no ha verificado tu cuenta"
    gris  "        Se creara el resto (servidor, base de datos, expedientes) y"
    gris  "        la distribucion se anade luego, sin recrear nada."
    gris  "        Pidela en https://console.aws.amazon.com/support/home#/"
  else
    CREAR_CLOUDFRONT="si"
    verde "  ok    CloudFront disponible"
  fi
fi

[[ $faltan -eq 0 ]] || { echo; rojo "Faltan requisitos. Resuelvelos y vuelve a ejecutar."; exit 1; }

# ── ¿Ya existe? ─────────────────────────────────────────────────────────────
if aws cloudformation describe-stacks --stack-name "$PILA" >/dev/null 2>&1; then
  ESTADO=$(aws cloudformation describe-stacks --stack-name "$PILA" \
           --query 'Stacks[0].StackStatus' --output text)
  echo
  verde "La pila «$PILA» ya existe (estado: $ESTADO). No se crea de nuevo."
  echo
  aws cloudformation describe-stacks --stack-name "$PILA" \
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' --output table
  exit 0
fi

echo
echo "══ 2/6 · Red ═════════════════════════════════════════════════════════"

VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
      --query 'Vpcs[0].VpcId' --output text 2>/dev/null)
[[ "$VPC" != "None" && -n "$VPC" ]] || { rojo "  No hay VPC por defecto en $REGION. Créala en VPC -> Actions -> Create default VPC"; exit 1; }
verde "  ok    VPC $VPC"

# RDS exige dos subredes en zonas distintas; se toma una de cada zona.
mapfile -t SUBREDES < <(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC" \
  --query 'Subnets[*].[SubnetId,AvailabilityZone]' --output text \
  | sort -u -k2,2 | head -2 | cut -f1)
[[ ${#SUBREDES[@]} -ge 2 ]] || { rojo "  Hacen falta 2 subredes en zonas distintas; encontradas ${#SUBREDES[@]}"; exit 1; }
SUBRED_LISTA="${SUBREDES[0]},${SUBREDES[1]}"
verde "  ok    subredes $SUBRED_LISTA"

echo
echo "══ 3/6 · Acceso ══════════════════════════════════════════════════════"

CLAVE="${CLAVE_SSH_NOMBRE:-$PILA}"
if aws ec2 describe-key-pairs --key-names "$CLAVE" >/dev/null 2>&1; then
  verde "  ok    par de claves «$CLAVE» ya existe"
else
  gris  "  creando el par de claves «$CLAVE»..."
  aws ec2 create-key-pair --key-name "$CLAVE" \
    --query KeyMaterial --output text > "$RAIZ/$CLAVE.pem"
  chmod 600 "$RAIZ/$CLAVE.pem" 2>/dev/null || true

  # En Windows chmod no cambia nada: los permisos reales son las ACL de NTFS, y
  # OpenSSH rechaza la clave («UNPROTECTED PRIVATE KEY FILE») si otros usuarios
  # pueden leerla. Se quita la herencia y se deja solo lectura para el dueno.
  if command -v icacls >/dev/null 2>&1; then
    icacls "$(cygpath -w "$RAIZ/$CLAVE.pem" 2>/dev/null || echo "$RAIZ/$CLAVE.pem")" \
      /inheritance:r /grant:r "${USERNAME:-$USER}:(R)" >/dev/null 2>&1 \
      && gris "        permisos NTFS restringidos a tu usuario"
  fi

  verde "  ok    clave privada guardada en $RAIZ/$CLAVE.pem"
  rojo  "        GUARDALA. No se puede volver a descargar."
fi

MI_IP=$(curl -s --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')
[[ -n "$MI_IP" ]] || MI_IP="0.0.0.0"
ADMIN_CIDR="$MI_IP/32"
verde "  ok    SSH restringido a $ADMIN_CIDR"

echo
echo "══ 4/6 · Contraseña de la base de datos ══════════════════════════════"

if [[ -n "${CLAVE_BD:-}" ]]; then
  gris "  usando CLAVE_BD del entorno"
else
  # 24 caracteres alfanumericos: cumple el patron de la plantilla y no obliga
  # a escribir nada a mano.
  #
  # El limite va al principio, no al final. Con «</dev/urandom | head -c 24»,
  # head cierra la tuberia, tr muere con SIGPIPE y —por pipefail— el script
  # entero se cae aqui sin explicar nada. Asi se leen 256 bytes acotados (~62
  # alfanumericos de media) y recorta cut, que consume toda la entrada.
  CLAVE_BD=$(head -c 256 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-24)
  if [[ ${#CLAVE_BD} -lt 24 ]]; then
    rojo "  No se pudo generar la contrasena (salieron ${#CLAVE_BD} caracteres)."
    gris "  Pasala tu:  CLAVE_BD=loQueQuieras bash deploy/aws/crear-infraestructura.sh"
    exit 1
  fi
  echo "  generada: $CLAVE_BD"
  rojo  "  ANOTALA: la necesitaras para la cadena de conexion."
fi

echo
echo "══ 5/6 · Lo que se va a crear (y facturar) ═══════════════════════════"

# Validar antes de cobrar: un error de sintaxis descubierto aqui cuesta dos
# segundos; descubierto a mitad de la creacion cuesta doce minutos de espera.
if aws cloudformation validate-template \
     --template-body "file://$PLANTILLA" \
     >/dev/null 2>&1; then
  verde "  ok    la plantilla es valida"
else
  rojo  "  falla AWS rechaza la plantilla:"
  aws cloudformation validate-template \
    --template-body "file://$PLANTILLA" 2>&1 | tail -3
  exit 1
fi

if [[ "$CREAR_CLOUDFRONT" == "si" ]]; then
  LINEA_CDN="    S3 + CloudFront     frontend y expedientes         ~0,60"
else
  LINEA_CDN="    S3                  solo expedientes               ~0,10
    (CloudFront queda fuera: se anade cuando AWS verifique la cuenta)"
fi

cat <<COSTE

    EC2 t3.small        servidor de aplicaciones      ~15,18 USD/mes
    Disco EBS 20 GB     del servidor                   ~1,60
    RDS db.t4g.micro    PostgreSQL                    ~12,41
    Disco RDS 20 GB                                    ~2,30
$LINEA_CDN
    ==========================================================
    TOTAL                                          ~32 USD/mes  (S/ 120)

    Se factura desde la primera hora. Para dejar de pagar el computo:
        aws ec2 stop-instances --instance-ids <id>
        aws rds stop-db-instance --db-instance-identifier tesis-tdah-postgres

COSTE

read -rp "  ¿Crear la infraestructura? (escribe CREAR): " RESPUESTA
[[ "$RESPUESTA" == "CREAR" ]] || { echo "  cancelado, no se ha creado nada"; exit 0; }

echo
echo "══ 6/6 · Creando ═════════════════════════════════════════════════════"

# Se guarda el StackId (el ARN). Con --on-failure DELETE, una pila que falla
# se borra, y a partir de ese momento consultarla POR NOMBRE responde «does not
# exist»: el motivo del fallo queda oculto justo cuando hace falta. Por el ARN
# si se puede consultar el historial de una pila ya borrada.
ID_PILA=$(aws cloudformation create-stack \
  --stack-name "$PILA" \
  --template-body "file://$PLANTILLA" \
  --capabilities CAPABILITY_IAM \
  --on-failure DELETE \
  --parameters \
    ParameterKey=Proyecto,ParameterValue="$PILA" \
    ParameterKey=VpcId,ParameterValue="$VPC" \
    "ParameterKey=SubnetIds,ParameterValue=\"$SUBRED_LISTA\"" \
    ParameterKey=ClaveSSH,ParameterValue="$CLAVE" \
    ParameterKey=IpAdministracion,ParameterValue="$ADMIN_CIDR" \
    ParameterKey=ClaveBD,ParameterValue="$CLAVE_BD" \
    ParameterKey=CrearCloudFront,ParameterValue="$CREAR_CLOUDFRONT" \
  --query StackId --output text)
echo "  $ID_PILA"

echo
gris "  Creando... tarda 10-15 minutos, casi todo esperando a la base de datos."
gris "  Puedes seguirlo en la consola: CloudFormation -> $PILA -> Events"
echo

aws cloudformation wait stack-create-complete --stack-name "$ID_PILA" || {
  echo
  rojo "  La creacion fallo. Motivo real (el primero de la lista):"
  echo
  # «Resource creation cancelled» es ruido: son los recursos que AWS aborto al
  # ver que otro fallaba. El de verdad es el que trae un mensaje del servicio.
  aws cloudformation describe-stack-events --stack-name "$ID_PILA" \
    --query "reverse(StackEvents[?ResourceStatus=='CREATE_FAILED' && ResourceStatusReason!='Resource creation cancelled'].[LogicalResourceId,ResourceStatusReason])" \
    --output text
  echo
  gris "  La pila se borro sola (--on-failure DELETE): no queda nada facturando."
  gris "  Historial completo:"
  gris "    aws cloudformation describe-stack-events --stack-name $ID_PILA"
  exit 1
}

verde "  Infraestructura creada."
echo
aws cloudformation describe-stacks --stack-name "$PILA" \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' --output table

cat <<SIGUIENTE

  Siguientes pasos:

    1. Variables del servidor (por SSH):
         ssh -i $CLAVE.pem ec2-user@<IpServidor>
         sudo nano /opt/tesis/entorno.env
       DOCUMENTO_KEY y DOCUMENTO_PEPPER tienen que ser LAS MISMAS que en
       backend_fastapi/.env, o los documentos cifrados no se podran leer.

    2. Backend:
         export IP_SERVIDOR=<IpServidor>
         export CLAVE_SSH=$RAIZ/$CLAVE.pem
         bash deploy/aws/desplegar-backend.sh

    3. Datos de Neon a RDS:
         deploy/aws/migrar-neon-a-rds.sh  (se ejecuta DENTRO de la instancia)

    4. HTTPS en la API (ANTES del frontend, no despues):
         Crea un subdominio gratis en duckdns.org apuntando a la IP elastica,
         copialo a la instancia y ejecuta:
         sudo bash configurar-https.sh <subdominio> <tu correo>

       Va antes porque la URL de la API se compila dentro del JavaScript. Si
       compilas el frontend en http:// el navegador bloqueara las peticiones
       (contenido mixto) y habra que repetir el paso 5 entero.

    5. Frontend:
         export BUCKET_FRONTEND=<BucketFrontendNombre>
         export ID_DISTRIBUCION=<IdDistribucion>
         export VITE_API_URL=https://<subdominio>
         bash deploy/aws/desplegar-frontend.sh

SIGUIENTE

if [[ "$CREAR_CLOUDFRONT" == "no" ]]; then
  cat <<PENDIENTE
  ATENCION: el paso 5 todavia NO se puede hacer. La pila se creo sin el bucket
  del frontend ni la distribucion, porque AWS no ha verificado tu cuenta para
  CloudFront. Los pasos 1 a 4 funcionan con normalidad.

  Cuando el soporte te responda, comprueba y completa la pila:

      bash deploy/aws/anadir-cloudfront.sh

  Eso hace una ACTUALIZACION de la pila: anade solo lo que falta y no toca ni
  la instancia, ni la base de datos, ni los expedientes.

PENDIENTE
fi
