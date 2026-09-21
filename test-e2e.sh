#!/bin/bash
# Prueba E2E de Legado Vivo contra PostgreSQL local.
# Uso: ./test-e2e.sh   (requiere: postgres local, puerto 3101 libre)
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
PORT=3101
BASE="http://localhost:$PORT"
J1=/tmp/lvj1.txt; J2=/tmp/lvj2.txt
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1 -- $2"; }

# $1 desc, $2 expected code, $3 actual code
code_is() { [ "$2" = "$3" ] && ok "$1" || fail "$1" "esperado HTTP $2, fue $3"; }
contains() { # $1 desc, $2 file, $3 pattern
  grep -q "$3" "$2" && ok "$1" || fail "$1" "no se encontró: $3";
}

echo "== 1. Arranque y migraciones =="
export DATABASE_URL="postgres://legado:legado@localhost:5432/legadovivo_test"
export SESSION_SECRET="test-secret-local"
export APP_URL="http://localhost:$PORT"
export BRIDGE_API_KEY="test-bridge-key"
export UPLOAD_DIR="/tmp/lv-uploads-test"
export PORT=$PORT
mkdir -p "$UPLOAD_DIR"
(node server.js > /tmp/lv-server.log 2>&1 &) 
for i in $(seq 1 30); do curl -s -o /dev/null "$BASE/healthz" && break; sleep 1; done
curl -s "$BASE/healthz" | grep -q '"ok":true' && ok "healthz" || fail "healthz" "$(cat /tmp/lv-server.log | tail -5)"
grep -q "aplicada" /tmp/lv-server.log && ok "migraciones aplicadas" || fail "migraciones" "$(tail -5 /tmp/lv-server.log)"
# Idempotencia: correr migraciones de nuevo vía segundo arranque breve
node -e "
const {runMigrations}=require('./migrate');
runMigrations().then(()=>{console.log('MIGR2 OK');process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)});
" 2>&1 | grep -q "MIGR2 OK" && ok "migraciones idempotentes" || fail "migraciones idempotentes" "ver log"

echo "== 2. Registro y login =="
curl -s -c $J1 -o /dev/null -w "%{http_code}" --data-urlencode "name=Miguel" --data-urlencode "email=miguel@test.com" --data-urlencode "password=secreto1" "$BASE/register" > /tmp/lv-code
code_is "registro usuario 1" "302" "$(cat /tmp/lv-code)"
curl -s -b $J1 "$BASE/dashboard" > /tmp/lv-dash.html
code_is "dashboard con sesión" "200" "$(curl -s -o /dev/null -w "%{http_code}" -b $J1 "$BASE/dashboard")"
contains "dashboard muestra título" /tmp/lv-dash.html "Mis familias"
# login con credencial mala
code_is "login rechazado con clave mala" "200" "$(curl -s -o /dev/null -w "%{http_code}" --data-urlencode "email=miguel@test.com" --data-urlencode "password=mala" "$BASE/login")"

echo "== 3. Familia e invitación =="
LOC=$(curl -s -c $J1 -b $J1 -o /dev/null -D - --data-urlencode "name=Familia Test" --data-urlencode "description=Prueba" "$BASE/families" | grep -i "^location:" | tr -d '\r' | awk '{print $2}')
FID=$(echo "$LOC" | grep -o '[0-9]*$')
[ -n "$FID" ] && ok "familia creada (id=$FID)" || fail "familia creada" "location=$LOC"
code_is "ver familia" "200" "$(curl -s -o /dev/null -w "%{http_code}" -b $J1 "$BASE/families/$FID")"
curl -s -b $J1 -o /dev/null --data-urlencode "role=collaborator" "$BASE/families/$FID/invites"
curl -s -b $J1 "$BASE/families/$FID/invites" > /tmp/lv-inv.html
CODE=$(grep -o 'LV-[A-F0-9]\{8\}' /tmp/lv-inv.html | head -1)
[ -n "$CODE" ] && ok "código de invitación generado ($CODE)" || fail "código invitación" "no encontrado"
contains "mensaje WhatsApp trae APP_URL" /tmp/lv-inv.html "http://localhost:$PORT"
contains "mensaje WhatsApp trae el código" /tmp/lv-inv.html "$CODE"

