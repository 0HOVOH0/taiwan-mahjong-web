'use strict';
/* 青竹十六張 — 牌桌前端。study.js 共用：$ element tile name api melds percent shanten state replay replayIndex renderReplay */
const $ = id => document.getElementById(id);
const winds = {east:'東',south:'南',west:'西',north:'北'};
const nums = ['一','二','三','四','五','六','七','八','九'];
const honors = ['東','南','西','北','中','發','白'];
const flowers = ['春','夏','秋','冬','梅','蘭','菊','竹'];
const kinds = {discard:'打出',declare_ready:'宣告聽牌',pass:'過',chi:'吃',pong:'碰',exposed_kong:'明槓',concealed_kong:'暗槓',added_kong:'加槓',win:'胡牌',draw:'摸牌'};
const AI_NAMES = ['松風','梅影','蘭心'];
const CALL_KINDS = ['win','chi','pong','exposed_kong','concealed_kong','added_kong','declare_ready','pass'];
let state = null, prevState = null, selected = null, busy = false, replay = null, replayIndex = 0;
let revealed = false, pendingReveal = null, autoTimer = null;
let hold = null, playing = false, playToken = 0; // playback of other players' moves

/* ---------- preferences (local only) ---------- */
const prefs = {think:false, autoready:false, fx:true, dwell:1500};
try { Object.assign(prefs, JSON.parse(localStorage.getItem('qingzhu-prefs') || '{}')); } catch {}
function savePrefs(){ try { localStorage.setItem('qingzhu-prefs', JSON.stringify(prefs)); } catch {} }

/* ---------- small helpers ---------- */
function name(t) {return t<27?nums[t%9]+['萬','筒','條'][Math.floor(t/9)]:t<34?honors[t-27]:flowers[t-34];}
function element(tag, cls, text) {const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function tile(t, small=false, button=false) {
  const el=element(button?'button':'span','tile'+(small?' small':''));
  el.setAttribute('aria-label',(button?'選擇 ':'')+name(t));el.title=name(t);
  if(t<9){el.classList.add('wan');el.append(element('span','number',nums[t]),element('span','suit','萬'));}
  else if(t<27){
    el.classList.add(t<18?'dots':'bamboo');const n=t%9+1,pips=element('span','pips');
    const layouts=[[[2,2]],[[2,1],[2,3]],[[1,1],[2,2],[3,3]],[[1,1],[3,1],[1,3],[3,3]],[[1,1],[3,1],[2,2],[1,3],[3,3]],[[1,1],[3,1],[1,2],[3,2],[1,3],[3,3]],[[1,1],[2,1],[3,1],[1,2],[3,2],[1,3],[3,3]],[[1,1],[2,1],[3,1],[1,2],[3,2],[1,3],[2,3],[3,3]],[[1,1],[2,1],[3,1],[1,2],[2,2],[3,2],[1,3],[2,3],[3,3]]];
    for(const [c,r] of layouts[n-1]){const p=element('i','pip');p.style.setProperty('--col',c);p.style.setProperty('--row',r);pips.append(p);}el.append(pips);
  } else {el.classList.add(t<34?'honor':'flower');if(t===31)el.classList.add('red');if(t===32)el.classList.add('green');if(t===33)el.classList.add('white');el.append(element('span','glyph',name(t)));}
  return el;
}
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function toast(message,ms=3200){const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,ms);}
function setBusy(value){busy=value;document.body.classList.toggle('busy',value);$('new-game').disabled=value;const lock=value||playing;$('confirm').disabled=lock||!state||state.finished||!selected;document.querySelectorAll('#hand button,.candidate,#special-actions button').forEach(b=>b.disabled=lock);if(playing)$('confirm').textContent='其他家出牌中…';}
async function api(path,body){const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});let data;try{data=await response.json();}catch{throw new Error('牌桌服務暫時無法回應，請檢查啟動視窗。');}if(!response.ok)throw new Error(data.error||'操作未完成');return data;}
function tag(text,cls=''){return element('span','tag '+cls,text);}
function melds(player){const group=element('div','melds');for(const meld of player.melds){const m=element('div','meld meld-'+meld.kind);m.title=kinds[meld.kind]||'副露';if(meld.tiles===null){for(let j=0;j<4;j++)m.append(element('span','back'));m.title='暗槓：牌面不公開';}else for(const t of meld.tiles)m.append(tile(t,true));group.append(m);}return group;}
function river(player){const r=element('div','river');for(const t of player.river)r.append(tile(t,true));return r;}
function percent(value){return (value*100).toFixed(1)+'%';}
function shanten(value){return value<0?'已完成':value===0?'聽牌':value+' 向聽';}
function chosen(){return state?.actions.find(a=>a.id===selected);}
function hideAdvice(){return prefs.think && !revealed && state && !state.finished;}

