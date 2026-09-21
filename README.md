# Legado Vivo 🌳

**El archivo familiar que crece con el tiempo / The family archive that grows over time.**

Aplicación web multiusuario lista para desplegar en Railway con su propia URL pública.
Cada familiar abre el enlace, crea su cuenta y colabora: fotos, audios y relatos se
convierten en historias verificables y álbumes PDF por temas.

> **Regla permanente:** la documentación vive con el código. Cada cambio en la app
> debe actualizar este README.

---

## ES — Manual

### 1. Qué es

Legado Vivo es el archivo privado de tu familia:

- **Familias y roles**: crea varias familias; cada una con administrador, colaboradores y lectores.
- **Recuerdos**: foto y/o audio, relato, transcripción, personas, lugar, fecha (exacta o aproximada)
  y entrevista guiada. Estados: completo o *pendiente de completar*.
- **Cronología**: ordenada por la fecha del recuerdo, no por la fecha de subida.
- **Historias**: genera texto con IA (OpenAI, opcional) citando sus fuentes, o escríbelas manualmente.
- **Taller**: selecciona recuerdos y genera álbumes PDF por tema (cumpleaños, Navidad, viajes…).
  Cada álbum es una *edición*: cuando agregues recuerdos, crea una nueva edición.
- **Búsqueda**: por palabras clave, o conversacional con IA si hay clave configurada.
- **Asistente por WhatsApp**: manda foto + relato al número del asistente y el borrador entra
  al archivo como *pendiente de completar*.
- **Bilingüe** español/inglés con selector.

### 2. Despliegue en Railway (paso a paso, como para novato)

1. **Sube el código a GitHub.** Crea un repositorio nuevo (p. ej. `legado-vivo`) y sube todos
   los archivos de este ZIP a la raíz (GitHub web: *Add file → Upload files*).
