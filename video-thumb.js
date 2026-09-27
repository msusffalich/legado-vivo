'use strict';
// Miniaturas de video: extrae el primer cuadro con ffmpeg (paquete ffmpeg-static).
// La miniatura se guarda junto al video como "<archivo>.thumb.jpg", de modo que
// no requiere columna nueva en la base de datos: se deriva del video_path.
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) { ffmpegPath = null; }

const THUMB_SUFFIX = '.thumb.jpg';

function thumbAbsForVideo(videoAbs) {
  return videoAbs + THUMB_SUFFIX;
}

// Devuelve la ruta absoluta de la miniatura (generándola si falta) o null si no se pudo.
function ensureVideoThumb(videoAbs) {
  return new Promise((resolve) => {
    const thumb = thumbAbsForVideo(videoAbs);
    try { if (fs.existsSync(thumb)) return resolve(thumb); } catch (e) { /* noop */ }
    if (!ffmpegPath || !videoAbs) return resolve(null);
    let vabs = videoAbs;
    try { if (!fs.existsSync(vabs)) return resolve(null); } catch (e) { return resolve(null); }
    execFile(ffmpegPath,
      ['-y', '-v', 'error', '-i', vabs, '-vframes', '1', '-q:v', '4', thumb],
      { timeout: 120000 },
      () => {
        try { if (fs.existsSync(thumb)) return resolve(thumb); } catch (e) { /* noop */ }
        resolve(null);
      });
  });
}

function deleteVideoThumb(videoAbs) {
  if (!videoAbs) return;
  try { fs.unlinkSync(thumbAbsForVideo(videoAbs)); } catch (e) { /* no existía */ }
}

// Nombre público de la miniatura para un video_path como "/uploads/abc.mp4".
function thumbPublicForVideo(videoPath) {
  if (!videoPath) return null;
  return videoPath + THUMB_SUFFIX;
}

module.exports = { THUMB_SUFFIX, thumbAbsForVideo, ensureVideoThumb, deleteVideoThumb, thumbPublicForVideo };
