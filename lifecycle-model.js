(function(root) {
  'use strict';
  const numeric = v => typeof v === 'number' && Number.isFinite(v);
  const percent = (value, base) => numeric(value) && numeric(base) && base > 0 ? Math.round((value / base - 1) * 10000) / 100 : null;
  const value = day => day?.complete && numeric(day.close) ? day.close : day?.last ?? null;
  function pool(record) {
    if(record.exit?.reported || /^T\+/.test(record.phase || '')) return 'after';
    if(record.phase === 'T-1_PM_WATCH') return 'before';
    if(record.phase === 'T-1_POSTMARKET') return 'today';
    return 'unknown';
  }
  const recordsForView = (records, view) => ['before','after','today'].includes(view) ? records.filter(r=>pool(r)===view) : [];
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
  const model = {numeric, percent, value, defense, afterExit, recordsForView};
  if (typeof module !== 'undefined') module.exports = model;
  root.LifecycleModel = model;
})(typeof window === 'undefined' ? globalThis : window);
