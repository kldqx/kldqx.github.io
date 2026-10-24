"use strict";
// Display only. signal_boundary=not_a_trading_signal.
(() => {
  const BOUNDARY = "not_a_trading_signal";
  const EVENT_LABELS = {
    AUCTION_ENTRY_CONFIRMED: "竞价条件满足", WASH_STANDBY: "等待开盘观察",
    AUCTION_VETOED: "竞价条件未满足", BOOK_BID1_VOLUME_DROP: "买一量回落",
    REVERSAL_TRIGGERED: "VWAP 上穿", VWAP_DEFENSE_TRIGGERED: "触及 VWAP 防守线"
  };
  const PHASE_LABELS = {
    WAITING: "等待 09:15 竞价观察窗口", PHASE_1_VIRTUAL: "竞价申报观察中",
    PHASE_1_DROP_CHECK: "观察盘口买一量变化", PHASE_2_REAL_AUCTION: "竞价锁定期",
    PHASE_3_FINAL_VERDICT: "观察集合竞价结果", PHASE_4_OPENING_REVERSAL: "开盘 VWAP 观察中",
    INTRADAY: "本次开盘观察已结束", FINISHED: "本次开盘观察已结束"
  };
  const numeric = value => typeof value === "number" && Number.isFinite(value);
  const numberText = (value, digits = 2) => numeric(value) ? value.toFixed(digits) : "—";
  const percent = value => numeric(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
  const tone = value => numeric(value) ? value > 0 ? "positive" : value < 0 ? "negative" : "" : "";
  const timeValue = value => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const clock = value => timeValue(value) === null ? "—" : new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(value));
  const eventLabel = event => EVENT_LABELS[event?.type] || (typeof event?.label === "string" ? event.label : "观察记录");

  function validFeed(feed, mode) {
    return feed && feed.schema === "live-sniper-web/v1" && feed.signal_boundary === BOUNDARY
      && feed.mode === mode && Array.isArray(feed.stocks)
      && feed.stocks.every(row => row && typeof row.code === "string")
      && new Set(feed.stocks.map(row => row.code)).size === feed.stocks.length;
  }

  function chartModel(points) {
    const original = Array.isArray(points) ? points : [];
    const accepted = original.filter(point => point && timeValue(point.at) !== null);
    const values = accepted.flatMap(point => [point.price, point.vwap].filter(value => numeric(value) && value > 0));
    if (!values.length) return null;
    const times = accepted.map(point => timeValue(point.at));
    const start = Math.min(...times), end = Math.max(...times);
    let low = Math.min(...values), high = Math.max(...values);
    const pad = Math.max((high - low) * .2, high * .0005, .001);
    low -= pad; high += pad;
    const x = at => end === start ? 240 : 8 + (timeValue(at) - start) / (end - start) * 464;
    const y = value => 8 + (high - value) / (high - low) * 94;
    const segments = key => {
      const result = []; let current = [], previous = null;
      for (const point of original) {
        if (!point || timeValue(point.at) === null) {
          if (current.length) result.push(current);
          current = []; previous = null; continue;
        }
        const at = timeValue(point.at);
        if (!numeric(point[key]) || point[key] <= 0 || (previous !== null && at < previous)) {
          if (current.length) result.push(current);
          current = []; previous = at;
          if (!numeric(point[key]) || point[key] <= 0) continue;
        }
        current.push([x(point.at), y(point[key])]); previous = at;
      }
      if (current.length) result.push(current);
      return result;
    };
    return {price:segments("price"), vwap:segments("vwap"), start:accepted[0].at,
      end:accepted[accepted.length - 1].at, count:accepted.filter(point => numeric(point.price)).length};
  }

  function createController({fetcher, draw, connection, schedule = setTimeout, cancel = clearTimeout}) {
    let mode = "live", generation = 0, timer = null, controller = null, demo = null, lastFeed = null;
    function stop() {
      generation += 1;
      if (timer !== null) cancel(timer);
      timer = null;
      if (controller) controller.abort();
      controller = null;
    }
    async function request(path, expectedGeneration) {
      const requestController = new AbortController();
      controller = requestController;
      const timeout = schedule(() => requestController.abort(), 8000);
      try {
        const response = await fetcher(path, {cache:"no-store", signal:requestController.signal});
        if (!response.ok) throw Error("feed_unavailable");
        const data = await response.json();
        return expectedGeneration === generation ? data : null;
      } finally { cancel(timeout); }
    }
    async function live(expectedGeneration) {
      try {
        const feed = await request("./sniper-feed.json", expectedGeneration);
        if (expectedGeneration !== generation) return;
        if (!validFeed(feed, "live")) throw Error("feed_invalid");
        if (lastFeed?.mode === "live" && lastFeed.run_id === feed.run_id
          && timeValue(feed.generated_at) !== null && timeValue(lastFeed.generated_at) !== null
          && timeValue(feed.generated_at) < timeValue(lastFeed.generated_at)) throw Error("feed_older");
        lastFeed = feed; draw(feed); connection("connected", "每 2 秒自动更新");
      } catch (error) {
        if (expectedGeneration !== generation) return;
        connection("error", lastFeed ? "连接中断 · 保留上次画面" : "暂时无法连接 · 正在重试");
      }
      if (expectedGeneration === generation) timer = schedule(() => live(expectedGeneration), 2000);
    }
    function play(frames, index, expectedGeneration) {
      if (expectedGeneration !== generation) return;
      lastFeed = frames[index]; draw(lastFeed);
      connection("demo", index === frames.length - 1 ? "演练完成 · 可重新播放" : `演练预览 · ${index + 1} / ${frames.length}`);
      if (index + 1 < frames.length) timer = schedule(() => play(frames, index + 1, expectedGeneration), 1000);
    }
    async function select(nextMode) {
      stop(); mode = nextMode; lastFeed = null;
      const expectedGeneration = generation;
      connection(mode === "demo" ? "demo" : "loading", mode === "demo" ? "正在准备演练" : "正在连接");
      draw(null, mode);
      if (mode === "live") return live(expectedGeneration);
      try {
        if (!demo) {
          const data = await request("./sniper-demo.json", expectedGeneration);
          if (expectedGeneration !== generation) return;
          if (!data || data.schema !== "live-sniper-demo/v1" || data.signal_boundary !== BOUNDARY
            || !Array.isArray(data.frames) || !data.frames.length || !data.frames.every(frame => validFeed(frame, "demo"))) throw Error("demo_invalid");
          demo = data.frames;
        }
        play(demo, 0, expectedGeneration);
      } catch (error) {
        if (expectedGeneration === generation) connection("error", "演练暂时不可用 · 点击刷新重试");
      }
    }
    function refresh() {
      if (mode === "demo") return select(mode);
      stop(); connection("loading", "正在刷新"); return live(generation);
    }
    return {select, refresh, stop, getMode:() => mode};
  }

  const api = {validFeed, chartModel, createController, numberText, percent, clock};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;
  window.sniperFrontend = api;
  const byId = id => document.getElementById(id);
  const el = (tag, className, text) => {const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;};
  const svgEl = (tag, attributes) => {const node = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [key,value] of Object.entries(attributes || {})) node.setAttribute(key,String(value)); return node;};
  const cards = new Map();
  let displayedMode = "live", lastRun = null;

  function setConnection(kind, message) {
    byId("connection-dot").className = `connection-dot ${kind}`;
    byId("connection-text").textContent = message;
    byId("footer-status").textContent = message;
  }

  function drawChart(container, points) {
    const model = chartModel(points);
    if (!model) {
      const placeholder = el("div", "chart-placeholder");
      const icon = svgEl("svg", {viewBox:"0 0 56 25", "aria-hidden":"true"});
      icon.append(svgEl("path", {d:"M1 20h54M6 15l10-7 10 6 12-10 12 5"}));
      placeholder.append(icon, el("span", "", "等待首个行情采样")); container.replaceChildren(placeholder); return;
    }
    const svg = svgEl("svg", {viewBox:"0 0 480 130", class:"stock-chart", role:"img", "aria-label":`${model.count} 个行情采样点，实线为价格，虚线为 VWAP`});
    for (const y of [18,60,102]) svg.append(svgEl("line", {x1:8,x2:472,y1:y,y2:y,class:"chart-grid"}));
    for (const [key,cls] of [["vwap","vwap-path"],["price","price-path"]]) {
      for (const segment of model[key]) {
        if (segment.length === 1) svg.append(svgEl("circle", {cx:segment[0][0],cy:segment[0][1],r:key === "price" ? 3.2 : 2, class:key === "price" ? "chart-point" : "vwap-path"}));
        else svg.append(svgEl("path", {d:segment.map((point,index) => `${index ? "L" : "M"}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" "),class:cls}));
      }
    }
    const start = svgEl("text", {x:8,y:124,class:"chart-label"}); start.textContent = clock(model.start);
    const end = svgEl("text", {x:472,y:124,class:"chart-label","text-anchor":"end"}); end.textContent = clock(model.end);
    svg.append(start,end); container.replaceChildren(svg);
  }

  function createCard() {
    const card = el("article", "stock-card");
    const heading = el("div", "card-heading"), identity = el("div", "stock-identity");
    const name = el("h3", "stock-name"), code = el("div", "stock-code"), status = el("span", "stock-status");
    identity.append(name,code); heading.append(identity,status);
    const priceRow = el("div", "price-row"), price = el("strong", "stock-price"), change = el("span", "stock-change");
    priceRow.append(price,change,el("span", "price-label", "最新价 / 元"));
    const metrics = el("div", "metric-grid");
    const metricRefs = ["累计成交", "分时 VWAP", "偏离 VWAP"].map(label => {
      const box = el("div", "metric"), value = el("strong"); box.append(el("span","",label),value); metrics.append(box); return value;
    });
    const chart = el("div", "chart-area"), legend = el("div", "chart-legend"), keys = el("div", "chart-legend-items");
    for (const [label,cls] of [["价格",""],["VWAP","vwap-key"]]) {const key = el("span");key.append(el("i",cls),document.createTextNode(label));keys.append(key);}
    const quoteAt = el("span"); legend.append(keys,quoteAt);
    const conditions = el("section", "conditions"), chips = el("div", "condition-list");conditions.append(el("h3","","观察条件"),chips);
    const latest = el("div", "latest-event");
    const details = el("details", "card-details"), summary = el("summary", "", "观察要点与记录"), content = el("div", "detail-content");
    const description = el("p"), eventList = el("ol", "event-list"); content.append(description,eventList);details.append(summary,content);
    card.append(heading,priceRow,metrics,chart,legend,conditions,latest,details);
    return {card,name,code,status,price,change,metricRefs,chart,quoteAt,chips,latest,details,description,eventList,chartSignature:null,eventSignature:null};
  }

  function updateCard(ref, stock, feed) {
    const events = Array.isArray(stock.events) ? stock.events.filter(event => event && typeof event.type === "string") : [];
    const latest = events[events.length - 1];
    const gaps = Array.isArray(stock.gaps) ? stock.gaps.filter(gap => typeof gap === "string") : [];
    const benchmark = stock.benchmark && typeof stock.benchmark === "object" ? stock.benchmark : {};
    const statusText = latest ? eventLabel(latest) : gaps.length ? "数据待补" : !numeric(stock.price) ? "等待行情" : feed.status === "finished" ? "观察结束" : "动态观察";
    const statusTone = latest?.type === "REVERSAL_TRIGGERED" ? "purple" : latest?.type === "AUCTION_ENTRY_CONFIRMED" ? "positive" : latest?.type === "VWAP_DEFENSE_TRIGGERED" ? "negative" : gaps.length || latest?.type === "BOOK_BID1_VOLUME_DROP" ? "warning" : "";
    ref.card.className = `stock-card ${tone(stock.change_pct)}`;
    ref.name.textContent = stock.name || stock.code; ref.code.textContent = stock.code;
    ref.status.textContent = statusText;ref.status.className = `stock-status ${statusTone}`;
    ref.price.textContent = numberText(stock.price);ref.price.className = `stock-price ${numeric(stock.price) ? tone(stock.change_pct) : "missing"}`;
    ref.change.textContent = percent(stock.change_pct);ref.change.className = `stock-change ${tone(stock.change_pct)}`;
    ref.metricRefs[0].replaceChildren(document.createTextNode(numberText(stock.turnover_yi)),el("small","","亿"));
    ref.metricRefs[1].textContent = numberText(stock.vwap);ref.metricRefs[2].textContent = percent(stock.vwap_deviation_pct);
    ref.quoteAt.textContent = timeValue(stock.source_data_at) === null ? "行情时点 —" : `行情 ${clock(stock.source_data_at)}`;
    const signature = JSON.stringify(stock.points || []);
    if (signature !== ref.chartSignature) {drawChart(ref.chart,stock.points);ref.chartSignature = signature;}
    const target = Array.isArray(benchmark.target_open_pct) && benchmark.target_open_pct.length === 2 && benchmark.target_open_pct.every(numeric)
      ? `${benchmark.target_open_pct[0] > 0 ? "+" : ""}${benchmark.target_open_pct[0]}% ~ ${benchmark.target_open_pct[1] > 0 ? "+" : ""}${benchmark.target_open_pct[1]}%` : "—";
    const chipData = [["高开",target],["成交",numeric(benchmark.min_turnover_yi) ? `≥ ${numberText(benchmark.min_turnover_yi)} 亿` : "—"],["防守",numeric(benchmark.max_vwap_pullback_pct) ? `${benchmark.max_vwap_pullback_pct}%` : "未配置"]];
    ref.chips.replaceChildren(...chipData.map(([label,value]) => {const chip=el("div","condition-chip");chip.append(el("span","",label),el("strong","",value));return chip;}));
    ref.latest.className = `latest-event ${gaps.length ? "warning" : ""}`;
    ref.latest.textContent = gaps.length ? "部分数据待补，查看观察记录了解详情。" : latest ? `${clock(latest.at)}  ${eventLabel(latest)}` : !numeric(stock.price) ? "观察条件已就位，等待竞价行情。" : "持续观察价格、成交额与 VWAP 变化。";
    ref.description.textContent = typeof benchmark.desc === "string" && benchmark.desc.trim() ? benchmark.desc : "按卡片中的竞价与 VWAP 条件跟踪。";
    const eventSignature = JSON.stringify([events,gaps]);
    if (eventSignature !== ref.eventSignature) {
      const items = [...events].reverse().map(event => {const item=el("li");const time=el("time","",clock(event.at));if(timeValue(event.at)!==null)time.dateTime=event.at;item.append(time,el("span","",eventLabel(event)));return item;});
      for (const gap of gaps) {const item=el("li");item.append(el("span","",gap));items.push(item);}
      if (!items.length) items.push(el("li","event-empty","暂无条件触发记录"));
      ref.eventList.replaceChildren(...items);ref.eventSignature=eventSignature;
    }
  }

  function draw(feed, requestedMode) {
    const mode = feed?.mode || requestedMode || displayedMode;
    displayedMode = mode;
    byId("live-mode").className = `mode-button ${mode === "live" ? "selected" : ""}`;
    byId("demo-mode").className = `mode-button ${mode === "demo" ? "selected demo-selected" : ""}`;
    byId("live-mode").setAttribute("aria-pressed",String(mode === "live"));byId("demo-mode").setAttribute("aria-pressed",String(mode === "demo"));
    byId("mode-label").textContent = mode === "demo" ? "离线演练" : "当前监控";byId("mode-label").className = `mode-label ${mode === "demo" ? "demo" : ""}`;
    byId("refresh-button").title = mode === "demo" ? "重新播放演练" : "刷新当前监控";byId("refresh-button").setAttribute("aria-label",byId("refresh-button").title);
    if (!feed) {
      cards.clear();byId("stock-grid").replaceChildren();lastRun=null;
      byId("empty-state").hidden=false;byId("empty-state").querySelector("h3").textContent=mode === "demo" ? "正在准备演练卡片" : "正在载入观察名单";
      byId("stock-count").textContent="—";byId("event-count").textContent="—";byId("quote-time").textContent="—";
      byId("session-description").textContent=mode === "demo" ? "使用生成行情，依次预览竞价与开盘的变化。" : "正在读取观察名单与最新行情。";
      byId("source-label").textContent=mode === "demo" ? "生成的演练行情" : "行情来源待确认";
      byId("seed-date").textContent="";byId("feed-notice").hidden=true;
      for (const step of document.querySelectorAll(".phase-track li")) step.className="";
      return;
    }
    if (lastRun !== feed.run_id) {cards.clear();byId("stock-grid").replaceChildren();lastRun=feed.run_id;}
    const stocks = feed.stocks;
    byId("stock-count").textContent=String(stocks.length);
    byId("event-count").textContent=String(stocks.reduce((count,stock)=>count+(Array.isArray(stock.events)?stock.events.length:0),0));
    const latest = stocks.map(stock=>stock.source_data_at).filter(value=>timeValue(value)!==null).sort((a,b)=>timeValue(a)-timeValue(b)).pop();
    byId("quote-time").textContent=clock(latest);
    byId("source-label").textContent=feed.source_label || (mode === "demo" ? "生成的演练行情" : "腾讯一级行情");
    byId("seed-date").textContent=feed.seed_date ? `观察名单 · ${feed.seed_date}` : "";
    byId("session-description").textContent=mode === "demo" ? `演练预览 · ${PHASE_LABELS[feed.phase] || "按顺序回放观察时点"}`
      : feed.status === "waiting" ? "观察条件已就位，等待下个竞价与开盘窗口。" : PHASE_LABELS[feed.phase] || "跟踪价格、成交额与 VWAP 的变化。";
    byId("list-caption").textContent=mode === "demo" ? "生成行情 · 有限时点演练" : "一股一卡 · 独立跟踪";
    const phaseIndex = feed.phase === "PHASE_4_OPENING_REVERSAL" || feed.phase === "FINISHED" ? 3 : feed.phase === "PHASE_3_FINAL_VERDICT" ? 2 : feed.phase === "PHASE_2_REAL_AUCTION" ? 1 : String(feed.phase).startsWith("PHASE_1") ? 0 : -1;
    for (const step of document.querySelectorAll(".phase-track li")) {const index=Number(step.dataset.step);step.className=index === phaseIndex ? "active" : index < phaseIndex ? "complete" : "";}
    byId("feed-notice").hidden=!feed.error;byId("feed-notice").textContent=feed.error ? "当前数据暂时不可用，页面会自动重试。" : "";
    byId("empty-state").hidden=stocks.length>0;
    if (!stocks.length) byId("empty-state").querySelector("h3").textContent="暂无观察标的";
    byId("stock-grid").className=`stock-grid ${stocks.length === 2 ? "two-cards" : ""}`;
    const currentCodes=new Set(stocks.map(stock=>stock.code));
    for (const [code,ref] of cards) if(!currentCodes.has(code)){ref.card.remove();cards.delete(code);}
    for (const stock of stocks) {
      let ref=cards.get(stock.code);
      if(!ref){ref=createCard();cards.set(stock.code,ref);byId("stock-grid").append(ref.card);}
      updateCard(ref,stock,feed);
    }
  }

  const controller=createController({fetcher:(...args)=>fetch(...args),draw,connection:setConnection});
  byId("live-mode").addEventListener("click",()=>controller.select("live"));
  byId("demo-mode").addEventListener("click",()=>controller.select("demo"));
  byId("refresh-button").addEventListener("click",()=>controller.refresh());
  window.addEventListener("pagehide",()=>controller.stop());
  controller.select("live");
})();
