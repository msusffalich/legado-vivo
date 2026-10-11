'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { buildAlbumMarkdown } = require('./album-markdown');

test('one album frontmatter, ordered stories/memories and no invented dates', () => {
 const album = { id: 9, title: 'Familia', narrative: 'Nuestra historia' };
 const items = [
  { kind: 'memory', memory: { id: 3, title: 'Primero', memory_date: null, place: 'Lima', people: ['Díaz, Ana'], story: 'Texto primero', doc_text: 'Documento original' } },
  { kind: 'story', title: 'Intermedio', text: 'Narración intermedia' },
  { kind: 'memory', memory: { id: 1, title: 'Último', memory_date: '2020-02-29', date_precision: 'approx', people: ['Miguel'], story: 'Texto final' } },
 ];
 const md = buildAlbumMarkdown({ album, items });
 assert.equal((md.match(/^---$/gm) || []).length, 2);
 const records = JSON.parse(md.match(/^recuerdos: (.*)$/m)[1]);
 assert.deepEqual(records.map(r => r.id), [3, 1]);
 assert.equal('fecha' in records[0], false); assert.deepEqual(records[0].personas, ['Díaz, Ana']);
 assert.equal(records[1].fecha, '2020-02-29'); assert.equal(records[1].precision_fecha, 'approx');
 assert(md.indexOf('Texto primero') < md.indexOf('Narración intermedia')); assert(md.indexOf('Narración intermedia') < md.indexOf('Texto final'));
 assert(md.includes('Documento original'));
 for (const date of [null, '2026-02-30']) assert.doesNotMatch(buildAlbumMarkdown({ album, items: [{ kind: 'memory', memory: { id: 4, memory_date: date, date_precision: 'exact' } }] }), /"fecha":/);
});

test('album markdown HTTP download scopes album, memories and people to family', async () => {
 const db = require('./db'), previous = db.query;
 db.query = async (sql, p) => {
  if (sql.includes('FROM families')) return { rows: [{ id: Number(p[0]) }] };
  if (sql.includes('FROM memberships')) return { rows: p[0] === 2 ? [{ role: 'reader' }] : [] };
  if (sql.includes('FROM albums')) { assert.equal(p[1], 2); return { rows: p[0] === '9' ? [{ id: 9, title: 'Álbum 李', memory_ids: [{ type: 'memory', id: 3 }, { type: 'story', text: 'En medio' }, { type: 'memory', id: 1 }, { type: 'memory', id: 999 }] }] : [] }; }
  if (sql.includes('FROM memories m')) { assert.match(sql, /m.family_id=\$2/); assert.match(sql, /memory_date::text/); return { rows: [{ id: 1, title: 'Uno', memory_date: '2026-10-09', date_precision: 'exact' }, { id: 3, title: 'Tres', memory_date: null }] }; }
  if (sql.includes('FROM memory_people')) { assert.match(sql, /p.family_id=\$2/); return { rows: [{ memory_id: 3, name: 'Miguel' }] }; }
  throw Error('Unexpected SQL');
 };
 const app=express();app.use((req,res,next)=>{req.session=req.get('x-user')?{user:{id:1}}:{};req.t=k=>k;req.lang='es';res.render=(v,data)=>res.json(data);next()});
 const { requireAuth, loadFamily }=require('./mw');app.use('/families/:fid/workshop', requireAuth, loadFamily, require('./routes-workshop'));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s))});
 const get=(path,signed=true)=>fetch(`http://127.0.0.1:${server.address().port}`+path,{headers:signed?{'x-user':'1'}:{},redirect:'manual'});
 try {
  const response=await get('/families/2/workshop/9/download-md');assert.equal(response.status,200);
  assert.match(response.headers.get('content-disposition'),/filename\*=UTF-8''/);assert.match(response.headers.get('content-type'),/text\/markdown/);
  const md=await response.text();const records=JSON.parse(md.match(/^recuerdos: (.*)$/m)[1]);assert.deepEqual(records.map(r=>r.id),[3,1]);assert.deepEqual(records[0].personas,['Miguel']);
  assert.equal((await get('/families/2/workshop/9/download-md',false)).status,302);
  assert.equal((await get('/families/3/workshop/9/download-md')).status,403);
  assert.equal((await get('/families/2/workshop/99/download-md')).status,404);
 } finally {db.query=previous;await new Promise(r=>server.close(r))}
});