2. **Crea el proyecto en Railway.** Entra a [railway.app](https://railway.app) → *New Project →
   Deploy from GitHub repo* → elige tu repositorio.
3. **Agrega PostgreSQL.** En el proyecto: *New → Database → Add PostgreSQL*. Railway crea
   automáticamente la variable `DATABASE_URL`.
4. **Agrega un Volume para las fotos.** En tu servicio: *Settings → Volumes → New Volume*,
   punto de montaje `/data/uploads`. (Sin esto, las fotos se pierden en cada despliegue.)
5. **Configura las variables** (*Variables* del servicio):
   | Variable | Ejemplo | Para qué |
   |---|---|---|
   | `APP_URL` | `https://legado-vivo.up.railway.app` | Enlace público que llevan las invitaciones de WhatsApp |
   | `SESSION_SECRET` | *(genera uno largo y único)* | Firma de las sesiones |
   | `BRIDGE_API_KEY` | *(genera una larga y única)* | Clave del puente con el Asistente |
   | `UPLOAD_DIR` | `/data/uploads` | Carpeta del Volume |
   | `OPENAI_API_KEY` | *(opcional)* | Historias y búsqueda conversacional |
   | `NODE_ENV` | `production` | Cookies seguras |
6. **Genera el dominio.** *Settings → Networking → Generate Domain*. Esa es tu `APP_URL`.
7. **Despliega.** Railway instala dependencias (`npm install`), arranca con `npm start`
   y ejecuta las migraciones automáticamente. Abre la URL y crea tu cuenta.

### 3. Invitar por WhatsApp

1. Entra a tu familia → pestaña **Invitaciones** → elige el rol → **Generar invitación**.
2. Copia el mensaje (o pulsa *Abrir en WhatsApp*) y envíalo a tu familiar.
3. El familiar toca el enlace, crea su cuenta, elige **Unirme con un código** e ingresa el código.
4. Los códigos vencen en 7 días y son de un solo uso; puedes revocarlos.

### 4. Conectar el Asistente Puente

El asistente (el bot de WhatsApp en Render) envía los borradores a:

```
POST https://TU-APP-RAILWAY/api/bridge/drafts
Header: x-bridge-key: <tu BRIDGE_API_KEY>
Content-Type: application/json
```

Ejemplo de cuerpo:

```json
{
  "draftId": "wa-987654321",
  "familyId": 1,
  "title": "La casa de la abuela",
  "text": "Esta foto es de 1985...",
  "transcription": "Texto transcrito del audio...",
  "people": ["Mamá", "Tío Juan"],
  "date": "1985-06-12",
  "datePrecision": "approx",
  "place": "Lima",
  "photoBase64": "<base64 opcional>",
  "photoFilename": "foto.jpg"
}
```

El borrador se crea como recuerdo **pendiente de completar** (sin duplicar si el `draftId`
ya existe). Luego lo completas en la app.

### 5. Desarrollo local

```bash
cp .env.example .env   # y edítalo
npm install
npm start              # http://localhost:3000
```

Necesitas PostgreSQL local con la base creada (`DATABASE_URL`).

---

## EN — Manual

### 1. What it is

Legado Vivo is your family's private archive:

- **Families & roles**: create several families; each with admin, collaborators and readers.
- **Memories**: photo and/or audio, story, transcription, people, place, date (exact or
  approximate) and a guided interview. Status: complete or *pending completion*.
- **Timeline**: ordered by the memory's date, not the upload date.
- **Stories**: AI-generate text (OpenAI, optional) with cited sources, or write manually.
- **Workshop**: pick memories and build themed PDF albums (birthdays, Christmas, trips…).
  Each album is an *edition*: when you add memories, create a new edition.
- **Search**: keyword search, or conversational AI search when a key is set.
- **WhatsApp assistant**: send a photo + story to the assistant's number and the draft
  enters the archive as *pending completion*.
- **Bilingual** Spanish/English with a language switcher.

### 2. Deploy to Railway (step by step)

1. **Push the code to GitHub.** Create a repo (e.g. `legado-vivo`) and upload every file
   from this ZIP to the root (*Add file → Upload files*).
2. **Create the Railway project.** Go to [railway.app](https://railway.app) → *New Project →
   Deploy from GitHub repo* → pick your repo.
3. **Add PostgreSQL.** In the project: *New → Database → Add PostgreSQL*. Railway injects
   `DATABASE_URL` automatically.
4. **Add a Volume for uploads.** In your service: *Settings → Volumes → New Volume*,
   mount path `/data/uploads`. (Without it, photos are lost on every deploy.)
5. **Set the variables** (service *Variables*):
   | Variable | Example | Purpose |
   |---|---|---|
   | `APP_URL` | `https://legado-vivo.up.railway.app` | Public link inside WhatsApp invitations |
   | `SESSION_SECRET` | *(generate a long unique one)* | Session signing |
   | `BRIDGE_API_KEY` | *(generate a long unique one)* | Assistant bridge key |
   | `UPLOAD_DIR` | `/data/uploads` | Volume folder |
   | `OPENAI_API_KEY` | *(optional)* | Stories + conversational search |
   | `NODE_ENV` | `production` | Secure cookies |
6. **Generate the domain.** *Settings → Networking → Generate Domain*. That's your `APP_URL`.
7. **Deploy.** Railway runs `npm install`, starts with `npm start` and applies
   migrations automatically. Open the URL and create your account.

### 3. Invite via WhatsApp

1. Open your family → **Invitations** tab → pick a role → **Generate invitation**.
2. Copy the message (or tap *Open in WhatsApp*) and send it to your relative.
3. They tap the link, create their account, choose **Join with a code** and enter the code.
4. Codes expire in 7 days and are single-use; you can revoke them.

### 4. Connect the Asistente Puente

The assistant (the WhatsApp bot on Render) sends drafts to:

```
POST https://YOUR-RAILWAY-APP/api/bridge/drafts
Header: x-bridge-key: <your BRIDGE_API_KEY>
Content-Type: application/json
```

Body example:

```json
{
  "draftId": "wa-987654321",
  "familyId": 1,
  "title": "Grandma's house",
  "text": "This photo is from 1985...",
  "transcription": "Transcribed audio text...",
  "people": ["Mom", "Uncle Juan"],
  "date": "1985-06-12",
  "datePrecision": "approx",
  "place": "Lima",
  "photoBase64": "<optional base64>",
  "photoFilename": "photo.jpg"
}
```

The draft becomes a **pending completion** memory (no duplicates when `draftId` exists).
Then finish it in the app.

### 5. Local development

```bash
cp .env.example .env   # then edit it
npm install
npm start              # http://localhost:3000
```

You need a local PostgreSQL with the database created (`DATABASE_URL`).

---

## Estructura / Structure (flat ZIP)

Todos los archivos van en la raíz del repo (ZIP plano, listo para *Upload files* de GitHub web).
*All files go at the repo root (flat ZIP, ready for GitHub web's Upload files).*

| Archivo | Qué es |
|---|---|
| `server.js` | Arranque: migraciones, sesiones, i18n, rutas / *Boot: migrations, sessions, i18n, routes* |
| `db.js` / `migrate.js` / `migration-001.sql` | PostgreSQL + migraciones idempotentes |
| `i18n.js` / `locale-es.json` / `locale-en.json` | Bilingüe es/en |
| `mw.js` | Auth y permisos / *Auth & permissions* |
| `ai.js` | OpenAI opcional (historias, búsqueda) |
| `pdfgen.js` | Álbumes PDF con pdfkit |
| `routes-*.js` | Rutas: auth, familias, personas, recuerdos, historias, taller, búsqueda, puente, cuenta |
| `view-*.ejs` | Vistas / *Views* (layout + páginas) |
| `assets-style.css` / `assets-app.js` | Estilos y JS mínimo |
| `Procfile` / `railway.json` | Despliegue / *Deploy* |

## Notas / Notes

- Sin `OPENAI_API_KEY`, las historias y la búsqueda conversacional muestran un aviso y la
  app sigue funcionando (búsqueda por palabras clave). / *Without `OPENAI_API_KEY`, stories
  and conversational search show a notice and the app keeps working (keyword search).*
- Las fotos se guardan en `UPLOAD_DIR` con nombres aleatorios y solo las puede ver un
  miembro de la familia del recuerdo (ruta `/uploads/:name` con sesión y membresía). /
  *Uploads go to `UPLOAD_DIR` with random names and only a member of the memory's family
  can view them (the `/uploads/:name` route checks session + membership).*
- `/join` es público (el invitado aún no tiene cuenta); `/api/bridge/drafts` se protege
  con el header `x-bridge-key`. El resto exige sesión. / *`/join` is public (the guest has
  no account yet); `/api/bridge/drafts` is protected by the `x-bridge-key` header.
  Everything else requires sign-in.*
- La búsqueda por palabras también encuentra recuerdos por el nombre de sus personas
  vinculadas. / *Keyword search also finds memories by their linked people's names.*
- Al eliminar tu cuenta, las familias donde eras el único miembro se eliminan con todo
  su contenido (no quedan huérfanas); si eras el único administrador de una familia con
  más miembros, el más antiguo es promovido. / *Deleting your account removes families
  where you were the sole member (no orphans); if you were the only admin of a larger
  family, the oldest member is promoted.*
- Versión 1.2.0 — 2026-09-21. Incluye corrección de Cronología, manejo seguro de
  errores `async` con Express 5, validación de archivos, cabeceras de seguridad y
  healthcheck de PostgreSQL. / *Version 1.2.0 — 2026-09-21. Includes the Timeline
  route fix, safe async error handling with Express 5, file validation, security
  headers, and a PostgreSQL-aware healthcheck.*
