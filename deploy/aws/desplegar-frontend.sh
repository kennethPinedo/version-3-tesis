#!/usr/bin/env bash
# Publica la interfaz React en S3 y refresca la caché de CloudFront.
#
#     export BUCKET_FRONTEND=tesis-tdah-frontend-123456789012
#     export ID_DISTRIBUCION=E1ABCDEFGHIJKL
#     export VITE_API_URL=http://52.x.x.x      # SIN /api al final
#     bash deploy/aws/desplegar-frontend.sh

set -euo pipefail

BUCKET_FRONTEND="${BUCKET_FRONTEND:-}"
ID_DISTRIBUCION="${ID_DISTRIBUCION:-}"
VITE_API_URL="${VITE_API_URL:-}"

if [[ -z "$BUCKET_FRONTEND" || -z "$ID_DISTRIBUCION" || -z "$VITE_API_URL" ]]; then
  cat <<'AYUDA'
Faltan datos. Los tres salen de la pila de CloudFormation:

    export BUCKET_FRONTEND=...   # salida BucketFrontendNombre
    export ID_DISTRIBUCION=...   # salida IdDistribucion
    export VITE_API_URL=...      # salida UrlApi, SIN «/api» al final

AYUDA
  exit 1
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ/frontend"

if [[ "$VITE_API_URL" == */api ]]; then
  echo "ERROR: VITE_API_URL no debe terminar en «/api»."
  echo "   El cliente lo añade solo; con «/api» las peticiones irían a /api/api."
  echo "   Usa: ${VITE_API_URL%/api}"
  exit 1
fi

echo "── 1/4 · Compilando con la API de producción ─────────────────────────"
# Vite congela las variables VITE_* en el momento de compilar: no se pueden
# cambiar después sin volver a compilar.
echo "   VITE_API_URL=$VITE_API_URL"
VITE_API_URL="$VITE_API_URL" npm run build

echo
echo "── 2/4 · Comprobando que la URL quedó dentro del paquete ─────────────"
if grep -rq "$VITE_API_URL" dist/assets/*.js; then
  echo "   la URL de la API está incrustada correctamente"
else
  echo "   AVISO: no encuentro la URL en el paquete compilado."
  echo "   Revisa que el código lea import.meta.env.VITE_API_URL."
fi

echo
echo "── 3/4 · Subiendo a S3 ───────────────────────────────────────────────"
# Los archivos con huella en el nombre (assets/index-AbC123.js) se cachean un
# año; index.html nunca, porque es quien apunta a la versión nueva.
aws s3 sync dist/ "s3://$BUCKET_FRONTEND/" \
  --delete \
  --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp dist/index.html "s3://$BUCKET_FRONTEND/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8"

echo
echo "── 4/4 · Invalidando la caché de CloudFront ──────────────────────────"
# Sin esto, los usuarios seguirían viendo la versión anterior hasta que caduque.
INVALIDACION=$(aws cloudfront create-invalidation \
  --distribution-id "$ID_DISTRIBUCION" \
  --paths "/*" \
  --query 'Invalidation.Id' --output text)
echo "   invalidación $INVALIDACION en curso (tarda 1-3 minutos)"

DOMINIO=$(aws cloudfront get-distribution --id "$ID_DISTRIBUCION" \
  --query 'Distribution.DomainName' --output text)
echo
echo "   Aplicación publicada en: https://$DOMINIO"
echo
echo "   RECUERDA: ese dominio tiene que estar en CORS_ORIGINS del backend."
echo "   Si no, el navegador bloqueará todas las llamadas a la API."
