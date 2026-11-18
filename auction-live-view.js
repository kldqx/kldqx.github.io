(function(root) {
  "use strict";
  const lineNames = {T_PULLBACK:"狙击线", T_FIRST_BOARD:"首板线"};
  const profileHash = "a022444bfe77e249019732bdf4c5afe724a62607b18d5aa5d9118df1ff87c37c";
  const checkpointTitles = {pending:"竞价待定稿", supported:"竞价支持原条件", unconfirmed:"竞价未确认",
    invalidated:"原条件已失效", evidence_gap:"竞价证据缺口"};
  const prices = {rising:"上行", falling:"下行", flat:"持平"};
  const relative = {strengthening:"转强", weakening:"转弱", flat:"持平"};
  const flows = {buying:"主动买盘持续", selling:"主动卖盘占优", mixed:"方向混合"};
  const sourceNames = {TENCENT_QUOTE:"腾讯个股行情",DFCF_BOARD_QUOTE:"东方财富原主线行情",VENVOO_NATIVE_TRADES:"逐笔方向成交"};
  const gapNames = {tdx_no_verified_aggressor_transactions:"通达信盘口缺已验证的逐笔成交方向",
    price_previous_minute_missing:"缺上一分钟个股价格",relative_matched_previous_or_current_missing:"个股与原主线缺同窗比较数据",
    frozen_card_identity_missing:"原卡身份待核",original_board_unbound:"原主线板块未绑定",
    two_observed_trade_windows_required:"缺相邻两分钟的有效逐笔成交",two_continuous_minutes_required:"尚无两个连续交易分钟",
    native_trade_direction_or_units_unverified:"逐笔成交方向或单位待核",stale_or_future_clock:"行情时点与本次观察窗口不匹配",
    missing_or_unverified:"来源缺失或尚未核验",original_hash_mismatch:"原件摘要校验失败"};
  function gapLabel(value) {
    if (Object.hasOwn(gapNames,value)) return gapNames[value];
    const match = /^(price|relative|flow)_(.+)$/.exec(value);
    if (match) return `${{price:"个股价格",relative:"原主线",flow:"主动成交"}[match[1]]} · ${gapNames[match[2]] || "该项数据待核"}`;
    return /[\u3400-\u9fff]/.test(value) && !/[\\/:]/.test(value) ? value : "本窗口数据或观察条件待核";
  }
  const strengthTitles = {confirmed:"相对原主线转强，持续主动买盘已观察到", partial:"盘中证据部分可用",
    observed:"已有盘中观测", unknown:"盘中证据待核", stopped:"盘中观察已停止"};
  const known = (map, state, fallback) => Object.hasOwn(map,state) ? map[state] : fallback;
  const textValue = value => typeof value === "string" && value.trim() ? value : "";
  const hashTag = value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? `SHA-256 ${value.slice(0,12)}` : "";
  const shanghaiDay = new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
  const clock = value => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(value)) : "";
  function measures(metrics) {
    const result = [];
    for (const [line,label] of Object.entries(lineNames)) {
      const row = metrics?.by_line?.[line];
      if (!row || !Number.isInteger(row.expected) || row.expected < 1) continue;
      const ratio = (n,d) => Number.isInteger(n) && Number.isInteger(d) && n >= 0 && n <= d ? `${n}/${d}` : "待核";
      const delay = Number.isInteger(row.delay_samples) && row.delay_samples > 0 && Number.isFinite(row.mean_detection_seconds) && row.mean_detection_seconds >= 0
        ? `${Math.round(row.mean_detection_seconds)} 秒（${row.delay_samples} 次）` : "待评价";
      result.push(`${label} · 竞价可评 ${ratio(row.evaluable,row.expected)} · 复核漏判 ${ratio(row.missed,row.adjudicated)} · 发现延迟 ${delay}`);
    }
    return result;
  }
  function observationText(stock) {
    const check = stock.auction_checkpoint?.schema === "auction-checkpoint/v1" ? stock.auction_checkpoint : {};
    const strength = stock.intraday_strength || {};
    const ruling = stock.auction_ruling;
    const original = textValue(ruling?.text);
    const gaps = Array.isArray(strength.gaps) ? [...new Set(strength.gaps.filter(textValue).map(gapLabel))] : [];
    const sources = (Array.isArray(strength.evidence_refs) ? strength.evidence_refs : []).map(ref =>
      [known(sourceNames,ref?.source_id,textValue(ref?.source_id)),clock(ref?.source_data_at),hashTag(ref?.sha256)].filter(Boolean).join(" · ")).filter(Boolean);
    const excess = Number.isFinite(strength.excess_pct_points) && Number.isFinite(strength.previous_excess_pct_points)
      ? `（前窗 ${strength.previous_excess_pct_points} → 本窗 ${strength.excess_pct_points} 个百分点）` : "";
    const windows = (Array.isArray(strength.flow_windows) ? strength.flow_windows : []).filter(point =>
      clock(point?.start_at) && Number.isFinite(point.net_shares)).map(point => `${clock(point.start_at)} 起 净 ${point.net_shares} 股`);
    const stages = [];
    for (const row of Array.isArray(check.phases) ? check.phases : []) {
      const name = {cancelable:"09:15–09:20 可撤",locked:"09:20–09:25 锁定"}[row?.phase];
      if (name && Number.isInteger(row.samples) && row.samples >= 0) stages.push(`${name} ${row.samples} 个采样点`);
    }
    const rows = [];
    if (Array.isArray(check.rows)) {
      for (const row of check.rows) {
        if (!row) continue;
        const label = textValue(row.rule_text) || textValue(row.metric) || "竞价项目";
        const reason = textValue(row.reason_label) || known({pass:"达标",fail:"未达标",missing:"证据缺口",pending:"待观察"},row.status,"待核");
        const value = Number.isFinite(row.actual_value) ? `${row.actual_value} ${textValue(row.unit)}` : "";
        const source = textValue(row.source_id);
        rows.push([label, reason, value, source, clock(row.source_data_at)].filter(Boolean).join(" · "));
      }
    }
    return {title:known(checkpointTitles,check.state,"竞价待核验"), details:[
      ["原裁决", original ? [original,textValue(ruling.rule_version),clock(ruling.available_at),hashTag(ruling.evidence_ref?.sha256)].filter(Boolean).join(" · ") : "待核原件"],
      ...(stages.length ? [["分段采样",stages.join(" · ")]] : []),
      ...(check.coverage && Number.isInteger(check.coverage.verified) && Number.isInteger(check.coverage.total)
        ? [["竞价可核项目",`${check.coverage.verified}/${check.coverage.total}`]] : []),
      ...(Array.isArray(check.late_facts) && check.late_facts.length ? [["截止后补证",`${check.late_facts.length} 项，另记于截止后`]] : []),
      ["逐项核验", rows.length ? rows : ["尚无逐项结果"]],
      ["下一项", textValue(check.next_observation) || "等待可核验的观测条件"],
      ["盘中", known(strengthTitles,strength.state,"盘中待观测")],
      ["价格", known(prices,strength.price_state,"待核")],["相对原主线",known(relative,strength.relative_state,"待核") + excess],
      ["主动成交", [known(flows,strength.flow_state,"方向待核"),...windows].join(" · ")],
      ...(gaps.length ? [["盘中缺口",gaps.join(" · ")]] : []),
      ...(sources.length ? [["盘中证据",sources]] : []),
      ...(strength.relation_to_original === "new_observation_after_invalidation" ? [["与原判断关系","原条件失效后另起观察"]] : []),
      ["证据首次可得", clock(strength.first_evidence_available_at) || "待核"],
      ["首次观察", clock(strength.first_observed_at) || "待核"],
      ["实际提醒", clock(strength.delivered_at) || "无送达回执"]
    ]};
  }


  const stopped = new Set(["stopped","withdrawn","expired","expired_unverified","closed","withdrawn_due_to_data_or_method_error"]);
  const stopText = {stopped:"监控已停止", withdrawn:"监控已撤回", expired:"监控已到期",
    expired_unverified:"到期未核验", closed:"当日已收盘", withdrawn_due_to_data_or_method_error:"原判断已撤回"};
  function dailyView(feed, today) {
    if (feed?.schema !== "live-sniper-web/v1" || feed.signal_boundary !== "not_a_trading_signal" ||
        feed.mode !== "live" || feed.monitoring_profile?.version !== "auction-live/v1" ||
        feed.monitoring_profile.sha256 !== profileHash ||
        !Array.isArray(feed.stocks) || !feed.handoff) return null;
    const lanes = Array.isArray(feed.handoff.lines) ? feed.handoff.lines : [feed.handoff];
    const current = lanes.filter(lane => lane && Object.hasOwn(lineNames,lane.research_line) && lane.target_trade_date === today);
    if (!current.length) return null;
    if ([feed.handoff.status,feed.handoff.monitor_status].some(status => ["error","rejected"].includes(status))
        && !stopped.has(feed.handoff.monitor_status)) return {day:today,generatedAt:feed.generated_at,cards:[],measures:[]};
    const reviewed = current.filter(lane => lane.research_status === "reviewed" && lane.independent_qa_status === "passed"
      && (lane.monitor_status === "ready" || stopped.has(lane.monitor_status)));
    const grouped = new Map();
    for (const stock of feed.stocks) {
      if (!stock || !textValue(stock.code) || !textValue(stock.run_id)) continue;
      const matches = reviewed.filter(lane => lane.research_line === stock.research_line && lane.run_id === stock.run_id &&
        lane.target_trade_date === stock.target_trade_date &&
        (!lane.research_result_sha256 || lane.research_result_sha256 === stock.research_result_sha256));
      if (matches.length !== 1 || stock.manual_label === "sold") continue;
      const key = JSON.stringify([stock.run_id,stock.research_line,stock.target_trade_date,stock.code,
        stock.research_result_sha256, stock.hypothesis_id, stock.judgment_version]);
      const terminal = [feed.handoff.status,feed.handoff.monitor_status,matches[0].monitor_status,stock.observation_status,stock.monitoring_status]
        .find(item => stopped.has(item));
      grouped.set(key, grouped.has(key) ? null : {key,stock,terminal});
    }
    const cards = [...grouped.values()].filter(Boolean);
    const byLine = {};
    for (const lane of reviewed) byLine[lane.research_line] = feed.auction_review_metrics?.by_line?.[lane.research_line];
    return {day:today, generatedAt:feed.generated_at, cards, measures:measures({by_line:byLine})};
  }

  function node(doc,tag,cls,content) {
    const result = doc.createElement(tag);
    if (cls) result.className = cls;
    if (content !== undefined) result.textContent = content;
    return result;
  }
  function card(doc,{stock,terminal}) {
    const view = observationText(stock);
    const article = node(doc,"article","stock-card");
    const title = node(doc,"h3","",`${stock.name || stock.code} · ${lineNames[stock.research_line]}`);
    const subtitle = [stock.code, `目标日 ${stock.target_trade_date}`, Number.isFinite(stock.price) ? `现价 ${stock.price.toFixed(2)} 元` : "",
      clock(stock.source_data_at) ? `行情 ${clock(stock.source_data_at)}` : ""].filter(Boolean);
    article.append(title,node(doc,"p","auction-evidence-meta",subtitle.join(" · ")));
    const identity = [typeof stock.hypothesis_id === "string" && stock.hypothesis_id ? `原假设 ${stock.hypothesis_id}` : "",
      stock.judgment_version ? `判断版本 ${hashTag(stock.judgment_version) || stock.judgment_version}` : ""].filter(Boolean);
    if (identity.length) article.append(node(doc,"p","auction-evidence-meta",identity.join(" · ")));
    const label = terminal ? `${stopText[terminal]} · 已记录的 09:25 结果` : "09:25";
    article.append(node(doc,"strong","",`${label} · ${view.title}`));
    for (const [key,value] of view.details) {
      if (Array.isArray(value)) {
        const details = node(doc,"details","card-details");
        details.append(node(doc,"summary","",key));
        for (const line of value) details.append(node(doc,"p","",line));
        article.append(details);
      } else {
        article.append(node(doc,"p","auction-evidence-meta",`${key} · ${value}`));
      }
    }
    return article;
  }

  function mount(doc) {
    const grid = doc.getElementById("stock-grid");
    const panel = node(doc,"section","auction-live-observations");
    panel.setAttribute("aria-label","竞价与盘中观察");
    panel.hidden = true;
    grid.before(panel);
    const style = node(doc,"style","");
    // Keep legacy price/manual controls accessible by explicit expansion of the original area.
    style.textContent = [
      "body[data-auction-observation]:not([data-legacy-market]) .overview .session-strip,body[data-auction-observation] .overview .phase-track,",
      "body[data-auction-observation] #session-description,body[data-auction-observation] #list-caption,",
      "body[data-auction-observation] #feed-notice,body[data-auction-observation] #empty-state,",
      "body[data-auction-observation]:not([data-legacy-market]) #stock-grid{display:none}",
      ".auction-live-observations .stock-card{padding:1rem}.auction-live-observations .stock-card h3{margin:0}",
      ".auction-live-observations .auction-evidence-meta{margin:.35rem 0}.auction-live-observations[hidden]{display:none}"
    ].join("");
    doc.head.append(style);
    let signature = "", displayed = false, snapshot;
    function clear() {
      delete doc.body.dataset.auctionObservation;
      delete doc.body.dataset.legacyMarket;
      panel.hidden = true;
      panel.replaceChildren();
      signature = "";
      displayed = false;
      snapshot = null;
    }
    function render(view,error) {
      if (!view && !error) {clear();return;}
      if (!view && !displayed) return;
      const data = view?.cards.map(item => [item.key,item.terminal,item.stock.name,item.stock.price,item.stock.source_data_at,observationText(item.stock)]);
      const nextSignature = JSON.stringify([view?.day,data,view?.measures,error]);
      const stamp = view ? `竞价与盘中观察 · ${view.day} · 快照 ${clock(view.generatedAt) || "时点待核"}` : "";
      if (signature === nextSignature) {
        if (snapshot) snapshot.textContent = stamp;
        return;
      }
      signature = nextSignature;
      snapshot = null;
      displayed = true;
      panel.hidden = false;
      doc.body.dataset.auctionObservation = "";
      const children = [];
      if (error || !view.cards.length) {
        children.push(node(doc,"p","feed-notice",error || "当前没有可展示的已审观察对象。"));
      } else {
        snapshot = node(doc,"p","session-description",stamp);
        children.push(snapshot);
        for (const text of view.measures) children.push(node(doc,"p","session-description",text));
        const cards = node(doc,"div","stock-grid");
        for (const item of view.cards) cards.append(card(doc,item));
        children.push(cards);
      }
      const legacy = node(doc,"button","mode-button","原行情与本地标记");
      legacy.type = "button";
      legacy.setAttribute("aria-controls","stock-grid");
      legacy.setAttribute("aria-expanded",String(doc.body.dataset.legacyMarket !== undefined));
      legacy.addEventListener("click",() => {
        if (doc.body.dataset.legacyMarket === undefined) doc.body.dataset.legacyMarket = "";
        else delete doc.body.dataset.legacyMarket;
        legacy.setAttribute("aria-expanded",String(doc.body.dataset.legacyMarket !== undefined));
      });
      children.push(legacy);
      panel.replaceChildren(...children);
    }
    return {render,clear};
  }
  function start(win) {
    const doc = win.document;
    const output = mount(doc);
    let timer, request, generation = 0, demo = false, paused = false, lastAt = null;
    function stop() {
      generation += 1;
      win.clearTimeout(timer);
      request?.abort();
      request = null;
    }
    async function refresh() {
      if (request || demo || paused || doc.hidden) return;
      const token = generation;
      const controller = new AbortController();
      request = controller;
      const timeout = win.setTimeout(() => controller.abort(),8000);
      try {
        const response = await win.fetch("./sniper-feed.json",{cache:"no-store",signal:controller.signal});
        if (!response.ok) throw Error("unavailable");
        const feed = await response.json();
        if (token !== generation) return;
        const view = dailyView(feed,win.LifecycleModel.today());
        const stamp = view && clock(feed.generated_at) ? Date.parse(feed.generated_at) : null;
        if (view && (stamp == null || shanghaiDay.format(stamp) !== view.day ||
            (lastAt !== null && stamp < lastAt))) throw Error("stale");
        lastAt = stamp;
        output.render(view);
      } catch {
        if (token === generation) output.render(null,"当前观察快照读取异常，等待下一次刷新。");
      } finally {
        win.clearTimeout(timeout);
        if (token === generation) {
          request = null;
          win.clearTimeout(timer);
          timer = win.setTimeout(refresh,15000);
        }
      }
    }
    function restart() { stop(); refresh(); }
    doc.getElementById("refresh-button")?.addEventListener("click",restart);
    doc.getElementById("demo-mode")?.addEventListener("click",() => {demo=true;stop();output.clear();});
    doc.getElementById("live-mode")?.addEventListener("click",() => {demo=false;restart();});
    doc.addEventListener("visibilitychange",() => {if (doc.hidden) stop(); else restart();});
    win.addEventListener("pagehide",() => {paused=true;stop();output.clear();});
    win.addEventListener("pageshow",event => {if (event.persisted) {paused=false;restart();}});
    refresh();
  }
  if (typeof module !== "undefined" && module.exports) module.exports = {dailyView,observationText,mount,start};
  if (root.document?.getElementById("stock-grid") && root.LifecycleModel) start(root);
})(typeof window === "undefined" ? globalThis : window);
