'use strict';
// Isolate synchronous HEIC/RAW decoding from the web server's event loop.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
sharp.cache(false);
sharp.concurrency(1);
const [source, destination] = process.argv.slice(2);
const LIMIT = 80 * 1000 * 1000;
const RAW = /\.(dng|cr2|cr3|crw|nef|nrw|arw|rw2|orf|pef|srw|raf|raw|3fr|erf|kdc|mos|mrw|x3f)$/i;
function jpeg(input) {
  return input.rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).toColourspace('srgb').jpeg({ quality: 94 }).toFile(destination);
}
function command(bin, args, stdoutFile) {
  return new Promise((resolve, reject) => {
    const fd = stdoutFile ? fs.openSync(stdoutFile, 'w') : null;
    const child = spawn(bin, args, { stdio: ['ignore', fd === null ? 'ignore' : fd, 'pipe'] });
    if (fd !== null) fs.closeSync(fd);
    let message = '';
    child.stderr.on('data', b => { message = (message + b.toString()).slice(-1000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(message || 'Image conversion failed')));
  });
}
(async () => {
  if (!source || !destination) throw new Error('Missing paths');
  // sharp handles JPEG, PNG, WebP, AVIF, TIFF, GIF and SVG. For multi-frame
  // photo containers the album displays the primary still; source is retained.
  try {
    await jpeg(sharp(source, { limitInputPixels: LIMIT, failOn: 'error', pages: 1 }));
    return;
  } catch (firstError) {
    const fd = fs.openSync(source, 'r'), header = Buffer.alloc(64);
    fs.readSync(fd, header, 0, header.length, 0); fs.closeSync(fd);
    const brand = header.toString('ascii', 8, 12);
    if (header.toString('ascii', 0, 4) === '8BPS') {
      await command(process.env.MAGICK_PATH || 'magick', ['-limit', 'memory', '256MiB', '-limit', 'map', '512MiB',
        '-limit', 'disk', '512MiB', '-limit', 'thread', '1', '-limit', 'time', '120', 'psd:' + source + '[0]',
        '-auto-orient', '-resize', '4096x4096>', '-background', 'white', '-alpha', 'remove', '-alpha', 'off',
        '-colorspace', 'sRGB', '-quality', '94', 'jpeg:' + destination]);
      return;
    }
    if (['mif1','msf1','heic','heix','hevc','hevx'].includes(brand) || /\.hei[cf]$/i.test(source)) {
      const decode = require('heic-decode');
      const images = await decode.all({ buffer: await fs.promises.readFile(source) });
      try {
        if (!images.length || images[0].width * images[0].height > LIMIT) throw new Error('Image exceeds pixel limit');
        const { width, height, data } = await images[0].decode();
        await jpeg(sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } }));
      } finally { images.dispose(); }
      return;
    }
    if (RAW.test(source)) {
      const temp = destination + '.tiff';
      try {
        await command(process.env.DCRAW_PATH || 'dcraw_emu', ['-w', '-T', '-Z', '-', source], temp);
        await jpeg(sharp(temp, { limitInputPixels: LIMIT, failOn: 'error' }));
      } finally { await fs.promises.rm(temp, { force: true }); }
      return;
    }
    // Bitmap/PSD/ICO and other still decoders available in ffmpeg.
    // Restrict demuxers: an arbitrary video cannot masquerade as a photo.
    const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
    await command(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe',
      '-format_whitelist', 'image2,bmp_pipe,png_pipe,jpeg_pipe,jpegls_pipe,tiff_pipe,webp_pipe,psd_pipe,ico,gif',
      '-i', source, '-frames:v', '1', '-vf', "scale=w='min(4096,iw)':h='min(4096,ih)':force_original_aspect_ratio=decrease",
      '-q:v', '2', '-threads', '1', '-f', 'image2', '-c:v', 'mjpeg', destination]);
  }
})().catch(err => { console.error(err.message); process.exitCode = 1; });
