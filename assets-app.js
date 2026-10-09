// Legado Vivo — JS mínimo del lado del cliente.
function copyWa() {
  var ta = document.getElementById('wamsg');
  if (!ta) return;
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(function () {});
  alert(ta.dataset.copied || '¡Copiado! / Copied!');
}

// Entrevista guiada: agrega las respuestas al relato.
function addInterview() {
  var story = document.getElementById('story');
  if (!story) return;
  var pairs = [
    ['iq_see', 'iq_who', 'iq_where', 'iq_when', 'iq_remember']
  ][0].map(function (n) {
    var el = document.querySelector('[name="' + n + '"]');
    return el && el.value.trim() ? { q: el.closest('label').childNodes[0].textContent.trim(), a: el.value.trim() } : null;
  }).filter(Boolean);
  if (!pairs.length) return;
  var block = pairs.map(function (p) { return p.q + '\n' + p.a; }).join('\n\n');
  story.value = (story.value.trim() ? story.value.trim() + '\n\n' : '') + block + '\n';
  story.focus();
}

// Pegado directo (Ctrl+V / Cmd+V) de archivos en el formulario de recuerdos.
// Solo actúa cuando el portapapeles trae archivos; el pegado de texto no se toca.
(function () {
  function init() {
    var form = document.getElementById('memory-form');
    if (!form) return;
    function field(name) { return form.querySelector('input[type="file"][name="' + name + '"]'); }
    var targets = { photo: field('photo'), video: field('video'), audio: field('audio'), document: field('document') };
    function pickTarget(f) {
      var type = f.type || '', name = f.name || '';
      if (/^image\//.test(type) || /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?|svg)$/i.test(name)) return targets.photo;
      if (/^video\//.test(type)) return targets.video;
      if (/^audio\//.test(type)) return targets.audio;
      if (/pdf/i.test(type) || /word|officedocument/i.test(type) || /^text\//.test(type) || /\.(pdf|docx|txt|md)$/i.test(name)) return targets.document;
      return null;
    }
    function note(input, label) {
      var old = input.parentNode.querySelector('.paste-note');
      if (old) old.remove();
      var s = document.createElement('span');
      s.className = 'muted small paste-note';
      s.textContent = '✓ ' + label;
      input.parentNode.appendChild(s);
      setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 4000);
    }
    document.addEventListener('paste', function (e) {
      var cd = e.clipboardData;
      if (!cd || !cd.files || !cd.files.length) return;
      var handled = false;
      var photoFiles = [];
      for (var i = 0; i < cd.files.length; i++) {
        var t = pickTarget(cd.files[i]);
        if (!t) continue;
        // Las fotos pueden acumularse en la galería (múltiple).
        if (t.name === 'photo' && window.__lvPhotoDrop) {
          photoFiles.push(cd.files[i]);
          note(t, cd.files[i].name || cd.files[i].type);
          handled = true;
        } else {
          var dt = new DataTransfer();
          dt.items.add(cd.files[i]);
          t.files = dt.files;
          note(t, cd.files[i].name || cd.files[i].type);
          handled = true;
        }
      }
      if (photoFiles.length && window.__lvPhotoDrop) window.__lvPhotoDrop.addFiles(photoFiles);
      if (handled) e.preventDefault();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// Galería de fotos: selección múltiple + arrastrar y soltar + vista previa
// con opción de quitar antes de guardar. El input real se sincroniza solo.
(function () {
  function init() {
    var input = document.getElementById('photo-input');
    var drop = document.getElementById('photo-drop');
    var prev = document.getElementById('photo-previews');
    if (!input || !drop) return;
    var dt = new DataTransfer();
    var previewUrls = [];
    function render() {
      if (!prev) return;
      previewUrls.forEach(function (url) { URL.revokeObjectURL(url); });
      previewUrls = [];
      prev.innerHTML = '';
      for (var i = 0; i < dt.files.length; i++) {
        (function (f, idx) {
          var box = document.createElement('div');
          box.className = 'preview';
          var img = document.createElement('img');
          var url = URL.createObjectURL(f);
          previewUrls.push(url);
          img.src = url;
          img.alt = f.name;
          var label = document.createElement('span');
          label.className = 'muted small';
          label.textContent = f.name;
          var rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'preview-rm';
          rm.textContent = '×';
          rm.setAttribute('aria-label', '×');
          rm.addEventListener('click', function () { dt.items.remove(idx); sync(); });
          box.appendChild(img);
          box.appendChild(label);
          box.appendChild(rm);
          prev.appendChild(box);
        })(dt.files[i], i);
      }
    }
    function sync() { input.files = dt.files; render(); }
    function addFiles(files) {
      for (var i = 0; i < files.length; i++) {
        if (/^image\//.test(files[i].type || '') || /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?|svg)$/i.test(files[i].name || '')) dt.items.add(files[i]);
      }
      sync();
    }
    input.addEventListener('change', function () {
      // input.files shares dt.files in Chromium. Clearing input.value would
      // also clear the gallery and submit an empty photo field.
      addFiles(Array.prototype.slice.call(input.files || []));
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    window.__lvPhotoDrop = { addFiles: addFiles };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