echo "== 4. Segundo usuario se une con el código =="
curl -s -c $J2 -o /dev/null --data-urlencode "name=Familiar" --data-urlencode "email=familiar@test.com" --data-urlencode "password=secreto2" "$BASE/register"
code_is "página /join pública con código" "200" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE/join?code=$CODE")"
LOC2=$(curl -s -b $J2 -c $J2 -o /dev/null -D - --data-urlencode "code=$CODE" "$BASE/join/accept" | grep -i "^location:" | tr -d '\r' | awk '{print $2}')
echo "$LOC2" | grep -q "/families/$FID" && ok "invitación aceptada" || fail "invitación aceptada" "location=$LOC2"
# código de un solo uso
code_is "código ya usado muestra aviso (200)" "200" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE/join?code=$CODE")"
curl -s "$BASE/join?code=$CODE" | grep -q "ya fue usado" && ok "aviso de código usado" || fail "aviso código usado" "sin mensaje"

echo "== 5. Personas =="
curl -s -b $J1 -o /dev/null --data-urlencode "name=Abuela Rosa" --data-urlencode "relationship=Abuela" --data-urlencode "notes=Notas" "$BASE/families/$FID/persons"
curl -s -b $J1 "$BASE/families/$FID/persons" > /tmp/lv-per.html
contains "persona creada" /tmp/lv-per.html "Abuela Rosa"
PID=$(grep -o 'persons/[0-9]*' /tmp/lv-per.html | head -1 | grep -o '[0-9]*$')
# eliminar con nombre incorrecto falla
curl -s -b $J1 -o /dev/null --data-urlencode "confirmName=Otro" "$BASE/families/$FID/persons/$PID/delete"
curl -s -b $J1 "$BASE/families/$FID/persons" | grep -q "Abuela Rosa" && ok "borrado con nombre incorrecto no borra" || fail "confirmación borrado" "se borró sin confirmar"

echo "== 6. Recuerdos (foto + fechas) =="
python3 -c "
import zlib, struct
def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
ihdr = struct.pack('>IIBBBBB', 16, 16, 8, 2, 0, 0, 0)
raw = b''.join(b'\x00' + b'\xc8\x32\x1e' * 16 for _ in range(16))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
open('/tmp/lv-foto.png','wb').write(png)
print('png ok')
"
MID1_LOC=$(curl -s -b $J1 -D - -o /dev/null -F "title=Recuerdo nuevo" -F "story=Historia de hoy" -F "memory_date=2024-05-01" -F "date_precision=exact" -F "place=Lima" -F "person_ids=$PID" -F "photo=@/tmp/lv-foto.png;type=image/png" "$BASE/families/$FID/memories" | grep -i "^location:" | tr -d '\r' | awk '{print $2}')
MID1=$(echo "$MID1_LOC" | grep -o '[0-9]*$')
[ -n "$MID1" ] && ok "recuerdo con foto creado (id=$MID1)" || fail "recuerdo con foto" "location=$MID1_LOC"
MID2_LOC=$(curl -s -b $J1 -D - -o /dev/null -F "title=Recuerdo antiguo" -F "story=Historia de 1985" -F "memory_date=1985-06-12" -F "date_precision=approx" "$BASE/families/$FID/memories" | grep -i "^location:" | tr -d '\r' | awk '{print $2}')
MID2=$(echo "$MID2_LOC" | grep -o '[0-9]*$')
[ -n "$MID2" ] && ok "recuerdo antiguo creado (id=$MID2)" || fail "recuerdo antiguo" "location=$MID2_LOC"
curl -s -b $J1 "$BASE/families/$FID/memories/timeline/view" > /tmp/lv-tl.html
P_ANT=$(grep -b -o "Recuerdo antiguo" /tmp/lv-tl.html | head -1 | cut -d: -f1)
P_NEW=$(grep -b -o "Recuerdo nuevo" /tmp/lv-tl.html | head -1 | cut -d: -f1)
[ -n "$P_ANT" ] && [ -n "$P_NEW" ] && [ "$P_ANT" -lt "$P_NEW" ] && ok "cronología ordena por fecha del recuerdo" || fail "orden cronológico" "ant=$P_ANT nuevo=$P_NEW"
# edición guarda versión (el formulario real envía person_ids con los vinculados marcados)
curl -s -b $J1 -o /dev/null -F "title=Recuerdo nuevo editado" -F "story=Historia editada" -F "person_ids=$PID" "$BASE/families/$FID/memories/$MID1"
curl -s -b $J1 "$BASE/families/$FID/memories/$MID1" > /tmp/lv-mem.html
contains "edición guarda versión" /tmp/lv-mem.html "Historial de versiones"

