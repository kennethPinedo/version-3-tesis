#!/usr/bin/env bash
# Anade el frontend (bucket de S3 + distribucion de CloudFront) a una pila que
# se creo sin ellos.
#
#     bash deploy/aws/anadir-cloudfront.sh
#
# Se usa cuando la pila se creo con CrearCloudFront=no porque AWS todavia no
# habia verificado la cuenta. Hace una ACTUALIZACION: anade los cuatro recursos
# que faltan y no toca la instancia, la base de datos ni los expedientes.

set -euo pipefail

export AWS_CLI_FILE_ENCODING=UTF-8

PILA="${PILA:-tesis-tdah}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PLANTILLA="$RAIZ/deploy/aws/infraestructura.yaml"
if command -v cygpath >/dev/null 2>&1; then
  PLANTILLA="$(cygpath -m "$PLANTILLA")"
fi

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }

echo
echo "== 1/4 - Comprobaciones ============================================="

if ! aws cloudformation describe-stacks --stack-name "$PILA" >/dev/null 2>&1; then
  rojo "  falla La pila \"$PILA\" no existe. Crea la infraestructura primero:"
  gris "          bash deploy/aws/crear-infraestructura.sh"
  exit 1
fi
verde "  ok    la pila \"$PILA\" existe"

ACTUAL=$(aws cloudformation describe-stacks --stack-name "$PILA" \
  --query "Stacks[0].Parameters[?ParameterKey=='CrearCloudFront'].ParameterValue" \
  --output text)
if [[ "$ACTUAL" == "si" ]]; then
  verde "  ok    la pila ya incluye CloudFront: no hay nada que anadir"
  aws cloudformation describe-stacks --stack-name "$PILA" \
    --query 'Stacks[0].Outputs[?OutputKey==`UrlAplicacion` || OutputKey==`IdDistribucion`].[OutputKey,OutputValue]' \
    --output table
  exit 0
fi

echo
echo "== 2/4 - Verificacion de CloudFront ================================="

# Misma sonda que en crear-infraestructura.sh: una peticion que AWS siempre
# rechaza, para leer QUE error devuelve sin crear nada.
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
RESPUESTA="$(aws cloudfront create-distribution \
  --distribution-config "file://$(cygpath -m "$SONDA" 2>/dev/null || echo "$SONDA")" 2>&1 || true)"
rm -f "$SONDA"

if grep -q "must be verified" <<<"$RESPUESTA"; then
  rojo "  falla AWS sigue sin verificar tu cuenta para CloudFront."
  gris "        Abre o reabre el caso en:"
  gris "          https://console.aws.amazon.com/support/home#/"
  gris "        Categoria \"Account and billing\" (gratis), servicio Account."
  exit 1
fi
verde "  ok    CloudFront ya esta disponible"

echo
echo "== 3/4 - Actualizando la pila ======================================="
gris "  Se anaden 4 recursos: bucket del frontend, su politica, el control de"
gris "  acceso de origen y la distribucion. Nada existente se recrea."
echo

# Los demas parametros se dejan como estan: UsePreviousValue evita tener que
# volver a escribir la contrasena de la base de datos, que no se puede leer.
PARAMS=()
while read -r CLAVE; do
  [[ -z "$CLAVE" || "$CLAVE" == "CrearCloudFront" ]] && continue
  PARAMS+=("ParameterKey=$CLAVE,UsePreviousValue=true")
done < <(aws cloudformation describe-stacks --stack-name "$PILA" \
           --query 'Stacks[0].Parameters[*].ParameterKey' --output text | tr '\t' '\n')
PARAMS+=("ParameterKey=CrearCloudFront,ParameterValue=si")

aws cloudformation update-stack \
  --stack-name "$PILA" \
  --template-body "file://$PLANTILLA" \
  --capabilities CAPABILITY_IAM \
  --parameters "${PARAMS[@]}" \
  --query StackId --output text

echo
gris "  Creando la distribucion... CloudFront tarda 5-10 minutos en propagarse."
echo

aws cloudformation wait stack-update-complete --stack-name "$PILA" || {
  echo
  rojo "  La actualizacion fallo. Motivo:"
  aws cloudformation describe-stack-events --stack-name "$PILA" \
    --query "reverse(StackEvents[?ResourceStatus=='CREATE_FAILED' || ResourceStatus=='UPDATE_FAILED'].[LogicalResourceId,ResourceStatusReason])" \
    --output text | head -6
  echo
  gris "  La pila vuelve sola a su estado anterior: lo que ya funcionaba sigue en pie."
  exit 1
}

echo
echo "== 4/4 - Listo ======================================================"
verde "  CloudFront anadido."
echo
aws cloudformation describe-stacks --stack-name "$PILA" \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' --output table

SUB="${VITE_API_URL:-https://<tu subdominio>}"
cat <<SIGUIENTE

  Ya puedes publicar la interfaz:

      export BUCKET_FRONTEND=<BucketFrontendNombre>
      export ID_DISTRIBUCION=<IdDistribucion>
      export VITE_API_URL=$SUB
      bash deploy/aws/desplegar-frontend.sh

  Y anade el dominio de CloudFront a CORS_ORIGINS del backend:

      sudo nano /opt/tesis/entorno.env
      cd /opt/tesis && sudo docker compose up -d --force-recreate api

SIGUIENTE
