"use strict";
// Display only. signal_boundary=not_a_trading_signal.
(() => {
  const BOUNDARY = "not_a_trading_signal";
  // L2 监控状态
  let l2Monitor = null;
  let l2AlertsPanel = null;
  let l2OverviewPanel = null;
  let lastStocksData = []; // L4: latest stocks for export
  const l2Containers = new Map(); // code -> container element for L2 orderbook
  const EVENT_LABELS = {
    AUCTION_ENTRY_CONFIRMED: "竞价条件满足", WASH_STANDBY: "等待开盘观察",
    AUCTION_VETOED: "竞价条件未满足", BOOK_BID1_VOLUME_DROP: "买一量回落",
    REVERSAL_TRIGGERED: "VWAP 上穿", VWAP_DEFENSE_TRIGGERED: "触及 VWAP 防守线",
    L2_BEARISH_VETO: "L2 看空拦截"
  };
  const PHASE_LABELS = {
    WAITING: "盘前等待 · 09:15 开始观察", PHASE_1_VIRTUAL: "竞价申报观察中",
    PHASE_1_DROP_CHECK: "观察盘口买一量变化", PHASE_2_REAL_AUCTION: "竞价锁定期",
    PHASE_3_FINAL_VERDICT: "观察集合竞价结果", PHASE_4_OPENING_REVERSAL: "开盘 VWAP 观察中",
    INTRADAY: "盘中观察", INTRADAY_AM: "上午盘中观察", LUNCH_BREAK: "午休 · 暂停行情采样",
    INTRADAY_PM: "下午盘中观察", CLOSING_AUCTION: "收盘竞价观察", POSTMARKET_REVIEW: "已收盘 · 盘后复核",
    CLOSED: "本次观察已结束 · 保留当日记录", FINISHED: "本次监控任务已结束"
  };
  const PHASE_STEPS = {
    PHASE_1_VIRTUAL:0, PHASE_1_DROP_CHECK:0, PHASE_2_REAL_AUCTION:1,
    PHASE_3_FINAL_VERDICT:2, PHASE_4_OPENING_REVERSAL:3, INTRADAY_AM:4,
    LUNCH_BREAK:5, INTRADAY_PM:6, CLOSING_AUCTION:7, POSTMARKET_REVIEW:8, CLOSED:9
  };
  const numeric = value => typeof value === "number" && Number.isFinite(value);
  const numberText = (value, digits = 2) => numeric(value) ? value.toFixed(digits) : "—";
  const percent = value => numeric(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
  const tone = value => numeric(value) ? value > 0 ? "positive" : value < 0 ? "negative" : "" : "";
  const timeValue = value => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const clock = value => timeValue(value) === null ? "—" : new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(value));
  const eventLabel = event => EVENT_LABELS[event?.type] || (typeof event?.label === "string" ? event.label : "观察记录");
  const deadlineText = value => timeValue(value) === null ? "见原条件" : new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
  const HANDOFF_LABELS = {
    pending: ["等待 QA 交接", "QA 完成后，观察名单会自动显示在这里。"],
    rejected: ["本批次 QA 未放行", "本批次审核结果暂未进入监控，等待后续研究更新。"],
    error: ["QA 交接读取异常", "正在重试读取本批次交接，研究结果未按零只处理。"],
    stopped: ["本批次监控已停止", "已有研究条件继续保留供查看。"]
  };
  const REVIEW_LABELS = {
    pending:"等待盘中复核", running:"盘中 AI 复核中", qa_pending:"等待独立 QA",
    accepted:"盘中复核已审", rejected:"盘中复核未放行", error:"盘中复核异常", uncertain:"盘中复核结果未确认",
    budget_exhausted:"盘中复核额度已用尽", waiting:"等待盘中复核", paused:"盘中复核暂停",
    stopped:"盘中复核已停止", withdrawn:"该股已撤回监控", closed:"本次复核已结束", unsupported:"盘中复核暂不可用"
  };
  const CONDITION_LABELS = {
    support_conditions:"支持条件", invalidation_conditions:"失效条件", deadline_at:"复核截止",
    trade_date:"计划观察日", status:"原计划状态", phase_semantics:"各时段含义",
    stage_observations:"分阶段观察", reference_prices:"原价格参照", decision_at_deadline:"截止时处理",
    on_support_absent:"支持未出现时", on_reliable_invalidation:"可靠反证出现时",
    on_unobserved_by_deadline:"截止仍未观测时", observable:"可观察条件", comparison_basis:"比较依据",
    condition_id:"条件编号", Friday_close_CNY:"周五收盘价 / 元", previous_session_close_CNY:"前次收盘价 / 元",
    summary:"盘中复核结论", reviewed_at:"盘中复核时点", qa_completed_at:"独立 QA 完成",
    original_outcome:"原竞价判断结果", hypothesis_id:"盘中判断编号", relation_to_original:"与原判断的关系",
    risks:"盘中风险", gaps:"未核实范围"
  };
  const observationEligible = stock => typeof stock.observation_eligible === "boolean" ? stock.observation_eligible : stock.monitoring_eligible;

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
    let mode = "live", generation = 0, timer = null, reviewTimer = null, demo = null, lastFeed = null;
    let expiryTimer = null;
    let lastQuotes = null, reviewCandidate = null, matchedReview = null, currentScope = null, manualState = null;
    let quoteError = false, reviewError = null;
    const requests = new Set();
    function stop() {
      generation += 1;
      if (timer !== null) cancel(timer);
      if (reviewTimer !== null) cancel(reviewTimer);
      if (expiryTimer !== null) cancel(expiryTimer);
      timer = null;
      reviewTimer = null;
      expiryTimer = null;
      for (const requestController of requests) requestController.abort();
    }
    async function request(path, expectedGeneration) {
      const requestController = new AbortController();
      requests.add(requestController);
      const timeout = schedule(() => requestController.abort(), 8000);
      try {
        const sep = path.includes("?") ? "&" : "?";
        const freshPath = path + sep + "_t=" + Date.now();
        const response = await fetcher(freshPath, {cache:"no-store", signal:requestController.signal});
        if (!response.ok) throw Error("feed_unavailable");
        const data = await response.json();
        return expectedGeneration === generation ? data : null;
      } finally { cancel(timeout); requests.delete(requestController); }
    }
    function scope(value, review = false) {
      const batch = review ? value?.batch_id : value?.handoff?.batch_id;
      const date = review ? value?.trade_date : value?.handoff?.target_trade_date;
      return typeof value?.workspace_id === "string" && value.workspace_id && typeof batch === "string" && batch
        && typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? JSON.stringify([value.workspace_id,batch,date]) : null;
    }
    function acceptReview(fresh = false) {
      if (!currentScope || !reviewCandidate) return;
      if (scope(reviewCandidate,true) !== currentScope) {reviewError="identity_mismatch";return;}
      if (matchedReview && timeValue(reviewCandidate.generated_at) < timeValue(matchedReview.generated_at)) {reviewError="older_result";return;}
      matchedReview=reviewCandidate;if(fresh)reviewError=null;
    }
    function publish() {
      if (!lastQuotes) return;
      if(expiryTimer !== null)cancel(expiryTimer);
      expiryTimer=null;
      const now=Date.now();let nextDeadline=null;
      if(manualState && lastQuotes.manual_watch_revision >= manualState.revision)manualState=null;
      const manualRows = new Map((manualState?.stocks || []).map(row=>[row.code,row]));
      const reviews = new Map((matchedReview?.stocks || []).map(row=>[row.code,row]));
      const stocks = lastQuotes.stocks.filter(stock=>(manualRows.get(stock.code)?.manual_label || stock.manual_label) !== "sold").map(stock=>{
        const quote={...stock};delete quote.review_status;delete quote.intraday_review;
        const manual=manualRows.get(stock.code);
        if(manual){quote.manual_label=manual.manual_label;quote.manual_revision=manual.manual_revision;}
        const currentStatus=lastQuotes.handoff?.status === "stopped" ? "stopped"
          : lastQuotes.handoff?.status === "withdrawn" ? "withdrawn"
          : (stock.observation_status ?? stock.monitoring_status);
        if(["stopped","withdrawn","invalidated","withdrawn_due_to_data_or_method_error"].includes(currentStatus))
          return {...quote,review_status:currentStatus === "stopped" ? "stopped" : "withdrawn"};
        const review=reviews.get(stock.code);
        const deadline=timeValue(review?.intraday_review?.deadline_at);
        if(review?.review_status === "accepted" && review.intraday_review?.status === "accepted" && deadline !== null){
          if(now >= deadline)return {...quote,review_status:"expired",intraday_review:{...review.intraday_review,
            status:"expired",qa_status:"accepted",reviewed_alert_direction:review.intraday_review.alert_direction,alert_direction:"none"}};
          nextDeadline=nextDeadline === null ? deadline : Math.min(nextDeadline,deadline);
        }
        return review ? {...quote,review_status:review.review_status,intraday_review:review.intraday_review} : quote;
      });
      lastFeed={...lastQuotes,stocks,manual_watch_revision:manualState?.revision ?? lastQuotes.manual_watch_revision,review_feed_error:currentScope ? reviewError : null};
      draw(lastFeed);
      if(nextDeadline !== null)expiryTimer=schedule(publish,nextDeadline-now);
      if(quoteError)connection("error","行情连接中断 · 保留上次画面");
      else if(currentScope && reviewError)connection("error","行情正常更新 · 盘中复核连接异常（保留上次匹配结果）");
      else connection("connected","每 2 秒自动更新");
    }
    async function live(expectedGeneration) {
      try {
        const feed = await request("./sniper-feed.json", expectedGeneration);
        if (expectedGeneration !== generation) return;
        if (!validFeed(feed, "live")) throw Error("feed_invalid");
        if (lastQuotes?.run_id === feed.run_id
          && timeValue(feed.generated_at) !== null && timeValue(lastQuotes.generated_at) !== null
          && timeValue(feed.generated_at) < timeValue(lastQuotes.generated_at)) return;
        if(Number.isInteger(lastQuotes?.manual_watch_revision) && Number.isInteger(feed.manual_watch_revision)
          && feed.manual_watch_revision < lastQuotes.manual_watch_revision)throw Error("manual_revision_older");
        const nextScope=scope(feed);
        if(nextScope !== currentScope){matchedReview=null;reviewError=null;currentScope=nextScope;}
        lastQuotes=feed;quoteError=false;acceptReview();publish();
      } catch (error) {
        if (expectedGeneration !== generation) return;
        quoteError=true;
        if(lastQuotes)publish();
        else connection("error","暂时无法连接 · 正在重试");
      }
      if (expectedGeneration === generation) timer = schedule(() => live(expectedGeneration), 2000);
    }
    async function reviews(expectedGeneration) {
      try {
        const data=await request("./intraday-review-feed.json",expectedGeneration);
        if(expectedGeneration !== generation)return;
        if(!data || data.schema !== "intraday-review-web/v1" || data.signal_boundary !== BOUNDARY
          || data.mode !== "live" || !scope(data,true) || timeValue(data.generated_at) === null
          || typeof data.status !== "string" || data.status === "error"
          || !Array.isArray(data.stocks) || !data.stocks.every(row=>row && typeof row.code === "string" && typeof row.review_status === "string")
          || new Set(data.stocks.map(row=>row.code)).size !== data.stocks.length)throw Error("review_feed_invalid");
        reviewCandidate=data;acceptReview(true);publish();
      } catch(error) {
        if(expectedGeneration !== generation)return;
        reviewError="unavailable";publish();
      }
      if(expectedGeneration === generation)reviewTimer=schedule(()=>reviews(expectedGeneration),2000);
    }
    function play(frames, index, expectedGeneration) {
      if (expectedGeneration !== generation) return;
      lastFeed = frames[index]; draw(lastFeed);
      connection("demo", index === frames.length - 1 ? "演练完成 · 可重新播放" : `演练预览 · ${index + 1} / ${frames.length}`);
      if (index + 1 < frames.length) timer = schedule(() => play(frames, index + 1, expectedGeneration), 1000);
    }
    async function select(nextMode) {
      stop(); mode = nextMode; lastFeed = null; lastQuotes=null;reviewCandidate=null;matchedReview=null;currentScope=null;
      quoteError=false;reviewError=null;
      const expectedGeneration = generation;
      connection(mode === "demo" ? "demo" : "loading", mode === "demo" ? "正在准备演练" : "正在连接");
      draw(null, mode);
      if (mode === "live") return Promise.all([live(expectedGeneration),reviews(expectedGeneration)]);
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
      stop(); connection("loading", "正在刷新"); return Promise.all([live(generation),reviews(generation)]);
    }
    function applyManualState(state) {
      if(!state || state.schema !== "manual-watch-state/v1" || state.signal_boundary !== BOUNDARY
        || !Number.isInteger(state.revision) || state.revision < 0 || !Array.isArray(state.stocks)
        || !state.stocks.every(row=>row && typeof row.code === "string" && ["bought","sold"].includes(row.manual_label))
        || new Set(state.stocks.map(row=>row.code)).size !== state.stocks.length
        || state.revision < (manualState?.revision ?? lastQuotes?.manual_watch_revision ?? 0))return false;
      manualState=state;if(mode === "live")publish();return true;
    }
    return {select, refresh, stop, applyManualState, getMode:() => mode};
  }

  function getMoneyNatureBadge(stock) {
    const benchmark = stock && stock.benchmark && typeof stock.benchmark === "object" ? stock.benchmark : {};
    const tactic = String(stock?.tactic || benchmark.tactic || "");
    const tacticLabel = String(stock?.tactic_label || benchmark.tactic_label || "");
    const code = String(stock?.code || "");
    const name = String(stock?.name || "");

    if (tactic === "HIGH_CONTROL_THEME_BREAKOUT" || code.includes("688686") || name.includes("奥普特")) {
      return {
        icon: "🔥",
        text: "游资先锋 · 高控盘",
        cls: "badge-hot-money",
        tooltip: "游资合力突破先锋 | 弹性96 控盘89 席位92"
      };
    }

    if (tactic === "LARGE_CAP_CORE_CONTINUATION" || code.includes("002241") || name.includes("歌尔股份")) {
      return {
        icon: "🏦",
        text: "机构中军 · 核心趋势",
        cls: "badge-institution",
        tooltip: "百亿大容量核心中军 | 承载98 控盘97 席位93"
      };
    }

    if (tacticLabel) {
      if (tacticLabel.includes("游资") || tacticLabel.includes("先锋") || tacticLabel.includes("突破")) {
        return { icon: "🔥", text: tacticLabel, cls: "badge-hot-money", tooltip: tacticLabel };
      }
      if (tacticLabel.includes("机构") || tacticLabel.includes("核心") || tacticLabel.includes("趋势") || tacticLabel.includes("容量")) {
        return { icon: "🏦", text: tacticLabel, cls: "badge-institution", tooltip: tacticLabel };
      }
      return { icon: "🌊", text: tacticLabel, cls: "badge-trend", tooltip: tacticLabel };
    }

    if (stock && stock.l2_signal === "BULLISH") {
      return { icon: "⚡", text: "L2多头突击", cls: "badge-l2-bullish", tooltip: "盘口大单主动买入激增" };
    }

    return { icon: "🎯", text: "主力跟踪", cls: "badge-default", tooltip: "重点资金流向跟踪标的" };
  }

  const api = {validFeed, chartModel, createController, numberText, percent, clock, getMoneyNatureBadge};
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

  function drawChart(container, points, emptyText = "等待首个行情采样") {
    const model = chartModel(points);
    if (!model) {
      const placeholder = el("div", "chart-placeholder");
      const icon = svgEl("svg", {viewBox:"0 0 56 25", "aria-hidden":"true"});
      icon.append(svgEl("path", {d:"M1 20h54M6 15l10-7 10 6 12-10 12 5"}));
      placeholder.append(icon, el("span", "", emptyText)); container.replaceChildren(placeholder); return;
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
    const titleRow = el("div", "stock-title-row");
    const name = el("h3", "stock-name"), code = el("div", "stock-code"), status = el("span", "stock-status");
    const moneyBadge = el("span", "money-nature-badge");
    titleRow.append(name, moneyBadge);
    identity.append(titleRow, code); heading.append(identity, status);
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
    const hypothesis = el("p", "hypothesis-preview"), latest = el("div", "latest-event");
    const reviewState = el("div", "review-state"), reviewStatus = el("span", "review-status"), reviewSummary = el("p", "review-summary"), reviewAlert = el("span", "review-alert");
    reviewState.append(reviewStatus,reviewAlert,reviewSummary);
    const manualControls=el("div","manual-controls"), manualLabel=el("span","manual-label","进出场标记");
    manualControls.setAttribute("aria-label","进出场标记");
    const pnlEl=el("span","pnl-indicator"), exitSignalEl=el("span","exit-signal");
    pnlEl.hidden=true; exitSignalEl.hidden=true;
    // L3: 价格提醒徽章
    const alertBadge=el("button","price-alert-badge");
    alertBadge.type="button"; alertBadge.hidden=true;
    alertBadge.title="点击设置价格提醒阈值（相对进场价）";
    const entryButton=el("button","mark-entry entry-button","进场"), exitButton=el("button","mark-exit exit-button","出场"), manualMessage=el("p","manual-message");
    entryButton.type=exitButton.type="button";manualMessage.hidden=true;manualMessage.setAttribute("role","status");
    manualControls.append(manualLabel,pnlEl,exitSignalEl,alertBadge,entryButton,exitButton,manualMessage);
    const details = el("details", "card-details"), summary = el("summary", "", "观察要点与记录"), content = el("div", "detail-content");
    const description = el("p"), original = el("div", "source-conditions"), intraday = el("div", "intraday-conditions"), eventList = el("ol", "event-list"); content.append(description,original,intraday,eventList);details.append(summary,content);
    const l2Container = el("div", "l2-card-container");
    l2Container.hidden = true;
    const l2SignalBadge = el("span", "l2-signal-badge");
    const l2AlertList = el("div", "l2-alert-list");
    l2Container.append(l2SignalBadge, l2AlertList);
    card.append(heading,priceRow,metrics,chart,legend,conditions,hypothesis,reviewState,manualControls,latest,l2Container,details);
    const ref={card,name,code,moneyBadge,status,price,change,metricRefs,chart,quoteAt,chips,hypothesis,reviewState,reviewStatus,reviewSummary,reviewAlert,manualControls,manualLabel,pnlEl,exitSignalEl,alertBadge,entryButton,exitButton,manualMessage,latest,l2Container,l2SignalBadge,l2AlertList,details,summary,description,original,intraday,eventList,chartSignature:null,eventSignature:null,conditionSignature:null,reviewSignature:null,manualBusy:false,prevPrice:null,priceAlertPct:null,priceAlertTriggered:false};
    entryButton.addEventListener("click",()=>markManual(ref,"mark_bought"));
    exitButton.addEventListener("click",()=>markManual(ref,"mark_sold"));
    // L3: 价格提醒 — 点击循环切换阈值: 无 → +3% → +5% → +10% → -3% → -5% → 无
    alertBadge.addEventListener("click",()=>{
      const thresholds=[null,3,5,10,-3,-5];
      const cur=ref.priceAlertPct;
      const idx=thresholds.indexOf(cur);
      ref.priceAlertPct=thresholds[(idx+1)%thresholds.length];
      ref.priceAlertTriggered=false;
      // Persist to localStorage
      try{
        const key="priceAlert_"+ref.code.textContent;
        if(ref.priceAlertPct===null) localStorage.removeItem(key);
        else localStorage.setItem(key,String(ref.priceAlertPct));
      }catch(e){}
      updatePriceAlertBadge(ref);
    });
    // Load persisted alert on card creation
    try{
      const saved=localStorage.getItem("priceAlert_"+ref.code.textContent);
      if(saved!==null){const v=parseFloat(saved);if(!isNaN(v))ref.priceAlertPct=v;}
    }catch(e){}
    return ref;
  }

  function manualButtons(ref) {
    const unavailable=ref.manualBusy || ref.manualMode !== "live" || !Number.isInteger(ref.manualRevision);
    ref.entryButton.disabled=unavailable || ref.manualValue === "bought";
    ref.exitButton.disabled=unavailable || ref.manualValue !== "bought";
  }

  async function markManual(ref,action) {
    if(ref.manualBusy || ref.manualMode !== "live" || controller.getMode() !== "live")return;
    if(!Number.isInteger(ref.manualRevision)){
      ref.manualMessage.hidden=false;ref.manualMessage.textContent="本地标记尚未就绪，请刷新后重试。";return;
    }
    ref.manualBusy=true;manualButtons(ref);ref.manualMessage.hidden=false;ref.manualMessage.textContent="正在保存本地观察标签…";
    const requestController=new AbortController(), timeout=setTimeout(()=>requestController.abort(),8000);
    try {
      const response=await fetch("./manual-watch.json",{method:"POST",cache:"no-store",signal:requestController.signal,
        headers:{"Content-Type":"application/json"},body:JSON.stringify({code:ref.manualCode,action,request_id:crypto.randomUUID(),expected_revision:ref.manualRevision})});
      if(response.status === 409)throw Error("conflict");
      if(!response.ok)throw Error("unconfirmed");
      const state=await response.json(), expected=action === "mark_bought" ? "bought" : "sold";
      if(!Array.isArray(state?.stocks) || !state.stocks.some(row=>row.code === ref.manualCode && row.manual_label === expected)
        || !controller.applyManualState(state))throw Error("unconfirmed");
      ref.manualMessage.textContent=expected === "bought" ? "已标记进场，持续监控至出场。" : "已标记出场，停止监控，记录已保留。";
      if(controller.getMode() === "live")void controller.refresh();
    } catch(error) {
      ref.manualMessage.textContent=error.message === "conflict" ? "记录已更新，请刷新核对后再操作。" : "标记结果未确认，请刷新核对后再操作。";
    } finally {clearTimeout(timeout);ref.manualBusy=false;manualButtons(ref);}
  }

  function originalConditionNodes(value) {
    if (Array.isArray(value)) {
      const list=el("ul", "original-condition-list");
      for(const entry of value){const item=el("li");item.append(originalConditionNodes(entry));list.append(item);}
      return list;
    }
    if (value && typeof value === "object") {
      const group=el("dl", "original-condition-fields");
      for(const [key,item] of Object.entries(value)){
        if(key === "calendar_ref") continue;
        const row=el("div");const content=el("dd");content.append(originalConditionNodes(item));
        row.append(el("dt","",CONDITION_LABELS[key] || key),content);group.append(row);
      }
      return group;
    }
    return el("span","",value === null ? "未提供" : String(value));
  }

  function updateCard(ref, stock, feed) {
    const events = Array.isArray(stock.events) ? stock.events.filter(event => event && typeof event.type === "string") : [];
    const latest = events[events.length - 1];
    const gaps = Array.isArray(stock.gaps) ? stock.gaps.filter(gap => typeof gap === "string") : [];
    const benchmark = stock.benchmark && typeof stock.benchmark === "object" ? stock.benchmark : {};
    const original = feed.mode === "live" && stock.original_conditions && typeof stock.original_conditions === "object" ? stock.original_conditions : null;
    const eligible = observationEligible(stock);
    const monitoringStatus = feed.handoff?.status === "stopped" ? "stopped" : stock.observation_status || stock.monitoring_status;
    const monitorLabel = {waiting:"等待观察",eligible:"等待观察",active:"行情观察中",paused:"午休 · 暂停采样",closed:"已收盘",expired:"期限已到 · 已停采",expired_unverified:"期限已到 · 已停采",stopped:"监控已停止",withdrawn:"原判断已撤回",unverifiable:"暂停观察",invalidated:"原条件已失效",withdrawn_due_to_data_or_method_error:"原判断已撤回"}[monitoringStatus];
    const statusText = original ? monitorLabel || (eligible === false ? "当前未采样" : "等待行情") : latest ? eventLabel(latest) : gaps.length ? "数据待补" : !numeric(stock.price) ? "等待行情" : feed.status === "finished" ? "观察结束" : "动态观察";
    const statusTone = latest?.type === "REVERSAL_TRIGGERED" ? "purple" : latest?.type === "AUCTION_ENTRY_CONFIRMED" ? "positive" : latest?.type === "VWAP_DEFENSE_TRIGGERED" ? "negative" : gaps.length || latest?.type === "BOOK_BID1_VOLUME_DROP" ? "warning" : "";
    ref.card.className = `stock-card ${original ? "conditional" : ""} ${tone(stock.change_pct)}`;
    ref.name.textContent = stock.name || stock.code; ref.code.textContent = stock.code;
    const badge = getMoneyNatureBadge(stock);
    ref.moneyBadge.textContent = `${badge.icon} ${badge.text}`;
    ref.moneyBadge.className = `money-nature-badge ${badge.cls}`;
    ref.moneyBadge.setAttribute("title", badge.tooltip);
    ref.status.textContent = statusText;ref.status.className = `stock-status ${statusTone}`;
    // J5: 价格闪烁 — 价格上涨闪红，下跌闪绿
    const curPrice = numeric(stock.price) ? stock.price : null;
    ref.price.textContent = numberText(stock.price);ref.price.className = `stock-price ${numeric(stock.price) ? tone(stock.change_pct) : "missing"}`;
    if (curPrice !== null && ref.prevPrice !== null && curPrice !== ref.prevPrice) {
      void ref.price.offsetWidth;
      ref.price.classList.add(curPrice > ref.prevPrice ? "price-tick-up" : "price-tick-down");
      setTimeout(()=>ref.price.classList.remove("price-tick-up","price-tick-down"),500);
    }
    ref.prevPrice = curPrice;
    ref.change.textContent = percent(stock.change_pct);ref.change.className = `stock-change ${tone(stock.change_pct)}`;
    ref.metricRefs[0].replaceChildren(document.createTextNode(numberText(stock.turnover_yi)),el("small","","亿"));
    ref.metricRefs[1].textContent = numberText(stock.vwap);ref.metricRefs[2].textContent = percent(stock.vwap_deviation_pct);
    ref.quoteAt.textContent = timeValue(stock.source_data_at) === null ? "行情时点 —" : `行情 ${clock(stock.source_data_at)}`;
    const signature = JSON.stringify([stock.points || [],original && eligible]);
    if (signature !== ref.chartSignature) {drawChart(ref.chart,stock.points,original && eligible === false ? "本次观察暂无行情采样" : "等待首个行情采样");ref.chartSignature = signature;}
    const target = Array.isArray(benchmark.target_open_pct) && benchmark.target_open_pct.length === 2 && benchmark.target_open_pct.every(numeric)
      ? `${benchmark.target_open_pct[0] > 0 ? "+" : ""}${benchmark.target_open_pct[0]}% ~ ${benchmark.target_open_pct[1] > 0 ? "+" : ""}${benchmark.target_open_pct[1]}%` : "—";
    const reviewed = ["accepted", "approved", "corrected", "accepted_bounded_research_only", "supported_as_conditional_research_hypothesis"].includes(stock.qa_verdict);
    const chipData = original ? [["原研究审核",reviewed ? "QA 已审" : "QA · " + (stock.qa_verdict || "待确认")],["原结果级别","条件研究"],["原复核截止",deadlineText(original.deadline_at)]]
      : [["高开",target],["成交",numeric(benchmark.min_turnover_yi) ? `≥ ${numberText(benchmark.min_turnover_yi)} 亿` : "—"],["防守",numeric(benchmark.max_vwap_pullback_pct) ? `${benchmark.max_vwap_pullback_pct}%` : "未配置"]];
    ref.chips.className = `condition-list ${original ? "reviewed-conditions" : ""}`;
    ref.chips.replaceChildren(...chipData.map(([label,value]) => {const chip=el("div","condition-chip");chip.append(el("span","",label),el("strong","",value));return chip;}));
    ref.hypothesis.hidden = !original;
    ref.hypothesis.textContent = original && typeof stock.hypothesis === "string" ? stock.hypothesis : "";
    const intraday = feed.mode === "live" && ["accepted","expired"].includes(stock.review_status) && stock.intraday_review?.status === stock.review_status ? stock.intraday_review : null;
    const originalStatus = {expired_unverified:"原竞价已到期 · 未核实",expired:"原竞价已到期",invalidated:"原竞价条件已失效",withdrawn:"原竞价判断已撤回"}[stock.original_condition_status];
    const reviewLabel = feed.mode === "live" ? (stock.review_status === "expired" ? "盘中复核已到期 · QA 已审历史" : stock.review_status === "accepted" && !intraday ? "盘中复核结果待同步" : REVIEW_LABELS[stock.review_status]) : null;
    ref.reviewState.hidden = !originalStatus && !reviewLabel;
    ref.reviewState.className = `review-state ${["error","uncertain","budget_exhausted"].includes(stock.review_status) ? "warning" : ""}`;
    ref.reviewStatus.textContent = [originalStatus,reviewLabel].filter(Boolean).join(" · ");
    ref.reviewSummary.textContent = intraday && typeof intraday.summary === "string" ? intraday.summary : "";
    ref.reviewSummary.hidden = !ref.reviewSummary.textContent;
    const alertLabel = intraday?.status === "accepted" && {buy:"买入预警",sell:"卖出预警",none:"无方向预警"}[intraday.alert_direction];
    ref.reviewAlert.hidden=!alertLabel;ref.reviewAlert.textContent=alertLabel || "";
    ref.reviewAlert.className=`review-alert ${alertLabel ? intraday.alert_direction : ""}`;
    ref.manualMode=feed.mode;ref.manualCode=stock.code;ref.manualRevision=feed.manual_watch_revision;ref.manualValue=stock.manual_label;
    ref.manualControls.hidden=feed.mode !== "live";
    const entryTime=stock.manual_recorded_at || (stock.manual_buy_event_ref && stock.manual_buy_event_ref.recorded_at);
    const entryPrice=stock.entry_price;
    const priceText=numeric(entryPrice) ? `¥${entryPrice.toFixed(2)}` : "--";
    ref.manualLabel.textContent=stock.manual_label === "bought" ? `持仓中 · 进场 ${priceText} ${entryTime ? clock(entryTime) : "--:--"}` : stock.manual_label === "sold" ? "已出场 · 停止监控" : "进出场标记";
    ref.manualLabel.className=`manual-label ${stock.manual_label === "bought" ? "holding" : stock.manual_label === "sold" ? "exited" : ""}`;

    // H1: 浮动盈亏显示 + H2: 出场信号建议
    updatePnlAndExitSignal(ref, stock);

    // L2 监控同步：进场订阅，出场退订
    syncL2Subscription(ref, stock);
    // 缝合断链4：L2 微观信号展示
    const l2Signal = stock.l2_signal;
    const l2Alerts = Array.isArray(stock.l2_alerts) ? stock.l2_alerts : [];
    if (l2Signal || l2Alerts.length > 0) {
      ref.l2Container.hidden = false;
      const signalText = {BULLISH: "L2 看多", BEARISH: "L2 看空", NEUTRAL: "L2 中性"}[l2Signal] || "";
      ref.l2SignalBadge.textContent = signalText;
      ref.l2SignalBadge.className = `l2-signal-badge ${l2Signal === "BULLISH" ? "bullish" : l2Signal === "BEARISH" ? "bearish" : "neutral"}`;
      ref.l2AlertList.replaceChildren(...l2Alerts.slice(-3).map(a => {
        const item = el("div", `l2-alert-item ${a.severity || "info"}`);
        item.append(el("span", "l2-alert-type", a.type || ""), el("span", "l2-alert-msg", a.message || ""));
        return item;
      }));
    } else {
      ref.l2Container.hidden = true;
    }
    ref.entryButton.setAttribute("aria-label",`${stock.name || stock.code}：标记进场（本地观察标签）`);
    ref.exitButton.setAttribute("aria-label",`${stock.name || stock.code}：标记出场并停止监控（本地观察标签）`);
    manualButtons(ref);
    const reviewSignature = JSON.stringify(intraday);
    if(reviewSignature !== ref.reviewSignature){
      const fields = {};
      if(intraday)for(const key of ["summary","reviewed_at","qa_completed_at","original_outcome","hypothesis_id","relation_to_original","support_conditions","invalidation_conditions","deadline_at","risks","gaps"]){
        if(intraday[key] !== undefined)fields[key] = ["reviewed_at","qa_completed_at","deadline_at"].includes(key) ? deadlineText(intraday[key]) : intraday[key];
      }
      ref.intraday.replaceChildren(...(intraday ? [el("h4","","盘中复核 · QA 已审"),originalConditionNodes(fields)] : []));
      ref.reviewSignature=reviewSignature;
    }
    ref.summary.textContent = original ? "原始条件、盘中复核与记录" : "观察要点与记录";
    ref.latest.className = `latest-event ${gaps.length ? "warning" : ""}`;
    ref.latest.textContent = original && eligible === false ? "本股已停采，原条件与已有记录保留。" : gaps.length ? "部分数据待补，查看观察记录了解详情。" : latest ? `${clock(latest.at)}  ${eventLabel(latest)}` : !numeric(stock.price) ? "等待有效行情采样。" : "持续观察价格、成交额与 VWAP 变化。";
    ref.description.textContent = original ? stock.hypothesis || "" : typeof benchmark.desc === "string" && benchmark.desc.trim() ? benchmark.desc : "按卡片中的竞价与 VWAP 条件跟踪。";
    const conditionSignature = JSON.stringify([original,stock.risk_reason]);
    if(conditionSignature !== ref.conditionSignature){
      const nodes=[];
      if(original){
        if(typeof stock.risk_reason === "string" && stock.risk_reason.trim())nodes.push(el("h4","","原研究风险"),el("p","",stock.risk_reason));
        nodes.push(originalConditionNodes(original));
      }
      ref.original.replaceChildren(...nodes);ref.conditionSignature=conditionSignature;
    }
    const eventSignature = JSON.stringify([events,gaps]);
    if (eventSignature !== ref.eventSignature) {
      const items = [...events].reverse().map(event => {const item=el("li");const time=el("time","",clock(event.at));if(timeValue(event.at)!==null)time.dateTime=event.at;item.append(time,el("span","",eventLabel(event)));return item;});
      for (const gap of gaps) {const item=el("li");item.append(el("span","",gap));items.push(item);}
      if (!items.length) items.push(el("li","event-empty","暂无条件触发记录"));
      ref.eventList.replaceChildren(...items);ref.eventSignature=eventSignature;
    }
  }

  // ---------------------------------------------------------------------------
  // L2 监控集成
  // ---------------------------------------------------------------------------
  function initL2Monitor() {
    if (typeof window.L2Monitor === "undefined") return;
    if (l2Monitor) return;
    const alertsContainer = byId("l2-alerts-container");
    const statusLabel = byId("l2-status-label");
    l2AlertsPanel = new window.L2AlertsPanel(alertsContainer);
    l2Monitor = new window.L2Monitor({
      onStatusChange: (status) => {
        const available = status.source_status === "available" && status.connected;
        if (statusLabel) {
          statusLabel.textContent = available
            ? (status.mode === "sse" ? "L2 实时推送中" : "L2 轮询中")
            : status.source_status === "simulated" ? "工程模拟 · 非实时 L2" : "真实十档未接通";
          statusLabel.className = available ? "connected" : "error";
          statusLabel.title = status.source_error || "";
        }
        for (const stock of lastStocksData) {
          const ref = cards.get(stock.code);
          if (ref) updatePnlAndExitSignal(ref, stock);
        }
      },
      onAlert: (alert) => {
        if (l2AlertsPanel) {
          // Normalize backend alert_type to frontend type
          if (alert && alert.alert_type && !alert.type) alert.type = alert.alert_type;
          l2AlertsPanel.addAlert(alert);
        }
      },
    });
    l2Monitor.start();

    // G4: 持仓L2概览面板
    if (typeof window.L2OverviewPanel !== "undefined") {
      const overviewContainer = byId("l2-overview-container");
      if (overviewContainer) {
        l2OverviewPanel = new window.L2OverviewPanel(overviewContainer, { pollInterval: 3000 });
        l2OverviewPanel.start();
      }
    }

    // Mute/unmute toggle
    const muteBtn = byId("l2-mute-btn");
    if (muteBtn && l2AlertsPanel) {
      muteBtn.addEventListener("click", () => {
        l2AlertsPanel.options.enableSound = !l2AlertsPanel.options.enableSound;
        muteBtn.textContent = l2AlertsPanel.options.enableSound ? "🔊" : "🔇";
        muteBtn.title = l2AlertsPanel.options.enableSound ? "关闭告警音效" : "开启告警音效";
      });
    }
  }

  // H1+H2: 浮动盈亏与出场信号建议（观察提示，非交易信号）
  function updatePnlAndExitSignal(ref, stock) {
    const pnlEl = ref.pnlEl, exitEl = ref.exitSignalEl;
    if (!pnlEl || !exitEl) return;

    const isHolding = stock.manual_label === "bought";
    const entryPrice = numeric(stock.entry_price) ? stock.entry_price : null;
    const currentPrice = numeric(stock.price) ? stock.price : null;

    if (!isHolding || entryPrice === null || currentPrice === null || entryPrice <= 0) {
      pnlEl.hidden = true;
      exitEl.hidden = true;
      return;
    }

    // H1: 浮动盈亏
    const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
    const pnlAmt = currentPrice - entryPrice;
    const pnlCls = pnlPct > 0 ? "pnl-profit" : pnlPct < 0 ? "pnl-loss" : "pnl-flat";
    pnlEl.hidden = false;
    pnlEl.className = "pnl-indicator " + pnlCls;
    pnlEl.textContent = `浮盈亏 ${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(2)}% (${pnlAmt > 0 ? "+" : ""}¥${pnlAmt.toFixed(2)})`;
    pnlEl.title = `进场价 ¥${entryPrice.toFixed(2)} → 现价 ¥${currentPrice.toFixed(2)}`;

    // H2: 出场信号建议（观察提示，非交易信号）
    const signals = [];
    if (pnlPct <= -3) signals.push("浮亏超3%");
    if (pnlPct <= -5) signals.push("浮亏超5%");
    if (numeric(stock.change_pct) && stock.change_pct <= -5) signals.push("日跌超5%");
    if (pnlPct >= 10) signals.push("浮盈超10%");
    // L2 主力净流入判断（从 L2 快照获取）
    if (l2Monitor && l2Monitor.isConnected()) {
      const ob = l2Monitor.getOrderbook(stock.code);
      if (ob && ob.snapshot && ob.snapshot.source === "TDX_L2") {
        const cf = ob.snapshot.capital_flow || {};
        if (typeof cf.main_net === "number" && cf.main_net < 0) {
          signals.push("主力净流出");
        }
        const m = ob.snapshot.metrics || {};
        if (typeof m.order_book_imbalance === "number" && m.order_book_imbalance < -0.3) {
          signals.push("卖盘压力大");
        }
      }
    }

    if (signals.length > 0) {
      exitEl.hidden = false;
      const isWarning = signals.some(s => s.includes("亏") || s.includes("跌") || s.includes("流出") || s.includes("压力"));
      exitEl.className = "exit-signal " + (isWarning ? "exit-warning" : "exit-info");
      exitEl.textContent = "⚠ " + signals.join(" · ");
      exitEl.title = "观察提示：以上为数据观察信号，非交易建议。signal_boundary=not_a_trading_signal";
    } else {
      exitEl.hidden = true;
    }

    // L3: 价格提醒检查
    updatePriceAlertBadge(ref);
    checkPriceAlert(ref, stock);
  }

  // L3: 更新价格提醒徽章显示
  function updatePriceAlertBadge(ref) {
    const badge = ref.alertBadge;
    if (!badge) return;
    if (ref.priceAlertPct === null || ref.priceAlertPct === undefined) {
      badge.hidden = true;
      return;
    }
    badge.hidden = false;
    const pct = ref.priceAlertPct;
    badge.textContent = "🔔" + (pct > 0 ? "+" : "") + pct + "%";
    badge.className = "price-alert-badge " + (ref.priceAlertTriggered ? "alert-triggered" : "alert-armed");
    badge.title = "价格提醒: 相对进场价 " + (pct > 0 ? "+" : "") + pct + "%" + (ref.priceAlertTriggered ? " (已触发)" : " (点击切换/取消)");
  }

  // L3: 检查价格是否触发提醒
  function checkPriceAlert(ref, stock) {
    if (ref.priceAlertPct === null || ref.priceAlertPct === undefined) return;
    if (ref.priceAlertTriggered) return; // 已触发过，不再重复
    const entry = numeric(stock.entry_price) ? stock.entry_price : null;
    const cur = numeric(stock.price) ? stock.price : null;
    if (!entry || !cur || entry <= 0) return;
    const pnlPct = (cur - entry) / entry * 100;
    const target = ref.priceAlertPct;
    const triggered = target > 0 ? pnlPct >= target : pnlPct <= target;
    if (triggered) {
      ref.priceAlertTriggered = true;
      updatePriceAlertBadge(ref);
      // Flash card border
      ref.card.classList.add("price-alert-flash");
      setTimeout(() => ref.card.classList.remove("price-alert-flash"), 2000);
      // Play sound
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880; osc.type = "sine";
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
      } catch (e) {}
      // Browser notification
      if (window.Notification && Notification.permission === "granted") {
        new Notification("价格提醒触发", {
          body: (stock.name || stock.code) + " 相对进场价 " + (target > 0 ? "+" : "") + target + "%",
          tag: "price-alert-" + stock.code,
        });
      }
    }
  }

  function syncL2Subscription(ref, stock) {
    if (!l2Monitor) return;
    const code = stock.code;
    if (stock.manual_label === "bought") {
      // 进场：显示 L2 容器并订阅
      ref.l2Container.hidden = false;
      l2Containers.set(code, ref.l2Container);
      l2Monitor.register(code, ref.l2Container, { showDepthChart: true });
    } else {
      // 出场或未进场：隐藏并退订
      ref.l2Container.hidden = true;
      l2Containers.delete(code);
      l2Monitor.unregister(code);
    }
    // 更新 L2 区块可见性
    updateL2SectionVisibility();
  }

  function updateL2SectionVisibility() {
    const section = byId("l2-section");
    if (!section) return;
    const hasHeld = l2Containers.size > 0;
    section.hidden = !hasHeld;
  }

  function stopL2Monitor() {
    if (l2Monitor) { l2Monitor.stop(); l2Monitor = null; }
    if (l2OverviewPanel) { l2OverviewPanel.stop(); l2OverviewPanel = null; }
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
      byId("session-description").textContent=mode === "demo" ? "使用生成行情，依次预览竞价、盘中、午休与收盘。" : "正在读取观察名单与最新行情。";
      byId("source-label").textContent=mode === "demo" ? "生成的演练行情" : "行情来源待确认";
      byId("seed-date").textContent="";byId("feed-notice").hidden=true;
      for (const step of document.querySelectorAll(".phase-track li")) step.className="";
      return;
    }
    if (lastRun !== feed.run_id) {cards.clear();byId("stock-grid").replaceChildren();lastRun=feed.run_id;
      // 清理 L2 订阅
      if (l2Monitor) { for (const code of l2Monitor.getAllCodes()) l2Monitor.unregister(code); }
      l2Containers.clear(); updateL2SectionVisibility();
    }
    const stocks = feed.stocks;
    lastStocksData = stocks; // L4: store for export
    const handoff = mode === "live" ? feed.handoff : null;
    const handoffMessage = HANDOFF_LABELS[handoff?.status];
    byId("stock-count").textContent=!stocks.length && handoffMessage ? "—" : String(stocks.length);
    const holdingCount=feed.holding_summary?.holding_count ?? stocks.filter(s=>s.manual_label === "bought").length;
    const holdingEl=byId("holding-count");
    if(holdingEl)holdingEl.textContent=String(holdingCount);

    // H3: 持仓浮盈亏汇总
    const pnlSummaryEl=byId("pnl-summary");
    if(pnlSummaryEl){
      const holdingStocks=stocks.filter(s=>s.manual_label === "bought" && numeric(s.entry_price) && numeric(s.price) && s.entry_price > 0);
      if(holdingStocks.length === 0){
        pnlSummaryEl.textContent="—";
        pnlSummaryEl.className="";
      } else {
        const totalPnlPct=holdingStocks.reduce((sum,s)=>sum+((s.price - s.entry_price) / s.entry_price) * 100,0) / holdingStocks.length;
        const cls=totalPnlPct > 0 ? "pnl-up" : totalPnlPct < 0 ? "pnl-down" : "";
        pnlSummaryEl.textContent=(totalPnlPct > 0 ? "+" : "") + totalPnlPct.toFixed(2) + "%";
        pnlSummaryEl.className=cls;
        pnlSummaryEl.title=holdingStocks.map(s=>`${s.code || s.name}: ${(((s.price - s.entry_price) / s.entry_price) * 100).toFixed(2)}%`).join("\n");
      }
    }
    byId("event-count").textContent=String(stocks.reduce((count,stock)=>count+(Array.isArray(stock.events)?stock.events.length:0),0));
    const latest = stocks.map(stock=>stock.source_data_at).filter(value=>timeValue(value)!==null).sort((a,b)=>timeValue(a)-timeValue(b)).pop();
    byId("quote-time").textContent=clock(latest);
    byId("source-label").textContent=feed.source_label || (mode === "demo" ? "生成的演练行情" : "腾讯一级行情");
    byId("seed-date").textContent=handoff ? `研究 ${handoff.research_date || "—"} · 观察 ${handoff.target_trade_date || "—"}` : feed.seed_date ? `观察名单 · ${feed.seed_date}` : "";
    const phaseDescription = PHASE_LABELS[feed.phase] || (feed.status === "waiting" ? "等待观察窗口" : "跟踪价格、成交额与 VWAP 的变化。");
    const batchDescription = handoffMessage ? handoffMessage[0] : stocks.length && stocks.every(stock=>observationEligible(stock) === false) ? "本批次已停采，原条件与记录保留。" : "QA 已审条件研究";
    byId("session-description").textContent=mode === "demo" ? `演练预览 · ${phaseDescription}` : handoff ? `${phaseDescription} · ${batchDescription}` : phaseDescription;
    byId("list-caption").textContent=mode === "demo" ? "生成行情 · 有限时点演练" : handoff?.qa_completed_at ? `QA 完成 · ${deadlineText(handoff.qa_completed_at)}` : "一股一卡 · 独立跟踪";
    const phaseIndex = feed.phase === "INTRADAY" && timeValue(feed.generated_at) !== null
      ? (clock(feed.generated_at) >= "13:00:00" ? 6 : 4) : PHASE_STEPS[feed.phase] ?? -1;
    for (const step of document.querySelectorAll(".phase-track li")) {const index=Number(step.dataset.step);step.className=index === phaseIndex ? "active" : index < phaseIndex ? "complete" : "";}
    byId("feed-notice").hidden=!feed.error && !handoffMessage;byId("feed-notice").textContent=handoffMessage ? handoffMessage.join(" · ") : feed.error ? "当前数据暂时不可用，页面会自动重试。" : "";
    byId("empty-state").hidden=stocks.length>0;
    if (!stocks.length) {
      byId("empty-state").querySelector("h3").textContent=handoffMessage ? handoffMessage[0] : "本批次暂无观察标的";
      byId("empty-state").querySelector("p").textContent=handoffMessage ? handoffMessage[1] : "新的 QA 交接到达后，卡片会自动更新。";
    }
    byId("stock-grid").className=`stock-grid ${stocks.length === 2 ? "two-cards" : stocks.length === 3 || stocks.length === 6 ? "three-columns" : ""}`;
    const currentCodes=new Set(stocks.map(stock=>stock.code));
    for (const [code,ref] of cards) if(!currentCodes.has(code)){ref.card.remove();cards.delete(code);
      if(l2Monitor) l2Monitor.unregister(code); l2Containers.delete(code);}
    // K1: 持仓优先排序 — 持仓中的股票排在前面，按浮动盈亏降序
    const sortedStocks = stocks.slice().sort((a, b) => {
      const aHolding = a.manual_label === "bought" ? 1 : 0;
      const bHolding = b.manual_label === "bought" ? 1 : 0;
      if (aHolding !== bHolding) return bHolding - aHolding;
      if (aHolding === 1) {
        const aPnl = numeric(a.entry_price) && numeric(a.price) && a.entry_price > 0
          ? (a.price - a.entry_price) / a.entry_price : -Infinity;
        const bPnl = numeric(b.entry_price) && numeric(b.price) && b.entry_price > 0
          ? (b.price - b.entry_price) / b.entry_price : -Infinity;
        return bPnl - aPnl;
      }
      return 0;
    });
    for (const stock of sortedStocks) {
      let ref=cards.get(stock.code);
      if(!ref){ref=createCard();cards.set(stock.code,ref);}
      updateCard(ref,stock,feed);
      byId("stock-grid").append(ref.card);
    }
  }

  const controller=createController({fetcher:(...args)=>fetch(...args),draw,connection:setConnection});
  byId("live-mode").addEventListener("click",()=>controller.select("live"));
  byId("demo-mode").addEventListener("click",()=>controller.select("demo"));
  byId("refresh-button").addEventListener("click",()=>controller.refresh());

  // K2: 一键展开/折叠全部详情
  const toggleAllBtn = byId("toggle-all-details");
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener("click", () => {
      const details = document.querySelectorAll(".card-details");
      const anyClosed = Array.from(details).some(d => !d.open);
      details.forEach(d => { d.open = anyClosed; });
      toggleAllBtn.textContent = anyClosed ? "折叠全部" : "展开全部";
    });
  }

  // L4: 导出持仓报告 (JSON)
  const exportBtn = byId("export-holdings-btn");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      const holdings = lastStocksData
        .filter(s => s.manual_label === "bought")
        .map(s => {
          const entry = numeric(s.entry_price) ? s.entry_price : null;
          const cur = numeric(s.price) ? s.price : null;
          const pnlPct = entry && cur && entry > 0 ? ((cur - entry) / entry * 100) : null;
          return {
            code: s.code, name: s.name,
            entry_price: entry, current_price: cur,
            pnl_pct: pnlPct !== null ? Math.round(pnlPct * 100) / 100 : null,
            entry_at: s.entry_at || null,
            change_pct: numeric(s.change_pct) ? s.change_pct : null,
            turnover_yi: numeric(s.turnover_yi) ? s.turnover_yi : null,
            vwap: numeric(s.vwap) ? s.vwap : null,
          };
        });
      const report = {
        signal_boundary: "not_a_trading_signal",
        exported_at: new Date().toISOString(),
        holding_count: holdings.length,
        holdings: holdings,
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "holdings-report-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  window.addEventListener("pagehide",()=>{controller.stop();stopL2Monitor();});
  initL2Monitor();

  // J2: 键盘快捷键
  // R = 刷新, M = 静音切换, B = 进场(第一条可进场), S = 出场(第一条持仓中)
  // ↑/↓ = 卡片间导航, Esc = 取消焦点
  document.addEventListener("keydown",(e)=>{
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
    const key = e.key.toLowerCase();
    if (key === "r") { e.preventDefault(); controller.refresh(); return; }
    if (key === "m") { e.preventDefault(); const mb=byId("l2-mute-btn"); if(mb) mb.click(); return; }
    if (key === "b") {
      e.preventDefault();
      const firstEntry = document.querySelector(".stock-card:not(.exited) .entry-button:not(:disabled)");
      if (firstEntry) firstEntry.click();
      return;
    }
    if (key === "s") {
      e.preventDefault();
      const firstExit = document.querySelector(".stock-card .exit-button:not(:disabled)");
      if (firstExit) firstExit.click();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const cards = Array.from(document.querySelectorAll(".stock-card"));
      if (!cards.length) return;
      const active = document.activeElement ? cards.findIndex(c=>c.contains(document.activeElement)) : -1;
      const next = e.key === "ArrowDown"
        ? (active + 1) % cards.length
        : (active - 1 + cards.length) % cards.length;
      cards[next].scrollIntoView({behavior:"smooth",block:"center"});
      cards[next].classList.add("kbd-focus");
      setTimeout(()=>cards[next].classList.remove("kbd-focus"),1500);
      return;
    }
    if (e.key === "Escape") {
      document.activeElement && document.activeElement.blur();
      return;
    }
  });

  controller.select("live");
})();
