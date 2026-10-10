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
- **Recuerdos**: fotos (hasta 10 por recuerdo, con selección múltiple, arrastrar y soltar y vista previa antes de
  guardar; también puedes pegar varias a la vez), video (máx. 200 MB) y/o audio (máx. 100 MB), relato, transcripción,
  personas, lugar, fecha (exacta o aproximada) y entrevista guiada. La subida muestra barra de progreso y avisa el
  motivo si falla. Estados: completo o *pendiente de completar*.
  Formatos aceptados: imágenes (jpg, png, gif, webp, heic/heif, avif, raw…), videos (mp4, mov, avi, mkv, webm, 3gp, mts…)
  y audios (mp3, wav, m4a, aac, ogg, flac…). En la biblioteca, los recuerdos con video muestran una miniatura
  (primer cuadro) con insignia ▶; el video se reproduce en la página del recuerdo. Las fotos del recuerdo se muestran
  como galería y al editar puedes quitar las que quieras.
  **Editor artístico** (botón 🎨 en la página del recuerdo): aplica a cualquier foto los estilos **carboncillo, pop art,
  caricatura o acuarela** con filtros reales de canvas (grises + contraste + grano, posterizar + saturación, bordes
  marcados, suavizado + papel); todo se procesa en tu navegador, sin APIs externas, y la versión estilizada se guarda
  como una foto más del recuerdo.
  **Documentos**: adjunta un PDF, Word (.docx) o texto (.txt, .md) (máx. 25 MB): el archivo original queda
  disponible para descargar y su contenido se extrae como narrativa del recuerdo (y queda buscable en la
  búsqueda por palabras). **Sidecar .md**: junto al botón de descarga del documento hay otro botón
  («Descargar sidecar .md») que baja un archivo `.md` con el mismo nombre base (ej. `Mi-recuerdo.pdf` →
  `Mi-recuerdo.md`) con los datos estructurados del recuerdo como frontmatter YAML (`fecha`, `lugar`,
  `personas`, `diario` con el wikilink del Diario en formato «Viernes 9 de octubre de 2026»): sirve para que
  el proceso que genera las notas del vault de Obsidian los lea directamente sin extraerlos del documento.
  La fecha se omite si no hay o es aproximada-desconocida (`date_precision = 'unknown'`); nunca se inventan fechas.
  **Comentario de la IA** (opcional, requiere clave de OpenAI en el servidor):
  la casilla «Generar comentario con IA» produce un comentario cálido y breve a partir del título y la narrativa;
  se puede regenerar al editar el recuerdo.
  **Sin subir archivos**: el campo «Video por URL» acepta un enlace público de **YouTube o Instagram**
  (p. ej. `https://www.youtube.com/watch?v=…` o `https://www.instagram.com/reel/…`): el servidor lo
  descarga en segundo plano (máx. 200 MB, hasta 720p) y lo guarda como el video del recuerdo; la página
  muestra «descargando…» o el motivo del error en tu idioma. El campo «Foto por URL» acepta el enlace
  directo de cualquier imagen pública (o de un post de Instagram): se descarga (máx. 100 MB) y queda como
  la foto del recuerdo. Puedes cambiar la URL después desde *Editar*.
  **Pegado directo**: también puedes pegar (Ctrl+V o ⌘V) imágenes, un video, un audio o un documento
  copiado: se coloca solo en su casilla del formulario (varias fotos a la vez, un archivo por los demás tipos).