/* ---------- seats ---------- */
function positions(){ // screen position -> seat
  const v=state.viewer;return {bottom:v,right:(v+1)%4,top:(v+2)%4,left:(v+3)%4};
}
function seatName(seat){
  if(seat===state.viewer)return '你';
  const offset=(seat-state.viewer+4)%4;return AI_NAMES[offset-1];
}
function seatWho(seat){const p=state.players.find(x=>x.seat===seat);return seat===state.viewer?'你':`${winds[p.wind]}家`;}
function lastDiscardSeat(){
  const ev=state.events||[];for(let i=ev.length-1;i>=0;i--){const e=ev[i];if(e.kind==='discard')return e.player;if(e.kind==='meld')return null;}return null;
}
function drawnTile(){
  const own=state.players[state.viewer];if(own.hand.length%3!==2)return null;
  const ev=state.events||[];
  for(let i=ev.length-1;i>=0;i--){const e=ev[i];if(e.player!==state.viewer)continue;
    if(e.kind==='draw')return e.types.length?e.types[0]:null;
    if(e.kind==='discard'||e.kind==='meld')return null;}
  return null;
}

function renderPlate(pos,seat){
  const box=$('plate-'+pos);box.replaceChildren();const p=state.players.find(x=>x.seat===seat);
  box.dataset.seat=seat;
  const avatar=element('div','avatar wind-'+p.wind);avatar.append(element('span','avatar-wind',winds[p.wind]));
  const info=element('div','plate-info');
  const line=element('div','plate-name');line.append(element('strong','',seatName(seat)));if(seat!==state.viewer)line.append(element('small','',' · AI'));
  const tags=element('div','plate-tags');if(state.dealer===seat)tags.append(tag('莊','dealer'));if(p.ready)tags.append(tag('聽','ready'));
  if(p.flowers.length)tags.append(tag('花 '+p.flowers.length,'flower-tag'));
  const score=state.finished&&state.result?state.result.payments[seat]:null;
  const meta=element('div','plate-meta',score===null?`${p.hand_count} 張`:(score>0?'+':'')+score);
  if(score!==null)meta.classList.add(score>0?'plus':score<0?'minus':'even');
  info.append(line,tags,meta);box.append(avatar,info);
  const yourTurn=!hold&&!state.finished&&seat===state.viewer&&state.actions.length>0;
  const reactingTo=hold?hold.actor===seat:(state.reaction&&state.reaction.source===seat);
  box.classList.toggle('active',yourTurn||!!reactingTo);
  box.title=p.flowers.length?'花牌：'+p.flowers.map(name).join('、'):'';
}
function renderSeat(pos,seat){
  const box=$('seat-'+pos);box.replaceChildren();const p=state.players.find(x=>x.seat===seat);
  const backs=element('div','backs');for(let i=0;i<p.hand_count;i++)backs.append(element('span','back'));
  const hidden=hold?.melds[seat]||0;const shown={...p,melds:p.melds.slice(0,p.melds.length-hidden)};
  box.append(backs);if(shown.melds.length)box.append(melds(shown));
}
function renderPond(pos,seat){
  const box=$('river-'+pos);box.replaceChildren();const p=state.players.find(x=>x.seat===seat);
  const hidden=Math.min(hold?.river[seat]||0,p.river.length);
  const tiles=p.river.slice(0,p.river.length-hidden);if(hold&&hold.extra[seat]!==null&&hold.extra[seat]!==undefined)tiles.push(hold.extra[seat]);
  const r=river({...p,river:tiles});const last=hold?hold.latest:lastDiscardSeat();
  if(last===seat&&r.lastElementChild)r.lastElementChild.classList.add('latest');
  box.append(r);
}
function renderCompass(){
  const ring=$('compass');ring.replaceChildren();const pos=positions();
  for(const [where,seat] of Object.entries(pos)){const p=state.players.find(x=>x.seat===seat);
    const w=element('span','cw cw-'+where+(state.dealer===seat?' is-dealer':''),winds[p.wind]);
    const active=hold?hold.actor===seat:((!state.finished&&seat===state.viewer&&state.actions.length&&!state.reaction)||(state.reaction&&state.reaction.source===seat));
    if(active)w.classList.add('lit');ring.append(w);}
}

/* ---------- event log ---------- */
function describe(e){
  const who=seatWho(e.player);
  switch(e.kind){
    case 'discard':return `${who} 打出 ${name(e.types[0])}`;
    case 'flower':return `${who} 補花 ${e.types.length?name(e.types[0]):''}`;
    case 'ready':return `${who} 宣告聽牌`;
    case 'win':return `${who} 胡牌${e.types.length?' · '+name(e.types[0]):''}`;
    case 'meld':{const t=e.types;
      if(!t.length)return `${who} 暗槓`;
      if(t.length===1)return `${who} 加槓 ${name(t[0])}`;
      if(t.length===4)return `${who} 槓 ${name(t[0])}`;
      if(t.every(x=>x===t[0]))return `${who} 碰 ${name(t[0])}`;
      return `${who} 吃 ${[...t].sort((a,b)=>a-b).map(name).join('')}`;}
    case 'draw':return e.player===state.viewer&&e.types.length?`你 摸進 ${name(e.types[0])}`:null;
    default:return null;
  }
}
function renderLog(){
  const lines=(state.events||[]).map(describe).filter(Boolean);
  $('ticker-text').textContent=state.finished?'本局結束':(lines.at(-1)||'牌局開始');
  const log=$('event-log');log.replaceChildren();
  for(const text of lines.slice(-14).reverse())log.append(element('li','',text));
}

