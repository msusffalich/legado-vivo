// Legado Vivo — editor artístico 100% en el navegador (canvas, sin APIs externas).
// 4 estilos deterministas: carboncillo, pop art, caricatura, acuarela.
(function () {
  'use strict';

  // PRNG determinista (mulberry32) para que el grano sea reproducible.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  function getCtx(canvas) { return canvas.getContext('2d', { willReadFrequently: true }); }

  // Carboncillo: grises + contraste fuerte + grano de lápiz.
  function charcoal(img, w, h) {
    var d = img.data, rand = rng(1234);
    for (var i = 0; i < d.length; i += 4) {
      var g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      g = (g - 128) * 1.7 + 128;                       // contraste
      g += (rand() - 0.5) * 36;                        // grano
      g = clamp(g);
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    return img;
  }

  // Pop art: posterizar a 4 niveles + saturación alta.
  function popart(img, w, h) {
    var d = img.data, levels = 4;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var sat = mx === 0 ? 0 : (mx - mn) / mx;
      var nsat = Math.min(1, sat * 1.9 + 0.15);
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      // re-saturar alrededor del gris
      r = clamp(lum + (r - lum) * (1 + nsat));
      g = clamp(lum + (g - lum) * (1 + nsat));
      b = clamp(lum + (b - lum) * (1 + nsat));
      d[i] = Math.floor(r / 256 * levels) * (255 / (levels - 1));
      d[i + 1] = Math.floor(g / 256 * levels) * (255 / (levels - 1));
      d[i + 2] = Math.floor(b / 256 * levels) * (255 / (levels - 1));
    }
    return img;
  }

  // Detección de bordes (Sobel) sobre grises, devuelve mapa 0..1.
  function sobel(gray, w, h) {
    var out = new Float32Array(w * h);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1]
                 + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        var gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1]
                 + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        out[i] = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 512);
      }
    }
    return out;
  }

  // Caricatura: posterizar + contraste + bordes oscuros marcados.
  function caricature(img, w, h) {
    var d = img.data, gray = new Float32Array(w * h), levels = 6, i, p = 0;
    for (i = 0; i < d.length; i += 4, p++) {
      gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    var edges = sobel(gray, w, h);
    p = 0;
    for (i = 0; i < d.length; i += 4, p++) {
      var r = clamp((d[i] - 128) * 1.35 + 128);
      var g = clamp((d[i + 1] - 128) * 1.35 + 128);
      var b = clamp((d[i + 2] - 128) * 1.35 + 128);
      r = Math.floor(r / 256 * levels) * (255 / (levels - 1));
      g = Math.floor(g / 256 * levels) * (255 / (levels - 1));
      b = Math.floor(b / 256 * levels) * (255 / (levels - 1));
      var e = edges[p];
      var dark = 1 - Math.min(0.85, e * 1.6);
      d[i] = r * dark; d[i + 1] = g * dark; d[i + 2] = b * dark;
    }
    return img;
  }

  // Desenfoque caja 3x3 simple.
  function blur3(src, w, h) {
    var out = new Float32Array(src.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sum = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx, yy = y + dy;
            if (xx >= 0 && xx < w && yy >= 0 && yy < h) { sum += src[yy * w + xx]; n++; }
          }
        }
        out[y * w + x] = sum / n;
      }
    }
    return out;
  }

  // Acuarela: suavizar + aclarar + grano de papel sutil.
  function watercolor(img, w, h) {
    var d = img.data, n = w * h, rand = rng(987);
    var rs = new Float32Array(n), gs = new Float32Array(n), bs = new Float32Array(n), i, p = 0;
    for (i = 0; i < d.length; i += 4, p++) { rs[p] = d[i]; gs[p] = d[i + 1]; bs[p] = d[i + 2]; }
    var rb = blur3(rs, w, h), gb = blur3(gs, w, h), bb = blur3(bs, w, h);
    p = 0;
    for (i = 0; i < d.length; i += 4, p++) {
      var lum = 0.299 * rb[p] + 0.587 * gb[p] + 0.114 * bb[p];
      var f = 0.82; // suaviza la saturación
      var r = clamp(lum + (rb[p] - lum) * f + 14 + (rand() - 0.5) * 12);
      var g = clamp(lum + (gb[p] - lum) * f + 14 + (rand() - 0.5) * 12);
      var b = clamp(lum + (bb[p] - lum) * f + 12 + (rand() - 0.5) * 12);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    return img;
  }

  var STYLES = {
    charcoal: { fn: charcoal },
    popart: { fn: popart },
    caricature: { fn: caricature },
    watercolor: { fn: watercolor }
  };

  // Aplica un estilo a un <img> ya cargado y lo dibuja en el canvas.
  // Limita el lado mayor a maxSide para que sea rápido en el teléfono.
  function renderTo(canvas, img, styleName, maxSide) {
    maxSide = maxSide || 1600;
    var sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    var scale = Math.min(1, maxSide / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    canvas.width = w; canvas.height = h;
    var ctx = getCtx(canvas);
    ctx.drawImage(img, 0, 0, w, h);
    var imgData = ctx.getImageData(0, 0, w, h);
    STYLES[styleName].fn(imgData, w, h);
    ctx.putImageData(imgData, 0, 0);
    return { w: w, h: h };
  }

  // Expone la API para la vista del editor.
  window.LVArt = {
    styles: Object.keys(STYLES),
    renderTo: renderTo,
    applyToCanvas: function (canvas, styleName) {
      var src = document.getElementById('art-source');
      if (!src || !src.complete || !src.naturalWidth) return false;
      renderTo(canvas, src, styleName);
      return true;
    }
  };
})();
