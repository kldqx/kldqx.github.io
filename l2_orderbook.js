"use strict";
// L2 Orderbook component — 五档盘口 + 委托量 + 盘口不平衡度
// Display only. signal_boundary=not_a_trading_signal.
// Connects to /l2-sse for real-time push, falls back to polling /l2-all.json.

(() => {
  const BOUNDARY = "not_a_trading_signal";

  // ---------------------------------------------------------------------------
  // L2Orderbook — renders a 5-level orderbook panel for a single stock
  // ---------------------------------------------------------------------------
  class L2Orderbook {
    constructor(container, code, options) {
      this.container = container;
      this.code = code;
      this.options = Object.assign({
        showTrades: true,
        showCapitalFlow: true,
        maxTrades: 20,
      }, options || {});
      this._snapshot = null;
      this._prevSnapshot = null;
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
      title.textContent = "L2 盘口";
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
      meta.append(spreadEl, imbalanceEl, seqEl);
      header.append(title, meta);

      // Orderbook
      const book = document.createElement("div");
      book.className = "l2-ob-book";

      // Asks column (卖五~卖一)
      const asksCol = document.createElement("div");
      asksCol.className = "l2-ob-col l2-ob-asks";
      const asksHeader = document.createElement("div");
      asksHeader.className = "l2-ob-col-header";
      asksHeader.innerHTML = "<span>卖价</span><span>委托量</span><span>委托笔数</span>";
      asksCol.appendChild(asksHeader);
      const askRows = [];
      for (let i = 4; i >= 0; i--) {
        const row = document.createElement("div");
        row.className = "l2-ob-row l2-ob-ask-row";
        row.dataset.level = String(i);
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
        row.append(priceEl, volEl, barEl, ordersEl);
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

      // Bids column (买一~买五)
      const bidsCol = document.createElement("div");
      bidsCol.className = "l2-ob-col l2-ob-bids";
      const bidsHeader = document.createElement("div");
      bidsHeader.className = "l2-ob-col-header";
      bidsHeader.innerHTML = "<span>买价</span><span>委托量</span><span>委托笔数</span>";
      bidsCol.appendChild(bidsHeader);
      const bidRows = [];
      for (let i = 0; i < 5; i++) {
        const row = document.createElement("div");
        row.className = "l2-ob-row l2-ob-bid-row";
        row.dataset.level = String(i);
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
        row.append(priceEl, volEl, barEl, ordersEl);
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

      root.append(header, book, summary);
      if (tradesSection) root.appendChild(tradesSection);
      if (capSection) root.appendChild(capSection);
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
      };
      this.container.appendChild(root);
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

      // Render asks (卖五~卖一, index 4 down to 0)
      const asks = snapshot.asks || [];
      for (let i = 0; i < 5; i++) {
        const level = 4 - i;
        const data = asks[level];
        const rowRef = r.askRows[i];
        if (data) {
          rowRef.priceEl.textContent = this._fmtPrice(data.price);
          rowRef.volEl.textContent = this._fmtVol(data.volume);
          rowRef.ordersEl.textContent = data.orders != null ? String(data.orders) : "—";
          const pct = Math.round((data.volume || 0) / maxVol * 100);
          rowRef.barInner.style.width = pct + "%";
          const prevAsk = this._prevSnapshot && this._prevSnapshot.asks ? this._prevSnapshot.asks[level] : null;
          if (prevAsk && prevAsk.volume > 0) {
            const change = (data.volume - prevAsk.volume) / prevAsk.volume;
            rowRef.row.classList.toggle("vol-up", change > 0.5);
            rowRef.row.classList.toggle("vol-down", change < -0.5);
          } else {
            rowRef.row.classList.remove("vol-up", "vol-down");
          }
          rowRef.row.classList.add("has-data");
        } else {
          rowRef.priceEl.textContent = "—";
          rowRef.volEl.textContent = "—";
          rowRef.ordersEl.textContent = "—";
          rowRef.barInner.style.width = "0%";
          rowRef.row.classList.remove("has-data", "vol-up", "vol-down");
        }
      }

      // Render bids (买一~买五, index 0 to 4)
      const bids = snapshot.bids || [];
      for (let i = 0; i < 5; i++) {
        const data = bids[i];
        const rowRef = r.bidRows[i];
        if (data) {
          rowRef.priceEl.textContent = this._fmtPrice(data.price);
          rowRef.volEl.textContent = this._fmtVol(data.volume);
          rowRef.ordersEl.textContent = data.orders != null ? String(data.orders) : "—";
          const pct = Math.round((data.volume || 0) / maxVol * 100);
          rowRef.barInner.style.width = pct + "%";
          const prevBid = this._prevSnapshot && this._prevSnapshot.bids ? this._prevSnapshot.bids[i] : null;
          if (prevBid && prevBid.volume > 0) {
            const change = (data.volume - prevBid.volume) / prevBid.volume;
            rowRef.row.classList.toggle("vol-up", change > 0.5);
            rowRef.row.classList.toggle("vol-down", change < -0.5);
          } else {
            rowRef.row.classList.remove("vol-up", "vol-down");
          }
          rowRef.row.classList.add("has-data");
        } else {
          rowRef.priceEl.textContent = "—";
          rowRef.volEl.textContent = "—";
          rowRef.ordersEl.textContent = "—";
          rowRef.barInner.style.width = "0%";
          rowRef.row.classList.remove("has-data", "vol-up", "vol-down");
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
      r.largeBuyEl.textContent = "大买 " + (metrics.large_buy_count || 0);
      r.largeSellEl.textContent = "大卖 " + (metrics.large_sell_count || 0);
      r.superBuyEl.textContent = "超买 " + (metrics.super_buy_count || 0);
      r.superSellEl.textContent = "超卖 " + (metrics.super_sell_count || 0);

      // Trade tape
      if (r.tradesList) {
        const trades = (snapshot.last_trades || []).slice(-this.options.maxTrades).reverse();
        r.tradesList.innerHTML = "";
        for (const t of trades) {
          const item = document.createElement("div");
          item.className = "l2-ob-trade " + (t.side === "B" ? "trade-buy" : t.side === "S" ? "trade-sell" : "");
          const isLarge = (t.volume || 0) >= 500;
          const isSuper = (t.volume || 0) >= 1000;
          if (isSuper) item.classList.add("trade-super");
          else if (isLarge) item.classList.add("trade-large");
          const time = document.createElement("span");
          time.className = "trade-time";
          time.textContent = this._fmtTime(t.at);
          const price = document.createElement("span");
          price.className = "trade-price";
          price.textContent = this._fmtPrice(t.price);
          const vol = document.createElement("span");
          vol.className = "trade-vol";
          vol.textContent = this._fmtVol(t.volume);
          const side = document.createElement("span");
          side.className = "trade-side";
          side.textContent = t.side === "B" ? "买" : t.side === "S" ? "卖" : "—";
          item.append(time, price, vol, side);
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

      // Footer
      r.tsEl.textContent = snapshot.timestamp ? this._fmtTime(snapshot.timestamp) : "—";
      r.srcEl.textContent = snapshot.source || "";
    }

    showError(msg) {
      if (this._el) {
        this._el.classList.add("l2-error");
        if (this._refs.tsEl) this._refs.tsEl.textContent = msg || "数据不可用";
      }
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
        pollInterval: 2000,
        autoConnect: true,
      }, options || {});

      this._orderbooks = new Map();
      this._containers = new Map();
      this._eventSource = null;
      this._pollTimer = null;
      this._connected = false;
      this._onStatusChange = (options && options.onStatusChange) || null;
      this._onAlert = (options && options.onAlert) || null;
    }

    _setStatus(connected, mode) {
      this._connected = connected;
      if (this._onStatusChange) {
        this._onStatusChange({ connected: connected, mode: mode });
      }
    }

    register(code, container, obOptions) {
      this._containers.set(code, container);
      if (!this._orderbooks.has(code)) {
        const ob = new L2Orderbook(container, code, obOptions);
        this._orderbooks.set(code, ob);
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

    start() {
      if (typeof EventSource !== "undefined") {
        try {
          const self = this;
          this._eventSource = new EventSource(this.options.ssePath);
          this._eventSource.onopen = function() {
            self._setStatus(true, "sse");
            self._stopPolling();
          };
          this._eventSource.onmessage = function(e) {
            try {
              const data = JSON.parse(e.data);
              if (data.type === "snapshot" || data.type === "update") {
                const snap = data.snapshot || data;
                self._dispatchSnapshot(snap);
              } else if (data.type === "alert") {
                if (self._onAlert) self._onAlert(data.alert);
              }
            } catch (err) { /* ignore malformed */ }
          };
          this._eventSource.onerror = function() {
            self._setStatus(false, "sse-error");
            self._eventSource.close();
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
      this._setStatus(true, "polling");
      const self = this;
      const tick = async function() {
        try {
          const resp = await fetch(self.options.pollPath, { cache: "no-store" });
          if (resp.ok) {
            const data = await resp.json();
            const snapshots = data.snapshots || data.stocks || [];
            for (const snap of snapshots) {
              self._dispatchSnapshot(snap);
            }
          }
        } catch (e) { /* retry next tick */ }
      };
      tick();
      this._pollTimer = setInterval(tick, this.options.pollInterval);
    }

    _stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    }

    _dispatchSnapshot(snapshot) {
      if (!snapshot || !snapshot.code) return;
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
      this._setStatus(false, "stopped");
    }

    isConnected() { return this._connected; }
  }

  // ---------------------------------------------------------------------------
  // L2AlertsPanel — displays L2 alert notifications
  // ---------------------------------------------------------------------------
  class L2AlertsPanel {
    constructor(container, options) {
      this.container = container;
      this.options = Object.assign({ maxAlerts: 50 }, options || {});
      this._alerts = [];
      this._el = null;
      this._listEl = null;
      this._build();
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
      this._alerts.unshift(alert);
      if (this._alerts.length > this.options.maxAlerts) {
        this._alerts.length = this.options.maxAlerts;
      }
      this._render();
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
        item.className = "l2-alert-item " + this._alertTone(alert.type || "");
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
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------
  window.L2Orderbook = L2Orderbook;
  window.L2Monitor = L2Monitor;
  window.L2AlertsPanel = L2AlertsPanel;
})();
