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
      if (/^image\//.test(type) || /\.(heic|heif|hif|avif|jpe?g|png|gif|webp|bmp|tiff?|svg|ico|dng|cr2|cr3|crw|nef|arw|rw2|orf|pef|srw|raf|raw|psd)$/i.test(name)) return targets.photo;
      if (/^video\//.test(type) || /\.(mp4|m4v|mov|avi|mkv|webm|wmv|flv|3gp|3g2|mts|m2ts|ts|mpg|mpeg|ogv)$/i.test(name)) return targets.video;
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
      for (var i = 0; i < cd.files.length; i++) {
        var t = pickTarget(cd.files[i]);
        if (t) {
          var dt = new DataTransfer();
          dt.items.add(cd.files[i]);
          t.files = dt.files;
          note(t, cd.files[i].name || cd.files[i].type);
          handled = true;
        }
      }
      if (handled) e.preventDefault();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

