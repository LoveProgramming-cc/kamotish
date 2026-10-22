import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':900},accept_downloads=True)
        errors=[]
        page.on('pageerror',lambda err: errors.append(str(err)))
        html=(ROOT/'index.html').read_text()
        html=re.sub(r'<script[^>]+src="[^"]+"[^>]*></script>','',html)
        html=re.sub(r'<link[^>]+href="style.css"[^>]*>','',html)
        page.set_content(html,wait_until='domcontentloaded')
        page.evaluate('''() => {const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{setItem:(k,v)=>m.set(k,v),getItem:k=>m.get(k)||null,removeItem:k=>m.delete(k)}})}''')
        page.add_style_tag(content=(ROOT/'style.css').read_text())
        for src in ['../web/kamotish.js','../tools/md2pdf/node_modules/markdown-it/dist/markdown-it.min.js','../web/markdown-it-kamotish.js','../web/kamotish-files.js','ime.js','app.js']:
            page.add_script_tag(content=(ROOT/src).read_text())
        page.wait_for_timeout(600)
        print('initial errors:',errors)
        assert not errors, errors
        initial=page.locator('.kamo-run').first
        units=initial.locator('.kw-unit')
        assert units.count()==3, [e.get_attribute('data-raw') for e in units.all()]
        assert page.evaluate('sourceOfRun(document.querySelector(".kamo-run"))')=='\\mi\\wou\\3中国人\\mou\\2'
        assert '\\\\' not in page.evaluate('sourceOfRun(document.querySelector(".kamo-run"))')
        assert page.evaluate('exportMarkdown()').find('\\kamotish{\\mi\\wou\\3中国人\\mou\\2}')>=0
        assert page.locator('article .kamo-err').count()==0
        # Test saved format is exact for supported document markup.
        native=page.evaluate('exportNative()')
        page.evaluate('(d)=>importNative(d)', native)
        assert page.evaluate('exportNative().content')==native['content']
        # selecting two vector units is possible with Range (atomic at glyph level)
        n=page.evaluate('''() => {let a=document.querySelectorAll('.kw-unit');let r=document.createRange();r.setStartBefore(a[0]);r.setEndAfter(a[1]);let s=getSelection();s.removeAllRanges();s.addRange(r);return selectedUnits(r).length}''')
        assert n==2,n
        # Real mouse drag across SVG glyphs must create a selectable browser Range.
        bounds=page.locator('.kamo-run').first.locator('.kw-unit').evaluate_all('(es)=>es.map(e=>{let r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})')
        mid=(bounds[0]['top']+bounds[0]['bottom'])/2
        page.mouse.move((bounds[0]['left']+bounds[0]['right'])/2, mid)
        page.mouse.down()
        page.mouse.move((bounds[2]['left']+bounds[2]['right'])/2, mid,steps=14)
        page.mouse.up()
        real_selected=page.evaluate('''() => {const s=getSelection();return s.rangeCount?selectedUnits(s.getRangeAt(0)).length:0}''')
        print('Mouse-selected SVG units:',real_selected)
        assert real_selected>=2, 'Pointer selection must cover individual glyph units'
        # Selection must support inline formatting across SVG units.
        page.evaluate("applyFormat('underline')")
        decorated=page.locator('.kw-unit').evaluate_all('(es)=>es.filter(e=>(e.style.textDecoration||"").includes("underline")).length')
        assert decorated>=2,decorated
        before=page.evaluate('exportNative().content')
        page.evaluate('importNative(exportNative())')
        assert page.evaluate('exportNative().content')==before
        # an in-place tone menu updates only the chosen grapheme
        page.locator('.kw-unit[data-kind="glyph"]').first.click()
        page.locator('#toneChoices button').nth(2).click()
        assert page.locator('.kw-unit[data-kind="glyph"]').first.get_attribute('data-raw')=='\\mi\\3'
        # Sidebar toggle / zoom work
        page.locator('#sideToggle').click()
        assert page.locator('#layout').get_attribute('class')=='collapsed'
        page.locator('#zoomIn').click()
        assert page.locator('#zoomLevel').inner_text()=='110%'
        page.keyboard.down('Control')
        page.mouse.move(700,400);page.mouse.wheel(0, 25)
        page.keyboard.up('Control')
        assert page.locator('#zoomLevel').inner_text()!='110%'
        # no native selects, colors use a custom palette
        assert page.locator('select').count()==0
        page.locator('#fontSize').click()
        assert page.locator('#dropdown').is_visible()
        page.locator('#dropdown button').last.click()
        assert not page.locator('#dropdown').is_visible()
        # edit & IME: glyph candidate 1, phon 2, tone 2/3/4 in slots 3/4/5
        page.locator('#editor p').first.click()
        page.keyboard.type('mi')
        assert page.locator('#composition').inner_text()=='mi'
        candidates=page.locator('#candidates .candidate')
        assert candidates.nth(0).inner_text().find('字素')>=0
        assert candidates.nth(1).inner_text().find('拟素')>=0
        assert candidates.nth(3).inner_text().find('三声')>=0
        page.keyboard.press('4')
        assert '\\mi\\3' in page.locator('.kw-unit').evaluate_all('(es)=>es.map(e=>e.dataset.raw)')
        assert page.locator('#ime').is_hidden()
        assert not errors, errors
        # PDF: browser print should keep SVG as vector paths, not raster screenshots.
        pdf=page.pdf(format='A4',print_background=True)
        import fitz
        doc=fitz.open(stream=pdf,filetype='pdf')
        assert doc.page_count>=1
        assert len(doc[0].get_images(full=True))==0, 'Sample page contains raster images'
        print('PDF pages:',doc.page_count,'raster images:',len(doc[0].get_images(full=True)))
        # Verify plain-text clipboard contains serialized Kamotish markup.
        clip=page.evaluate('''() => {let a=document.querySelectorAll('.kw-unit');let r=document.createRange();r.setStartBefore(a[0]);r.setEndAfter(a[1]);let s=getSelection();s.removeAllRanges();s.addRange(r);let data={};let e={preventDefault(){},clipboardData:{setData(t,v){data[t]=v}}};writeSelectedClipboard(e,false);return data['text/plain']}''')
        assert '\\kamotish{' in clip and '\\mi\\3' in clip,clip
        # Snapshot for design review
        print('SUCCESS: SVG unit selection, tones, native roundtrip, sidebar, zoom, custom menus, and IME')
        browser.close()
