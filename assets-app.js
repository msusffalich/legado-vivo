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
