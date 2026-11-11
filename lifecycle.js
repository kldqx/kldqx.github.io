(function() {
  'use strict';
  const M = window.LifecycleModel;
  const before = document.body.dataset.view === 'before';
  const offsets = before ? [-3,-2,-1] : [1,2,3];
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text = value => typeof value === 'object' && value !== null ? JSON.stringify(value,null,2) : String(value ?? '未记录');
  const n = (value, digits=2) => M.numeric(value) ? value.toFixed(digits) : '—';
  const pct = value => M.numeric(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—';
  const tone = value => M.numeric(value) ? value > 0 ? 'up' : value < 0 ? 'down' : '' : '';
  const dayLabel = value => value === 0 ? 'T' : value > 0 ? `T+${value}` : `T−${-value}`;
  const briefTime = value => value ? String(value).replace('T',' ').slice(0,19) : '未记录';
  const group = record => `${record.t_date}|${record.batch_id}`;
  let data = null, batch = '', selected = '', scope = 'all', search = '', loading = false;
  const initial = new URLSearchParams(location.search);
  try {
    const saved = JSON.parse(sessionStorage.getItem('lifecycle-selection') || '{}');
    batch = initial.get('batch') || saved.batch || '';
    selected = initial.get('code') || saved.code || '';
  } catch { batch = initial.get('batch') || ''; selected = initial.get('code') || ''; }

  function saveSelection(record) {
    const query = new URLSearchParams({batch,code:record.code});
    history.replaceState(null,'',location.pathname+'?'+query.toString());
    try { sessionStorage.setItem('lifecycle-selection',JSON.stringify({batch,code:record.code})); } catch {}
    document.querySelectorAll('[data-cross]').forEach(a=>{ a.href = a.dataset.cross + '?' + query.toString(); });
  }
  const currentDay = r => offsets.map(o=>r.days?.[o]).filter(d=>d && (M.numeric(d.last)||M.numeric(d.close))).at(-1);
  const latest = r => {const d=currentDay(r);return M.value(d);};
  function recordStatus(r) {
    if (before) return {label:r.calendar_available?'已存依据待对照':'交易日历缺口',cls:''};
    if(M.defense(r).conflict) return {label:'原规则日期待核对',cls:'warn'};
    if(r.exit?.reported) return {label:'原记录已离场',cls:'done'};
    if(M.defense(r).touched) return {label:'T+1 价位触及 · 复核',cls:'warn'};
    return {label:'持续观察',cls:''};
  }
  function metric(label,value,note,cls='') {return `<div class="stat"><span class="label">${esc(label)}</span><strong class="${cls}">${esc(value)}</strong><small>${esc(note)}</small></div>`;}
  function render() {
    const groups = [...new Set(data.records.map(group))];
    if(!groups.includes(batch)) {
      batch = groups[0] || '';
      if(!before) batch = groups.find(g => data.records.some(r=>group(r)===g && r.exit?.reported)) || batch;
    }
    $('batch').innerHTML = groups.map(g=>{const r=data.records.find(r=>group(r)===g);return `<option value="${esc(g)}">T = ${esc(r.t_date)} · ${esc(r.batch_id)} · ${data.records.filter(x=>group(x)===g).length}只</option>`;}).join('');
    $('batch').value=batch;
    const rows = data.records.filter(r=>group(r)===batch);
    const coverage = rows.reduce((s,r)=>s+offsets.filter(o=>r.days?.[o]?.state==='有数据').length,0);
    $('stats').innerHTML = before
      ? metric('本批次观察',rows.length,'保持同一 T 日、同一批次') + metric('前序数据覆盖',`${coverage}/${rows.length*3}`,'有数据的股票 × 交易日') + metric('已存依据',rows.filter(r=>r.original?.hypothesis).length,'首次观察时保存，不覆盖') + metric('T 日已有行情',rows.filter(r=>r.days?.['0']?.state==='有数据').length,'与入选前依据并列对照')
      : metric('本批次跟踪',rows.length,'离场后仍保留至 T+3') + metric('T+1 确认价位触及',rows.filter(r=>M.defense(r).touched).length,`${rows.filter(r=>M.defense(r).touched===null).length} 只尚无法判断`,'up') + metric('原记录已离场',rows.filter(r=>r.exit?.reported).length,'不把收盘价当作离场价') + metric('后续数据覆盖',`${coverage}/${rows.length*3}`,'有数据的股票 × 交易日');
    const filtered = rows.filter(r=>(r.name+' '+r.code).toLowerCase().includes(search.toLowerCase()));
    if(!filtered.some(r=>r.code===selected)) selected=filtered[0]?.code || '';
    $('stock-count').textContent=`${filtered.length} 只`;
    $('stocks').innerHTML = filtered.map(r=>{const s=recordStatus(r),price=latest(r),change=M.percent(price,r.baseline?.price);return `<button class="stock ${r.code===selected?'selected':''}" data-code="${esc(r.code)}" aria-pressed="${r.code===selected}"><span class="stock-top"><span>${esc(r.name)}</span><span>${n(price)}</span></span><small>${esc(r.code)}</small><span class="stock-foot"><span class="pill ${s.cls}">${esc(s.label)}</span><span class="${tone(change)}">${pct(change)}</span></span></button>`;}).join('') || '<div class="empty">没有匹配的股票</div>';
    $('stocks').querySelectorAll('[data-code]').forEach(b=>b.onclick=()=>{selected=b.dataset.code;render();});
    const r=filtered.find(x=>x.code===selected);
    if(!r){$('detail').innerHTML='<div class="panel empty">暂无可绑定的批次数据。<br>需要原记录中的 T 日及股票代码。</div>';return;}
    saveSelection(r); renderDetail(r);
    const times=rows.flatMap(r=>offsets.map(o=>r.days?.[o]?.source_at)).filter(Boolean).sort();
    $('source-time').textContent='行情资料截至 '+briefTime(times.at(-1))+' · 日期均为上海时间';
    $('refresh-time').textContent='页面刷新 '+new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' · 数据生成 '+briefTime(data.generated_at);
    const warnings=[];
    if(data.quote_error)warnings.push('最新行情暂未取得，保留已存记录');
    if(data.unbound?.length)warnings.push(`${data.unbound.length} 条记录缺少可确认 T 日，未混入批次`);
    $('notice').hidden=!warnings.length;$('notice').textContent=warnings.join('；');
  }
  function renderDetail(r) {
    const d=currentDay(r),price=latest(r),change=M.percent(price,r.baseline?.price),def=M.defense(r),status=recordStatus(r);
    const daily=scope==='all'?offsets:[Number(scope)];
    const selectedDay = scope==='all'?d:r.days?.[scope];
    const value=M.value(selectedDay);
    const pullback=M.percent(value,selectedDay?.high);
    const headings = before ? ['前序价格与成交量','按实际交易日对齐 · 日线与分钟记录分开展示'] : ['离场后的价格路径','原离场协议保持不变 · T+2 / T+3 只作后续验证'];
    $('detail').innerHTML=`
      <section class="panel"><div class="detail-head"><div><span class="eyebrow">${before?'BEFORE THE SIGNAL':'AFTER THE EXIT'}</span><h2>${esc(r.name)}<small>${esc(r.code)}</small></h2><span class="pill ${status.cls}">${esc(status.label)}</span> <span class="sub">T = ${esc(r.t_date)}</span></div><div class="price"><strong>${n(price)}</strong><small class="${tone(change)}">${pct(change)}</small> <small class="muted">相对 T 收盘</small></div></div>
      <div class="tabs" role="group" aria-label="观察交易日"><button data-scope="all" class="${scope==='all'?'active':''}" aria-pressed="${scope==='all'}">三日总览</button>${offsets.map(o=>`<button data-scope="${o}" class="${scope===String(o)?'active':''}" aria-pressed="${scope===String(o)}">${dayLabel(o)} <span>${esc(r.days?.[o]?.date?.slice(5)||'待确认')}</span></button>`).join('')}</div>
      <div class="chart-title"><span>${headings[0]}</span><span>${headings[1]}</span></div><div class="chart-wrap">${chart(r,daily)}</div>
      <div class="chart-foot">${scope==='all'?'柱线为日内高低与开收盘；不连接缺失日期。':'有分钟记录时显示实际采样路径，否则仅展示日线。'} 未复权价格；除权等价格跳变需结合原始资料核对。</div>
      <div class="detail-metrics"><div><small>T 日收盘基准</small><strong>${n(r.baseline?.price)}</strong></div><div><small>${before?'选中日成交额':'T+1 防守参考价'}</small><strong>${before?(M.numeric(selectedDay?.amount)?n(selectedDay.amount/1e8)+' 亿':'—'):n(def.line)}</strong></div><div><small>选中日距日高</small><strong class="${tone(pullback)}">${pct(pullback)}</strong></div><div><small>${before?'原依据版本':'相对记录离场价'}</small><strong>${before?1+(r.revisions?.length||0):pct(M.afterExit(r,selectedDay))}</strong></div></div></section>
      <section class="panel"><div class="section-head"><h3>${before?'三日证据对照':'逐日跟踪记录'}</h3><small>${before?'价格和成交量是事实；不自动推导资金主体或洗盘结论':'涨跌为基准对比，非账户收益；事后高点不代表可成交机会'}</small></div><div class="table-scroll">${dayTable(r)}</div></section>
      <div class="evidence-grid"><section class="panel"><div class="section-head"><h3>${before?'已存依据与记录':'原离场协议与记录'}</h3><small>原文保留</small></div><div class="copy">${before?originalBlock(r):exitBlock(r,def)}</div></section><section class="panel"><div class="section-head"><h3>${before?'与 T 日实际表现对照':'事件与后续验证'}</h3><small>按已取得的记录展示</small></div><div class="copy">${before?tDayBlock(r):eventsBlock(r,def)}</div></section></div>
      <section class="panel"><details><summary>数据来源、时间口径与后续修订 (${r.revisions?.length||0})</summary><p>T 日归属：${esc(r.date_basis)}\n原依据首次保存：${esc(briefTime(r.first_observed_at))}（采集保存时间，不代替研究发布时间）\n批次：${esc(r.batch_id)}\n日线：本地工程日线缓存；当前采样：腾讯行情；分钟回填：保留原 feed 来源。\n${esc(r.calendar_available?'交易日历覆盖本观察窗口。':'交易日历未覆盖完整窗口，未推算未知日期。')}\n数据生成时间不代表行情实时；缺少日期的资金、板块与异常因子不拆分填入每日。</p>${(r.revisions||[]).map(v=>`<p>后续版本 · ${esc(briefTime(v.observed_at))}\n${esc(text(v.hypothesis))}</p>`).join('')}</details></section>`;
    $('detail').querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{scope=b.dataset.scope;renderDetail(r);});
  }
  function originalBlock(r) {
    const o=r.original||{};
    return `<p class="sub">以下为首次采集的原 feed 快照，未确认其在 T 日前已可得；可能包含后续更新，不作为已验证的前序证据。</p><p>${esc(text(o.hypothesis))}</p><dl><dt>所属板块（原记录）</dt><dd>${esc(text(o.sectors))}</dd><dt>原进入条件</dt><dd>${esc(text(o.original_conditions))}</dd><dt>原失效 / 风险依据</dt><dd>${esc(text(o.risk_reason))}</dd><dt>审核状态（原文）</dt><dd>${esc(text(o.qa_verdict))}</dd></dl>`;
  }
  function exitBlock(r,def) {
    return `<p class="rule">${esc(r.rule_text || '未取得原离场规则。页面不会补造规则或触发判断。')}</p><dl><dt>原记录离场状态</dt><dd>${r.exit?.reported?'已报告离场；不代表已取得成交凭证':'未取得明确离场记录'}</dd><dt>记录离场时间 / 价格</dt><dd>${esc(briefTime(r.exit?.at))} / ${n(r.exit?.price)}</dd><dt>T+1 防守价观察</dt><dd>${def.conflict?'原规则日期与批次 T+1 日期不一致，待核对；暂停价位判断':def.touched===true?'价格曾低于防守参考价，请结合原协议复核':def.touched===false?'已有日内高低数据未见跌破参考价':'数据或规则不足，无法确认'}</dd></dl><p class="sub">T+2、T+3 继续记录后续走势；不延长原持有期，不修改离场条件。</p>`;
  }
  function tDayBlock(r) {
    const d=r.days?.['0']||{};
    return `<dl><dt>T 日 / 行情日期</dt><dd>${esc(r.t_date)} / ${esc(d.date||'缺数据')}</dd><dt>开盘 / 最新或收盘</dt><dd>${n(d.open)} / ${n(M.value(d))}</dd><dt>日内最高 / 最低</dt><dd>${n(d.high)} / ${n(d.low)}</dd><dt>竞价与条件记录（原文）</dt><dd>${esc(text(r.original?.auction_reason))}</dd></dl><p>个股资金、板块每日变化和异常特征，需要带日期的原始证据；现有三日汇总不冒充逐日验证。</p>`;
  }
  function eventsBlock(r,def) {
    return `<ol class="timeline"><li><strong>T 日 ${esc(r.t_date)}</strong><br>收盘基准 ${n(r.baseline?.price)}，未用作实际入场价。</li><li><strong>T+1 原条件观察</strong><br>${def.at?'首次记录价位触及 '+esc(briefTime(def.at)):'未取得可定位的首次触发时间。'}<br>${r.exit?.reported?esc(r.exit.note || '原记录已报告离场'):'尚无明确离场记录。'}</li><li><strong>T+2 → T+3 后续验证</strong><br>${r.exit?.price?'对照记录离场价观察后续变化。':'缺少记录离场价，暂不计算“卖早 / 避开回撤”的幅度。'}<br>行情缺失或未到观察日时保持空白。</li></ol>`;
  }
  function dayTable(r) {
    const rows = offsets.map(o=>{const d=r.days?.[o]||{},value=M.value(d),p=M.percent(value,r.baseline?.price),ret=M.percent(value,d.open);return `<tr><td><strong>${dayLabel(o)}</strong><span class="cells-note">${esc(d.date||'日历未覆盖')}</span></td><td>${n(d.open)}</td><td>${n(value)}<span class="cells-note">${d.complete?'收盘':M.numeric(value)?'采样价':'—'}</span></td><td>${n(d.high)} / ${n(d.low)}</td><td class="${tone(p)}">${pct(p)}<span class="cells-note">${before?'T 收盘回看基准':'非持仓收益'}</span></td><td>${before?(M.numeric(d.volume)?n(d.volume/10000)+' 万股':'—'):`<span class="${tone(ret)}">${pct(ret)}</span>`}</td><td><span class="pill">${esc(d.state||'缺数据')}</span><span class="cells-note">${esc(briefTime(d.source_at))}</span></td></tr>`;}).join('');
    return `<table><thead><tr><th>交易日</th><th>开盘</th><th>最新 / 收盘</th><th>日内最高 / 最低</th><th>相对 T 收盘</th><th>${before?'成交量':'相对当日开盘'}</th><th>数据状态 / 时点</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function chart(r,chosen) {
    const days=chosen.map(o=>({offset:o,...(r.days?.[o]||{})}));
    const intraday=chosen.length===1 && days[0].points?.length>1;
    const points=intraday?days[0].points:[];
    const vals=intraday?points.map(p=>p.price):days.flatMap(d=>[d.open,d.high,d.low,d.close,d.last]).filter(M.numeric);
    if(!vals.length)return '<div class="chart-empty"><div>这个观察窗口尚无可绘制行情<br><small>未到交易日或缺数据时，不生成走势</small></div></div>';
    const baseline=r.baseline?.price, defense=M.defense(r).line;
    const refs=[{value:baseline,label:'T 收盘',color:'#8292ab'}];
    if(!before && chosen.includes(1))refs.push({value:defense,label:'T+1 防守参考',color:'#e4b975'});
    const all=vals.concat(refs.map(v=>v.value).filter(M.numeric));
    let lo=Math.min(...all),hi=Math.max(...all),pad=Math.max((hi-lo)*.18,hi*.003);lo-=pad;hi+=pad;
    const W=900,H=260,L=65,R=760,top=20,bottom=220;
    const y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
    let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${intraday?'实际分钟采样价格':'三个交易日的高低与开收盘价格'}">`;
    for(let i=0;i<5;i++){const value=lo+(hi-lo)*i/4,yy=y(value);s+=`<line x1="${L}" y1="${yy}" x2="${R}" y2="${yy}" stroke="#253345"/><text x="${L-10}" y="${yy+4}" text-anchor="end">${n(value)}</text>`;}
    refs.filter(v=>M.numeric(v.value)).forEach(v=>{s+=`<line x1="${L}" y1="${y(v.value)}" x2="${R}" y2="${y(v.value)}" stroke="${v.color}" stroke-dasharray="5 6"/><text x="${R+9}" y="${y(v.value)+4}">${v.label}</text>`;});
    if(intraday){
      const x=i=>L+i/Math.max(1,points.length-1)*(R-L);
      s+=`<polyline points="${points.map((p,i)=>`${x(i)},${y(p.price)}`).join(' ')}" fill="none" stroke="#75e4db" stroke-width="2.2"/>`;
      for(const i of [...new Set([0,Math.floor(points.length/2),points.length-1])])s+=`<text x="${x(i)}" y="245" text-anchor="middle">${esc(points[i].at.slice(11,16))}</text>`;
      const exit=r.exit;
      if(exit?.at && M.numeric(exit.price) && exit.at.slice(0,10)===days[0].date){const i=points.findIndex(p=>p.at>=exit.at);if(i>=0 && exit.price>=lo && exit.price<=hi)s+=`<circle cx="${x(i)}" cy="${y(exit.price)}" r="5" fill="#f1c581"><title>记录离场 ${esc(exit.at)} / ${n(exit.price)}</title></circle>`;}
    } else days.forEach((d,i)=>{
      const x=L+(i+.5)/days.length*(R-L),value=M.value(d);
      const color=M.numeric(value)&&M.numeric(d.open)&&value<d.open?'#79cfae':'#ff9393';
      if(M.numeric(d.high)&&M.numeric(d.low))s+=`<line x1="${x}" y1="${y(d.high)}" x2="${x}" y2="${y(d.low)}" stroke="${color}" stroke-width="2"/>`;
      if(M.numeric(value)&&M.numeric(d.open))s+=`<rect x="${x-17}" y="${Math.min(y(d.open),y(value))}" width="34" height="${Math.max(2,Math.abs(y(d.open)-y(value)))}" fill="${color}" opacity=".8"><title>${esc(d.date)} 开 ${n(d.open)} 收/最新 ${n(value)}</title></rect>`;
      else if(M.numeric(value))s+=`<circle cx="${x}" cy="${y(value)}" r="4" fill="#75e4db"/>`;
      else s+=`<text x="${x}" y="130" text-anchor="middle">${esc(d.state||'缺数据')}</text>`;
      s+=`<text x="${x}" y="245" text-anchor="middle">${dayLabel(d.offset)} · ${esc(d.date?.slice(5)||'日期未知')}</text>`;
    });
    return s+'</svg>';
  }
  async function load() {
    if(loading)return;loading=true;$('refresh').disabled=true;
    try {
      const response=await fetch('./lifecycle-feed.json',{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const next=await response.json();
      if(next.schema!=='lifecycle-observer/v1'||!Array.isArray(next.records))throw new Error('数据格式不匹配');
      data=next;render();
    }catch(error){$('notice').hidden=false;$('notice').textContent=`观察数据暂不可用（${error.name==='TimeoutError'?'请求超时':error.message}）。${data?'保留上次已加载记录。':'请稍后刷新；不会用演示行情填充。'}`;
      if(!data)$('detail').innerHTML='<div class="panel empty">等待观察数据<br><small>页面已就绪，行情文件暂未取得</small></div>';
    }finally{loading=false;$('refresh').disabled=false;}
  }
  $('batch').onchange=()=>{batch=$('batch').value;selected='';scope='all';render();};
  $('search').oninput=()=>{search=$('search').value;if(data)render();};
  $('refresh').onclick=load;
  load();setInterval(()=>{if(!document.hidden)load();},60000);
})();
