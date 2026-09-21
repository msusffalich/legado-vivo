'use strict';
// i18n mínimo: diccionarios es/en cargados de locale-es.json / locale-en.json
const es = require('./locale-es.json');
const en = require('./locale-en.json');

const DICTS = { es, en };

function t(lang, key, vars) {
  const dict = DICTS[lang] || DICTS.es;
  let s = dict[key];
  if (s === undefined) s = DICTS.es[key];
  if (s === undefined) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split('{' + k + '}').join(v == null ? '' : String(v));
    }
  }
  return s;
}

function pickLang(v) {
  return v === 'en' ? 'en' : 'es';
}

module.exports = { t, pickLang };