/* ---------- call stamps ---------- */
function stamp(seat,text,big=false){
  if(!prefs.fx||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const pos=Object.entries(positions()).find(([,s])=>s===seat)[0];
  const s=element('div','stamp at-'+pos+(big?' big':''));s.append(element('span','stamp-text',text));
  $('fx').append(s);setTimeout(()=>s.remove(),1500);
}
function playEffects(){
  if(!prevState||prevState.viewer!==state.viewer)return;
  const queue=[];
  for(const p of state.players){const old=prevState.players.find(x=>x.seat===p.seat);if(!old)continue;
    if(p.melds.length>old.melds.length){const m=p.melds.at(-1);queue.push([p.seat,{chi:'吃',pong:'碰',exposed_kong:'槓',concealed_kong:'暗槓',added_kong:'槓'}[m.kind]||'碰']);}
    else if(p.melds.some((m,i)=>old.melds[i]&&old.melds[i].kind!==m.kind))queue.push([p.seat,'槓']);
    if(p.ready&&!old.ready)queue.push([p.seat,'聽']);
  }
  if(state.finished&&!prevState.finished&&state.result?.winners?.length){
    for(const w of state.result.winners){const self=state.result.source_player===null||state.result.source_player===w;queue.push([w,self?'自摸':'胡',true]);}
  }
  queue.slice(0,4).forEach(([seat,text,big],i)=>setTimeout(()=>stamp(seat,text,big),i*420));
}

/* ---------- hand & actions ---------- */
function selectAction(id,{fromTile=false}={}){
  if(busy||playing)return;
  if(fromTile&&id===selected&&window.matchMedia('(hover: none)').matches===false){/* desktop: double click confirms via dblclick */}
  selected=id;renderHand();renderCoach();updateConfirm();
}
function updateConfirm(){
  if(playing){$('confirm').textContent='其他家出牌中…';$('confirm').disabled=true;return;}
  const a=chosen();$('confirm').textContent=state.finished?'本局已結束':a?`確認${a.label}`:'選擇動作';
  $('confirm').disabled=busy||state.finished||!a;
}
function renderHand(){
  const own=state.players[state.viewer];
  const hand=$('hand');hand.replaceChildren();const current=chosen();const rec=hideAdvice()?null:state.actions.find(a=>a.recommended);
  const drawn=drawnTile();const tiles=[...own.hand];let drawnIndex=-1;
  if(drawn!==null){drawnIndex=tiles.indexOf(drawn);}
  const rest=tiles.filter((_,i)=>i!==drawnIndex).sort((a,b)=>a-b);
  const ordered=drawnIndex>=0?[...rest,drawn]:rest;
  let starred=false,selDone=false;
  ordered.forEach((t,i)=>{
    const options=state.actions.filter(a=>['discard','declare_ready'].includes(a.kind)&&a.types[0]===t);
    const playable=options.length>0&&!state.finished;
    const b=tile(t,false,playable);
    if(drawnIndex>=0&&i===ordered.length-1)b.classList.add('drawn');
    if(playable){
      const id=(options.find(a=>a.kind==='discard')||options[0]).id;
      b.setAttribute('role','option');
      const isSel=!!(current&&['discard','declare_ready'].includes(current.kind)&&current.types[0]===t);
      b.onclick=()=>{ if(selected===id&&b.classList.contains('selected')){ confirmChoice(); } else selectAction(id,{fromTile:true}); };
    }
    const selType=current&&['discard','declare_ready'].includes(current.kind)?current.types[0]:null;
    if(selType===t&&!selDone&&(drawnIndex<0||t!==drawn||i===ordered.length-1)){b.classList.add('selected');selDone=true;}
    if(rec&&!starred&&['discard','declare_ready'].includes(rec.kind)&&rec.types[0]===t&&(drawnIndex<0||rec.types[0]!==drawn||i===ordered.length-1)){b.classList.add('recommended');starred=true;}
    if(b.tagName==='BUTTON')b.setAttribute('aria-selected',b.classList.contains('selected')?'true':'false');
    hand.append(b);
  });
  // own melds + flowers on the tray
  const om=$('own-melds');om.replaceChildren(melds(own));if(own.flowers.length){const f=element('div','flower-row');own.flowers.forEach(t=>f.append(tile(t,true)));om.append(f);}
  $('hand-tip').textContent=state.finished?'本局已結算':state.reaction?'可回應其他玩家的出牌':drawn!==null?'最右邊是剛摸進的牌 · 再點一次出牌':'點牌預覽，再點一次出牌';
  // big call buttons
  const specials=$('special-actions');specials.replaceChildren();
  const callActions=state.actions.filter(a=>!['discard','draw'].includes(a.kind));
  for(const a of callActions){
    const b=element('button','call-btn call-'+a.kind+(a.id===selected?' active':''));
    b.append(element('span','call-glyph',{win:'胡',chi:'吃',pong:'碰',exposed_kong:'槓',concealed_kong:'槓',added_kong:'槓',declare_ready:'聽',pass:'過'}[a.kind]||'·'));
    b.append(element('span','call-label',a.label));
    if(a.recommended&&!hideAdvice())b.classList.add('recommended');
    b.setAttribute('aria-pressed',a.id===selected?'true':'false');
    b.onclick=()=>{ if(selected===a.id) confirmChoice(); else selectAction(a.id); };
    specials.append(b);
  }
  specials.classList.toggle('has-calls',callActions.length>0);
}

/* ---------- coach ---------- */
function metric(label,value,unit=''){const m=element('div','metric');m.append(element('span','',label));const strong=element('strong','',value);strong.append(element('small','',unit));m.append(strong);return m;}
function renderResult(){const r=state.result,box=element('div','result-card');const won=r.winners.includes(state.viewer);box.append(element('span','eyebrow','HAND COMPLETE'),element('h3','',r.winners.length?(won?'這一手，胡了。':'這一局，留點心得。'):'流局，下一手再來。'));const points=r.payments[state.viewer];box.append(element('div','score'+(points<0?' negative':''),(points>0?'+':'')+points),element('p','muted','本局淨分 · 規則引擎結算'));
 const list=element('div','score-list');for(const p of state.players){const row=element('div');row.append(element('span','',`${seatName(p.seat)} · ${winds[p.wind]}位${r.winners.includes(p.seat)?' / 胡牌':''}`),element('strong','',(r.payments[p.seat]>0?'+':'')+r.payments[p.seat]));list.append(row);}box.append(list,element('p','muted','可在「對局回顧」檢視每次選擇，或開始新的一局。'));$('coach-content').replaceChildren(box);}
function renderOverlay(){
  const o=$('result-overlay');
  if(playing||!state.finished||!state.result){o.hidden=true;return;}
  const r=state.result;o.replaceChildren();const won=r.winners.includes(state.viewer);
  const card=element('div','result-banner'+(won?' win':r.winners.length?' lose':' draw'));
  card.append(element('div','result-title',r.winners.length?(won?'胡牌！':`${r.winners.map(seatName).join('、')} 胡牌`):'流局'));
  const pts=r.payments[state.viewer];card.append(element('div','result-points',(pts>0?'+':'')+pts));
  const again=element('button','primary','再來一局');again.onclick=()=>start();
  const review=element('button','quiet light','回顧這局');review.onclick=()=>$('replay').click();
  const row=element('div','result-actions');row.append(review,again);card.append(row);o.append(card);o.hidden=false;
}
function renderCoach(){
 $('model-badge').textContent=state.model_name;if(state.finished){renderResult();return;}
 const box=$('coach-content');box.replaceChildren();
 if(hideAdvice()){
   const c=element('div','coach-hidden');c.append(element('div','empty-symbol','想'),element('h3','','先照自己的判斷出牌。'),element('p','muted','「先自己想」已開啟：送出後才揭曉 AI 會怎麼選。'));
   const peek=element('button','quiet','現在就看建議');peek.onclick=()=>{revealed=true;render();};c.append(peek);box.append(c);return;
 }
 const a=chosen();if(!a)return;
 const label=element('div','advice-label');label.append(element('span','',a.recommended?'AI 建議 · 目前選擇':'你選的動作'),element('span',a.recommended?'rec':'',a.recommended?'✦ 建議':'可自由選擇'));box.append(label);
 const title=element('div','selected-action');if(a.types.length)title.append(tile(a.types[0]));const heading=element('div');heading.append(element('h3','',a.label),element('p','',state.recommendation_method+' · 依目前公開牌況'));title.append(heading);box.append(title);
 const metrics=element('div','metric-grid');metrics.append(metric('出牌後牌型',a.shanten<0?'完成':a.shanten===0?'聽牌':a.shanten,a.shanten>0?'向聽':''),metric('有效未見牌',a.ukeire,'張'),metric('下一抽進張先驗',percent(a.next_draw_prior)),metric(`${a.horizon_draws} 抽至少進張一次`,percent(a.four_draw_prior)));box.append(metrics);
 const effTitle=element('div','effective-title');effTitle.append(element('span','',a.shanten===0?'可完成牌型的牌':'能改善牌型的進張'),element('small','',`未見牌池 ${a.unseen_population} 張`));box.append(effTitle);const effective=element('div','effective-tiles');for(const e of a.effective_tiles){const item=element('div','effective');item.append(tile(e.type,true),element('small','',`× ${e.unseen}`));effective.append(item);}box.append(effective);if(!a.effective_tiles.length)effective.append(element('span','muted','此動作沒有列出的有效進張。'));
 const risk=element('div','risk-row');const d=a.danger_score;const level=d<.3?'低':d<.65?'中':'高';risk.append(element('span','',a.kind==='added_kong'?'後續棄牌危險分數':'公開牌況危險分數'),element('strong',d>=.65?'high':'',`${d.toFixed(2)} / 1 · ${level}`));box.append(risk);
 if(a.needs_discard)box.append(element('div','context-warning',`吃碰後仍需出牌。以上牌型與進張以後續打出${name(a.followup_discard_type)}為條件，尚未執行。`));
 if(a.needs_supplement)box.append(element('div','context-warning','這是補牌前的牌型估計，未知補牌可能改變結果；危險分數不代表搶槓機率。'));
 if(!state.model_loaded)box.append(element('div','context-warning','BC 模型未成功載入，目前使用規則教師建議。'));
 const ct=element('div','candidates-title');ct.append(element('span','',`比較合法動作 · ${state.actions.length}`),element('span','pref-note','長條＝模型偏好，不是勝率'));box.append(ct);
 const candidates=element('div','candidates');const sorted=[...state.actions].sort((x,y)=>(y.recommended-x.recommended)||((y.preference??-1)-(x.preference??-1))||(x.shanten-y.shanten)||(y.ukeire-x.ukeire));
 const LIMIT=4;const showAll=renderCoach.showAll||sorted.length<=LIMIT+1;
 (showAll?sorted:sorted.slice(0,LIMIT)).forEach((c,i)=>{const b=element('button','candidate'+(selected===c.id?' active':''));b.setAttribute('aria-pressed',selected===c.id?'true':'false');b.append(element('span','rank',i+1));if(c.types.length)b.append(tile(c.types[0],true));const text=element('span','choice-label',c.label);if(c.recommended)text.append(element('span','star','✦'));text.append(element('small','',shanten(c.shanten)+' · '+c.ukeire+' 張進張'));b.append(text);
   const pref=element('span','pref');if(c.preference===null){pref.append(element('em','','—'));}else{const bar=element('span','pref-bar');bar.style.setProperty('--w',Math.max(2,Math.round(c.preference*100))+'%');pref.append(bar,element('em','',c.preference<0.005?'<1%':Math.round(c.preference*100)+'%'));}
   b.append(pref);b.onclick=()=>selectAction(c.id);candidates.append(b);});
 box.append(candidates);
 if(!showAll){const more=element('button','quiet more-candidates',`顯示全部 ${sorted.length} 個動作`);more.onclick=()=>{renderCoach.showAll=true;renderCoach();};box.append(more);}
}

/* ---------- bottom sheet (narrow screens) ---------- */
const narrow=()=>matchMedia('(max-width: 999px)').matches;
function openSheet(open){
  document.body.classList.toggle('sheet-open',open);$('sheet-backdrop').hidden=!open;
  $('hint-button').setAttribute('aria-expanded',open?'true':'false');
  if(open&&state&&prefs.think&&!revealed&&!state.finished){/* stays hidden until user taps peek */}
}
$('hint-button').onclick=()=>openSheet(!document.body.classList.contains('sheet-open'));
$('coach-close').onclick=()=>openSheet(false);$('sheet-backdrop').onclick=()=>openSheet(false);

/* ---------- keep ponds clear of the edge seats (melds vary in width) ---------- */
function layoutPonds(){
  const board=$('board');if(!board)return;const B=board.getBoundingClientRect();const gap=6;
  const L=$('seat-left').getBoundingClientRect(),R=$('seat-right').getBoundingClientRect(),T=$('seat-top').getBoundingClientRect();
  $('river-left').style.left=L.width?`${Math.round(L.right-B.left+gap)}px`:'';
  $('river-right').style.right=R.width?`${Math.round(B.right-R.left+gap)}px`:'';
  $('river-top').style.top=T.height?`${Math.round(T.bottom-B.top+gap)}px`:'';
}
addEventListener('resize',()=>{if(state)layoutPonds();});
/* ---------- main render ---------- */
function render(){
  const pos=positions();
  for(const where of ['top','left','right'])renderSeat(where,pos[where]);
  for(const where of ['top','left','right','bottom']){renderPond(where,pos[where]);renderPlate(where,pos[where]);}
  renderCompass();renderLog();
  $('wall-count').textContent=state.live_tiles;
  const own=state.players[state.viewer];
  $('round-label').textContent=`${winds[own.wind]}位 · 東風局`;
  $('table-status').textContent=state.finished?'本局結束':state.reaction?'等你回應':'輪到你';
  const rc=$('reaction');rc.replaceChildren();rc.classList.toggle('show',!!state.reaction&&!state.finished);
  if(state.reaction&&!state.finished){rc.append(element('span','',`${seatName(state.reaction.source)}打出`),tile(state.reaction.tile,true));}
  $('new-game').textContent='新的一局';$('replay').disabled=false;$('seat').value=String(state.viewer);$('menu-seat').value=String(state.viewer);
  document.querySelector('[data-proxy="replay"]').disabled=false;
  renderHand();renderCoach();renderOverlay();updateConfirm();
  if(playing)lockTray(true);
  layoutPonds();
  $('hint-button').classList.toggle('dim',hideAdvice());
}
function accept(next){
  prevState=state;state=next;revealed=false;renderCoach.showAll=false;
  selected=prefs.think?null:((state.actions.find(a=>a.recommended)||state.actions[0])?.id||null);
  if(prefs.think&&state.actions.length===1)selected=state.actions[0].id;
  const steps=prevState&&prevState.viewer===state.viewer&&prefs.dwell>0?buildSteps(newEvents(prevState.events||[],state.events||[])):[];
  if(steps.length){startPlayback(steps);return;}
  render();playEffects();afterTurnReady();
}
function afterTurnReady(){
  if(pendingReveal){toast(pendingReveal);pendingReveal=null;}
  status(state.finished?'本局已結算，可回顧每一手的選擇。':hideAdvice()?'先自己想：選好再送出，AI 建議會在之後揭曉。':'✦ 表示 AI 建議。你可以選擇任何合法動作。');
  scheduleAuto();
}

/* ---------- playback: show each other player's move for a moment ---------- */
// The server advances the AI seats in one request and only sends the last 28 public events.
// Find the events that are new since the previous snapshot by aligning the two windows.
function newEvents(before,after){
  const same=(a,b)=>a.kind===b.kind&&a.player===b.player&&a.tile_count===b.tile_count&&JSON.stringify(a.types)===JSON.stringify(b.types);
  for(let k=0;k<=before.length;k++){
    const tail=before.slice(k);if(tail.length>after.length)continue;
    if(tail.every((e,i)=>same(e,after[i])))return after.slice(tail.length);
  }
  return after.slice();
}
function buildSteps(events){
  const steps=[];const v=state.viewer;
  events.forEach((e,i)=>{
    if(e.kind==='discard'&&e.player!==v){
      const next=events.slice(i+1).find(x=>x.kind!=='draw'&&x.kind!=='flower');
      const claimed=!!(next&&next.kind==='meld'&&next.player!==e.player&&next.types.length!==1&&next.types.includes(e.types[0]));
      steps.push({e,type:'discard',claimed,ms:prefs.dwell});
    } else if(e.kind==='meld'){
      const prev=[...events.slice(0,i)].reverse().find(x=>x.kind==='discard');
      steps.push({e,type:'meld',newMeld:e.types.length!==1,from:prev&&prev.player!==e.player?prev.player:null,ms:e.player===v?250:Math.max(1300,prefs.dwell*.9)});
    } else if(e.kind==='ready'&&e.player!==v){steps.push({e,type:'ready',ms:1100});}
    else if(e.kind==='win'){steps.push({e,type:'win',ms:1300});}
  });
  return steps;
}
function startPlayback(steps){
  const token=++playToken;playing=true;document.body.classList.add('replaying');
  hold={river:{0:0,1:0,2:0,3:0},melds:{0:0,1:0,2:0,3:0},extra:{0:null,1:null,2:null,3:null},latest:null,actor:null};
  for(const st of steps){
    if(st.type==='discard'&&!st.claimed)hold.river[st.e.player]++;
    if(st.type==='meld'&&st.newMeld)hold.melds[st.e.player]++;
  }
  // a win by discard: keep the winning tile in the river count consistent with the final snapshot
  render();lockTray(true);$('table-status').textContent='出牌中';$('hand-tip').textContent='其他家出牌中…';status('其他家出牌中…（點一下牌桌可略過）');
  let i=0;
  const tick=()=>{
    if(token!==playToken)return;
    if(i>=steps.length){finishPlayback(token);return;}
    const st=steps[i++],e=st.e,seat=e.player;hold.actor=seat;
    if(st.type==='discard'){
      if(st.claimed)hold.extra[seat]=e.types[0];else hold.river[seat]=Math.max(0,hold.river[seat]-1);
      hold.latest=seat;spotlight(seat,e.types[0],st.ms);
    } else if(st.type==='meld'){
      if(st.newMeld)hold.melds[seat]=Math.max(0,hold.melds[seat]-1);
      if(st.from!==null&&st.from!==undefined)hold.extra[st.from]=null;
      hold.latest=null;clearSpotlight();
      const t=e.types;stamp(seat,!t.length?'暗槓':t.length===1||t.length===4?'槓':t.every(x=>x===t[0])?'碰':'吃');
    } else if(st.type==='ready'){stamp(seat,'聽');}
    else if(st.type==='win'){clearSpotlight();const self=state.result&&(state.result.source_player===null||state.result.source_player===seat);stamp(seat,self?'自摸':'胡',true);}
    renderTable();$('ticker-text').textContent=describe(e)||$('ticker-text').textContent;
    setTimeout(tick,st.ms);
  };
  tick();
}
function finishPlayback(token){
  if(token!==playToken)return;
  playToken++;playing=false;hold=null;clearSpotlight();document.body.classList.remove('replaying');
  lockTray(false);render();afterTurnReady();
}
function skipPlayback(){if(playing)finishPlayback(playToken);}
function lockTray(on){document.querySelectorAll('#hand button,#special-actions button,.candidate').forEach(b=>b.disabled=on);$('confirm').disabled=on||!chosen();if(on)$('confirm').textContent='其他家出牌中…';}
function renderTable(){
  const pos=positions();
  for(const where of ['top','left','right'])renderSeat(where,pos[where]);
  for(const where of ['top','left','right','bottom']){renderPond(where,pos[where]);renderPlate(where,pos[where]);}
  renderCompass();layoutPonds();
  $('table-status').textContent=playing?'出牌中':$('table-status').textContent;
}
function spotlight(seat,type,ms){
  clearSpotlight();
  const pos=Object.entries(positions()).find(([,s])=>s===seat)[0];
  const rel={right:'下家',top:'對家',left:'上家',bottom:'你'}[pos];const p=state.players.find(x=>x.seat===seat);
  const box=element('div','discard-spot center from-'+pos+' wind-'+p.wind);box.id='discard-spot';
  const arrow=element('span','spot-arrow',{right:'▶',top:'▲',left:'◀',bottom:'▼'}[pos]);arrow.setAttribute('aria-hidden','true');
  const label=element('span','spot-label');label.append(element('b','',rel),document.createTextNode(` ${seatName(seat)}（${winds[p.wind]}）打出`));
  box.setAttribute('role','status');box.setAttribute('aria-label',`${rel}${seatName(seat)}打出${name(type)}`);
  box.append(arrow,label,tile(type),element('span','spot-name',name(type)));
  box.style.setProperty('--dwell',ms+'ms');$('fx').append(box);
}
function clearSpotlight(){$('discard-spot')?.remove();}
$('board').addEventListener('click',e=>{if(playing&&!e.target.closest('#ticker,#event-log'))skipPlayback();});
function scheduleAuto(){
  clearTimeout(autoTimer);if(!prefs.autoready||!state||state.finished)return;
  const own=state.players[state.viewer];
  if(own.ready&&state.actions.length===1&&state.actions[0].kind==='discard'){autoTimer=setTimeout(()=>{if(state&&state.actions.length===1&&!busy&&!playing){selected=state.actions[0].id;confirmChoice();}},900);}
}
async function start(){if(busy)return;if(playing){playToken++;playing=false;hold=null;clearSpotlight();document.body.classList.remove('replaying');}setBusy(true);status('正在洗牌、安排三位 AI 入座…');try{prevState=null;state=null;accept((await api('/api/new',{seat:Number($('seat').value)})).state);}catch(error){status(error.message,true);}finally{setBusy(false);}}
$('new-game').onclick=()=>{if(state&&!state.finished)$('new-dialog').showModal();else start();};
$('replace-game').onclick=()=>{$('new-dialog').close();start();};
async function confirmChoice(){
  if(busy||playing||!selected||!state||state.finished)return;
  const mine=chosen();const rec=state.actions.find(a=>a.recommended);
  if(prefs.think&&!revealed&&mine&&rec&&state.actions.length>1){pendingReveal=mine.id===rec.id?`和 AI 想的一樣：${rec.label} ✦`:`你：${mine.label} · AI 會選：${rec.label}`;}
  setBusy(true);status('已送出選擇，其他玩家思考中…');
  try{accept((await api('/api/action',{version:state.version,candidate:selected})).state);}
  catch(error){status(error.message,true);try{const current=(await api('/api/state')).state;if(current){state=current;selected=(state.actions.find(a=>a.recommended)||state.actions[0])?.id||null;render();}}catch{}}
  finally{setBusy(false);updateConfirm();}
}
$('confirm').onclick=confirmChoice;
$('rules').onclick=()=>$('rules-dialog').showModal();document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());