echo "== 7. Taller: álbum PDF =="
AL_LOC=$(curl -s -b $J1 -D - -o /dev/null --data-urlencode "title=Álbum de prueba" --data-urlencode "memory_ids=$MID1" --data-urlencode "memory_ids=$MID2" "$BASE/families/$FID/workshop" | grep -i "^location:" | tr -d '\r' | awk '{print $2}')
AID=$(echo "$AL_LOC" | grep -o '[0-9]*$')
[ -n "$AID" ] && ok "álbum creado (id=$AID)" || fail "álbum" "location=$AL_LOC"
curl -s -b $J1 -D /tmp/lv-pdf.hdr -o /tmp/lv-album.pdf "$BASE/families/$FID/workshop/$AID/download"
grep -qi "application/pdf" /tmp/lv-pdf.hdr && ok "descarga con content-type PDF" || fail "content-type PDF" "$(head -3 /tmp/lv-pdf.hdr)"
head -c 4 /tmp/lv-pdf.pdf 2>/dev/null; head -c 4 /tmp/lv-album.pdf | grep -q "%PDF" && ok "archivo es un PDF válido" || fail "PDF válido" "$(head -c 20 /tmp/lv-album.pdf | od -c | head -1)"
[ $(stat -c%s /tmp/lv-album.pdf) -gt 2000 ] && ok "PDF con contenido ($(stat -c%s /tmp/lv-album.pdf) bytes)" || fail "tamaño PDF" "muy pequeño"

echo "== 8. Puente del asistente =="
code_is "puente sin clave → 401" "401" "$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{"draftId":"x"}' "$BASE/api/bridge/drafts")"
code_is "puente sin familyId → 400" "400" "$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "x-bridge-key: test-bridge-key" -H "Content-Type: application/json" -d '{"draftId":"wa-1"}' "$BASE/api/bridge/drafts")"
BR=$(curl -s -X POST -H "x-bridge-key: test-bridge-key" -H "Content-Type: application/json" -d '{"draftId":"wa-1","familyId":'"$FID"',"title":"Del puente","text":"Relato del asistente","people":["Abuela Rosa","Tío Nuevo"],"date":"1990-01-01","datePrecision":"approx"}' "$BASE/api/bridge/drafts")
echo "$BR" | grep -q '"ok":true' && ok "borrador del puente creado" || fail "puente" "$BR"
BRMID=$(echo "$BR" | grep -o '"memoryId":[0-9]*' | grep -o '[0-9]*')
BR2=$(curl -s -X POST -H "x-bridge-key: test-bridge-key" -H "Content-Type: application/json" -d '{"draftId":"wa-1","familyId":'"$FID"'}' "$BASE/api/bridge/drafts")
echo "$BR2" | grep -q '"duplicate":true' && ok "puente idempotente (no duplica)" || fail "idempotencia puente" "$BR2"
curl -s -b $J1 "$BASE/families/$FID/memories?status=pending" | grep -q "Del puente" && ok "borrador visible como pendiente" || fail "pendiente visible" "no aparece"

echo "== 9. Búsqueda e historias sin IA =="
code_is "búsqueda por palabras" "200" "$(curl -s -o /dev/null -w "%{http_code}" -b $J1 "$BASE/families/$FID/search?q=Rosa")"
curl -s -b $J1 "$BASE/families/$FID/search?q=Rosa" | grep -q "Recuerdo nuevo editado" && ok "búsqueda encuentra el recuerdo" || fail "búsqueda" "sin resultados"
curl -s -b $J1 "$BASE/families/$FID/stories/new" | grep -q "no disponible" && ok "aviso sin OPENAI_API_KEY" || fail "aviso IA" "no aparece"

