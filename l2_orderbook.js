"use strict";
// L2 Orderbook component — 十档盘口(L2) + 委托量 + 盘口不平衡度
// Display only. signal_boundary=not_a_trading_signal.
// Connects to /l2-sse for real-time push, falls back to polling /l2-all.json.

(() => {
  const BOUNDARY = "not_a_trading_signal";
  const LEVELS = 10; // L2 双十档

  // ---------------------------------------------------------------------------
  // L2Orderbook — renders a 10-level (双十档) orderbook panel for a single stock
  // ---------------------------------------------------------------------------
  class L2Orderbook {
    constructor(container, code, options) {
      this.container = container;
      this.code = code;
      this.options = Object.assign({
        showTrades: true,
        showCapitalFlow: true,
        showDepthChart: false,
        maxTrades: 20,
        spikeThreshold: 0.3,    // M1: 盘口异动阈值 (30%)
        onSpike: null,           // M1: 异动回调 (code, side, level, change, snapshot)
      }, options || {});
      this._snapshot = null;
      this._prevSnapshot = null;
      this._seenTrades = new Set();
      this._el = null;
      this._refs = {};
      this._build();
    }

    _build() {
      const root = document.createElement("div");
      root.className = "l2-orderbook";
      root.dataset.code = this.code;
      root.setAttribute("aria-label", "L2盘口 " + this.code);

      // Header
      const header = document.createElement("div");
      header.className = "l2-ob-header";
      const title = document.createElement("span");
      title.className = "l2-ob-title";
      title.textContent = "L2 十档盘口";
      const meta = document.createElement("div");
      meta.className = "l2-ob-meta";
      const spreadEl = document.createElement("span");
      spreadEl.className = "l2-ob-spread";
      spreadEl.textContent = "价差 —";
      const imbalanceEl = document.createElement("span");
      imbalanceEl.className = "l2-ob-imbalance neutral";
      imbalanceEl.textContent = "不平衡度 —";
      const seqEl = document.createElement("span");
      seqEl.className = "l2-ob-seq";
      const histBtn = document.createElement("button");
      histBtn.className = "l2-ob-hist-btn";
      histBtn.type = "button";
      histBtn.textContent = "历史";
      histBtn.title = "查看历史L2快照";
      meta.append(spreadEl, imbalanceEl, seqEl, histBtn);
      header.append(title, meta);

      // Orderbook
      const book = document.createElement("div");
      book.className = "l2-ob-book";

      // Asks column (卖十~卖一)
      const asksCol = document.createElement("div");
      asksCol.className = "l2-ob-col l2-ob-asks";
      const asksHeader = document.createElement("div");
      asksHeader.className = "l2-ob-col-header";
      asksHeader.innerHTML = "<span>档位</span><span>卖价</span><span>委托量</span><span>委托笔数</span>";
      asksCol.appendChild(asksHeader);
      const askRows = [];
      for (let i = LEVELS - 1; i >= 0; i--) {
        const row = document.createElement("div");
        row.className = "l2-ob-row l2-ob-ask-row";
        row.dataset.level = String(i);
        const levelEl = document.createElement("span");
        levelEl.className = "l2-ob-level";
        levelEl.textContent = "卖" + (i + 1);
        const priceEl = document.createElement("span");
        priceEl.className = "l2-ob-price";
        const volEl = document.createElement("span");
        volEl.className = "l2-ob-vol";
        const barEl = document.createElement("span");
        barEl.className = "l2-ob-bar";
        const barInner = document.createElement("i");
        barEl.appendChild(barInner);
        const ordersEl = document.createElement("span");
        ordersEl.className = "l2-ob-orders";
        row.append(levelEl, priceEl, volEl, barEl, ordersEl);
        asksCol.appendChild(row);
        askRows.push({ row: row, priceEl: priceEl, volEl: volEl, barInner: barInner, ordersEl: ordersEl, level: i });
      }

      // Divider with mid price
      const divider = document.createElement("div");
      divider.className = "l2-ob-divider";
      const midPrice = document.createElement("span");
      midPrice.className = "l2-ob-mid";
      midPrice.textContent = "—";
      divider.appendChild(midPrice);

      // Bids column (买一~买十)
      const bidsCol = document.createElement("div");
      bidsCol.className = "l2-ob-col l2-ob-bids";
      const bidsHeader = document.createElement("div");
      bidsHeader.className = "l2-ob-col-header";
      bidsHeader.innerHTML = "<span>档位</span><span>买价</span><span>委托量</span><span>委托笔数</span>";
      bidsCol.appendChild(bidsHeader);
      const bidRows = [];
      for (let i = 0; i < LEVELS; i++) {
        const row = document.createElement("div");
        row.className = "l2-ob-row l2-ob-bid-row";
        row.dataset.level = String(i);
        const levelEl = document.createElement("span");
        levelEl.className = "l2-ob-level";
        levelEl.textContent = "买" + (i + 1);
        const priceEl = document.createElement("span");
        priceEl.className = "l2-ob-price";
        const volEl = document.createElement("span");
        volEl.className = "l2-ob-vol";
        const barEl = document.createElement("span");
        barEl.className = "l2-ob-bar";
        const barInner = document.createElement("i");
        barEl.appendChild(barInner);
        const ordersEl = document.createElement("span");
        ordersEl.className = "l2-ob-orders";
        row.append(levelEl, priceEl, volEl, barEl, ordersEl);
        bidsCol.appendChild(row);
        bidRows.push({ row: row, priceEl: priceEl, volEl: volEl, barInner: barInner, ordersEl: ordersEl, level: i });
      }

      book.append(asksCol, divider, bidsCol);

      // Summary row
      const summary = document.createElement("div");
      summary.className = "l2-ob-summary";
      const bidTotalEl = document.createElement("span");
      bidTotalEl.className = "l2-ob-bid-total";
      bidTotalEl.textContent = "买盘 —";
      const askTotalEl = document.createElement("span");
      askTotalEl.className = "l2-ob-ask-total";
      askTotalEl.textContent = "卖盘 —";
      const largeBuyEl = document.createElement("span");
      largeBuyEl.className = "l2-ob-large-buy";
      largeBuyEl.textContent = "大买 —";
      const largeSellEl = document.createElement("span");
      largeSellEl.className = "l2-ob-large-sell";
      largeSellEl.textContent = "大卖 —";
      const superBuyEl = document.createElement("span");
      superBuyEl.className = "l2-ob-super-buy";
      superBuyEl.textContent = "超买 —";
      const superSellEl = document.createElement("span");
      superSellEl.className = "l2-ob-super-sell";
      superSellEl.textContent = "超卖 —";
      summary.append(bidTotalEl, askTotalEl, largeBuyEl, largeSellEl, superBuyEl, superSellEl);

      // Trade tape
      let tradesSection = null;
      if (this.options.showTrades) {
        tradesSection = document.createElement("div");
        tradesSection.className = "l2-ob-trades";
        const tradesHeader = document.createElement("div");
        tradesHeader.className = "l2-ob-trades-header";
        tradesHeader.textContent = "逐笔成交";
        const tradesList = document.createElement("div");
        tradesList.className = "l2-ob-trades-list";
        tradesSection.append(tradesHeader, tradesList);
      }

      // Capital flow
      let capSection = null;
      if (this.options.showCapitalFlow) {
        capSection = document.createElement("div");
        capSection.className = "l2-ob-capflow";
        const capHeader = document.createElement("div");
        capHeader.className = "l2-ob-capflow-header";
        capHeader.textContent = "资金流微结构";
        const capGrid = document.createElement("div");
        capGrid.className = "l2-ob-capflow-grid";
        capSection.append(capHeader, capGrid);
      }

      // Footer
      const footer = document.createElement("div");
      footer.className = "l2-ob-footer";
      const tsEl = document.createElement("span");
      tsEl.className = "l2-ob-timestamp";
      tsEl.textContent = "等待数据…";
      const srcEl = document.createElement("span");
      srcEl.className = "l2-ob-source";
      footer.append(tsEl, srcEl);

      // History panel (hidden by default)
      const histPanel = document.createElement("div");
      histPanel.className = "l2-ob-history";
      histPanel.hidden = true;
      const histHeader = document.createElement("div");
      histHeader.className = "l2-ob-history-header";
      const histTitle = document.createElement("span");
      histTitle.textContent = "历史快照";
      const histClose = document.createElement("button");
      histClose.className = "l2-ob-history-close";
      histClose.type = "button";
      histClose.textContent = "×";
      histClose.title = "关闭";
      histHeader.append(histTitle, histClose);
      const histList = document.createElement("div");
      histList.className = "l2-ob-history-list";
      histPanel.append(histHeader, histList);

      // Depth chart (cumulative bid/ask volume, SVG)
      let depthSection = null;
      if (this.options.showDepthChart) {
        depthSection = document.createElement("div");
        depthSection.className = "l2-ob-depth";
        const depthHeader = document.createElement("div");
        depthHeader.className = "l2-ob-depth-header";
        depthHeader.textContent = "盘口深度";
        const depthSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        depthSvg.setAttribute("class", "l2-ob-depth-svg");
        depthSvg.setAttribute("viewBox", "0 0 200 60");
        depthSvg.setAttribute("preserveAspectRatio", "none");
        depthSection.append(depthHeader, depthSvg);
      }

      root.append(header, book, summary);
      if (depthSection) root.appendChild(depthSection);
      if (tradesSection) root.appendChild(tradesSection);
      if (capSection) root.appendChild(capSection);
      root.appendChild(histPanel);
      root.appendChild(footer);

      this._el = root;
      this._refs = {
        spreadEl: spreadEl, imbalanceEl: imbalanceEl, seqEl: seqEl,
        askRows: askRows, bidRows: bidRows, midPrice: midPrice,
        bidTotalEl: bidTotalEl, askTotalEl: askTotalEl,
        largeBuyEl: largeBuyEl, largeSellEl: largeSellEl,
        superBuyEl: superBuyEl, superSellEl: superSellEl,
        tradesList: tradesSection ? tradesSection.querySelector(".l2-ob-trades-list") : null,
        capGrid: capSection ? capSection.querySelector(".l2-ob-capflow-grid") : null,
        tsEl: tsEl, srcEl: srcEl,
        histBtn: histBtn, histPanel: histPanel, histList: histList, histClose: histClose,
        depthSvg: depthSection ? depthSection.querySelector(".l2-ob-depth-svg") : null,
      };
      this.container.appendChild(root);

      // History button toggle
      histBtn.addEventListener("click", () => this._toggleHistory());
      histClose.addEventListener("click", () => { histPanel.hidden = true; });
    }

    async _toggleHistory() {
      const r = this._refs;
      if (r.histPanel.hidden) {
        r.histPanel.hidden = false;
        r.histList.innerHTML = "";
        const loading = document.createElement("div");
        loading.className = "l2-ob-history-loading";
        loading.textContent = "加载中…";
        r.histList.appendChild(loading);
        try {
          const resp = await fetch("./l2-history.json?code=" + encodeURIComponent(this.code) + "&limit=30", { cache: "no-store" });
          if (resp.ok) {
            const data = await resp.json();
            this._renderHistory(data.snapshots || []);
          } else {
            r.histList.innerHTML = "";
            const err = document.createElement("div");
            err.className = "l2-ob-history-empty";
            err.textContent = "暂无历史数据";
            r.histList.appendChild(err);
          }
        } catch (e) {
          r.histList.innerHTML = "";
          const err = document.createElement("div");
          err.className = "l2-ob-history-empty";
          err.textContent = "加载失败";
          r.histList.appendChild(err);
        }
      } else {
        r.histPanel.hidden = true;
      }
    }

    _renderHistory(snapshots) {
      const r = this._refs;
      r.histList.innerHTML = "";
      if (!snapshots.length) {
        const empty = document.createElement("div");
        empty.className = "l2-ob-history-empty";
        empty.textContent = "暂无历史数据";
        r.histList.appendChild(empty);
        return;
      }
      for (const snap of snapshots) {
        const row = document.createElement("div");
        row.className = "l2-ob-history-row";
        const m = snap.metrics || {};
        const time = document.createElement("span");
        time.className = "hist-time";
        time.textContent = this._fmtTime(snap.timestamp);
        const bidPrice = document.createElement("span");
        bidPrice.className = "hist-bid";
        bidPrice.textContent = snap.bids && snap.bids[0] ? snap.bids[0].price.toFixed(2) : "—";
        const askPrice = document.createElement("span");
        askPrice.className = "hist-ask";
        askPrice.textContent = snap.asks && snap.asks[0] ? snap.asks[0].price.toFixed(2) : "—";
        const imb = document.createElement("span");
        imb.className = "hist-imb " + (typeof m.order_book_imbalance === "number" ? (m.order_book_imbalance > 0 ? "positive" : m.order_book_imbalance < 0 ? "negative" : "") : "");
        imb.textContent = typeof m.order_book_imbalance === "number" ? ((m.order_book_imbalance > 0 ? "+" : "") + (m.order_book_imbalance * 100).toFixed(1) + "%") : "—";
        const bidVol = document.createElement("span");
        bidVol.className = "hist-bidvol";
        bidVol.textContent = this._fmtVol(m.bid_total || 0);
        const askVol = document.createElement("span");
        askVol.className = "hist-askvol";
        askVol.textContent = this._fmtVol(m.ask_total || 0);
        const alerts = document.createElement("span");
        alerts.className = "hist-alerts";
        alerts.textContent = (snap.alerts && snap.alerts.length) ? "⚡" + snap.alerts.length : "";
        row.append(time, bidPrice, askPrice, imb, bidVol, askVol, alerts);
        r.histList.appendChild(row);
      }
    }

    _fmtPrice(v) {
      return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "—";
    }

    _fmtVol(v) {
      if (typeof v !== "number" || !Number.isFinite(v)) return "—";
      if (v >= 10000) return (v / 10000).toFixed(1) + "万";
      return String(v);
    }

    _fmtTime(ts) {
      if (!ts) return "";
      try {
        const d = new Date(ts);
        if (isNaN(d.getTime())) return ts;
        return new Intl.DateTimeFormat("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: false,
        }).format(d);
      } catch (e) { return ts; }
    }

    // I1: 价格闪烁 — 价格上涨闪红，下跌闪绿
    _flashPrice(el, currentPrice, prevPrice) {
      el.textContent = this._fmtPrice(currentPrice);
      if (typeof currentPrice !== "number" || typeof prevPrice !== "number") return;
      if (currentPrice === prevPrice) return;
      // Remove existing flash classes and force reflow
      el.classList.remove("price-flash-up", "price-flash-down");
      void el.offsetWidth;
      if (currentPrice > prevPrice) {
        el.classList.add("price-flash-up");
      } else {
        el.classList.add("price-flash-down");
      }
      // Clean up after animation
      const self = this;
      setTimeout(function() {
        el.classList.remove("price-flash-up", "price-flash-down");
      }, 600);
    }

    // M1: 盘口异动检测 — 委托量突增/突减超过阈值时闪烁并回调
    _detectSpike(rowEl, change, side, level, data, snapshot) {
      if (snapshot.source !== "TDX_L2") return;
      const threshold = this.options.spikeThreshold || 0.3;
      rowEl.classList.remove("vol-spike-up", "vol-spike-down");
      if (Math.abs(change) >= threshold) {
        const cls = change > 0 ? "vol-spike-up" : "vol-spike-down";
        void rowEl.offsetWidth; // force reflow
        rowEl.classList.add(cls);
        setTimeout(function() { rowEl.classList.remove(cls); }, 1000);
        // Trigger callback
        if (typeof this.options.onSpike === "function") {
          try {
            this.options.onSpike({
              code: this.code,
              side: side,           // "bid" or "ask"
              level: level + 1,     // 1-based
              change: change,
              changePct: Math.round(change * 100),
              volume: data.volume,
              price: data.price,
              timestamp: snapshot.timestamp,
            });
          } catch (e) { /* ignore */ }
        }
      }
    }

    update(snapshot) {
      if (!snapshot || snapshot.code !== this.code) return;
      this._prevSnapshot = this._snapshot;
      this._snapshot = snapshot;
      const r = this._refs;
      const metrics = snapshot.metrics || {};

      // Header meta
      const spread = metrics.spread;
      r.spreadEl.textContent = spread != null ? "价差 " + this._fmtPrice(spread) : "价差 —";
      const imb = metrics.order_book_imbalance;
      if (typeof imb === "number") {
        const pct = (imb * 100).toFixed(1);
        r.imbalanceEl.textContent = "不平衡 " + (imb > 0 ? "+" : "") + pct + "%";
        r.imbalanceEl.className = "l2-ob-imbalance " + (imb > 0.1 ? "bid-heavy" : imb < -0.1 ? "ask-heavy" : "neutral");
      }
      r.seqEl.textContent = snapshot.sequence ? "#" + snapshot.sequence : "";

      // Max volume for bar scaling
      const allVols = [];
      (snapshot.bids || []).forEach(function(b) { allVols.push(b.volume || 0); });
      (snapshot.asks || []).forEach(function(a) { allVols.push(a.volume || 0); });
      const maxVol = Math.max.apply(null, allVols.concat([1]));

      // Render asks (卖十~卖一, index 9 down to 0)
      const asks = snapshot.asks || [];
      for (let i = 0; i < LEVELS; i++) {
        const level = LEVELS - 1 - i;
        const data = asks[level];
        const rowRef = r.askRows[i];
        if (data) {
          // I1: 价格闪烁 — compare with previous snapshot
          const prevAsk = this._prevSnapshot && this._prevSnapshot.asks ? this._prevSnapshot.asks[level] : null;
          this._flashPrice(rowRef.priceEl, data.price, prevAsk ? prevAsk.price : null);
          rowRef.volEl.textContent = this._fmtVol(data.volume);
          rowRef.ordersEl.textContent = data.orders != null ? String(data.orders) : "—";
          const pct = Math.round((data.volume || 0) / maxVol * 100);
          rowRef.barInner.style.width = pct + "%";
          if (prevAsk && prevAsk.volume > 0) {
            const change = (data.volume - prevAsk.volume) / prevAsk.volume;
            rowRef.row.classList.toggle("vol-up", change > 0.5);
            rowRef.row.classList.toggle("vol-down", change < -0.5);
            // M1: 盘口异动检测 — 委托量突增/突减超过阈值
            this._detectSpike(rowRef.row, change, "ask", level, data, snapshot);
          } else {
            rowRef.row.classList.remove("vol-up", "vol-down", "vol-spike-up", "vol-spike-down");
          }
          rowRef.row.classList.add("has-data");
        } else {
          rowRef.priceEl.textContent = "—";
          rowRef.volEl.textContent = "—";
          rowRef.ordersEl.textContent = "—";
          rowRef.barInner.style.width = "0%";
          rowRef.row.classList.remove("has-data", "vol-up", "vol-down", "vol-spike-up", "vol-spike-down");
        }
      }

      // Render bids (买一~买十, index 0 to 9)
      const bids = snapshot.bids || [];
      for (let i = 0; i < LEVELS; i++) {
        const data = bids[i];
        const rowRef = r.bidRows[i];
        if (data) {
          // I1: 价格闪烁 — compare with previous snapshot
          const prevBid = this._prevSnapshot && this._prevSnapshot.bids ? this._prevSnapshot.bids[i] : null;
          this._flashPrice(rowRef.priceEl, data.price, prevBid ? prevBid.price : null);
          rowRef.volEl.textContent = this._fmtVol(data.volume);
          rowRef.ordersEl.textContent = data.orders != null ? String(data.orders) : "—";
          const pct = Math.round((data.volume || 0) / maxVol * 100);
          rowRef.barInner.style.width = pct + "%";
          if (prevBid && prevBid.volume > 0) {
            const change = (data.volume - prevBid.volume) / prevBid.volume;
            rowRef.row.classList.toggle("vol-up", change > 0.5);
            rowRef.row.classList.toggle("vol-down", change < -0.5);
            // M1: 盘口异动检测 — 委托量突增/突减超过阈值
            this._detectSpike(rowRef.row, change, "bid", i, data, snapshot);
          } else {
            rowRef.row.classList.remove("vol-up", "vol-down", "vol-spike-up", "vol-spike-down");
          }
          rowRef.row.classList.add("has-data");
        } else {
          rowRef.priceEl.textContent = "—";
          rowRef.volEl.textContent = "—";
          rowRef.ordersEl.textContent = "—";
          rowRef.barInner.style.width = "0%";
          rowRef.row.classList.remove("has-data", "vol-up", "vol-down", "vol-spike-up", "vol-spike-down");
        }
      }

      // Mid price
      if (bids[0] && asks[0]) {
        r.midPrice.textContent = this._fmtPrice((bids[0].price + asks[0].price) / 2);
      } else if (bids[0]) {
        r.midPrice.textContent = this._fmtPrice(bids[0].price);
      }

      // Summary
      r.bidTotalEl.textContent = "买盘 " + this._fmtVol(metrics.bid_total || 0);
      r.askTotalEl.textContent = "卖盘 " + this._fmtVol(metrics.ask_total || 0);
      const countText = value => typeof value === "number" ? String(value) + (metrics.trade_volume_status === "partial" ? "（已核部分）" : "") : "—";
      r.largeBuyEl.textContent = "大买 " + countText(metrics.large_buy_count);
      r.largeSellEl.textContent = "大卖 " + countText(metrics.large_sell_count);
      r.superBuyEl.textContent = "超买 " + countText(metrics.super_buy_count);
      r.superSellEl.textContent = "超卖 " + countText(metrics.super_sell_count);
      if (r.tradesList) r.tradesList.title = (snapshot.trade_evidence_gaps || []).join("; ");

      // Trade tape
      if (r.tradesList) {
        const trades = (snapshot.last_trades || []).slice(-this.options.maxTrades).reverse();
        // Snapshot length cannot establish whether any trade is new.
        r.tradesList.innerHTML = "";
        for (let ti = 0; ti < trades.length; ti++) {
          const t = trades[ti];
          const item = document.createElement("div");
          item.className = "l2-ob-trade " + (t.side === "B" ? "trade-buy" : t.side === "S" ? "trade-sell" : "");
          const normalized = ["lot", "share"].includes(t.volume_unit)
            && typeof t.volume_lots === "number" && Number.isFinite(t.volume_lots) && t.volume_lots >= 0
            && typeof t.amount_cny === "number" && Number.isFinite(t.amount_cny) && t.amount_cny >= 0;
          const isLarge = normalized && t.volume_lots >= 500;
          const isSuper = normalized && t.volume_lots >= 1000;
          if (isSuper) item.classList.add("trade-super");
          else if (isLarge) item.classList.add("trade-large");
          // I2: Flash on new large/super trade (first item = newest)
          const hasNewTrade = t.trade_identity_status === "verified" && typeof t.trade_key === "string" && t.trade_key.length > 0 && !this._seenTrades.has(t.trade_key);
          if (hasNewTrade) this._seenTrades.add(t.trade_key);
          if (snapshot.source === "TDX_L2" && hasNewTrade && ti === 0 && (isLarge || isSuper)) {
            item.classList.add("trade-flash");
          }
          const time = document.createElement("span");
          time.className = "trade-time";
          time.textContent = this._fmtTime(t.at);
          const price = document.createElement("span");
          price.className = "trade-price";
          price.textContent = this._fmtPrice(t.price);
          const vol = document.createElement("span");
          vol.className = "trade-vol";
          vol.textContent = normalized ? this._fmtVol(t.volume_lots) + "手"
            : this._fmtVol(t.volume) + (t.volume_unit === "lot" ? "手" : t.volume_unit === "share" ? "股" : "（单位待核）");
          // I2: Badge for large/super trades
          if (isSuper || isLarge) {
            const badge = document.createElement("span");
            badge.className = "trade-badge " + (isSuper ? "badge-super" : "badge-large");
            badge.textContent = isSuper ? "超" : "大";
            item.append(time, price, vol, badge);
          } else {
            item.append(time, price, vol);
          }
          const side = document.createElement("span");
          side.className = "trade-side " + (t.side === "B" ? "side-buy" : t.side === "S" ? "side-sell" : "");
          // M2: 方向图标 ▲买 ▼卖
          side.textContent = t.side === "B" ? "▲买" : t.side === "S" ? "▼卖" : "—";
          item.appendChild(side);
          // I2: Trade amount for large trades
          if (isLarge) {
            const amt = document.createElement("span");
            amt.className = "trade-amt";
            const amount = t.amount_cny;
            amt.textContent = amount >= 10000 ? (amount / 10000).toFixed(1) + "万" : String(Math.round(amount));
            amt.title = "成交金额: ¥" + amount.toFixed(0);
            item.appendChild(amt);
          }
          r.tradesList.appendChild(item);
        }
      }

      // Capital flow
      if (r.capGrid) {
        const cf = snapshot.capital_flow || {};
        r.capGrid.innerHTML = "";
        const fields = [
          ["主力净流入", cf.main_net, "yuan"],
          ["超大单净流入", cf.super_large_net, "yuan"],
          ["大单净流入", cf.large_net, "yuan"],
          ["散户净流入", cf.retail_net, "yuan"],
          ["主力净占比", cf.main_ratio, "pct"],
        ];
        for (const [label, val, unit] of fields) {
          const cell = document.createElement("div");
          cell.className = "l2-ob-capflow-cell";
          const lbl = document.createElement("span");
          lbl.className = "capflow-label";
          lbl.textContent = label;
          const v = document.createElement("strong");
          let toneCls = "";
          if (typeof val === "number" && Number.isFinite(val)) {
            toneCls = val > 0 ? "positive" : val < 0 ? "negative" : "";
          }
          v.className = "capflow-value " + toneCls;
          let display;
          if (typeof val !== "number" || !Number.isFinite(val)) {
            display = "—";
          } else if (unit === "yuan") {
            display = (val >= 10000 || val <= -10000)
              ? (val / 10000).toFixed(2) + "万"
              : val.toFixed(0);
          } else {
            display = (val > 0 ? "+" : "") + val.toFixed(2) + "%";
          }
          v.textContent = display;
          cell.append(lbl, v);
          r.capGrid.appendChild(cell);
        }
      }

      // Depth chart (cumulative volume)
      if (r.depthSvg) this._renderDepthChart(r.depthSvg, bids, asks, maxVol);

      // Footer
      r.tsEl.textContent = snapshot.timestamp ? this._fmtTime(snapshot.timestamp) : "—";
      r.srcEl.textContent = String(snapshot.source || "").includes("SIMULATED")
        ? "工程模拟 · " + snapshot.source : snapshot.source || "";
    }

    _renderDepthChart(svg, bids, asks, maxVol) {
      const NS = "http://www.w3.org/2000/svg";
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const W = 200, H = 60, PAD = 2;
      if (!bids.length && !asks.length) return;

      // Cumulative bid volume (from 买十 to 买一, left to right)
      const bidLevels = bids.slice().reverse(); // 买十 first
      let cumBid = 0;
      const bidPoints = [];
      for (let i = 0; i < bidLevels.length; i++) {
        cumBid += bidLevels[i].volume || 0;
        const x = PAD + (i / Math.max(bidLevels.length - 1, 1)) * (W / 2 - PAD * 2);
        const y = H - PAD - (cumBid / Math.max(maxVol * LEVELS, 1)) * (H - PAD * 2);
        bidPoints.push({ x: x, y: Math.max(PAD, Math.min(H - PAD, y)) });
      }
      // Cumulative ask volume (from 卖一 to 卖十, left to right in right half)
      let cumAsk = 0;
      const askPoints = [];
      for (let i = 0; i < asks.length; i++) {
        cumAsk += asks[i].volume || 0;
        const x = W / 2 + PAD + (i / Math.max(asks.length - 1, 1)) * (W / 2 - PAD * 2);
        const y = H - PAD - (cumAsk / Math.max(maxVol * LEVELS, 1)) * (H - PAD * 2);
        askPoints.push({ x: x, y: Math.max(PAD, Math.min(H - PAD, y)) });
      }

      // Draw bid area (left half, red/A股买盘)
      if (bidPoints.length >= 2) {
        const bidPath = document.createElementNS(NS, "path");
        let d = "M " + bidPoints[0].x + " " + H + " ";
        for (const p of bidPoints) d += "L " + p.x + " " + p.y + " ";
        d += "L " + bidPoints[bidPoints.length - 1].x + " " + H + " Z";
        bidPath.setAttribute("d", d);
        bidPath.setAttribute("fill", "rgba(255,135,149,0.25)");
        bidPath.setAttribute("stroke", "rgba(255,135,149,0.6)");
        bidPath.setAttribute("stroke-width", "1");
        svg.appendChild(bidPath);
      }

      // Draw ask area (right half, green/A股卖盘)
      if (askPoints.length >= 2) {
        const askPath = document.createElementNS(NS, "path");
        let d = "M " + askPoints[0].x + " " + H + " ";
        for (const p of askPoints) d += "L " + p.x + " " + p.y + " ";
        d += "L " + askPoints[askPoints.length - 1].x + " " + H + " Z";
        askPath.setAttribute("d", d);
        askPath.setAttribute("fill", "rgba(115,213,172,0.25)");
        askPath.setAttribute("stroke", "rgba(115,213,172,0.6)");
        askPath.setAttribute("stroke-width", "1");
        svg.appendChild(askPath);
      }

      // Center line
      const centerLine = document.createElementNS(NS, "line");
      centerLine.setAttribute("x1", W / 2);
      centerLine.setAttribute("y1", 0);
      centerLine.setAttribute("x2", W / 2);
      centerLine.setAttribute("y2", H);
      centerLine.setAttribute("stroke", "rgba(255,255,255,0.15)");
      centerLine.setAttribute("stroke-width", "0.5");
      centerLine.setAttribute("stroke-dasharray", "2,2");
      svg.appendChild(centerLine);
    }

    showError(msg) {
      this._snapshot = null;
      this._prevSnapshot = null;
      if (this._el) {
        const r = this._refs;
        r.spreadEl.textContent = "价差 —";
        r.imbalanceEl.textContent = "不平衡度 —";
        r.imbalanceEl.className = "l2-ob-imbalance neutral";
        r.seqEl.textContent = "";
        r.midPrice.textContent = "—";
        for (const row of [...r.askRows, ...r.bidRows]) {
          row.priceEl.textContent = row.volEl.textContent = row.ordersEl.textContent = "—";
          row.barInner.style.width = "0%";
          row.row.classList.remove("has-data", "vol-up", "vol-down", "vol-spike-up", "vol-spike-down");
        }
        for (const [key, label] of [["bidTotalEl", "买盘"], ["askTotalEl", "卖盘"], ["largeBuyEl", "大买"], ["largeSellEl", "大卖"], ["superBuyEl", "超买"], ["superSellEl", "超卖"]]) {
          r[key].textContent = label + " —";
        }
        for (const key of ["tradesList", "capGrid", "depthSvg"]) {
          if (r[key]) r[key].textContent = "";
        }
        this._el.classList.add("l2-error");
        r.tsEl.textContent = msg || "数据不可用";
      }
    }

    setSourceStatus(status, error, label) {
      const changed = this._sourceStatus !== status;
      this._sourceStatus = status;
      if (changed || status === "unavailable") {
        this.showError(status === "available" ? "等待真实十档数据…" : status === "simulated" ? "工程模拟" : "真实十档未接通");
      }
      this._el.classList.toggle("l2-error", status === "unavailable");
      this._refs.srcEl.textContent = (status === "simulated" ? "工程模拟 · " : "") + (label || "");
      this._refs.srcEl.title = error || "";
    }

    showLoading() {
      if (this._el) this._el.classList.add("l2-loading");
    }

    remove() {
      if (this._el && this._el.parentNode) {
        this._el.parentNode.removeChild(this._el);
      }
      this._el = null;
    }

    get element() { return this._el; }
    get snapshot() { return this._snapshot; }

    // M6: 异动阈值设置 — 调整盘口异动检测阈值 (0~1, 默认 0.3 = 30%)
    setSpikeThreshold(value) {
      const v = Number(value);
      if (!isNaN(v) && v > 0 && v <= 1) {
        this.options.spikeThreshold = v;
      }
    }

    get spikeThreshold() { return this.options.spikeThreshold; }
  }

  // ---------------------------------------------------------------------------
  // L2Monitor — manages L2 data connections for all subscribed stocks
  // ---------------------------------------------------------------------------
  class L2Monitor {
    constructor(options) {
      this.options = Object.assign({
        ssePath: "./l2-sse",
        pollPath: "./l2-all.json",
        subscriptionsPath: "./l2-subscriptions.json",
        pollInterval: 1000,
        autoConnect: true,
      }, options || {});

      this._orderbooks = new Map();
      this._containers = new Map();
      this._eventSource = null;
      this._pollTimer = null;
      this._pollGeneration = 0;
      this._connected = false;
      this._sourceStatus = "unavailable";
      this._sourceError = null;
      this._sourceLabel = "TDX_L2_UNAVAILABLE";
      this._onStatusChange = (options && options.onStatusChange) || null;
      this._onAlert = (options && options.onAlert) || null;
      this._alertsPanel = null;    // M3: 告警面板联动
    }

    // M3: 异动告警联动 — 绑定告警面板，前端异动检测自动触发告警
    linkAlertsPanel(panel) {
      this._alertsPanel = panel;
      for (const [code, ob] of this._orderbooks) {
        this._wireSpikeToAlerts(code, ob);
      }
    }

    // M3: 为单个 orderbook 挂接 onSpike 回调，将异动事件转换为告警
    _wireSpikeToAlerts(code, ob) {
      const panel = this._alertsPanel;
      if (!panel || typeof panel.addAlert !== "function") return;
      const origOnSpike = ob.options.onSpike;
      ob.options.onSpike = (spike) => {
        if (!this._connected || !ob.snapshot || ob.snapshot.source !== "TDX_L2") return;
        if (typeof origOnSpike === "function") origOnSpike(spike);
        const isBid = spike.side === "bid";
        const absChange = Math.abs(spike.change);
        const severity = absChange >= 0.5 ? "high" : "medium";
        panel.addAlert({
          type: isBid ? "volume_spike_bid" : "volume_spike_ask",
          code: spike.code,
          message: (isBid ? "买" : "卖") + "盘第" + spike.level + "档 委托量" + (spike.changePct >= 0 ? "+" : "") + spike.changePct + "%",
          detail: "委托量 " + spike.volume + " @ " + spike.price,
          timestamp: spike.timestamp,
          severity: severity,
        });
      };
    }

    _setStatus(data, mode) {
      this._sourceStatus = ["available", "simulated"].includes(data.source_status) ? data.source_status : "unavailable";
      this._sourceError = data.source_error || null;
      this._sourceLabel = data.source_label || "TDX_L2_UNAVAILABLE";
      this._connected = this._sourceStatus === "available";
      for (const ob of this._orderbooks.values()) {
        ob.setSourceStatus(this._sourceStatus, this._sourceError, this._sourceLabel);
      }
      if (this._onStatusChange) {
        this._onStatusChange({ connected: this._connected, mode: mode,
          source_status: this._sourceStatus, source_error: this._sourceError, source_label: this._sourceLabel });
      }
    }

    register(code, container, obOptions) {
      this._containers.set(code, container);
      if (!this._orderbooks.has(code)) {
        const ob = new L2Orderbook(container, code, obOptions);
        this._orderbooks.set(code, ob);
        ob.setSourceStatus(this._sourceStatus, this._sourceError, this._sourceLabel);
        // M3: 若已绑定告警面板，自动挂接异动告警联动
        if (this._alertsPanel) {
          this._wireSpikeToAlerts(code, ob);
        }
      }
    }

    unregister(code) {
      const ob = this._orderbooks.get(code);
      if (ob) { ob.remove(); this._orderbooks.delete(code); }
      this._containers.delete(code);
    }

    getOrderbook(code) {
      return this._orderbooks.get(code);
    }

    getAllCodes() {
      return Array.from(this._orderbooks.keys());
    }

    // M6: 批量设置所有已注册 orderbook 的异动阈值
    setSpikeThreshold(value) {
      for (const ob of this._orderbooks.values()) {
        ob.setSpikeThreshold(value);
      }
    }

    start() {
      if (typeof EventSource !== "undefined") {
        try {
          const self = this;
          const source = new EventSource(this.options.ssePath);
          this._eventSource = source;
          source.onopen = function() {
            if (self._eventSource !== source) return;
            self._setStatus({}, "sse");
            self._stopPolling();
          };
          source.onmessage = function(e) {
            if (self._eventSource !== source) return;
            try {
              const data = JSON.parse(e.data);
              if (data.type === "source_status") {
                self._setStatus(data, "sse");
              } else if (data.type === "snapshot" || data.type === "update") {
                const snap = data.snapshot || data;
                self._dispatchSnapshot(snap);
              } else if (!data.type && data.code && Array.isArray(data.bids) && Array.isArray(data.asks)) {
                self._dispatchSnapshot(data);
              } else if (data.type === "alert") {
                if (self._connected && self._onAlert) self._onAlert(data.alert);
              }
            } catch (err) { /* ignore malformed */ }
          };
          source.onerror = function() {
            if (self._eventSource !== source) return;
            self._setStatus({}, "sse-error");
            source.close();
            self._eventSource = null;
            self._startPolling();
          };
          return;
        } catch (e) {
          // fall through to polling
        }
      }
      this._startPolling();
    }

    _startPolling() {
      if (this._pollTimer) return;
      this._setStatus({}, "polling");
      const generation = ++this._pollGeneration;
      let latestRequest = 0;
      const self = this;
      const tick = async function() {
        const request = ++latestRequest;
        try {
          const sep = self.options.pollPath.includes("?") ? "&" : "?";
      const resp = await fetch(self.options.pollPath + sep + "_t=" + Date.now(), { cache: "no-store" });
          if (generation !== self._pollGeneration || request !== latestRequest) return;
          if (resp.ok) {
            const data = await resp.json();
            if (generation !== self._pollGeneration || request !== latestRequest) return;
            self._setStatus(data, "polling");
            const snapshots = data.snapshots || {};
            for (const snap of Object.values(snapshots)) {
              self._dispatchSnapshot(snap);
            }
          } else {
            self._setStatus({}, "polling-error");
          }
        } catch (e) {
          if (generation === self._pollGeneration && request === latestRequest) self._setStatus({}, "polling-error");
        }
      };
      tick();
      this._pollTimer = setInterval(tick, this.options.pollInterval);
    }

    _stopPolling() {
      this._pollGeneration++;
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    }

    _dispatchSnapshot(snapshot) {
      if (!snapshot || !snapshot.code) return;
      const expectedSource = this._sourceStatus === "available" ? "TDX_L2"
        : this._sourceStatus === "simulated" ? "TDX_L2_SIMULATED" : null;
      if (!expectedSource || snapshot.source !== expectedSource) return;
      const ob = this._orderbooks.get(snapshot.code);
      if (ob) {
        ob.update(snapshot);
      }
    }

    pushSnapshot(snapshot) {
      this._dispatchSnapshot(snapshot);
    }

    stop() {
      if (this._eventSource) {
        this._eventSource.close();
        this._eventSource = null;
      }
      this._stopPolling();
      this._setStatus({}, "stopped");
    }

    isConnected() { return this._connected; }
  }

  // ---------------------------------------------------------------------------
  // L2AlertsPanel — displays L2 alert notifications
  // ---------------------------------------------------------------------------
  class L2AlertsPanel {
    constructor(container, options) {
      this.container = container;
      this.options = Object.assign({
        maxAlerts: 50,
        enableSound: true,
        enableNotification: true,
        flashOnNew: true,
      }, options || {});
      this._alerts = [];
      this._el = null;
      this._listEl = null;
      this._audioCtx = null;
      this._build();
      if (this.options.enableNotification && typeof Notification !== "undefined" && Notification.permission === "default") {
        try { Notification.requestPermission(); } catch (e) { /* ignore */ }
      }
    }

    _severity(type) {
      // high: 超大单, 盘口转向, 资金强流
      // medium: 大单, 委托突增
      // low: 其他
      if (!type) return "low";
      if (type === "super_large_order" || type.indexOf("flip") >= 0 || type.indexOf("strong") >= 0) return "high";
      if (type === "large_order" || type.indexOf("spike") >= 0) return "medium";
      return "low";
    }

    _playAlertSound(severity) {
      if (!this.options.enableSound) return;
      try {
        if (!this._audioCtx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this._audioCtx = new AC();
        }
        const ctx = this._audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        // Different pitch for different severity
        osc.frequency.value = severity === "high" ? 880 : severity === "medium" ? 660 : 440;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } catch (e) { /* audio not available */ }
    }

    // M4: 异动告警音效 — 买盘高音(1200Hz), 卖盘低音(400Hz), 与现有告警音效区分
    _playSpikeSound(side, severity) {
      if (!this.options.enableSound) return;
      try {
        if (!this._audioCtx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this._audioCtx = new AC();
        }
        const ctx = this._audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        // 买盘异动=高音, 卖盘异动=低音
        osc.frequency.value = side === "bid" ? 1200 : 400;
        osc.type = "triangle";
        const vol = severity === "high" ? 0.25 : 0.15;
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      } catch (e) { /* audio not available */ }
    }

    _showNotification(alert) {
      if (!this.options.enableNotification) return;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      try {
        const label = this._alertLabel(alert.type || alert.alert_type);
        new Notification("L2盘口异动 — " + (alert.code || ""), {
          body: label + (alert.message || alert.detail || ""),
          tag: "l2-alert-" + (alert.code || ""),
          silent: false,
        });
      } catch (e) { /* notification not available */ }
    }

    _build() {
      const root = document.createElement("div");
      root.className = "l2-alerts-panel";
      const header = document.createElement("div");
      header.className = "l2-alerts-header";
      const title = document.createElement("span");
      title.textContent = "盘口异动告警";
      const count = document.createElement("span");
      count.className = "l2-alerts-count";
      count.textContent = "0";
      header.append(title, count);
      const list = document.createElement("div");
      list.className = "l2-alerts-list";
      const empty = document.createElement("div");
      empty.className = "l2-alerts-empty";
      empty.textContent = "暂无异动告警";
      list.appendChild(empty);
      root.append(header, list);
      this.container.appendChild(root);
      this._el = root;
      this._listEl = list;
      this._countEl = count;
      this._emptyEl = empty;
    }

    _alertLabel(type) {
      const labels = {
        large_order: "大单成交",
        super_large_order: "超大单成交",
        volume_spike_bid: "买盘委托突增",
        volume_spike_ask: "卖盘委托突增",
        imbalance_flip_bullish: "盘口转多",
        imbalance_flip_bearish: "盘口转空",
        capital_inflow_strong: "资金强流入",
        capital_outflow_strong: "资金强流出",
      };
      return labels[type] || type;
    }

    _alertTone(type) {
      if (!type) return "alert-neutral";
      if (type.indexOf("bullish") >= 0 || type.indexOf("inflow") >= 0) return "alert-bullish";
      if (type.indexOf("bearish") >= 0 || type.indexOf("outflow") >= 0) return "alert-bearish";
      if (type.indexOf("spike") >= 0) return "alert-warning";
      if (type === "large_order" || type === "super_large_order") return "alert-bullish";
      return "alert-neutral";
    }

    addAlert(alert) {
      if (!alert) return;
      const type = alert.type || alert.alert_type || "";
      const severity = this._severity(type);
      this._alerts.unshift(alert);
      if (this._alerts.length > this.options.maxAlerts) {
        this._alerts.length = this.options.maxAlerts;
      }
      this._render();
      // Trigger effects for new alert
      // M4: 异动告警使用专属音效 (买盘高音/卖盘低音)
      if (type.indexOf("spike") >= 0) {
        const side = type.indexOf("bid") >= 0 ? "bid" : "ask";
        this._playSpikeSound(side, severity);
      } else {
        this._playAlertSound(severity);
      }
      if (severity === "high") this._showNotification(alert);
      if (this.options.flashOnNew && this._el) {
        this._el.classList.remove("l2-alerts-flash");
        // Force reflow to restart animation
        void this._el.offsetWidth;
        this._el.classList.add("l2-alerts-flash");
      }
    }

    _render() {
      if (!this._listEl) return;
      this._listEl.innerHTML = "";
      if (this._alerts.length === 0) {
        this._listEl.appendChild(this._emptyEl);
        this._countEl.textContent = "0";
        return;
      }
      this._countEl.textContent = String(this._alerts.length);
      for (const alert of this._alerts) {
        const item = document.createElement("div");
        const sev = this._severity(alert.type || alert.alert_type || "");
        item.className = "l2-alert-item " + this._alertTone(alert.type || alert.alert_type || "") + " sev-" + sev;
        if (sev === "high") item.classList.add("l2-alert-new");
        const time = document.createElement("span");
        time.className = "alert-time";
        try {
          time.textContent = alert.at
            ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(alert.at))
            : "";
        } catch (e) { time.textContent = alert.at || ""; }
        const code = document.createElement("span");
        code.className = "alert-code";
        code.textContent = alert.code || "";
        const label = document.createElement("span");
        label.className = "alert-label";
        label.textContent = this._alertLabel(alert.type);
        const detail = document.createElement("span");
        detail.className = "alert-detail";
        detail.textContent = alert.detail || "";
        item.append(time, code, label, detail);
        this._listEl.appendChild(item);
      }
    }

    clear() {
      this._alerts = [];
      this._render();
    }

    get alerts() { return this._alerts.slice(); }

    // M5: 异动历史记录 — 过滤 type 包含 "spike" 的异动告警
    getSpikeAlerts() {
      return this._alerts.filter(function(a) {
        const t = a.type || a.alert_type || "";
        return t.indexOf("spike") >= 0;
      });
    }

    // M7: 异动数据导出 — 导出告警记录为 CSV 字符串
    exportAlerts(format) {
      const rows = [["时间", "股票代码", "告警类型", "消息", "详情", "严重等级"]];
      for (const a of this._alerts) {
        const t = a.at ? new Date(a.at).toISOString() : "";
        rows.push([
          t,
          a.code || "",
          a.type || a.alert_type || "",
          a.message || "",
          a.detail || "",
          a.severity || this._severity(a.type || a.alert_type || ""),
        ]);
      }
      return this._toCsv(rows);
    }

    // M7: 仅导出异动告警
    exportSpikeAlerts() {
      const rows = [["时间", "股票代码", "方向", "档位", "变化幅度", "委托量", "价格", "严重等级"]];
      for (const a of this.getSpikeAlerts()) {
        const t = a.at ? new Date(a.at).toISOString() : "";
        const isBid = (a.type || "").indexOf("bid") >= 0;
        rows.push([
          t,
          a.code || "",
          isBid ? "买盘" : "卖盘",
          a.message || "",
          "",
          a.detail || "",
          "",
          a.severity || "",
        ]);
      }
      return this._toCsv(rows);
    }

    // M7: CSV 转换私有方法
    _toCsv(rows) {
      return rows.map(function(row) {
        return row.map(function(cell) {
          const s = String(cell == null ? "" : cell);
          if (s.indexOf(",") >= 0 || s.indexOf("\"") >= 0 || s.indexOf("\n") >= 0) {
            return "\"" + s.replace(/"/g, "\"\"") + "\"";
          }
          return s;
        }).join(",");
      }).join("\n");
    }

    // M7: 触发浏览器下载 CSV 文件
    downloadCsv(filename, csvContent) {
      try {
        const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || "l2-alerts.csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) { /* download not available */ }
    }
  }

  // ---------------------------------------------------------------------------
  // L2OverviewPanel — 持仓股票L2概览对比面板
  // ---------------------------------------------------------------------------
  class L2OverviewPanel {
    constructor(container, options) {
      this.container = container;
      this.options = Object.assign({ pollInterval: 3000 }, options || {});
      this._snapshots = new Map(); // code -> latest snapshot
      this._el = null;
      this._tableBody = null;
      this._pollTimer = null;
      this._pollGeneration = 0;
      this._sourceStatus = "unavailable";
      this._build();
      this._render();
    }

    _build() {
      const root = document.createElement("div");
      root.className = "l2-overview-panel";
      const header = document.createElement("div");
      header.className = "l2-overview-header";
      header.textContent = "持仓 L2 概览";
      const table = document.createElement("table");
      table.className = "l2-overview-table";
      const thead = document.createElement("thead");
      thead.innerHTML = "<tr><th>股票</th><th>买一</th><th>卖一</th><th>价差</th><th>不平衡度</th><th>买盘</th><th>卖盘</th><th>大单净</th><th>主力净流入</th></tr>";
      const tbody = document.createElement("tbody");
      table.append(thead, tbody);
      root.append(header, table);
      this.container.appendChild(root);
      this._el = root;
      this._header = header;
      this._tableBody = tbody;
    }

    update(code, snapshot) {
      this._snapshots.set(code, snapshot);
      this._render();
    }

    remove(code) {
      this._snapshots.delete(code);
      this._render();
    }

    _render() {
      if (!this._tableBody) return;
      this._header.textContent = this._sourceStatus === "simulated" ? "持仓 L2 概览 · 工程模拟" : "持仓 L2 概览";
      this._tableBody.innerHTML = "";
      if (this._snapshots.size === 0) {
        const row = document.createElement("tr");
        row.className = "l2-overview-empty";
        const cell = document.createElement("td");
        cell.colSpan = 9;
        cell.textContent = this._sourceStatus === "unavailable" ? "真实十档未接通" : "暂无持仓股票";
        row.appendChild(cell);
        this._tableBody.appendChild(row);
        return;
      }
      const fmtPrice = function(v) { return typeof v === "number" ? v.toFixed(2) : "—"; };
      const fmtVol = function(v) {
        if (typeof v !== "number") return "—";
        if (v >= 10000) return (v / 10000).toFixed(1) + "万";
        return String(v);
      };
      const fmtYuan = function(v) {
        if (typeof v !== "number") return "—";
        if (v >= 10000 || v <= -10000) return (v / 10000).toFixed(1) + "万";
        return String(v.toFixed(0));
      };
      const tone = function(v) { return typeof v === "number" ? v > 0 ? "positive" : v < 0 ? "negative" : "" : ""; };

      for (const [code, snap] of this._snapshots) {
        const m = snap.metrics || {};
        const cf = snap.capital_flow || {};
        const row = document.createElement("tr");
        row.dataset.code = code;

        const cells = [
          { text: code, cls: "ov-code" },
          { text: snap.bids && snap.bids[0] ? fmtPrice(snap.bids[0].price) : "—", cls: "ov-bid " + (snap.bids && snap.bids[0] ? "price-up" : "") },
          { text: snap.asks && snap.asks[0] ? fmtPrice(snap.asks[0].price) : "—", cls: "ov-ask " + (snap.asks && snap.asks[0] ? "price-down" : "") },
          { text: m.spread != null ? fmtPrice(m.spread) : "—", cls: "ov-spread" },
          { text: typeof m.order_book_imbalance === "number" ? ((m.order_book_imbalance > 0 ? "+" : "") + (m.order_book_imbalance * 100).toFixed(1) + "%") : "—", cls: "ov-imb " + tone(m.order_book_imbalance) },
          { text: fmtVol(m.bid_total || 0), cls: "ov-bidvol" },
          { text: fmtVol(m.ask_total || 0), cls: "ov-askvol" },
          { text: m.trade_volume_status === "unknown" ? "—" : String((m.large_buy_count || 0) - (m.large_sell_count || 0)) + (m.trade_volume_status === "partial" ? "（部分）" : ""), cls: "ov-large " + tone((m.large_buy_count || 0) - (m.large_sell_count || 0)) },
          { text: fmtYuan(cf.main_net), cls: "ov-mainflow " + tone(cf.main_net) },
        ];
        for (const c of cells) {
          const td = document.createElement("td");
          td.className = c.cls;
          td.textContent = c.text;
          row.appendChild(td);
        }
        this._tableBody.appendChild(row);
      }
    }

    start() {
      if (this._pollTimer) return;
      const generation = ++this._pollGeneration;
      let latestRequest = 0;
      const self = this;
      const tick = async function() {
        const request = ++latestRequest;
        try {
          const resp = await fetch("./l2-all.json?_t=" + Date.now(), { cache: "no-store" });
          if (generation !== self._pollGeneration || request !== latestRequest) return;
          if (resp.ok) {
            const data = await resp.json();
            if (generation !== self._pollGeneration || request !== latestRequest) return;
            self._sourceStatus = ["available", "simulated"].includes(data.source_status) ? data.source_status : "unavailable";
            const snapshots = data.snapshots || {};
            // Clear and update all
            self._snapshots.clear();
            const expectedSource = self._sourceStatus === "available" ? "TDX_L2"
              : self._sourceStatus === "simulated" ? "TDX_L2_SIMULATED" : null;
            for (const code in snapshots) {
              if (expectedSource && snapshots[code].source === expectedSource) self._snapshots.set(code, snapshots[code]);
            }
            self._render();
          } else {
            self._sourceStatus = "unavailable";
            self._snapshots.clear();
            self._render();
          }
        } catch (e) {
          if (generation !== self._pollGeneration || request !== latestRequest) return;
          self._sourceStatus = "unavailable";
          self._snapshots.clear();
          self._render();
        }
      };
      tick();
      this._pollTimer = setInterval(tick, this.options.pollInterval);
    }

    stop() {
      this._pollGeneration++;
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
      this._sourceStatus = "unavailable";
      this._snapshots.clear();
      this._render();
    }
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------
  window.L2Orderbook = L2Orderbook;
  window.L2Monitor = L2Monitor;
  window.L2AlertsPanel = L2AlertsPanel;
  window.L2OverviewPanel = L2OverviewPanel;
})();