- **Cronología**: ordenada por la fecha del recuerdo, no por la fecha de subida.
- **Historias**: genera texto con IA (OpenAI, opcional) citando sus fuentes, o escríbelas manualmente.
- **Taller**: arma álbumes PDF por tema (cumpleaños, Navidad, viajes…).
  Cada álbum es una *edición*: cuando agregues recuerdos, crea una nueva edición.
  El armador tiene filtros combinables (fechas, personas, tema/palabra clave), miniaturas
  de foto y video en la lista, y orden manual: arrastra con ⋮⋮ o usa ↑ ↓ — ese orden es el
  que sale en el PDF. También puedes escribir la *historia o narrativa del álbum*, que
  aparece después de la portada, y elegir una *temática visual* que decora la portada
  (General, Familia, Cumpleaños, Navidad, Viaje, Boda/Aniversario).
  El PDF sale maquetado editorialmente: portada con título, autor y fecha, un recuerdo
  por página (la imagen nunca se parte ni se distorsiona: conserva su proporción aunque
  la foto vertical traiga orientación EXIF de teléfono), cabecera con el título del álbum
  y número de página al pie, sin páginas en blanco. Los recuerdos que tengan audio muestran en el PDF
  un botón **«Escuchar audio»** (en español o inglés, según tu idioma) que abre el audio en el navegador;
  para que el botón funcione, la variable `APP_URL` debe contener la dirección pública de tu app en Railway.
  La decoración temática llega a cada página (banda superior, filetes y rombos en el color de la temática,
  inicial decorada al inicio del relato, marco doble en las fotos); los documentos muestran una tarjeta con su
  nombre y la narrativa extraída, y el comentario de la IA aparece como nota de cierre.
  Los álbumes se guardan en la
  biblioteca del taller y se pueden volver a **editar** (título, narrativa, temática,
  recuerdos y orden), descargar o eliminar — la descarga **regenera el PDF** desde el
  álbum guardado, no hay que volver a armarlo.
  Entre los recuerdos puedes intercalar **historias intermedias**: un bloque con icono
  📖 y su propia mini-historia (título + texto), independiente de la narrativa inicial,
  que en el PDF ocupa su propia página. Los recuerdos con video aparecen con una imagen
  de su primer cuadro.
- **Búsqueda**: por palabras clave, o conversacional con IA si hay clave configurada.
- **Asistente por WhatsApp**: manda foto + relato al número del asistente (+1 555-153-9713)
  y el borrador entra al archivo como *pendiente de completar*.
- **Ayuda en la app**: la página *Ayuda* del menú trae el manual completo en español e inglés,
  con el número del Asistente Puente, el flujo de captura por WhatsApp, límites de formato,
  el Taller, el PDF editorial y la solución de problemas.
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
   | `ASSISTANT_WHATSAPP_NUMBER` | `+1 555-153-9713` | Número del Asistente Puente que se agrega al mensaje de invitación (si se deja vacío, la línea no aparece) |
   | `NODE_ENV` | `production` | Cookies seguras |
6. **Genera el dominio.** *Settings → Networking → Generate Domain*. Esa es tu `APP_URL`.
7. **Despliega.** Railway instala dependencias (`npm install`), arranca con `node server.js`
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

**Nota:** cada llamada lleva una sola foto (`photoBase64`) y crea un borrador. Para varias
fotos se hacen varias llamadas (un borrador por foto). Solo en la app se pueden juntar
hasta 10 fotos en un solo recuerdo.

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
- **Memories**: photos (up to 10 per memory, with multi-select, drag and drop and preview before saving;
  you can also paste several at once), video (max 200 MB) and/or audio (max 100 MB), story, transcription,
  people, place, date (exact or approximate) and a guided interview. Upload shows a progress bar and reports the
  reason if it fails. Status: complete or *pending completion*.
  Accepted formats: images (jpg, png, gif, webp, heic/heif, avif, raw…), videos (mp4, mov, avi, mkv, webm, 3gp, mts…)
  and audios (mp3, wav, m4a, aac, ogg, flac…). In the library, video memories show a thumbnail
  (first frame) with a ▶ badge; the video plays on the memory page. A memory's photos display as a
  gallery, and when editing you can remove any of them.
  **Art editor** (🎨 button on the memory page): apply **charcoal, pop art, caricature or watercolor**
  styles to any photo using real canvas filters (grayscale + contrast + grain, posterize + saturation, marked
  edges, softening + paper); everything is processed in your browser, with no external APIs, and the stylized
  version is saved as another photo of the memory.
  **Documents**: attach a PDF, Word (.docx) or text (.txt, .md) file (max 25 MB): the original file stays
  available for download and its content is extracted as the memory's narrative (and becomes searchable
  with keyword search). **Sidecar .md**: next to the document download button there is another button
  ("Download sidecar .md") that downloads a `.md` file with the same base name (e.g. `Mi-recuerdo.pdf` →
  `Mi-recuerdo.md`) carrying the memory's structured data as YAML frontmatter (`fecha`, `lugar`,
  `personas`, `diario` with the Diary wikilink as "Viernes 9 de octubre de 2026"): it lets the process
  that generates the Obsidian vault notes read them directly without extracting them from the document.
  The date is omitted when missing or when its precision is unknown (`date_precision = 'unknown'`);
  dates are never invented.
  **AI comment** (optional, needs an OpenAI key on the server): the “Generate AI comment”
  checkbox produces a short, warm comment from the title and narrative; it can be regenerated when editing the memory.
  **Without uploading files**: the “Video by URL” field accepts a public **YouTube or Instagram**
  link (e.g. `https://www.youtube.com/watch?v=…` or `https://www.instagram.com/reel/…`): the server
  downloads it in the background (max 200 MB, up to 720p) and saves it as the memory's video; the page
  shows “downloading…” or the reason for the error in your language. The “Photo by URL” field accepts a
  direct link to any public image (or an Instagram post): it is downloaded (max 100 MB) and saved as the
  memory's photo. You can change the URL later from *Edit*.
  **Direct paste**: you can also paste (Ctrl+V or ⌘V) copied images, video, audio or documents:
  they land in their own form field (several photos at once, one file per other type).
