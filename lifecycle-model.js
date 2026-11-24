(function(root) {
  'use strict';
  const numeric = v => typeof v === 'number' && Number.isFinite(v);
  const percent = (value, base) => numeric(value) && numeric(base) && base > 0 ? Math.round((value / base - 1) * 10000) / 100 : null;
  const value = day => day?.complete && numeric(day.close) ? day.close : day?.last ?? null;
  // Same bounded exchange calendar as market_calendar.py; uncovered dates stay unknown.
  const calendar = {"valid_from":"2026-01-01","valid_through":"2026-12-31","verified_on":"2026-09-22","sources":[{"exchange":"SSE","published_on":"2025-12-22","url":"https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml"},{"exchange":"SZSE","published_on":"2025-12-22","url":"https://investor.szse.cn/disclosure/notice/general/t20251222_618087.html"},{"exchange":"SSE","published_on":"2026-09-17","url":"https://www.sse.com.cn/disclosure/announcement/general/c/c_20260915_10832273.shtml"}],"holiday_ranges":[["2026-01-01","2026-01-03"],["2026-02-15","2026-02-23"],["2026-04-04","2026-04-06"],["2026-05-01","2026-05-05"],["2026-06-19","2026-06-21"],["2026-09-25","2026-09-27"],["2026-10-01","2026-10-07"]]};
  const isoDay = s => {
    if(typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
    const d=new Date(s+'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===s ? s : null;
  };
  const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function trading(day) {
    if(!isoDay(day)||day<calendar.valid_from||day>calendar.valid_through)return null;
    const weekday=new Date(day+'T00:00:00Z').getUTCDay();
    return weekday!==0 && weekday!==6 && !calendar.holiday_ranges.some(([a,b])=>day>=a&&day<=b);
  }
  function shiftDay(day,direction) {
    if(!isoDay(day))return null;
    let d=new Date(day+'T00:00:00Z');
    for(let i=0;i<40;i++) {
      d.setUTCDate(d.getUTCDate()+direction);
      const next=d.toISOString().slice(0,10),status=trading(next);
      if(status===null)return null;
      if(status)return next;
    }
    return null;
  }
  const referenceDate = (day=today()) => trading(day)===true ? day : trading(day)===false ? shiftDay(day,-1) : null;
  const windowCache=new Map();
  function cohortDates(asOf=today()) {
    if(windowCache.has(asOf))return windowCache.get(asOf);
    const ref=referenceDate(asOf), result={};
    if(ref) {
      result[0]=ref;
      for(const direction of [-1,1]) {
        let day=ref;
        for(let n=1;n<=3;n++) {day=shiftDay(day,-direction);if(!day)break;result[n*direction]=day;}
      }
    }
    if(windowCache.size>4)windowCache.clear();
    windowCache.set(asOf,result);return result;
  }
  function targetDate(record, fallback=null) {
    if(record.t_date!==undefined)return isoDay(record.t_date);
    if(record.target_trade_date)return isoDay(record.target_trade_date);
    const match=/(?<![\w+\-])T\s*=\s*(\d{4}-\d{2}-\d{2})/.exec(typeof record.cycle_position==='string'?record.cycle_position:'');
    if(match)return isoDay(match[1]);
    const seed=isoDay(record.seed_trade_date);
    // An abbreviated explicit T date is usable only when the full seed date anchors it.
    // Conflicting shorthand stays unknown instead of being silently shifted by phase.
    const shortTarget=/(?<![\w+\-])T\s*=\s*(\d{2}-\d{2})(?![\d-])/.exec(typeof record.cycle_position==='string'?record.cycle_position:'');
    if(shortTarget)return seed && seed.slice(5)===shortTarget[1] ? seed : null;
    const phaseOffset=/^T-(\d)/.exec(String(record.phase||''));
    if(seed && phaseOffset){
      let day=trading(seed)?seed:null;
      if(day){for(let i=0;i<Number(phaseOffset[1]);i++){day=shiftDay(day,1);if(!day)break;}}
      return day;
    }
    if(seed && record.phase==='T+1_EXIT_DONE')return seed;
    // A current handoff date applies only to rows without a legacy lifecycle identity.
    return !/^T[+-]/.test(record.phase||'') ? isoDay(fallback) : null;
  }
  function cohort(record,asOf=today(),fallback=null) {
    const target=targetDate(record,fallback);
    if(!target)return null;
    const found=Object.entries(cohortDates(asOf)).find(([,day])=>day===target);
    return found ? Number(found[0]) : null;
  }
  function recordsForView(records,view,asOf=today(),fallback=null) {
    return records.filter(r=>{const c=cohort(r,asOf,fallback);return c!==null &&
      (view==='today'?c===0:view==='before'?c<0:view==='after'?c>0:false);});
  }
  const cohortLabel = c => c===null?'日期待核对':c===0?'T':c>0?`T+${c}`:`T−${-c}`;
  function defense(record) {
    const day = record.days?.['1'] || {};
    const ruleDate = /T\+1\s*[=：:]\s*(\d{4}-\d{2}-\d{2})/.exec(record.rule_text || '')?.[1];
    const conflict = Boolean(ruleDate && ruleDate !== day.date);
    const enabled = !conflict && /(?:开盘|开).*3\s*%/.test(record.rule_text || '');
    const line = enabled && numeric(day.open) && day.open > 0 ? day.open * 0.97 : null;
    const point = line === null ? null : (day.points || []).find(p => numeric(p.price) && p.price < line);
    return {line, conflict, touched: point ? true : line !== null && numeric(day.low) ? day.low < line : null, at:point?.at || null};
  }
  const afterExit = (record, day) => {
    const exitAt = Date.parse(record.exit?.at);
    const observedAt = Date.parse(day?.complete && numeric(day.close) ? `${day.date}T15:00:00+08:00` : day?.last_at || day?.source_at);
    return Number.isFinite(exitAt) && Number.isFinite(observedAt) && observedAt >= exitAt ? percent(value(day),record.exit?.price) : null;
  };
  const model = {numeric, percent, value, defense, afterExit, recordsForView, cohort, cohortDates, cohortLabel, targetDate, referenceDate, today, calendar};
  if (typeof module !== 'undefined') module.exports = model;
  root.LifecycleModel = model;
})(typeof window === 'undefined' ? globalThis : window);
