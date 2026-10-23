'use strict';
window.KamotishWriter = { mount(container, options = {}) {
/* Kamotish Writer v2: selectable SVG units, versioned native document and custom UI. */
const $ = id => container.querySelector('#kw-' + id);
let hasDocument=false, loadingDocument=false, revision=0, savedRevision=0, createdAt='', saveQueue=Promise.resolve(), libraryRecords=[], nameAction=null, deleteTarget=null, insertionTarget=null;
let openedDocument = null, baseline = '', automaticZoom = !localStorage.getItem('kamotish-writer-zoom');
const editor=$('editor'), ime=$('ime'), layout=$('layout'), workspace=$('workspace');
const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NAMED_TONES=['一声','二声','三声','四声'];
const GLYPH=/^\\([a-z][a-z']*\d?)(?:\\([1-4]))?/;
const KNOWN_GLYPHS=new Set(Kamotish.graphemeNames());
const PRESETS={block:[['p','正文'],['h1','标题 1'],['h2','标题 2'],['h3','标题 3'],['blockquote','引用']],font:[['serif','宋体 / Serif'],['sans-serif','黑体 / Sans'],['monospace','等宽字体']],size:['12','14','16','18','20','24','30','36','48'].map(x=>[x,x+' px']),zoom:[.5,.65,.75,.85,1,1.1,1.25,1.5,1.75,2].map(x=>[String(x),Math.round(x*100)+'%']).concat([['fit','适合宽度']])};
let mode='kamo', composing='', items=[],active=0,selectionBefore=null,saveTimer,selectedToneUnit=null,zoom=1,dropdownType='',swatchColor='#24313d',docId=crypto.randomUUID?.()||String(Date.now());
function notify(s){let t=$('toast');t.textContent=s;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2600)}
function filename(){return ($('docTitle').value||'Kamotish').replace(/[\\/:*?"<>|]/g,'_')}
function download(name,data,mime){const blob=new Blob([data],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)}
function normalizedSource(v){ // Repair one known v1 bug: literals with doubled slash before a command.
  return String(v||'').replace(/\\no(?![a-z'])/g,'\\nou').replace(/\\\\(?=[a-z][a-z']*\d?|[234])/g,'\\');
}
// A run is editable, but each vector grapheme / syllable is one *individually* selectable atom.
// Store the exact source spelling on each atom; SVG is purely a view, never serialized as content.
function unit(raw,kind,name='',tone=''){if(kind==='glyph'){raw=normalizedSource(raw);if(name==='no')name='nou';}const e=document.createElement('span');e.className='kw-unit';e.contentEditable='false';e.dataset.raw=raw;e.dataset.kind=kind;if(name)e.dataset.name=name;if(tone)e.dataset.tone=tone;const display=kind==='separator'?'':kind==='text'?'':kind==='glyph'? '\\'+name+(tone?'\\'+tone:''):raw.replace(/^-/, '');if(kind==='separator'){e.classList.add('kw-hidden');e.textContent='';}else if(kind==='text')e.textContent=raw;else e.innerHTML=Kamotish.renderInline(display);e.setAttribute('aria-label',kind==='glyph'?name+(tone?NAMED_TONES[Number(tone)-1]:'一声'):raw);return e;}
function makeKamoRun(value,{legacy=false}={}){
  const source=normalizedSource(value);let out=document.createElement('span');out.className='kamo-run';out.dataset.kamoRun='true';
  let i=0,plain='',pending='';const flush=()=>{if(plain){out.appendChild(document.createTextNode(plain));plain='';}};
  while(i<source.length){
    const rest=source.slice(i),ch=source[i];
    if(ch==='\\'){
      const m=GLYPH.exec(rest);
      if(m&&KNOWN_GLYPHS.has(m[1])){flush();if(pending){out.append(unit(pending,'separator'));pending='';}out.append(unit(m[0],'glyph',m[1],m[2]||''));i+=m[0].length;continue;}
      plain+=ch;i++;continue;
    }
    if(ch==='-'){
      // A single dash is a lexical separator; two dashes render as one literal dash.
      flush();if(source[i+1]==='-'){if(pending){out.append(unit(pending,'separator'));pending='';}out.append(unit('--','text'));i+=2;continue;}
      pending+='-';i++;continue;
    }
    if(/[a-z]/i.test(ch)){
      const m=/^[A-Za-z]+/.exec(rest);let end=i+m[0].length,part=m[0],t='';
      if(!/[A-Z]/.test(part)){const tone=/^\\([1-4])/.exec(source.slice(end));if(tone){t=tone[1];end+=tone[0].length;}}
      flush();const raw=pending+source.slice(i,end);pending='';
      // Abbreviations are plain text, as in the native Kamotish renderer.
      if(/[A-Z]/.test(part)){out.append(unit(raw,'text'));}
      else {out.append(unit(raw,'phon'));}
      i=end;continue;
    }
    if(pending){flush();out.append(unit(pending,'separator'));pending='';}
    plain+=ch;i++;
  }
  if(pending){flush();out.append(unit(pending,'separator'));}flush();return out;
}
function sourceOfRun(run){let value='';for(const node of run.childNodes){if(node.nodeType===3)value+=node.textContent;else if(node.nodeType===1){if(node.classList.contains('kw-unit'))value+=node.dataset.raw||'';else if(node.classList.contains('kamo-run'))value+=sourceOfRun(node);else value+=sourceOfRun(node);}}return value;}
function upgradeOldTokens(parent=editor){parent.querySelectorAll('.kamo-token').forEach(e=>e.replaceWith(makeKamoRun(e.dataset.kamo||'',{legacy:true})));}
function insertNode(node){restoreSelection();const s=window.getSelection();if(!s.rangeCount){editor.focus();return}const r=s.getRangeAt(0);r.deleteContents();r.insertNode(node);r.setStartAfter(node);r.collapse(true);s.removeAllRanges();s.addRange(r);saveSelection();changed();}
function insertText(s){insertNode(document.createTextNode(s))}
function insertKamo(src){insertNode(makeKamoRun(src))}
function insideEditor(){const s=getSelection();return !!s?.anchorNode&&(s.anchorNode===editor||editor.contains(s.anchorNode))}
function saveSelection(){const s=getSelection();if(insideEditor()&&s.rangeCount)selectionBefore=s.getRangeAt(0).cloneRange()}
function restoreSelection(){editor.focus({preventScroll:true});if(selectionBefore){const s=getSelection();try{s.removeAllRanges();s.addRange(selectionBefore.cloneRange())}catch{editor.focus()}}}
function selectedUnits(range){if(!range||range.collapsed)return[];return [...editor.querySelectorAll('.kw-unit')].filter(e=>{try{return range.intersectsNode(e)}catch{return false}})}
function drawSelection(){const s=getSelection(),r=s?.rangeCount?s.getRangeAt(0):null;const all=r&&insideEditor()?selectedUnits(r):[];editor.querySelectorAll('.kw-unit.is-selected').forEach(e=>{if(!all.includes(e))e.classList.remove('is-selected')});all.forEach(e=>e.classList.add('is-selected'));}
function changed(){refreshOutline();if(!hasDocument||loadingDocument)return;revision++;$('saveStatus').textContent='尚未保存';clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(),450)}
function refreshOutline(){const root=$('outline');root.replaceChildren();editor.querySelectorAll('h1,h2,h3').forEach(h=>{const b=document.createElement('button');b.className=h.tagName.toLowerCase();b.textContent=h.textContent.trim()||'未命名标题';b.onclick=()=>h.scrollIntoView({behavior:'smooth',block:'center'});root.append(b)});$('counter').textContent=editor.textContent.replace(/\s/g,'').length+' 字'}
function placeFixed(el,rect){el.hidden=false;const w=el.offsetWidth,h=el.offsetHeight;el.style.left=Math.max(8,Math.min(innerWidth-w-9,rect.left))+'px';el.style.top=(rect.bottom+h+10>innerHeight?Math.max(8,rect.top-h-7):rect.bottom+7)+'px'}
function closeTone(){selectedToneUnit=null;$('tonePicker').hidden=true}
function setTone(e,tone){if(!e?.isConnected||e.dataset.kind!=='glyph')return;const name=e.dataset.name;const n=String(tone);e.dataset.raw='\\'+name+(tone?'\\'+n:'');if(tone)e.dataset.tone=n;else delete e.dataset.tone;e.innerHTML=Kamotish.renderInline(e.dataset.raw);e.setAttribute('aria-label',name+' '+NAMED_TONES[Number(tone||1)-1]);closeTone();changed();}
function showTone(e){if(e.dataset.kind!=='glyph')return;closeDropdown();selectedToneUnit=e;let target=$('toneChoices');target.replaceChildren();for(let i=1;i<=4;i++){const t=i===1?'':String(i),b=document.createElement('button');b.className=(e.dataset.tone||'')===t?'selected':'';b.type='button';b.innerHTML=`${Kamotish.renderInline('\\'+e.dataset.name+(t?'\\'+t:''))}<small>${NAMED_TONES[i-1]}</small>`;b.onclick=()=>setTone(e,t);target.append(b)}placeFixed($('tonePicker'),e.getBoundingClientRect())}
editor.addEventListener('click',e=>{saveSelection();const t=e.target.closest('.kw-unit[data-kind="glyph"]');if(t)showTone(t);else closeTone();});
document.addEventListener('selectionchange',()=>{if(!composing)saveSelection();drawSelection();});
editor.addEventListener('keyup',saveSelection);editor.addEventListener('mouseup',saveSelection);
// Browser clipboard usually turns inline SVG into blanks. Export selected vector units as
// Kamotish source, including partially selected runs. Non-Kamotish selections use native copy.
function copySourceFromFragment(root){
  let result='';for(const n of root.childNodes){
    if(n.nodeType===3){result+=n.textContent;continue}if(n.nodeType!==1)continue;
    if(n.classList.contains('kamo-run'))result+='\\kamotish{'+sourceOfRun(n)+'}';
    else if(n.classList.contains('kw-unit'))result+='\\kamotish{'+(n.dataset.raw||'')+'}';
    else if(n.tagName==='BR')result+='\n';
    else result+=copySourceFromFragment(n)+(n.matches('p,div,h1,h2,h3,li')?'\n':'');
  }return result;
}
function writeSelectedClipboard(e,shouldCut){const s=getSelection();if(!insideEditor()||!s.rangeCount||s.isCollapsed)return false;
  const range=s.getRangeAt(0),selected=selectedUnits(range);if(!selected.length)return false;
  const fragment=range.cloneContents();const value=copySourceFromFragment(fragment);
  e.preventDefault();e.clipboardData?.setData('text/plain',value);
  if(shouldCut){range.deleteContents();s.removeAllRanges();s.addRange(range);changed()}
  return true;
}
editor.addEventListener('copy',e=>writeSelectedClipboard(e,false));
editor.addEventListener('cut',e=>writeSelectedClipboard(e,true));
editor.addEventListener('paste',e=>{
  const plain=e.clipboardData?.getData('text/plain')||'';
  // Restore plain copied formulas as rendered, editable SVG units.
  if(/^\\kamotish\{[^{}]*\}$/.test(plain.trim())){e.preventDefault();insertKamo(plain.trim().slice(10,-1));}
});
// Tone keys commit tones; candidate selection and paging use separate arrow keys.
const IME_PAGE_SIZE=6;
function setMode(m){stopIme();mode=m;$('kamoMode').classList.toggle('active',m==='kamo');$('nativeMode').classList.toggle('active',m==='native');notify(m==='kamo'?'卡谋语拼音已开启':'系统中文输入已开启')}
$('kamoMode').onclick=()=>setMode('kamo');$('nativeMode').onclick=()=>setMode('native');
KamoIME.onupdate=status=>{$('dictionaryStatus').textContent=status;if(composing)drawIme()};KamoIME.init();
function stopIme(){composing='';ime.hidden=true;active=0;items=[]}
function caretRect(){
 const selection=getSelection();let range=selection?.rangeCount?selection.getRangeAt(0).cloneRange():selectionBefore?.cloneRange();
 if(!range||!editor.contains(range.startContainer)){range=document.createRange();range.selectNodeContents(editor);range.collapse(false);}
 range.collapse(false);let rect=range.getBoundingClientRect();
 if(rect.height&& (rect.left||rect.top))return rect;
 // Empty contenteditable blocks can return a zero rectangle. A temporary marker
 // measures the actual caret, including CSS zoom and the workspace scroll offset.
 const marker=document.createElement('span');marker.textContent='\u200b';marker.style.cssText='display:inline;pointer-events:none';
 range.insertNode(marker);rect=marker.getBoundingClientRect();marker.remove();return rect;
}
function placeIme(){if(composing)placeFixed(ime,caretRect());}
workspace.addEventListener('scroll',placeIme,{passive:true});window.addEventListener('resize',placeIme);
function preview(x){return x.type==='glyph'||x.type==='phon'?Kamotish.renderInline(x.value):safe(x.value)}
function drawIme(){
 if(!composing){ime.hidden=true;return;}items=KamoIME.candidates(composing);active=Math.min(active,Math.max(0,items.length-1));
 const page=Math.floor(active/IME_PAGE_SIZE),start=page*IME_PAGE_SIZE;
 $('composition').textContent=composing;
 $('candidates').innerHTML=items.slice(start,start+IME_PAGE_SIZE).map((c,j)=>`<button data-i="${start+j}" class="candidate ${start+j===active?'selected':''}"><span class="kamoPreview">${preview(c)}</span><span class="caption">${safe(c.label)}</span></button>`).join('');
 container.querySelector('.imeFoot').textContent=`1–4 一至四声 · ←→ 选择 · ↑↓ 翻页 · Enter/空格 确认 · ${page+1}/${Math.max(1,Math.ceil(items.length/IME_PAGE_SIZE))} 页 · Esc`;
 placeIme();
}
function chooseTone(tone){
 const selected=items[active],target=selected&&['glyph','phon'].includes(selected.type)?selected:items.find(c=>['glyph','phon'].includes(c.type));
 if(!target)return;
 const value=target.value.replace(/\\[1-4]$/,'')+(tone==='1'?'':'\\'+tone);
 stopIme();insertKamo(value);editor.focus();
}
function choose(i=active){const c=items[i];if(!c)return;stopIme();if(c.type==='glyph'||c.type==='phon')insertKamo(c.value);else insertText(c.value);editor.focus()}
$('candidates').addEventListener('mousedown',e=>e.preventDefault());$('candidates').addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(b)choose(Number(b.dataset.i))});
editor.addEventListener('keydown',e=>{if(mode!=='kamo'||e.isComposing||e.ctrlKey||e.metaKey||e.altKey)return;
 if(composing){
  if(e.key==='Escape'){e.preventDefault();stopIme();return}
  if(e.key==='Backspace'){e.preventDefault();composing=composing.slice(0,-1);drawIme();return}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const pages=Math.max(1,Math.ceil(items.length/IME_PAGE_SIZE));const page=Math.max(0,Math.min(pages-1,Math.floor(active/IME_PAGE_SIZE)+(e.key==='ArrowDown'?1:-1)));active=Math.min(items.length-1,page*IME_PAGE_SIZE+active%IME_PAGE_SIZE);drawIme();return}
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const start=Math.floor(active/IME_PAGE_SIZE)*IME_PAGE_SIZE,count=Math.min(IME_PAGE_SIZE,items.length-start);active=start+(active-start+(e.key==='ArrowRight'?1:count-1))%Math.max(1,count);drawIme();return}
  if(/^[1-4]$/.test(e.key)){e.preventDefault();chooseTone(e.key);return}
  if(e.key===' '||e.key==='Enter'){e.preventDefault();choose();return}
  if(/^[a-z']$/i.test(e.key)){e.preventDefault();composing+=e.key.toLowerCase();active=0;drawIme();return}
  if(e.key==='-'){e.preventDefault();composing+="'";active=0;drawIme();return}
  if(e.key.length===1){e.preventDefault();const c=items[0];if(c)choose(0);insertText(e.key);return}
  stopIme();
 }
 if(/^[a-z]$/i.test(e.key)){e.preventDefault();saveSelection();closeTone();closeDropdown();composing=e.key.toLowerCase();drawIme()}
});
// Toolbar dropdowns are custom listboxes: no browser-native select controls.
const menu=$('dropdown');
function closeDropdown(){menu.hidden=true;dropdownType='';container.querySelectorAll('.menuAnchor[aria-expanded="true"]').forEach(b=>b.setAttribute('aria-expanded','false'))}
function openMenu(anchor,type){if(!menu.hidden&&dropdownType===type){closeDropdown();return}closeTone();saveSelection();dropdownType=type;container.querySelectorAll('.menuAnchor').forEach(b=>b.setAttribute('aria-expanded',String(b===anchor)));menu.replaceChildren();
 menu.setAttribute('role',type==='file'?'menu':'listbox');
 if(type==='file'||type==='insert'){
   menu.setAttribute('role','menu');
   const entries=type==='insert'
     ? [['图片…','从本机选择，可多选',chooseImages],['表格…','设置行数、列数与表头',openTableDialog],['分隔线','',()=>insertHtmlAtCaret('<hr><p><br></p>')],['卡谋语…','字素与拟素',openInsert]]
     : [...(hasDocument?[['文稿',''],['新建文稿…','创建空白文稿',newDocument],['重命名…','修改当前文稿名称',()=>renameDocument(docId)],['关闭文稿','保存后返回文稿列表',closeDocument]]:[]),['导入',''],['导入单个文件…','Markdown、原生文稿、文本',()=>$('fileInput').click()],['导入文件夹…','Markdown 与本地图片',()=>$('folderInput').click()],...(hasDocument?[['保存与导出',''],['立即保存','保存到此浏览器的文稿库',()=>save().then(ok=>{if(ok)notify('已保存到我的文稿');})],['下载原生文稿…','.kamodoc · 保留格式与插图',saveNative],['导出 Markdown…','.md · 与文档工具互通',exportMd]]:[])];
   for(const [label,hint,action] of entries){
     const el=document.createElement(action?'button':'div');
     if(action){el.className='menuItem fileMenuItem';el.setAttribute('role','menuitem');el.innerHTML='<span>'+safe(label)+'</span><small>'+safe(hint)+'</small>';el.onclick=()=>{closeDropdown();try{const result=action();result?.catch?.(e=>notify(e.message));}catch(e){notify(e.message);}};}
     else{el.className='menuHeading';el.textContent=label;}
     menu.append(el);
   }
 }else if(type==='color'){const grid=document.createElement('div');grid.className='swatchGrid';for(const color of ['#252b32','#5f6875','#e34b50','#dc8b2c','#e4c141','#348e6a','#168c9b','#335eae','#7444af','#c3429a','#ffffff','#000000']){const b=document.createElement('button');b.className='swatch';b.style.background=color;b.title=color;b.setAttribute('aria-label',color);b.onclick=()=>{applyFormat('foreColor',color);swatchColor=color;container.querySelector('.colorMark').style.borderBottomColor=color;closeDropdown()};grid.append(b)}menu.append(grid)}
 else for(const [val,label] of PRESETS[type]||[]){const b=document.createElement('button');b.className='menuItem';b.setAttribute('role','option');b.dataset.value=val;b.innerHTML=`<span>${safe(label)}</span>`;b.onclick=()=>{if(type==='zoom'){if(val==='fit'){automaticZoom=true;localStorage.removeItem('kamotish-writer-zoom');fitWidth();}else setZoom(Number(val));}else if(type==='block')applyBlock(val);else if(type==='font')applyFont(val);else if(type==='size')applySize(Number(val));closeDropdown()};menu.append(b)}
 placeFixed(menu,anchor.getBoundingClientRect());if(type==='file'||type==='insert')menu.querySelector('button')?.focus();}
container.querySelectorAll('[data-menu]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();openMenu(b,b.dataset.menu)}));
menu.addEventListener('keydown',e=>{const btns=[...menu.querySelectorAll('button')];let index=btns.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();btns[(index+(e.key==='ArrowDown'?1:btns.length-1))%btns.length]?.focus()}else if(e.key==='Escape'){const anchor=container.querySelector('.menuAnchor[aria-expanded="true"]');closeDropdown();anchor?.focus();}});
document.addEventListener('pointerdown',e=>{container.querySelectorAll('.document-actions[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;});if(!e.target.closest('#kw-dropdown,.menuAnchor'))closeDropdown();if(!e.target.closest('#kw-tonePicker,.kw-unit'))closeTone()});
function formatKw(command,value,units){for(const u of units){if(command==='bold')u.style.fontWeight=u.style.fontWeight==='bold'?'':'bold';if(command==='italic')u.style.fontStyle=u.style.fontStyle==='italic'?'':'italic';if(command==='underline')u.style.textDecoration=u.style.textDecoration.includes('underline')?'':'underline';if(command==='strikeThrough')u.style.textDecoration=u.style.textDecoration.includes('line-through')?'':'line-through';if(command==='foreColor')u.style.color=value;if(command==='fontName')u.style.fontFamily=value;if(command==='fontSize')u.style.fontSize=value+'px';}}
function applyFormat(cmd,value){restoreSelection();const s=getSelection(),units=s.rangeCount?selectedUnits(s.getRangeAt(0)):[];document.execCommand(cmd,false,value===undefined?null:value);if(units.length)formatKw(cmd,value,units);changed()}
function applyBlock(tag){restoreSelection();document.execCommand('formatBlock',false,tag==='blockquote'?'blockquote':tag);changed()}
function applyFont(font){restoreSelection();applyFormat('fontName',font)}
function applySize(px){restoreSelection();const units=getSelection()?.rangeCount?selectedUnits(getSelection().getRangeAt(0)):[];document.execCommand('fontSize',false,'3');editor.querySelectorAll('font[size="3"]').forEach(f=>{f.removeAttribute('size');f.style.fontSize=px+'px'});formatKw('fontSize',px,units);changed()}
container.querySelectorAll('[data-cmd]').forEach(b=>{b.addEventListener('mousedown',e=>e.preventDefault());b.onclick=()=>applyFormat(b.dataset.cmd)});
$('undoBtn').onclick=()=>{editor.focus();document.execCommand('undo');changed()};$('redoBtn').onclick=()=>{editor.focus();document.execCommand('redo');changed()};
// Zoom uses CSS layout zoom, not a transform: caret, DOM selection and popup coordinates stay correct.
function setZoom(z,persist=true){zoom=Math.min(2,Math.max(.5,Math.round(z*100)/100));container.style.setProperty('--doc-zoom',String(zoom));$('zoomLevel').textContent=Math.round(zoom*100)+'%';if(persist){automaticZoom=false;localStorage.setItem('kamotish-writer-zoom',String(zoom));}}
$('zoomOut').onclick=()=>setZoom(zoom-.1);$('zoomIn').onclick=()=>setZoom(zoom+.1);
workspace.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();setZoom(zoom*Math.exp(-e.deltaY*.01))}},{passive:false});
// Safari sends proprietary gesture events on some trackpads.
let gestureBase=1;workspace.addEventListener('gesturestart',e=>{e.preventDefault();gestureBase=zoom},{passive:false});workspace.addEventListener('gesturechange',e=>{e.preventDefault();setZoom(gestureBase*e.scale)},{passive:false});workspace.addEventListener('gestureend',e=>e.preventDefault(),{passive:false});
$('sideToggle').onclick=()=>{if(matchMedia('(max-width:760px)').matches){const opened=layout.classList.toggle('outline-open');layout.classList.remove('collapsed');$('sideToggle').setAttribute('aria-expanded',String(opened));return;}const collapsed=layout.classList.toggle('collapsed');$('sideToggle').setAttribute('aria-expanded',String(!collapsed));localStorage.setItem('kamotish-writer-sidebar',collapsed?'hidden':'visible')};
// Insert dialog with live SVG preview, no window.prompt().
function sourceValue(){const value=$('kamoSource').value.trim();return value.startsWith('\\kamotish{')&&value.endsWith('}')?value.slice('\\kamotish{'.length,-1):value}
function openInsert(){saveSelection();$('kamoDialog').hidden=false;$('kamoSource').value='\\mi\\wou\\3中国人\\mou\\2';updatePreview();$('kamoSource').focus()}
function updatePreview(){$('sourcePreview').innerHTML=Kamotish.renderInline(sourceValue())}
$('kamoSource').addEventListener('input',updatePreview);
$('cancelInsert').onclick=()=>{$('kamoDialog').hidden=true;editor.focus()};
$('confirmInsert').onclick=()=>{const s=sourceValue();$('kamoDialog').hidden=true;if(s)insertKamo(s)};
$('kamoDialog').addEventListener('pointerdown',e=>{if(e.target===$('kamoDialog'))$('cancelInsert').click()});
// Lossless roundtrip for supported editor markup; preserve *source*, not thousands of SVG path nodes.
// The schema is versioned; all user-visible formatting and vector tokens are represented as JSON data.
const BLOCK_TAGS=new Set(['P','DIV','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','UL','OL','LI','BR','STRONG','B','EM','I','U','S','STRIKE','SPAN','FONT','A','SUP','SUB','CODE','PRE','HR','TABLE','THEAD','TBODY','TR','TH','TD']);
const STYLE_FIELDS=['color','backgroundColor','fontFamily','fontSize','fontWeight','fontStyle','textDecoration','textAlign','lineHeight','letterSpacing','textIndent'];
function safeLink(value, image=false){
 const s=String(value||'').trim();
 const scheme=s.replace(/[\u0000-\u0020]/g,'');
 if (/^(?:https?:|mailto:)/i.test(scheme) || !/^[a-z][a-z0-9+.-]*:/i.test(scheme)) return s;
 if (image && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|avif|bmp|x-icon)[;,]/i.test(s)) return s;
 return '';
}
function nodeToAst(n){if(n.nodeType===3)return {t:'text',v:n.textContent};if(n.nodeType!==1)return null;
 if(n.tagName==='IMG')return {t:'image',src:safeLink(n.getAttribute('src'),true),originalSrc:n.dataset.originalSrc||'',alt:n.getAttribute('alt')||'',title:n.getAttribute('title')||''};
 if(n.classList.contains('kw-unit'))return {t:'unit',raw:n.dataset.raw||'',kind:n.dataset.kind||'phon',name:n.dataset.name||'',tone:n.dataset.tone||'',style:extractStyles(n)};
 if(n.classList.contains('kamo-run'))return {t:'run',children:[...n.childNodes].map(nodeToAst).filter(Boolean)};
 if(!BLOCK_TAGS.has(n.tagName))return {t:'element',tag:'span',children:[...n.childNodes].map(nodeToAst).filter(Boolean)};
 let tag=n.tagName.toLowerCase(),style=extractStyles(n);if(tag==='font'){tag='span';if(n.color)style.color=n.color;if(n.face)style.fontFamily=n.face;}
 const result={t:'element',tag,children:[...n.childNodes].map(nodeToAst).filter(Boolean)};
 if(Object.keys(style).length)result.style=style;
 if(n.tagName==='A')result.href=safeLink(n.getAttribute('href'));
 if(n.tagName==='TD'||n.tagName==='TH'){result.colspan=n.colSpan;result.rowspan=n.rowSpan;}
 return result;
}
function extractStyles(e){const result={};for(const key of STYLE_FIELDS)if(e.style?.[key])result[key]=e.style[key];return result}
function applySafeStyles(e,style){if(!style||typeof style!=='object')return;for(const key of STYLE_FIELDS){const v=style[key];if(typeof v==='string'&&v.length<180&&!/expression\s*\(|url\s*\(/i.test(v))e.style[key]=v}}
function astToNode(n){if(!n||typeof n!=='object')return document.createTextNode('');if(n.t==='text')return document.createTextNode(String(n.v||''));if(n.t==='image'){const e=document.createElement('img');e.src=safeLink(n.src,true);e.alt=String(n.alt||'');e.title=String(n.title||'');if(n.originalSrc)e.dataset.originalSrc=safeLink(n.originalSrc,true);return e;}if(n.t==='unit'){const kind=['phon','glyph','separator','text'].includes(n.kind)?n.kind:'text';const e=unit(String(n.raw||''),kind,String(n.name||''),String(n.tone||''));applySafeStyles(e,n.style);return e}
 if(n.t==='run'){const e=document.createElement('span');e.className='kamo-run';e.dataset.kamoRun='true';for(const x of (Array.isArray(n.children)?n.children:[]))e.append(astToNode(x));return e}
 let tag=String(n.tag||'span').toUpperCase();if(!BLOCK_TAGS.has(tag)||tag==='FONT')tag='SPAN';const e=document.createElement(tag);applySafeStyles(e,n.style);if(tag==='A')e.href=safeLink(n.href);if(tag==='TD'||tag==='TH'){e.colSpan=Math.max(1,Math.min(100,Number(n.colspan)||1));e.rowSpan=Math.max(1,Math.min(100,Number(n.rowspan)||1));}for(const x of (Array.isArray(n.children)?n.children:[]))e.append(astToNode(x));return e;
}
function exportNative(){return {format:'Kamotish Writer',schemaVersion:2,id:docId,title:$('docTitle').value,createdBy:'Kamotish Writer 2',savedAt:new Date().toISOString(),page:{size:'A4'},content:[...editor.childNodes].map(nodeToAst).filter(Boolean)}}
function importNative(doc){if(doc?.format!=='Kamotish Writer'||doc.schemaVersion!==2||!Array.isArray(doc.content))throw Error('不是支持的 .kamodoc 文档 (需要版本 2)');if(doc.content.length>100000)throw Error('文档节点数量异常');editor.replaceChildren(...doc.content.map(astToNode));$('docTitle').value=String(doc.title||'未命名文稿');docId=String(doc.id||docId);changed()}
function saveNative(){download(filename()+'.kamodoc',JSON.stringify(exportNative(),null,2),'application/vnd.kamotish-writer+json;charset=utf-8');notify('原生 .kamodoc 文稿已导出');}
// Markdown intentionally has fewer features than .kamodoc; custom marks are expressed as inline HTML where supported.
function serializeInline(root,insideRun=false){let out='',kamo='';const flush=()=>{if(kamo){out+='\\kamotish{'+kamo+'}';kamo=''}};
 for(const n of root.childNodes){if(n.nodeType===3){if(insideRun)kamo+=n.textContent;else{flush();out+=n.textContent.replace(/([\\*_`\[\]])/g,'\\$1')}continue}if(n.nodeType!==1)continue;
 if(n.classList.contains('kw-unit')){if(!Object.keys(extractStyles(n)).length){kamo+=n.dataset.raw||'';continue}flush();let content='\\kamotish{'+(n.dataset.raw||'')+'}';for(const [field,val] of Object.entries(extractStyles(n))){if(field==='fontWeight'&&val==='bold')content='**'+content+'**';else if(field==='fontStyle'&&val==='italic')content='*'+content+'*';else if(field==='textDecoration'&&val.includes('underline'))content='<u>'+content+'</u>';else content=`<span style="${field.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}:${safe(val)}">${content}</span>`;}out+=content;continue}
 if(n.classList.contains('kamo-run')){flush();out+=serializeInline(n,true);continue}
 flush();let v=serializeInline(n,insideRun);switch(n.tagName){case'IMG':if((n.getAttribute('src')||'').startsWith('data:image/svg+xml')){v='<img src="'+safe(n.getAttribute('src'))+'" alt="'+safe(n.alt||'')+'">';break;}v='!['+(n.alt||'').replace(/[\[\]]/g,'')+'](<'+(n.dataset.originalSrc||n.getAttribute('src')||'').replace(/>/g,'%3E')+'>)';break;case'BR':v='  \n';break;case'B':case'STRONG':v='**'+v+'**';break;case'I':case'EM':v='*'+v+'*';break;case'U':v='<u>'+v+'</u>';break;case'S':case'STRIKE':v='~~'+v+'~~';break;case'A':v='['+v+']('+safe(n.getAttribute('href')||'')+')';break;default:if(Object.keys(extractStyles(n)).length){const css=Object.entries(extractStyles(n)).map(([k,w])=>k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+safe(w)).join(';');v='<span style="'+css+'">'+v+'</span>'}}out+=v}
 flush();return out;
}
function blockMd(n){
 if(n.nodeType===3)return n.textContent.trim();if(n.nodeType!==1)return '';
 const tag=n.tagName,s=serializeInline(n).trim(),align=n.style.textAlign||'';let result;
 if(/^H[1-6]$/.test(tag))result='#'.repeat(+tag[1])+' '+s;
 else if(tag==='BLOCKQUOTE')result=[...n.childNodes].map(blockMd).filter(Boolean).join('\n\n').split('\n').map(line=>'> '+line).join('\n');
 else if(tag==='UL'||tag==='OL')result=[...n.children].map((li,i)=>(tag==='UL'?'- ':`${i+1}. `)+serializeInline(li).trim()).join('\n');
 else if(tag==='HR')result='---';
 else if(tag==='PRE'){
   const fence='`'.repeat(Math.max(3,...[...n.textContent.matchAll(/`+/g)].map(m=>m[0].length+1)));
   result=fence+'\n'+n.textContent.replace(/\n$/,'')+'\n'+fence;
 }else if(tag==='TABLE'){
   const rows=[...n.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>serializeInline(td).trim().replace(/\|/g,'\\|').replace(/\n/g,'<br>')));
   if(!rows.length)return '';
   const width=Math.max(...rows.map(r=>r.length)),row=r=>'| '+Array.from({length:width},(_,i)=>r[i]||'').join(' | ')+' |';
   result=[row(rows[0]),row(Array(width).fill('---')),...rows.slice(1).map(row)].join('\n');
 }else result=s;
 return align&&align!=='left'?`<div style="text-align:${align}">\n\n${result}\n\n</div>`:result;
}
function exportMarkdown(){return '<!-- Kamotish Writer Markdown. For exact roundtrip, use .kamodoc -->\n\n'+[...editor.childNodes].map(blockMd).filter(Boolean).join('\n\n').trim()+'\n'}
function exportMd(){download(filename()+'.md',exportMarkdown(),'text/markdown;charset=utf-8');notify('Markdown 已导出');}$('pdfBtn').onclick=()=>{deactivate();options.onExport?.(exportDocument())};
const markdown = window.markdownit({html:true,linkify:true}).use(window.markdownitKamotish, Kamotish);
markdown.renderer.rules.kamotish = (tokens,i) => makeKamoRun(tokens[i].content).outerHTML;
function importMarkdown(source, {imageSources,documentPath}={}) {
 const dom=new DOMParser().parseFromString(markdown.render(source),'text/html');
 dom.querySelectorAll('script,style,iframe,object,embed,form,input,button').forEach(e=>e.remove());
 dom.querySelectorAll('img').forEach(img=>{
   const src=img.getAttribute('src')||''; img.dataset.originalSrc=src;
   if(imageSources&&!/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)){
     const key=new URL(src,new URL(documentPath||'','https://kamotish.invalid/')).pathname;
     if(Object.prototype.hasOwnProperty.call(imageSources,key))img.src=imageSources[key];
   }
 });
 editor.replaceChildren(...[...dom.body.childNodes].map(nodeToAst).filter(Boolean).map(astToNode));
 changed();
}
async function openMarkdown(d){
 await ready;if(hasDocument&&!(await save()))throw Error('当前文稿尚未保存，未切换文稿');
 loadingDocument=true;hasDocument=true;deactivate();docId=d.writerId||crypto.randomUUID();createdAt=new Date().toISOString();
 if(d.writerId){const previous=await KamotishLibrary.get(d.writerId);if(previous)createdAt=previous.createdAt;}
 openedDocument=d;importMarkdown(d.md,d);$('docTitle').value=d.name.replace(/\.(md|markdown)$/i,'');
 baseline=JSON.stringify(exportNative().content)+$('docTitle').value;revision=1;savedRevision=0;loadingDocument=false;
 showDocument();await save(true);notify('文稿已载入');
}
$('folderCancel').onclick=()=>{$('folderDialog').hidden=true;};
$('folderInput').onchange=async e=>{
 try{
   const docs=await window.KamotishFiles.readEntries([...e.target.files].map(file=>({file,path:file.webkitRelativePath||file.name})));
   if(!docs.length)throw Error('文件夹中没有 Markdown 文档');
   const list=$('folderFiles');list.replaceChildren();
   for(const d of docs){const b=document.createElement('button');b.textContent=decodeURIComponent(d.documentPath);b.onclick=async()=>{try{await openMarkdown(d);$('folderDialog').hidden=true;}catch(e){notify(e.message);}};list.append(b);}
   $('folderDialog').hidden=false;
 }catch(ex){notify('导入失败: '+ex.message);}finally{e.target.value='';}
};
$('fileInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{
 if(f.size>60*1024*1024)throw Error('文件过大 (上限 60 MB)');const src=await f.text();
 if(/\.kamodoc$/i.test(f.name))await openNativeDocument(JSON.parse(src));
 else if(/\.html?$/i.test(f.name)){const dom=new DOMParser().parseFromString(src,'text/html');dom.querySelectorAll('script,style,iframe,object,embed').forEach(x=>x.remove());await openMarkdown({name:f.name,md:dom.body.textContent});}
 else await openMarkdown({name:f.name,md:src});
 }catch(ex){notify('导入失败: '+ex.message);}e.target.value='';};
async function save(force=false){
 clearTimeout(saveTimer);if(!hasDocument||loadingDocument||(!force&&revision===savedRevision))return true;
 const id=docId,version=revision,source=openedDocument?{name:openedDocument.name,md:openedDocument.md,documentPath:openedDocument.documentPath,writerId:id}:null;
 const record={id,title:$('docTitle').value||'未命名文稿',createdAt,updatedAt:new Date().toISOString(),document:exportNative(),source,baseline};
 $('saveStatus').textContent='正在保存…';
 const result=saveQueue.then(()=>KamotishLibrary.put(record));saveQueue=result.catch(()=>{});
 try{await result;if(hasDocument&&docId===id){savedRevision=Math.max(savedRevision,version);$('saveStatus').textContent=revision===savedRevision?'已保存到此浏览器':'尚未保存';}return true;}
 catch(e){if(docId===id)$('saveStatus').textContent='保存失败 · 请下载备份';notify('文稿保存失败: '+e.message);return false;}
}
function restoreDoc(){try{const raw=localStorage.getItem('kamotish-writer-v2');if(raw){importNative(JSON.parse(raw));return true}}catch(e){console.warn('Native recovery failed:',e)}
 try{const v1=JSON.parse(localStorage.getItem('kamotish-writer-v1'));if(v1&&typeof v1.html==='string'&&typeof v1.title==='string'){const dom=new DOMParser().parseFromString(v1.html,'text/html');dom.querySelectorAll('script,style,iframe,object,embed,form,input,button').forEach(x=>x.remove());dom.querySelectorAll('*').forEach(e=>{for(const a of [...e.attributes])if(/^on/i.test(a.name))e.removeAttribute(a.name)});editor.innerHTML=dom.body.innerHTML;$('docTitle').value=v1.title;upgradeOldTokens();notify('已迁移旧版文稿; 建议导出 .kamodoc 备份');return true}}catch(e){console.warn('v1 recovery failed:',e)}return false}
editor.addEventListener('input',()=>{stopIme();changed()});$('docTitle').addEventListener('input',changed);
container.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save().then(ok=>{if(ok)notify('已保存到我的文稿');})}
 if((e.ctrlKey||e.metaKey)&&['+','=','-','0'].includes(e.key)&&document.activeElement===editor){e.preventDefault();setZoom(e.key==='0'?1:zoom+(e.key==='-'?-.1:.1))}
 if(e.key==='Escape'){if(composing)stopIme();closeTone();closeDropdown();if(!$('kamoDialog').hidden)$('cancelInsert').click();for(const id of ['tableDialog','nameDialog','deleteDialog'])$(id).hidden=true;}});
try{const savedZoom=localStorage.getItem('kamotish-writer-zoom');if(savedZoom)setZoom(Number(savedZoom));}catch{zoom=1;}
if(localStorage.getItem('kamotish-writer-sidebar')==='hidden'){layout.classList.add('collapsed');$('sideToggle').setAttribute('aria-expanded','false')}
function showDocument(){
 $('libraryView').hidden=true;$('documentView').hidden=false;selectionBefore=null;
 workspace.scrollTop=0;fitWidth();
}
async function refreshLibrary(){
 libraryRecords=await KamotishLibrary.list();renderLibrary();
}
function renderLibrary(){
 const term=$('librarySearch').value.trim().toLocaleLowerCase();
 const records=libraryRecords.filter(d=>d.title.toLocaleLowerCase().includes(term));
 records.sort($('librarySort').value==='title'?(a,b)=>a.title.localeCompare(b.title,'zh'):(a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 $('libraryCount').textContent=libraryRecords.length+' 份文稿';
 $('libraryStatus').textContent=records.length?'':term?'没有找到匹配的文稿':'还没有文稿。新建一份，或从文件菜单导入已有文档。';
 const list=$('libraryList');list.replaceChildren();
 for(const record of records){
   const row=document.createElement('div');row.className='library-row';row.dataset.documentId=record.id;
   const open=document.createElement('button');open.className='library-open';
   open.innerHTML='<span class="document-symbol" aria-hidden="true">▤</span><span><strong>'+safe(record.title)+'</strong><small>'+safe(new Date(record.updatedAt).toLocaleString('zh-CN'))+' 修改</small></span>';
   open.onclick=()=>openSavedDocument(record.id).catch(e=>notify(e.message));
   const more=document.createElement('details');more.className='document-actions';
   const summary=document.createElement('summary');summary.textContent='⋯';summary.setAttribute('aria-label',record.title+'的操作');more.append(summary);
   const actions=document.createElement('div');actions.className='document-action-menu';
   for(const [label,action] of [['重命名',()=>renameDocument(record.id)],['创建副本',()=>duplicateDocument(record.id)],['删除',()=>requestDelete(record)]]){
     const button=document.createElement('button');button.textContent=label;if(label==='删除')button.className='danger';
     button.onclick=()=>{more.open=false;try{action()?.catch?.(e=>notify(e.message));}catch(e){notify(e.message);}};actions.append(button);
   }
   more.append(actions);row.append(open,more);list.append(row);
 }
}
function askName(heading,value,action){
 nameAction=action;$('nameHeading').textContent=heading;$('nameInput').value=value;$('nameDialog').hidden=false;
 $('nameInput').focus();$('nameInput').select();
}
$('nameCancel').onclick=()=>{$('nameDialog').hidden=true;nameAction=null;};
$('nameForm').onsubmit=async e=>{
 e.preventDefault();const name=$('nameInput').value.trim();if(!name)return;
 const submit=$('nameForm').querySelector('[type="submit"]');submit.disabled=true;
 try{await nameAction?.(name);$('nameDialog').hidden=true;nameAction=null;}catch(error){notify(error.message);}finally{submit.disabled=false;}
};
function newDocument(){askName('新建文稿','未命名文稿',name=>openNativeDocument({format:'Kamotish Writer',schemaVersion:2,title:name,content:[{t:'element',tag:'p',children:[{t:'element',tag:'br',children:[]}]}]}));}
async function openNativeDocument(document){
 await ready;if(hasDocument&&!(await save()))throw Error('当前文稿尚未保存，未切换文稿');
 // Validate before replacing the current document.
 if(document?.format!=='Kamotish Writer'||document.schemaVersion!==2||!Array.isArray(document.content)||document.content.length>100000)throw Error('不是支持的 .kamodoc 文稿');
 loadingDocument=true;hasDocument=true;deactivate();openedDocument=null;baseline='';createdAt=new Date().toISOString();
 importNative(Object.assign({},document,{id:crypto.randomUUID()}));revision=1;savedRevision=0;loadingDocument=false;showDocument();await save(true);
}
async function openSavedDocument(id){
 await ready;if(hasDocument&&!(await save()))throw Error('当前文稿尚未保存，未切换文稿');
 const record=await KamotishLibrary.get(id);if(!record)throw Error('这份文稿已不存在');
 loadingDocument=true;hasDocument=true;deactivate();openedDocument=record.source;baseline=record.baseline||'';createdAt=record.createdAt;
 importNative(record.document);revision=0;savedRevision=0;loadingDocument=false;$('saveStatus').textContent='已保存到此浏览器';showDocument();
}
async function closeDocument(){
 if(hasDocument){if(!(await save()))return;options.onDocumentClosed?.(exportDocument());}
 clearTimeout(saveTimer);hasDocument=false;openedDocument=null;selectionBefore=null;deactivate();
 $('documentView').hidden=true;$('libraryView').hidden=false;editor.replaceChildren();
 await refreshLibrary();
}
async function renameDocument(id){
 const record=id===docId&&hasDocument?{title:$('docTitle').value}:await KamotishLibrary.get(id);
 if(!record)throw Error('文稿已不存在');
 askName('重命名文稿',record.title,async title=>{
   if(hasDocument&&docId===id){$('docTitle').value=title;changed();await save();}
   else{const stored=await KamotishLibrary.get(id);const unchanged=stored.source&&stored.baseline===JSON.stringify(stored.document.content)+stored.document.title;stored.title=title;stored.document.title=title;stored.updatedAt=new Date().toISOString();if(stored.source){stored.source.name=title+'.md';stored.baseline=unchanged?JSON.stringify(stored.document.content)+title:'';}await KamotishLibrary.put(stored);}
   options.onDocumentRenamed?.(id,title);await refreshLibrary();
 });
}
async function duplicateDocument(id){
 const record=await KamotishLibrary.get(id);if(!record)throw Error('文稿已不存在');
 const unchanged=record.source&&record.baseline===JSON.stringify(record.document.content)+record.document.title;
 record.id=crypto.randomUUID();record.title+='（副本）';record.createdAt=record.updatedAt=new Date().toISOString();record.document.id=record.id;record.document.title=record.title;
 if(record.source){record.source.name=record.title+'.md';record.source.writerId=record.id;record.baseline=unchanged?JSON.stringify(record.document.content)+record.title:'';}
 await KamotishLibrary.put(record);await refreshLibrary();notify('已创建副本');
}
function requestDelete(record){deleteTarget=record.id;$('deleteMessage').textContent='将从此浏览器的文稿库中删除“'+record.title+'”。已下载的文件不会受影响。';$('deleteDialog').hidden=false;$('deleteCancel').focus();}
$('deleteCancel').onclick=()=>{$('deleteDialog').hidden=true;deleteTarget=null;};
$('deleteConfirm').onclick=async()=>{
 if(!deleteTarget)return;try{await KamotishLibrary.remove(deleteTarget);options.onDocumentDeleted?.(deleteTarget);$('deleteDialog').hidden=true;deleteTarget=null;await refreshLibrary();notify('文稿已删除');}catch(e){notify(e.message);}
};
$('librarySearch').oninput=renderLibrary;$('librarySort').onchange=renderLibrary;
$('newDocument').onclick=newDocument;$('backToLibrary').onclick=()=>closeDocument().catch(e=>notify(e.message));
async function initializeLibrary(){
 try{
   if(!(await KamotishLibrary.meta('legacy-migrated'))){
     loadingDocument=true;
     if(restoreDoc()){
       const native=exportNative(),now=new Date().toISOString();
       await KamotishLibrary.put({id:native.id,title:native.title||'恢复的文稿',createdAt:now,updatedAt:now,document:native,source:null,baseline:''});
     }
     await KamotishLibrary.setMeta('legacy-migrated',true);loadingDocument=false;
   }
   editor.replaceChildren();hasDocument=false;await refreshLibrary();
 }catch(e){loadingDocument=false;$('libraryStatus').textContent='无法打开本地文稿库: '+e.message;throw e;}
}
function restoreInsertionPoint(){
 editor.focus({preventScroll:true});const selection=getSelection();
 if(selectionBefore&&editor.contains(selectionBefore.startContainer)){selection.removeAllRanges();selection.addRange(selectionBefore.cloneRange());}
 else{const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.removeAllRanges();selection.addRange(range);}
}
function insertHtmlAtCaret(html){
 if(!hasDocument)return;restoreInsertionPoint();
 if(!document.execCommand('insertHTML',false,html))throw Error('无法在此处插入内容，请将光标放到正文中');
 saveSelection();changed();
}
function openTableDialog(){saveSelection();insertionTarget=docId;$('tableDialog').hidden=false;$('tableRows').focus();}
$('tableCancel').onclick=()=>{$('tableDialog').hidden=true;editor.focus();};
$('tableForm').onsubmit=e=>{
 e.preventDefault();if(!hasDocument||insertionTarget!==docId)return;
 const rows=Number($('tableRows').value),cols=Number($('tableColumns').value);
 if(!Number.isInteger(rows)||rows<1||rows>30||!Number.isInteger(cols)||cols<1||cols>12)return;
 const table=document.createElement('table');
 for(let r=0;r<rows;r++){const row=table.insertRow();for(let c=0;c<cols;c++){const cell=document.createElement(r===0&&$('tableHeader').checked?'th':'td');cell.append(document.createElement('br'));row.append(cell);}}
 $('tableDialog').hidden=true;insertHtmlAtCaret(table.outerHTML+'<p><br></p>');
}
function chooseImages(){saveSelection();insertionTarget=docId;$('imageInput').click();}
$('imageInput').onchange=async e=>{
 const target=insertionTarget,files=[...e.target.files];e.target.value='';
 try{
   const images=[];
   for(const file of files){
     if(!/^image\//.test(file.type))throw Error('请选择图片文件');
     const img=document.createElement('img');img.src=await KamotishFiles.imageData(file);img.alt=file.name.replace(/\.[^.]+$/,'');images.push(img.outerHTML);
   }
   if(!hasDocument||docId!==target)return notify('当前文稿已切换，已取消插入图片');
   if(images.length)insertHtmlAtCaret(images.join('')+'<p><br></p>');
 }catch(error){notify('插入图片失败: '+error.message);}
};

const ready=initializeLibrary();
window.addEventListener('pagehide',()=>save());
window.addEventListener('beforeunload',e=>{if(hasDocument&&revision!==savedRevision){e.preventDefault();e.returnValue='';}});
function deactivate(){stopIme();closeTone();closeDropdown();$('kamoDialog').hidden=true;$('folderDialog').hidden=true;$('tableDialog').hidden=true;}
function exportDocument(){
 if(!hasDocument)return null;
 const name=filename()+'.md',documentPath=openedDocument?.documentPath||'/'+encodeURIComponent(name);
 const unchanged=openedDocument && baseline===JSON.stringify(exportNative().content)+$('docTitle').value;
 const imageSources=Object.assign(Object.create(null),openedDocument?.imageSources);
 for(const img of editor.querySelectorAll('img')){
   const src=img.dataset.originalSrc||img.getAttribute('src');
   if(src&&!/^[a-z][a-z0-9+.-]*:/i.test(src)&&img.src.startsWith('data:image/')){
     const key=new URL(src,new URL(documentPath,'https://kamotish.invalid/')).pathname;
     imageSources[key]=img.src;
   }
 }
 return {writerId:docId,name:unchanged?openedDocument.name:name,md:unchanged?openedDocument.md:exportMarkdown(),documentPath,imageSources};
}
function fitWidth(){if(automaticZoom&&workspace.clientWidth)setZoom(Math.min(1,(workspace.clientWidth-50)/794),false);}
window.addEventListener('resize',()=>{if(!container.hidden)fitWidth();});
return {ready,openMarkdown,exportDocument,exportNative,importNative,exportMarkdown,deactivate,save,closeDocument,newDocument,openSavedDocument,hasDocument:()=>hasDocument,activate(){if(!hasDocument)refreshLibrary().catch(e=>notify(e.message));fitWidth();if(matchMedia('(max-width:760px)').matches)$('sideToggle').setAttribute('aria-expanded',String(layout.classList.contains('outline-open')));}};
} };
