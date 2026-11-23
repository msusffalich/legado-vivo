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

// Los mismos formatos de foto/video que admite el servidor, incluso si el
// dispositivo declara un MIME genérico.
function lvMediaKind(file) {
  var type = file.type || '';
  var name = file.name || '';
  if (/^video\//i.test(type) || /\.(mp4|m4v|mov|avi|mkv|webm|wmv|flv|3gp|3g2|mts|m2ts|ts|mpg|mpeg|ogv)$/i.test(name)) return 'video';
  if (/^image\//i.test(type) || /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|hif|avif|svg|ico|dng|cr2|cr3|crw|raf|raw|nrw|nef|arw|rw2|orf|pef|srw|psd)$/i.test(name)) return 'photo';
  return '';
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
      if (lvMediaKind(f)) return targets.photo;
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
// con opción de quitar antes de guardar. El envío usa la selección que se muestra.
(function () {
  function init() {
    var input = document.getElementById('photo-input');
    var drop = document.getElementById('photo-drop');
    var prev = document.getElementById('photo-previews');
    if (!input || !drop) return;
    var selected = [];
    var previewUrls = [];
    var notice = document.getElementById('photo-limit-notice');
    function remainingExisting() {
      return Math.max(0, Number(input.dataset && input.dataset.existing || 0) -
        document.querySelectorAll('input[name="remove_photo_ids"]:checked, input[name="remove_video_ids"]:checked').length);
    }
    function render() {
      if (!prev) return;
      previewUrls.forEach(function (url) { URL.revokeObjectURL(url); });
      previewUrls = [];
      prev.innerHTML = '';
      for (var i = 0; i < selected.length; i++) {
        (function (f, idx) {
          var box = document.createElement('div');
          box.className = 'preview';
          var video = lvMediaKind(f) === 'video';
          var img = document.createElement(video ? 'video' : 'img');
          if (video) { img.controls = true; img.preload = 'metadata'; }
          var url = URL.createObjectURL(f);
          previewUrls.push(url);
          img.src = url;
          img.alt = f.name;
          var label = document.createElement('span');
          label.className = 'muted small';
          label.textContent = f.name;
          img.onerror=function(){img.style.display='none';label.textContent=f.name+' · '+(document.documentElement.lang==='en'?'Preview available after saving and conversion.':'Vista previa disponible después de guardar y convertir.');};
          var rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'preview-rm';
          rm.textContent = '×';
          rm.setAttribute('aria-label', '×');
          rm.addEventListener('click', function () { selected.splice(idx, 1); render(); });
          box.appendChild(img);
          box.appendChild(label);
          box.appendChild(rm);
          prev.appendChild(box);
        })(selected[i], i);
      }
    }
    function addFiles(files) {
      files = Array.prototype.slice.call(files || []);
      var overflow = false;
      var incompatible = [];
      for (var i = 0; i < files.length; i++) {
        if (!lvMediaKind(files[i])) {
          incompatible.push(files[i].name);
        } else if (selected.length + remainingExisting() >= 10) {
          overflow = true;
        } else {
          selected.push(files[i]);
        }
      }
      if (notice) {
        var messages = [];
        if (overflow) messages.push(input.dataset.limitMessage);
        if (incompatible.length) messages.push(input.dataset.typeMessage + ': ' + incompatible.join(', '));
        notice.textContent = messages.join(' ');
      }
      render();
    }
    input.addEventListener('change', function () {
      // Take a snapshot of the live list before clearing the picker. Clearing
      // lets the user select the same file after removing it from the previews.
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      addFiles(files);
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
    window.__lvPhotoDrop = {
      addFiles: addFiles,
      appendTo: function (data) {
        data.delete(input.name);
        selected.forEach(function (file) { data.append(input.name, file, file.name); });
      }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
