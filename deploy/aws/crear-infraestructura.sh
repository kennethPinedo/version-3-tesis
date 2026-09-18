#!/usr/bin/env bash
# Crea toda la infraestructura de AWS en un solo paso.
#
#     bash deploy/aws/crear-infraestructura.sh
#
# Comprueba los requisitos, descubre la red por su cuenta, muestra lo que se va
# a facturar y pide confirmacion ANTES de crear nada. Es idempotente: si la pila
# ya existe, lo dice y no la duplica.

set -euo pipefail

PILA="${PILA:-tesis-tdah}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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
  CLAVE_BD=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)
  echo "  generada: $CLAVE_BD"
  rojo  "  ANOTALA: la necesitaras para la cadena de conexion."
fi

echo
echo "══ 5/6 · Lo que se va a crear (y facturar) ═══════════════════════════"
cat <<'COSTE'

    EC2 t3.small        servidor de aplicaciones      ~15,18 USD/mes
    Disco EBS 20 GB     del servidor                   ~1,60
    RDS db.t4g.micro    PostgreSQL                    ~12,41
    Disco RDS 20 GB                                    ~2,30
    S3 + CloudFront     frontend y expedientes         ~0,60
    ──────────────────────────────────────────────────────────
    TOTAL                                          ~32 USD/mes  (S/ 120)

    Se factura desde la primera hora. Para dejar de pagar el computo:
        aws ec2 stop-instances --instance-ids <id>
        aws rds stop-db-instance --db-instance-identifier tesis-tdah-postgres

COSTE

read -rp "  ¿Crear la infraestructura? (escribe CREAR): " RESPUESTA
[[ "$RESPUESTA" == "CREAR" ]] || { echo "  cancelado, no se ha creado nada"; exit 0; }

echo
echo "══ 6/6 · Creando ═════════════════════════════════════════════════════"

aws cloudformation create-stack \
  --stack-name "$PILA" \
  --template-body "file://$RAIZ/deploy/aws/infraestructura.yaml" \
  --capabilities CAPABILITY_IAM \
  --on-failure DELETE \
  --parameters \
    ParameterKey=Proyecto,ParameterValue="$PILA" \
    ParameterKey=VpcId,ParameterValue="$VPC" \
    "ParameterKey=SubnetIds,ParameterValue=\"$SUBRED_LISTA\"" \
    ParameterKey=ClaveSSH,ParameterValue="$CLAVE" \
    ParameterKey=IpAdministracion,ParameterValue="$ADMIN_CIDR" \
    ParameterKey=ClaveBD,ParameterValue="$CLAVE_BD" \
  --query StackId --output text

echo
gris "  Creando... tarda 10-15 minutos, casi todo esperando a la base de datos."
gris "  Puedes seguirlo en la consola: CloudFormation -> $PILA -> Events"
echo

aws cloudformation wait stack-create-complete --stack-name "$PILA" || {
  rojo "  La creacion fallo. Motivo:"
  aws cloudformation describe-stack-events --stack-name "$PILA" \
    --query "StackEvents[?ResourceStatus=='CREATE_FAILED'].[LogicalResourceId,ResourceStatusReason]" \
    --output table
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

    4. Frontend:
         export BUCKET_FRONTEND=<BucketFrontendNombre>
         export ID_DISTRIBUCION=<IdDistribucion>
         export VITE_API_URL=http://<IpServidor>
         bash deploy/aws/desplegar-frontend.sh

SIGUIENTE
