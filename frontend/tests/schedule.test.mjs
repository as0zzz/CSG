import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,day,shift,iso} from '../src/schedule.ts';

const definitions=[['A',6,[]],['B',2,[]],['C',3,['A']],['D',5,['A']],['E',3,['A']],['F',2,['C']],['G',3,['D']],['H',4,['B','E']],['I',2,['H']],['J',2,['F','G','I']]];
function reference(){const tasks=[];for(const [code,duration,preds] of definitions){const start=Math.max(day('2026-11-12'),...preds.map(p=>day(tasks.find(t=>t.id===p).end_date)+1));tasks.push({id:code,code,title:code,start_date:iso(start),end_date:iso(start+duration-1),duration_days:duration,predecessor_ids:preds,version:1});}return tasks;}
test('reference matches 17-day schedule and critical A-E-H-I-J chain',()=>{const tasks=reference(),m=analyze(tasks);assert.equal(m.duration,17);assert.deepEqual([...m.critical].sort(),['A','E','H','I','J']);assert.equal(m.conflicts.length,0);assert.equal(tasks.find(t=>t.id==='J').start_date,'2026-11-27');});
test('manual move violating predecessor is highlighted',()=>{const tasks=reference();tasks.find(t=>t.id==='C').start_date='2026-11-13';assert.deepEqual(analyze(tasks).conflicts,[{from:'A',to:'C'}]);});
test('cycle fails instead of silently producing an invalid diagram',()=>{const tasks=reference();tasks[0].predecessor_ids=['J'];assert.throws(()=>analyze(tasks),/Цикл/);});
test('calendar arithmetic crosses month/year boundaries without timezone shifts',()=>{assert.equal(shift('2026-12-31',1),'2027-01-01');assert.equal(shift('2026-11-12',-12),'2026-10-31');assert.equal(iso(day('2026-11-12')),'2026-11-12');});
test('empty graph has no invented duration or critical tasks',()=>{const m=analyze([]);assert.equal(m.duration,0);assert.equal(m.critical.size,0);});