/* ---------- ticker / log ---------- */
$('ticker').onclick=()=>{const log=$('event-log');log.hidden=!log.hidden;$('ticker').setAttribute('aria-expanded',String(!log.hidden));};

/* ---------- menu & options ---------- */
function closeMenu(){$('menu').hidden=true;$('menu-button').setAttribute('aria-expanded','false');}
$('menu-button').onclick=e=>{e.stopPropagation();const m=$('menu');m.hidden=!m.hidden;$('menu-button').setAttribute('aria-expanded',String(!m.hidden));};
document.addEventListener('click',e=>{if(!$('menu').hidden&&!$('menu').contains(e.target))closeMenu();});
document.querySelectorAll('[data-proxy]').forEach(b=>b.onclick=()=>{closeMenu();$(b.dataset.proxy).click();});
$('opt-dwell').value=String(prefs.dwell);$('opt-dwell').onchange=()=>{prefs.dwell=Number($('opt-dwell').value);savePrefs();};
$('menu-seat').onchange=()=>{$('seat').value=$('menu-seat').value;};
$('seat').addEventListener('change',()=>{$('menu-seat').value=$('seat').value;});
for(const [id,key] of [['opt-think','think'],['opt-autoready','autoready'],['opt-fx','fx']]){
  const box=$(id);box.checked=!!prefs[key];
  box.onchange=()=>{prefs[key]=box.checked;savePrefs();if(state){if(key==='think'){revealed=false;if(box.checked&&state.actions.length>1)selected=null;if(!box.checked&&!selected)selected=(state.actions.find(a=>a.recommended)||state.actions[0])?.id||null;}render();scheduleAuto();}};
}