- **Timeline**: ordered by the memory's date, not the upload date.
- **Stories**: AI-generate text (OpenAI, optional) with cited sources, or write manually.
- **Workshop**: build themed PDF albums (birthdays, Christmas, trips…).
  Each album is an *edition*: when you add memories, create a new edition.
  The builder has combinable filters (dates, people, theme/keyword), photo and video
  thumbnails in the list, and manual ordering: drag with ⋮⋮ or use ↑ ↓ — that order is
  the one used in the PDF. You can also write the *album's story or narrative*, shown
  after the cover page, and pick a *visual theme* that decorates the cover
  (General, Family, Birthday, Christmas, Trip, Wedding/Anniversary).
  The PDF is editorially laid out: cover with title, author and date, one memory per
  page (images never split or distort: they keep their aspect ratio even when a
  portrait phone photo carries EXIF orientation), album-title header and page numbers
  in the footer, with no blank pages. Memories that include audio show a **“Listen to audio”**
  button in the PDF (in Spanish or English, following your language) that opens the audio in the browser;
  for the button to work, the `APP_URL` variable must contain your app's public Railway address.
  The theme decoration reaches every page (top band, rules and diamonds in the theme color, drop initial,
  double frame on photos); documents show a card with their name and the extracted narrative, and the AI comment
  appears as a closing note.
  Albums are saved in the workshop library and can
  be **edited** again (title, narrative, theme, memories and order), downloaded or
  deleted — downloading **regenerates the PDF** from the saved album, no need to
  rebuild it.
  Between memories you can interleave **interstitial stories**: a block with a 📖 icon
  and its own mini-story (title + text), independent from the opening narrative, which
  gets its own page in the PDF. Video memories appear with a still image of their
  first frame.
- **Search**: keyword search, or conversational AI search when a key is set.
- **WhatsApp assistant**: send a photo + story to the assistant's number (+1 555-153-9713) and
  the draft enters the archive as *pending completion*.
- **In-app help**: the *Help* page in the menu carries the full manual in Spanish and English,
  with the Asistente Puente number, the WhatsApp capture flow, format limits, the Workshop,
  the editorial PDF and troubleshooting.
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
   | `ASSISTANT_WHATSAPP_NUMBER` | `+1 555-153-9713` | Puente Assistant number added to the invitation message (if empty, the line is omitted) |
   | `NODE_ENV` | `production` | Secure cookies |
6. **Generate the domain.** *Settings → Networking → Generate Domain*. That's your `APP_URL`.
7. **Deploy.** Railway runs `npm install`, starts with `node server.js` and applies
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