echo "== 10. Idioma y cuenta =="
curl -s -b $J1 -o /dev/null -w "%{http_code}" --data-urlencode "lang=en" "$BASE/lang" > /tmp/lv-code
curl -s -b $J1 "$BASE/dashboard" | grep -q "My families" && ok "cambio a inglés" || fail "cambio idioma" "sigue en español"
curl -s -b $J1 -o /dev/null --data-urlencode "lang=es" "$BASE/lang" > /dev/null

echo "== 11. Limpieza: borrados con confirmación =="
curl -s -b $J1 -o /dev/null --data-urlencode "confirmName=Abuela Rosa" "$BASE/families/$FID/persons/$PID/delete"
curl -s -b $J1 "$BASE/families/$FID/persons" | grep -q "Abuela Rosa" && fail "borrar persona" "sigue ahí" || ok "persona borrada con confirmación"
curl -s -b $J1 -o /dev/null "$BASE/families/$FID/workshop/$AID/delete"
code_is "álbum borrado" "200" "$(curl -s -o /dev/null -w "%{http_code}" -b $J1 "$BASE/families/$FID/workshop")"
# lector no puede crear recuerdos (403)
curl -s -b $J1 -o /dev/null --data-urlencode "role=reader" "$BASE/families/$FID/invites"
CODE2=$(curl -s -b $J1 "$BASE/families/$FID/invites" | grep -o 'LV-[A-F0-9]\{8\}' | head -1)
curl -s -c /tmp/lvj3.txt -o /dev/null --data-urlencode "name=Lector" --data-urlencode "email=lector@test.com" --data-urlencode "password=secreto3" "$BASE/register" > /dev/null
curl -s -b /tmp/lvj3.txt -c /tmp/lvj3.txt -o /dev/null --data-urlencode "code=$CODE2" "$BASE/join/accept" > /dev/null
code_is "lector no puede crear recuerdos" "403" "$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/lvj3.txt -F "title=X" "$BASE/families/$FID/memories")"
code_is "lector sí puede ver la familia" "200" "$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/lvj3.txt "$BASE/families/$FID")"

echo "== 12. Subidas protegidas y familias huérfanas =="
PHOTO_URL=$(curl -s -b $J1 "$BASE/families/$FID/memories/$MID1" | grep -o '/uploads/[^"]*' | head -1)
[ -n "$PHOTO_URL" ] && ok "foto del recuerdo localizada ($PHOTO_URL)" || fail "foto localizada" "sin URL"
code_is "miembro ve la foto" "200" "$(curl -s -o /dev/null -w "%{http_code}" -b $J1 "$BASE$PHOTO_URL")"
code_is "sin sesión la foto redirige a login" "302" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE$PHOTO_URL")"
curl -s -c /tmp/lvj4.txt -o /dev/null --data-urlencode "name=Extraño" --data-urlencode "email=extrano@test.com" --data-urlencode "password=secreto4" "$BASE/register" > /dev/null
code_is "no miembro recibe 403 en la foto" "403" "$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/lvj4.txt "$BASE$PHOTO_URL")"
# familia de un único miembro: al borrar la cuenta, la familia desaparece (no queda huérfana)
curl -s -c /tmp/lvj5.txt -o /dev/null --data-urlencode "name=Huerfano" --data-urlencode "email=huerfano@test.com" --data-urlencode "password=secreto5" "$BASE/register" > /dev/null
LOC5=$(curl -s -b /tmp/lvj5.txt -c /tmp/lvj5.txt -o /dev/null -D - --data-urlencode "name=Familia Sola" "$BASE/families" | grep -i "^location:" | tr -d '\r' | awk '{print $2}')
FID5=$(echo "$LOC5" | grep -o '[0-9]*$')
curl -s -b /tmp/lvj5.txt -c /tmp/lvj5.txt -o /dev/null --data-urlencode "confirmName=Huerfano" "$BASE/account/delete" > /dev/null
code_is "familia de miembro único se elimina con la cuenta" "404" "$(curl -s -o /dev/null -w "%{http_code}" -b $J1 "$BASE/families/$FID5")"

echo ""
echo "RESULTADO: $PASS pasadas, $FAIL fallidas"
# detener servidor
pkill -f "node server.js" 2>/dev/null
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