/* ---------- keyboard ---------- */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&(!$('menu').hidden||document.body.classList.contains('sheet-open'))){openSheet(false);closeMenu();$('menu-button').focus();return;}
  if(e.key===' '&&playing&&!/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)){skipPlayback();e.preventDefault();return;}
  if(!state||state.finished||busy||playing||document.querySelector('dialog[open]')||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
  const playable=[...document.querySelectorAll('#hand button.tile')];
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
    if(!playable.length)return;let i=playable.findIndex(b=>b.classList.contains('selected'));
    i=i<0?(e.key==='ArrowRight'?0:playable.length-1):(i+(e.key==='ArrowRight'?1:-1)+playable.length)%playable.length;
    playable[i].click();document.querySelectorAll('#hand button.tile')[i]?.focus();e.preventDefault();
  } else if(e.key==='Enter'&&selected&&!(e.target.tagName==='BUTTON'&&e.target!==document.body)){confirmChoice();e.preventDefault();}
  else if(e.key==='h'||e.key==='H'){if(narrow())openSheet(!document.body.classList.contains('sheet-open'));else if(hideAdvice()){revealed=true;render();}}
  else if(e.key==='Escape'){openSheet(false);closeMenu();}
});

/* ---------- rotate hint for portrait phones ---------- */
function rotateHintOnce(){
  if(!matchMedia('(max-width: 600px) and (orientation: portrait)').matches)return;
  try{if(sessionStorage.getItem('qingzhu-rotate')==='1')return;sessionStorage.setItem('qingzhu-rotate','1');}catch{}
  setTimeout(()=>toast('小提示：橫放手機，牌桌和手牌會更大。',4200),600);
}
rotateHintOnce();

