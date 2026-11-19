'use strict';
function tileCode(t) { return t < 27 ? `${t % 9 + 1}${['m','p','s'][Math.floor(t / 9)]}` : `${t - 26}z`; }
function tableCell(row, value, header = false) { const c = element(header ? 'th' : 'td', '', value); row.append(c); return c; }
function comparisonTable(actions, chosenId, manual = false) {
  const wrapper = element('div','comparison-scroll'), table = element('table','comparison-table'), head = element('thead'), hr = element('tr');
  const titles = manual ? ['打牌選擇','牌型','有效未見牌','下一抽進張先驗','四抽至少一次'] : ['候選動作','牌型','有效未見牌','下一抽進張先驗','危險分數','模型偏好'];
  titles.forEach(t=>tableCell(hr,t,true)); head.append(hr); table.append(head);
  const body = element('tbody');
  for (const a of actions) {
    const row = element('tr',a.id && a.id===chosenId?'selected-row':'');
    const label = tableCell(row,a.label);
    if (a.id===chosenId && chosenId) label.append(element('small','comparison-tag','當時選擇'));
    if (a.recommended) label.append(element('small','comparison-tag','AI 建議'));
    if (a.teacher_recommended) label.append(element('small','comparison-tag','規則建議'));
    tableCell(row,shanten(a.shanten));tableCell(row,`${a.ukeire} 張`);tableCell(row,percent(a.next_draw_prior));
    if (manual) tableCell(row,percent(a.four_draw_prior));
    else { tableCell(row,a.danger_score.toFixed(2));tableCell(row,a.preference===null?'—':percent(a.preference)); }
    body.append(row);
  }
  table.append(body);wrapper.append(table);return wrapper;
}

