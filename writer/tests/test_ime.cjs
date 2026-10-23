'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const context={window:{},console,fetch:async()=>({ok:false,status:404})};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(base,'../web/kamotish.js'),'utf8'),context);
context.Kamotish=context.window.Kamotish;
vm.runInContext(fs.readFileSync(path.join(base,'ime.js'),'utf8'),context);
const ime=context.window.KamoIME;
ime._testSetShards({
  n:{ni:[['你',100000]],nihao:[['你好',1000000]]},
  w:{wo:[['我',1000000]]},
  j:{jintian:[['今天',100000]]},
  h:{hen:[['很',100000]],hao:[['好',100000]]},
  z:{zhongguo:[['中国',1000000]]}
});
const cn=s=>ime.candidates(s).map(c=>c.value);
assert.equal(ime.candidates('mi')[0].type,'glyph');
assert.equal(ime.candidates('mi')[4].type,'phon');
assert.equal(ime.candidates('mi')[1].value,'\\mi\\2');
assert.equal(ime.candidates('mi')[2].value,'\\mi\\3');
assert.equal(ime.candidates('mi')[3].value,'\\mi\\4');
assert.equal(ime.candidates('wou')[0].value,'\\wou');
assert.equal(ime.candidates('hou')[5].value,'\\hou2');
assert.equal(ime.candidates('nihao')[0].value,'ni-hao');
assert.ok(cn('nihao').includes('你好'));
assert.ok(cn('wojintian').includes('我今天'));
assert.ok(cn('niha').includes('你好')); // prefix completion
assert.equal(ime.candidates('ni')[0].value,'ni'); // No grapheme, phoneme first
assert.ok(cn('zhongguo').includes('中国'));
assert.equal(ime.candidates('nou')[0].value,'\\nou');
assert.ok(!ime.candidates('no').some(c=>c.type==='glyph'));
console.log('IME candidate priority, polyphony, Rime phrase and sentence composition tests passed');