**Note:** each call carries a single photo (`photoBase64`) and creates one draft. For several
photos, make several calls (one draft per photo). Only in the app can up to 10 photos be
grouped into a single memory.

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
| `pdfgen.js` | Álbumes PDF con pdfkit (miniaturas de video, botón de audio, decoración temática, tarjetas de documento e IA) |
| `video-thumb.js` | Extrae el primer cuadro del video como miniatura (ffmpeg) |
| `media-download.js` | Descarga de video (YouTube/Instagram) y foto por URL (yt-dlp / HTTP) |
| `doc-extract.js` | Extrae narrativa de documentos: PDF (pdf-parse), Word (.docx, mammoth), texto |
| `sidecar.js` | Genera el `.md` acompañante del recuerdo: frontmatter YAML con `fecha`, `lugar`, `personas` y `diario` (ruta `/:mid/sidecar`) |
| `ai.js` | Búsqueda conversacional, generación de historias y comentarios cálidos de IA |
| `routes-*.js` | Rutas: auth, familias, personas, recuerdos, historias, taller, búsqueda, puente, cuenta |
| `view-*.ejs` | Vistas / *Views* (layout + páginas) |
| `assets-style.css` / `assets-app.js` | Estilos y JS mínimo |
| `Procfile` / `railway.json` | Despliegue / *Deploy* |
| `nixpacks.toml` | Agrega Python 3 a la imagen de Railway (yt-dlp lo necesita para descargar videos/fotos por URL) |

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
- Versión 1.4.2 — 2026-10-10: **sidecar .md del recuerdo** — junto al botón de descarga del
  documento hay un botón «Descargar sidecar .md»: baja un `.md` con el mismo nombre base que el documento
  (ej. `Mi-recuerdo.pdf` → `Mi-recuerdo.md`) con los datos estructurados como frontmatter YAML (`fecha`
  en AAAA-MM-DD, `lugar` tal cual está en la BD, `personas` de la tabla `persons`, `diario` con el wikilink
  del Diario en formato «Viernes 9 de octubre de 2026»). Lo genera al vuelo la ruta `GET
  /families/:fid/memories/:mid/sidecar` (nuevo módulo `sidecar.js`; sin archivos en disco, siempre
  actualizado; respeta la membresía de la familia). La fecha se omite si es NULL o su precisión es
  `'unknown'` — nunca se inventan fechas. Sirve para que el proceso que genera las notas del vault de
  Obsidian lea fecha/lugar/personas/diario directamente. Todo bilingüe ES/EN (nueva clave
  `sidecar_download`). /
  *Version 1.4.2 — 2026-10-10: **memory sidecar .md** — next to the document download button there is a
  "Download sidecar .md" button: it downloads a `.md` with the same base name as the document
  (e.g. `Mi-recuerdo.pdf` → `Mi-recuerdo.md`) carrying the structured data as YAML frontmatter (`fecha`
  as AAAA-MM-DD, `lugar` as stored in the DB, `personas` from the `persons` table, `diario` with the
  Diary wikilink as "Viernes 9 de octubre de 2026"). It is generated on the fly by the new `GET
  /families/:fid/memories/:mid/sidecar` route (new `sidecar.js` module; no files on disk, always current;
  honors family membership). The date is omitted when NULL or its precision is `'unknown'` — dates are
  never invented. It lets the process that generates the Obsidian vault notes read date/place/people/diary
  directly. All bilingual ES/EN (new `sidecar_download` key).*
- Versión 1.4.0 — 2026-10-08: **mejoras de octubre** — (1) **varias fotos por recuerdo** (hasta 10;
  selección múltiple, arrastrar y soltar, vista previa antes de guardar, pegar varias a la vez; galería
  con opción de quitar fotos al editar; migración `migration-007.sql`); (2) **editor artístico** (botón 🎨
  en el recuerdo): estilos **carboncillo, pop art, caricatura y acuarela** aplicados con filtros reales de
  canvas 100% en el navegador, sin APIs externas; la versión estilizada se guarda como una foto más;
  (3) **documentos** PDF/Word/texto con tope subido a **25 MB** (narrativa extraída y buscable verificada
  de punta a punta). Todo bilingüe ES/EN. /
  *Version 1.4.0 — 2026-10-08: **October upgrades** — (1) **multiple photos per memory** (up to 10;
  multi-select, drag and drop, preview before saving, paste several at once; gallery with remove option
  when editing; `migration-007.sql`); (2) **art editor** (🎨 button on the memory): **charcoal, pop art,
  caricature and watercolor** styles applied with real canvas filters 100% in the browser, no external APIs;
  the stylized version is saved as another photo; (3) **documents** PDF/Word/text with the cap raised to
  **25 MB** (extracted searchable narrative verified end to end). All bilingual ES/EN.*
