'use strict';
// Temáticas visuales de los álbumes PDF: cada una define sus colores
// y un motivo decorativo que se dibuja en la portada.
const THEMES = {
  general:    { accent: '#8a6d3b', soft: '#f8f4ec', deep: '#2b2118', motif: 'frame' },
  familia:    { accent: '#b4552d', soft: '#faf0e6', deep: '#3a2415', motif: 'dots' },
  cumpleanos: { accent: '#d6455b', soft: '#fdf0f2', deep: '#4a1520', motif: 'confetti' },
  navidad:    { accent: '#a31621', soft: '#faf3e6', deep: '#1f3d2b', motif: 'stars' },
  viaje:      { accent: '#0e7c8c', soft: '#eaf6f8', deep: '#123a40', motif: 'waves' },
  boda:       { accent: '#b98a2f', soft: '#faf5ea', deep: '#3d2c12', motif: 'rings' },
};
const THEME_IDS = Object.keys(THEMES);

function themeOf(id) {
  return THEMES[id] || THEMES.general;
}

module.exports = { THEMES, THEME_IDS, themeOf };