renderReplay = function() {
  const s = replay.snapshots[replayIndex], own = s.players[s.viewer], content = $('replay-content');
  content.replaceChildren();$('replay-index').textContent=`${replayIndex+1} / ${replay.snapshots.length}`;
  $('prev-step').disabled=replayIndex===0;$('next-step').disabled=replayIndex===replay.snapshots.length-1;
  content.append(element('p','muted',`${replay.metadata?.rules_version || '舊版公開紀錄'} · ${s.model_name} · 活牌 ${s.live_tiles} 張 · ${s.finished?'本局已結算':'當時的決策局面'}`));
  const hand=element('div','replay-hand');[...own.hand].sort((a,b)=>a-b).forEach(t=>hand.append(tile(t)));content.append(hand, melds(own));
  const publicTable=element('div','replay-public');
  for (const p of s.players) {
    const box=element('section');box.append(element('strong','',`${p.seat===s.viewer?'你':'AI'} · ${winds[p.wind]}位${p.ready?' · 已聽牌':''}`));
    if(p.seat!==s.viewer)box.append(element('p','muted',`暗手 ${p.hand_count} 張`));
    box.append(melds(p));const river=element('div','replay-hand');p.river.forEach(t=>river.append(tile(t,true)));box.append(river);publicTable.append(box);
  }
  content.append(publicTable);
  const picked=s.actions.find(a=>a.id===s.chosen), rec=s.actions.find(a=>a.recommended);
  const note=element('div','replay-note');note.append(element('div','',`你的選擇：${picked?.label||(s.finished?'已結算':'尚未記錄')}`),element('div','',`當時建議：${rec?.label||'—'}`));
  if(s.finished)note.append(element('div','',`本局淨分：${s.result.payments[s.viewer]>0?'+':''}${s.result.payments[s.viewer]}`));
  content.append(note);
  if(s.actions.length)content.append(comparisonTable(s.actions,s.chosen));
  content.append(element('p','muted','回放保留當時的公開資訊與建議，不會還原他家暗牌或繼續這份紀錄。外部檔案僅驗證格式與公開資訊邊界，建議及結果仍以檔案記載為準。'));
};
$('replay-dialog').classList.add('wide-dialog');
$('replay-dialog').addEventListener('keydown',event=>{
  if(event.key==='ArrowLeft' && replayIndex>0){replayIndex--;renderReplay();event.preventDefault();}
  if(event.key==='ArrowRight' && replayIndex<replay.snapshots.length-1){replayIndex++;renderReplay();event.preventDefault();}
});
$('study').onclick=()=>{$('study-status').textContent='';$('use-current').disabled=!state||state.finished;$('study-dialog').showModal();};
function showImported(data){replay=data;replayIndex=0;renderReplay();$('study-dialog').close();$('replay-dialog').showModal();}
$('import-replay').onclick=()=>$('replay-file').click();
$('replay-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>8*1024*1024)throw Error('檔案超過 8 MB');$('study-status').textContent='檢查公開紀錄中…';const raw=JSON.parse(await file.text());showImported(await api('/api/import-replay',raw));}
  catch(error){$('study-status').textContent='無法載入：'+error.message;}finally{event.target.value='';}
};
$('example-replay').onclick=async()=>{try{showImported(await api('/api/example-replay'));}catch(error){$('study-status').textContent=error.message;}};
$('manual-example').onclick=()=>{$('manual-hand').value='123456m 123p 123789s 67z';$('manual-melds').value='';$('manual-public').value='666z';};
$('use-current').onclick=()=>{
  if(!state || state.finished)return;const own=state.players[state.viewer];
  $('manual-hand').value=own.hand.map(tileCode).join(' ');$('manual-melds').value=own.melds.map(m=>m.tiles.map(tileCode).join(' ')).join(' | ');
  const known=[];for(const p of state.players){known.push(...p.river);if(p.seat!==state.viewer)for(const m of p.melds)if(m.tiles)known.push(...m.tiles);}
  $('manual-public').value=known.map(tileCode).join(' ');$('study-status').textContent='已帶入目前能看到的牌；可以修改後比較。';
};
let entryTarget=$('manual-hand');
for(const id of ['manual-hand','manual-melds','manual-public'])$(id).addEventListener('focus',()=>{entryTarget=$(id);});
for(let t=0;t<34;t++){
  const b=tile(t,true,true);b.type='button';b.setAttribute('aria-label','加入 '+name(t));b.onclick=()=>{entryTarget.value+=(entryTarget.value && !entryTarget.value.endsWith(' ')?' ':'')+tileCode(t)+' ';entryTarget.focus();};$('tile-palette').append(b);
}
$('hand-form').onsubmit=async event=>{
  event.preventDefault();const submit=event.submitter;if(submit)submit.disabled=true;$('study-status').textContent='計算牌型與進張…';$('hand-analysis').replaceChildren();
  try{
    const result=await api('/api/analyze-hand',{hand:$('manual-hand').value,melds:$('manual-melds').value,public_tiles:$('manual-public').value});
    $('study-status').textContent=`${result.method} · 未見牌池 ${result.unseen_population} 張`;
    const best=result.rows[0], panel=element('div','replay-note');panel.append(element('strong','',`${best.label} · ${shanten(best.shanten)} · ${best.ukeire} 張有效未見牌`));
    const effective=element('div','effective-tiles');for(const e of best.effective_tiles){const item=element('div','effective');item.append(tile(e.type,true),element('small','',`× ${e.unseen}`));effective.append(item);}panel.append(effective);
    $('hand-analysis').append(panel,comparisonTable(result.rows,null,true),element('p','muted',result.note));
  }catch(error){$('study-status').textContent=error.message;}finally{if(submit)submit.disabled=false;}
};
$('outcome-current').onclick=async()=>{
  const content=$('outcome-result');content.replaceChildren(element('p','muted','讀取目前局面…'));
  try{
    const data=await api('/api/forecast'), f=data.forecast;content.replaceChildren();
    if(!f){content.append(element('p','muted','這個局面目前沒有可用的估計。請先開始一局，並等到待打牌階段；超出樣本涵蓋範圍時也不顯示數字。'));return;}
    if(state && data.version!==state.version){content.append(element('p','muted','牌局已變動，請關閉研究室並重新整理後再查看。'));return;}
    if(f.estimates.win!==undefined){
      content.append(element('p','replay-note',`照 BC 建議繼續打的胡牌估計：約 ${Math.round(f.estimates.win*100)}%`));
      const quality=f.reliability.win,b=quality.bucket;
      if(quality.ece!==null)content.append(element('p','muted',`獨立測試 ${f.test_games} 局；分組平均校準誤差約 ${(quality.ece*100).toFixed(1)} 個百分點。`));
      if(b)content.append(element('p','muted',`相近預測分數的 ${b.count} 個測試局面，實際胡牌比例 ${percent(b.observed)}，樣本 95% 區間 ${percent(b.observed_ci95[0])}–${percent(b.observed_ci95[1])}。此區間描述那一組樣本，不是這一局的保證。`));
    }
    content.append(element('p','muted',f.note),element('p','muted','放槍機率尚未通過獨立誤差檢查，因此保留公開牌況危險分數。'));
  }catch(error){content.replaceChildren(element('p','muted',error.message));}
};