- Versión 1.3.3 — 2026-09-29: tres correcciones de idioma — (1) en *Editar recuerdo*, la etiqueta
  "Actual:" del video actual ahora respeta el idioma seleccionado (nueva clave `current`: "Actual"/"Current");
  (2) agregada la clave faltante `invite_used` en inglés ("Used"); (3) el aviso de "mensaje copiado" en
  *Invitaciones* ahora muestra el texto en tu idioma en vez de "¡Copiado! / Copied!" mezclado. /
  *Version 1.3.3 — 2026-09-29: three language fixes — (1) in Edit memory, the current-video "Actual:" label
  now follows the selected language (new `current` key: "Actual"/"Current"); (2) added the missing
  `invite_used` key in English ("Used"); (3) the "message copied" notice in Invitations now shows in your
  language instead of the mixed "¡Copiado! / Copied!".*
- Versión 1.3.1 — 2026-09-28: los **emojis** de WhatsApp se retiran del PDF del Taller (las fuentes del PDF
  no los soportan y salían como símbolos extraños; la web los conserva), los comentarios de IA se generan
  **sin emojis** y se corrigió el contador «RECUERDO n DE m» del PDF (mostraba n+1). /
  *Version 1.3.1 — 2026-09-28: **emojis** from WhatsApp are stripped from the workshop PDF (PDF fonts cannot
  render them and showed strange symbols; the web keeps them), AI comments are generated **without emojis**,
  and the PDF «MEMORY n OF m» counter was fixed (it showed n+1).*
- Versión 1.3.0 — 2026-09-28: **documentos adjuntos** (PDF/Word/texto, máx. 20 MB, narrativa extraída y buscable),
  **comentarios de IA opcionales** por recuerdo (requieren OpenAI), decoración temática extendida del PDF
  (banda superior, inicial decorada, marco doble, tarjetas de documento e IA), auditoría de 0 páginas en blanco
  (migración `migration-006.sql`; dependencias `pdf-parse`, `mammoth`). /
  *Version 1.3.0 — 2026-09-28: **document attachments** (PDF/Word/text, max 20 MB, extracted searchable narrative),
  **optional AI comments** per memory (need OpenAI), extended theme decoration of the PDF
  (top band, drop initial, double frame, document and AI cards), zero-blank-pages audit
  (migration `migration-006.sql`; `pdf-parse`, `mammoth` dependencies).*
- Versión 1.2.1 — 2026-09-28: `nixpacks.toml` (Python 3 en Railway para yt-dlp).
- Versión 1.2.0 — 2026-09-28: video por URL (YouTube/Instagram), foto por URL,
  botón «Escuchar audio» en el PDF (migración `migration-005.sql`).
- Nota: los enlaces de *stories* de Instagram exigen inicio de sesión y no se pueden
  descargar; usa videos públicos de YouTube o posts/reels públicos de Instagram.
- 2026-09-27: la subida de recuerdos (nuevo/editar) muestra **barra de progreso** con % y
  MB, y si falla muestra el **motivo** en tu idioma (archivo muy grande, tipo no permitido,
  conexión cortada). Límite de **video subido a 200 MB** (foto/audio: 100 MB).
  Todos los formatos de imagen y video habilitados: se acepta por tipo MIME o por
  extensión (jpg, png, heic/heif, webp, avif, raw; mp4, mov, avi, mkv, webm, 3gp, mts, etc.). /
  *2026-09-27: memory upload (new/edit) shows a **progress bar** with % and MB, and on
  failure shows the **reason** in your language (file too large, type not allowed,
  connection dropped). **Video limit raised to 200 MB** (photo/audio: 100 MB).
  All image and video formats enabled: accepted by MIME type or extension
  (jpg, png, heic/heif, webp, avif, raw; mp4, mov, avi, mkv, webm, 3gp, mts, etc.).*
- 2026-09-27 (videos en biblioteca): la ruta `/uploads/:name` no autorizaba `video_path`
  (solo foto/audio) y devolvía 404: los videos no se reproducían. Corregido. Además la
  biblioteca ahora muestra miniatura del primer cuadro para recuerdos con video y sin
  foto (con insignia ▶). / *2026-09-27 (videos in library): the `/uploads/:name` route
  did not authorize `video_path` (only photo/audio) and returned 404: videos would not
  play. Fixed. The library now also shows a first-frame thumbnail for video-only memories
  (with a ▶ badge).*
