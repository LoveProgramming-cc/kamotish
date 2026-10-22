/* Kamotish Writer IME
 * Hanzi and phrase data: Rime Ice, GPL-3.0-only (built in GitHub Actions).
 * Always-available single-character fallback: xpinyin, LPPL-1.3c+.
 * This hybrid composing layer is original MIT code. It does NOT run librime.
 */
window.KamoIME = (() => {
  const names = Kamotish.graphemeNames();
  const namesSet = new Set(names);
  const spellings = `a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo e en eng er fa fan fang fei fen feng fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu long lou lu luan lun luo lv lve ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nuo nv nve o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao ye yi yin ying yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo`.split(' ');
  const py = new Set(spellings);
  const fallback = Object.create(null), shards = Object.create(null), loading = new Map();
  let index = null, state = '正在加载字表…';
  let onupdate = null;
  function update(status) { if (status) state = status; if (typeof onupdate === 'function') onupdate(state); }
  function phonValid(s) { try { Kamotish.parseSyllable(s); return true; } catch { return false; } }
  function glyph(name){ return {type:'glyph', value:'\\'+name, label:'字素 · '+name}; }
  function phon(value){return {type:'phon', value, label:'拟素 · '+value}; }
  function han(value, source='雾凇拼音'){return {type:'han',value,label:source}; }

  function splitPinyin(s) {
    if (!s) return [];
    const chunks=s.split("'"); if (chunks.length > 1) {
      const split=chunks.map(splitPinyin);return split.every(p=>p && p.length)?split.flat():null;
    }
    const memo=new Map();
    function dfs(pos){
      if(pos===s.length)return [];
      if(memo.has(pos))return memo.get(pos);
      let best=null;
      for(let end=Math.min(s.length,pos+6);end>pos;end--){
        const part=s.slice(pos,end);
        if(!py.has(part))continue;
        const remaining=dfs(end);
        if(remaining && (!best || remaining.length+1<best.length))best=[part,...remaining];
      }
      memo.set(pos,best);return best;
    }
    return dfs(0);
  }

  async function init() {
    // xpinyin provides a legitimate, broad single-character reading database even locally.
    try {
      const res=await fetch('writer/data/xpinyin-fallback.json');
      if (!res.ok) throw Error(`fallback HTTP ${res.status}`);
      Object.assign(fallback,await res.json());
      update('xpinyin 已加载 · 汉字单字候选可用');
    } catch(err) { update('基础字表未加载 · 仍可输入字素 / 拟素'); }
    try {
      const r=await fetch('writer/data/rime-index.json', {cache:'no-cache'});
      if(!r.ok) throw Error(`HTTP ${r.status}`);
      const manifest=await r.json();
      if(!manifest.shardRoot || !Array.isArray(manifest.characters)) throw Error('词库索引损坏');
      index=manifest;
      update(`雾凇拼音就绪 · ${index.candidates.toLocaleString('zh-CN')} 个汉字/词语候选 · 按需加载`);
    } catch(err) {
      update('本地 xpinyin 单字字表 · 部署 GitHub Actions 后启用雾凇完整词库');
    }
    return state;
  }
  function shardFor(key) {return shards[key[0]] || null;}
  function loadShard(ch) {
    if(!index || !index.characters.includes(ch) || shards[ch] || loading.has(ch))return loading.get(ch)||Promise.resolve();
    const p=fetch('writer/'+index.shardRoot+ch+'.json').then(r=>{if(!r.ok)throw Error(r.status);return r.json()})
      .then(data=>{shards[ch]=data; update();})
      .catch(()=>{update('部分雾凇词库分片不可用, 正在使用已加载词库');})
      .finally(()=>loading.delete(ch));
    loading.set(ch,p);return p;
  }
  // Load only shards whose initials appear in the current composition.
  function loadFor(raw){
    if(!index)return;
    const letters=[...new Set(raw.toLowerCase().replace(/[^a-z]/g,''))].filter(ch=>index.characters.includes(ch));
    letters.forEach(loadShard);
  }
  function directMatches(s){
    const d=shardFor(s); return d?.[s] || [];
  }
  function exactChinese(s){
    const direct=directMatches(s).map(([txt])=>han(txt));
    // Only fall back to xpinyin when Rime data for this initial is not yet loaded.
    if(direct.length)return direct;
    if(s in fallback) return fallback[s].slice(0,24).map(txt=>han(txt,'xpinyin 字表'));
    return [];
  }
  function prefixMatches(s, limit=5){
    if(s.length<2)return [];
    const d=shardFor(s);if(!d)return [];
    // Array keys are inserted lexically in builder; sort explicitly for robustness.
    const keys=Object.keys(d).sort(); let lo=0,hi=keys.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(keys[mid]<s)lo=mid+1;else hi=mid;}
    const results=[];
    for(let i=lo; i<keys.length && keys[i].startsWith(s) && i<lo+140;i++){
      if(keys[i]===s)continue;
      for(const [txt,weight] of d[keys[i]].slice(0,2))results.push({txt,weight});
    }
    results.sort((a,b)=>b.weight-a.weight);
    return results.slice(0,limit).map(x=>han(x.txt,'雾凇 · 联想'));
  }
  function sentenceCandidates(s, maxCandidates=4){
    if(s.length<4 || s.length>65)return [];
    const dp=Array.from({length:s.length+1},()=>[]);
    dp[0]=[{value:'',score:0,count:0}];
    for(let i=0;i<s.length;i++) {
      if(!dp[i].length)continue;
      const d=shardFor(s.slice(i));if(!d)continue;
      for(let j=i+1;j<=Math.min(s.length,i+26);j++){
        const read=s.slice(i,j),words=d[read];
        if(!words)continue;
        for(const previous of dp[i])for(const [word,freq] of words.slice(0,3)){
          // Favor long dictionary words and few segment boundaries, but respect word frequency.
          const score=previous.score+Math.log1p(freq)*0.42+Math.min(word.length,6)*1.5-10;
          dp[j].push({value:previous.value+word,score,count:previous.count+1});
        }
        if(dp[j].length>15)dp[j]=dp[j].sort((a,b)=>b.score-a.score).slice(0,12);
      }
    }
    return dp[s.length].filter(x=>x.count>=2).sort((a,b)=>b.score-a.score).slice(0,maxCandidates).map(x=>han(x.value,'雾凇 · 智能组词'));
  }
  function candidates(raw){
    const s=raw.toLowerCase().replace(/[^a-z']/g,'');if(!s)return [];
    loadFor(s);
    const out=[], seen=new Set();
    function add(x) {const id=x.type+':'+x.value;if(!seen.has(id)){seen.add(id);out.push(x)}}
    const split=splitPinyin(s),multi=split && split.length>1;
    let phones=null;
    if(multi && split.every(phonValid))phones=split.join('-');
    else if(!multi && phonValid(s))phones=s;
    if(multi){ if(phones)add(phon(phones)); }
    else {
      // Under the user's contract, glyph #1 then phoneme #2 for single-syllable input.
      if(namesSet.has(s))add(glyph(s));
      if(phones)add(phon(phones));
      // Shortcuts stay consistent: 1 = unmarked glyph, 2 = phonetic block,
      // 3 = tone 2, 4 = tone 3, 5 = tone 4. Exactly one key to commit any tone.
      if(namesSet.has(s)) for (const tone of ['2', '3', '4'])
        add({type:'glyph', value:'\\'+s+'\\'+tone, label:'字素 · '+s+' · '+({2:'二声',3:'三声',4:'四声'}[tone])});
      if(s==='hou')add(glyph('hou2'));  // Alternate reading of a distinct grapheme.
      if(s==='mou')add(glyph('mou2'));
    }
    exactChinese(s).forEach(add);
    sentenceCandidates(s).forEach(add);
    // An unfinished syllable can predict words starting with the current pinyin prefix.
    prefixMatches(s,8).forEach(add);
    add({type:'literal',value:raw,label:'原样输入'});
    return out.slice(0,9);
  }
  return {init,loadFor,candidates,splitPinyin,phonValid,get status(){return state},get fullDictionary(){return !!index},
    set onupdate(fn){onupdate=fn},get onupdate(){return onupdate},
    // Strictly for deterministic tests; never used in production.
    _testSetShards(data){Object.assign(shards,data)},_testSetFallback(data){Object.assign(fallback,data)} };
})();