/* ---------- replay (study.js extends renderReplay) ---------- */
function renderReplay(){const s=replay.snapshots[replayIndex],own=s.players[s.viewer],b=$('replay-content');b.replaceChildren();$('replay-index').textContent=`${replayIndex+1} / ${replay.snapshots.length}`;$('prev-step').disabled=replayIndex===0;$('next-step').disabled=replayIndex===replay.snapshots.length-1;const h=element('div','replay-hand');for(const t of [...own.hand].sort((a,b)=>a-b))h.append(tile(t,true));b.append(h);const chosenAction=s.actions.find(a=>a.id===s.chosen),rec=s.actions.find(a=>a.recommended),note=element('div','replay-note');note.append(element('div','',`你的選擇：${chosenAction?.label||(s.finished?'已結算':'等待決定')}`),element('div','',`當時建議：${rec?.label||'—'}`));if(chosenAction)note.append(element('div','',`${shanten(chosenAction.shanten)} · ${chosenAction.ukeire} 張有效未見牌 · 下一抽進張先驗 ${percent(chosenAction.next_draw_prior)}`));b.append(note,element('p','muted','只包含你當時可見的手牌與公開資訊。事後結果不能直接證明另一個動作會更好。'));}
$('replay').onclick=async()=>{try{replay=await api('/api/replay');replayIndex=replay.snapshots.length-1;renderReplay();$('replay-dialog').showModal();}catch(error){status(error.message,true);}};
$('prev-step').onclick=()=>{replayIndex--;renderReplay();};$('next-step').onclick=()=>{replayIndex++;renderReplay();};
$('download').onclick=()=>{const blob=new Blob([JSON.stringify(replay,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download='青竹-公開對局紀錄.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function renderStartCard(){
  const o=$('result-overlay');o.replaceChildren();
  const card=element('div','result-banner start');card.append(element('div','result-title','青竹 · 十六張'),element('p','start-sub','一位玩家，三位 AI 陪練'));
  const row=element('div','start-seat');const sel=element('select');sel.id='start-seat';sel.setAttribute('aria-label','選擇座位');
  ['東位','南位','西位','北位'].forEach((t,i)=>{const o2=element('option','',t);o2.value=String(i);sel.append(o2);});sel.value=$('seat').value;
  sel.onchange=()=>{$('seat').value=sel.value;$('menu-seat').value=sel.value;};
  const go=element('button','primary','開始一局');go.id='start-cta';go.onclick=()=>start();
  row.append(sel,go);card.append(row);o.append(card);o.hidden=false;
}
(async()=>{try{const data=await api('/api/state');if(data.state)accept(data.state);else{renderStartCard();status('牌桌準備好了。選好座位，就能開始。');}}catch(error){status(error.message,true);}})();