- 2026-09-27 (miniaturas en todas las vistas): la página de la familia, la cronología y la
  búsqueda tenían su propia cuadrícula de recuerdos sin miniatura de video; ahora muestran
  la misma miniatura (primer cuadro + insignia ▶) que la biblioteca. / *2026-09-27
  (thumbnails in all views): the family page, timeline and search had their own memory
  grids without video thumbnails; they now show the same thumbnail (first frame + ▶ badge)
  as the library.*
- 2026-09-27 (miniaturas de video en los álbumes PDF): al subir un video se extrae
  automáticamente su primer cuadro como miniatura (`<video>.thumb.jpg`, con ffmpeg).
  El álbum PDF ahora incluye esa imagen en los recuerdos con video y sin foto; si la
  miniatura no se puede generar, se dibuja un recuadro con símbolo de reproducción.
  De paso se corrigió que el texto del álbum se encimaba sobre las fotos (pdfkit no
  avanza el cursor tras `image()`). Requiere la dependencia `ffmpeg-static`. /
  *2026-09-27 (video thumbnails in PDF albums): uploading a video now automatically
  extracts its first frame as a thumbnail (`<video>.thumb.jpg`, via ffmpeg). The PDF
  album includes that image for video-only memories; if the thumbnail cannot be
  generated, a placeholder box with a play symbol is drawn instead. Also fixed album
  text overlapping photos (pdfkit does not advance the cursor after `image()`).
  Requires the `ffmpeg-static` dependency.*
- 2026-09-27 (álbumes: miniaturas, filtros, orden manual y narrativa): la página del álbum
  no mostraba miniatura para recuerdos con video; ahora sí (primer cuadro + insignia ▶).
  El armador de álbumes ahora tiene: filtros combinables por fecha (desde/hasta), personas
  y tema o palabra clave; miniaturas de foto y video en la lista; orden manual — arrastra
  con ⋮⋮ o usa ↑ ↓ y ese orden se respeta al guardar y en el PDF (ya no se reordena por
  fecha automáticamente). Además se agregó la *historia o narrativa del álbum*
  (columna `narrative`, migración `migration-003.sql`), que aparece tras la portada del
  PDF y en la página del álbum. Gramática: "1 recuerdo" en singular en vez de
  "1 recuerdos". Los relatos individuales se siguen editando en cada recuerdo
  (campo Relato). / *2026-09-27 (albums: thumbnails, filters, manual order and
  narrative): the album page did not show thumbnails for video memories; it now does
  (first frame + ▶ badge). The album builder now has: combinable filters by date
  (from/to), people and theme or keyword; photo and video thumbnails in the list;
  manual ordering — drag with ⋮⋮ or use ↑ ↓ and that order is kept on save and in the
  PDF (no longer auto-sorted by date). Also added the *album story or narrative*
  (`narrative` column, `migration-003.sql` migration), shown after the PDF cover page
  and on the album page. Grammar: singular "1 memory" instead of "1 memories".
  Individual stories are still edited inside each memory (Story field).*
- 2026-09-27 (álbum PDF editorial + biblioteca editable + temáticas): el PDF se reescribió
  con maquetación editorial — portada con título, autor y fecha sobre fondo decorado según
  la temática elegida (General, Familia, Cumpleaños, Navidad, Viaje, Boda/Aniversario;
  columna `theme`, migración `migration-004.sql`; motivos vectoriales: marco, puntos,
  confeti, estrellas, olas, anillos), página de narrativa, un recuerdo por página con la
  imagen arriba (nunca se parte ni queda huérfana), cabecera con el título del álbum en el
  color de la temática y número de página al pie. La biblioteca del taller ahora permite
  volver a **editar** cada álbum (título, narrativa, temática, recuerdos y orden),
  además de descargarlo o eliminarlo. / *2026-09-27 (editorial album PDF + editable
  library + themes): the PDF was rewritten with editorial layout — cover with title,
  author and date over a theme-decorated background (General, Family, Birthday,
  Christmas, Trip, Wedding/Anniversary; `theme` column, `migration-004.sql` migration;
  vector motifs: frame, dots, confetti, stars, waves, rings), narrative page, one memory
  per page with the image on top (never split or orphaned), album-title header in the
  theme color and page numbers in the footer. The workshop library now lets you
  **edit** each album again (title, narrative, theme, memories and order), besides
  downloading or deleting it.*
- 2026-09-27 (PDF: sin páginas en blanco, fotos sin distorsión, historias intermedias):
  (1) las páginas en blanco al final las causaba el bucle de pies de página — pdfkit abre
  una página nueva cuando el texto supera maxY(); ahora el pie se escribe reduciendo
  temporalmente el margen inferior; (2) las fotos se dibujan con la opción `fit` de pdfkit
  (escala uniforme) calculando el tamaño real con el intercambio ancho/alto de la
  orientación EXIF — verificado en el PDF: matriz 483.28×302.05 para 1600×1000 y
  285×380 para foto vertical con EXIF 6; (3) **historias intermedias**: el contenido del
  álbum es una lista de bloques `{type:'memory',id}` / `{type:'story',title,text}`
  (los álbumes antiguos con `[ids]` se normalizan solos); en el armador se insertan con
  ＋📖 entre los recuerdos, se editan en línea, se reordenan y se eliminan; en la web
  aparecen como tarjetas 📖 intercaladas y en el PDF ocupan su propia página con icono
  de libro vectorial. La descarga regenera el PDF desde el álbum guardado.
  / *2026-09-27 (PDF: no blank pages, no photo distortion, interstitial stories):
  (1) the trailing blank pages were caused by the footer loop — pdfkit opens a new page
  when text exceeds maxY(); the footer is now written with a temporarily reduced bottom
  margin; (2) photos are drawn with pdfkit's `fit` option (uniform scaling), computing
  the real size with the EXIF-orientation width/height swap — verified in the PDF:
  483.28×302.05 matrix for 1600×1000 and 285×380 for a portrait EXIF-6 photo;
  (3) **interstitial stories**: album content is a block list `{type:'memory',id}` /
  `{type:'story',title,text}` (old `[ids]` albums normalize automatically); in the
  builder they are inserted with +📖 between memories, edited inline, reordered and
  deleted; on the web they appear as interleaved 📖 cards and in the PDF they get their
  own page with a vector book icon. Downloading regenerates the PDF from the saved album.*


### Corrección integral — 10 de octubre de 2026

Se recuperaron las funciones eliminadas por la última carga: selección de recuerdos no
consecutivos, movimiento individual y múltiple con desplazamiento automático y borrador,
cargas mixtas de fotos/videos, extracción de documentos, editor artístico y exportación HTML.
El ZIP HTML contiene el álbum autocontenido con sus medios, además del PDF existente.

**Sidecar:** en Taller (crear/editar/ver álbum) y en cada recuerdo hay un botón
«Descargar sidecar .md» / “Download sidecar .md”. En el recuerdo aparece junto al documento;
también está disponible sin documento. El nombre usa el del documento o el título.
Se exportan únicamente los metadatos guardados y las personas vinculadas de la misma familia.
No se certifica su verdad histórica ni se infieren datos desde imágenes, narrativas o IA.
Una fecha ausente, inválida o de precisión desconocida se omite, junto con `diario`.
Una fecha aproximada conserva `precision_fecha: "approx"` y no crea enlace diario.
Una fecha exacta conserva `precision_fecha: "exact"` y puede enlazar el Diario.
La fecha se lee como texto desde PostgreSQL para evitar cambios por zona horaria.
No se utiliza la fecha de carga o de creación como fecha del recuerdo.

**English:** Restores album selection/reordering, mixed media uploads, document extraction,
art editing and portable HTML export. Each memory can download a sidecar, including memories
without attachments. Only stored metadata and linked people in the same family are exported.
Missing/invalid/unknown dates are omitted; approximate dates are explicitly marked and do not
create a daily-note link. This exports recorded information, not historical verification.

Validación local: `npm ci` y `npm test`. Las pruebas HTTP usan datos simulados y no modifican
la base de producción. Conservar las variables y el volumen existentes al desplegar.
