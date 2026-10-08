(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const fmt = value => number(value) === null ? '—' : new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 }).format(value);
  const pct = value => number(value) === null || value > 1 ? '—' : new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value * 100);
  const text = (id, value) => { const node = byId(id); if (node) node.textContent = String(value ?? '—'); };
  const sourceNames = { web: 'サイト・QR', app: 'アプリ', apple: 'App Store', google: 'Google Play' };
  const platformNames = { ios: 'iOS', android: 'Android', web: 'ブラウザー', unknown: '判別できないOS' };
  const unitNames = { downloads: 'ダウンロード', installs: 'インストール', views: '表示', clicks: 'クリック' };
  const state = { mode: 'real', controller: null, request: 0, report: null, realApps: [], realFilters: null, pendingImport: null, importing: false };

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = String(value);
    return element;
  }

  function svgNode(tag, attrs = {}, value) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, val]) => element.setAttribute(key, String(val)));
    if (value !== undefined) element.textContent = String(value);
    return element;
  }

  function timestamp(value) {
    if (!value) return '未取得';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '未取得';
    return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  function calendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return '—';
    return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
  }

  function getSource(report, id) {
    return (Array.isArray(report.sources) ? report.sources : []).find(item => item && item.id === id) || { id, status: 'no_data', lastReceivedAt: null };
  }

  function hasRecords(report, id) {
    return getSource(report, id).status === 'connected';
  }

  function metric(report, key, sourceId) {
    if (!hasRecords(report, sourceId)) return null;
    return number(report.totals?.[key]);
  }

  function empty(container, title, copy) {
    const host = node('div', 'empty-chart');
    host.append(node('span', 'empty-chart-mark'), node('strong', '', title), node('p', '', copy));
    host.firstChild.setAttribute('aria-hidden', 'true');
    container.replaceChildren(host);
  }

  function selection() {
    return { days: Number(byId('filter-days').value), app: byId('filter-app').value || 'all', platform: byId('filter-platform').value || 'all' };
  }

  function fillApps(apps) {
    const valid = (Array.isArray(apps) ? apps : []).filter(app => app && typeof app.id === 'string' && typeof app.name === 'string');
    const selectedFilter = byId('filter-app').value;
    const selectedImport = byId('import-app').value;
    byId('filter-app').replaceChildren(new Option('すべてのアプリ', 'all'));
    byId('import-app').replaceChildren(new Option('アプリを選択', ''));
    const importable = valid.filter(app => app.id !== 'brand');
    valid.forEach(app => {
      byId('filter-app').append(new Option(app.name, app.id));
      if (app.id !== 'brand') byId('import-app').append(new Option(app.name, app.id));
    });
    if (valid.some(app => app.id === selectedFilter)) byId('filter-app').value = selectedFilter;
    if (importable.some(app => app.id === selectedImport)) byId('import-app').value = selectedImport;
    if (importable.length === 1) byId('import-app').value = importable[0].id;
    byId('import-submit').disabled = state.mode === 'demo' || !importable.length;
    if (!importable.length) text('csv-preview', '登録済みアプリがありません。サーバーのアプリ設定後に取り込めます。');
  }

  async function requestJson(url, options = {}) {
    const response = await window.VIBAdminAPI.request(url, options);
    if (response.status === 401) {
      window.location.assign(window.VIBAdminAPI.loginPath);
      throw new Error('セッションが終了しました。ログインし直してください。');
    }
    let result;
    try { result = await response.json(); } catch { throw new Error('サーバーの応答を読み取れませんでした。接続先とサーバーの起動状態を確認してください。'); }
    if (!response.ok) {
      const message = typeof result?.error === 'string' ? result.error.slice(0, 220) : `データを取得できませんでした（HTTP ${response.status}）。`;
      throw new Error(message);
    }
    return result;
  }

  async function loadReport() {
    if (state.mode === 'demo') { renderReport(demoReport()); return; }
    const id = ++state.request;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    document.body.classList.add('is-loading');
    byId('refresh').disabled = true;
    byId('page-error').hidden = true;
    const filters = selection();
    const query = new URLSearchParams({ days: String(filters.days), app: filters.app, platform: filters.platform });
    try {
      const report = await requestJson(`/api/admin/report?${query}`, { signal: controller.signal });
      if (id !== state.request || state.mode !== 'real') return;
      state.report = report;
      state.realApps = Array.isArray(report.apps) ? report.apps : [];
      fillApps(state.realApps);
      renderReport(report);
    } catch (error) {
      if (id !== state.request || state.mode !== 'real') return;
      byId('page-error').hidden = false;
      byId('page-error').textContent = `${error.name === 'AbortError' ? '応答がありません。サーバーの起動・ネットワークを確認して、もう一度更新してください。' : error.message}${state.report ? ' 最後に取得した条件の結果を表示しています。今回選択した条件はまだ反映されていません。' : ' 未取得の数値は0件として表示しません。'}`;
      if (!state.report) {
        text('report-status-title', 'データを取得できていません');
        text('report-status-copy', 'ログイン状態と管理サーバーの接続を確認してください。');
        text('last-updated', '最終集計：未取得');
      }
    } finally {
      clearTimeout(timer);
      if (id === state.request) { document.body.classList.remove('is-loading'); byId('refresh').disabled = false; }
    }
  }

  function renderReport(report) {
    const isDemo = state.mode === 'demo';
    const days = number(report.filter?.days) ?? selection().days;
    const platform = platformNames[report.filter?.platform] || 'すべてのOS';
    const selectedApp = (report.apps || []).find(app => app.id === report.filter?.app)?.name || 'すべてのアプリ';
    const series = (Array.isArray(report.series) ? report.series : []).filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date)).slice(-366);
    const dateRange = series.length ? `${calendarDate(series[0].date)}–${calendarDate(series[series.length - 1].date)}` : `過去${days}日間`;
    text('period-label', `${dateRange} · ${selectedApp} · ${platform}`);
    text('last-updated', `${isDemo ? '表示確認用' : '最終集計'}：${timestamp(report.generatedAt)}（日本時間）`);
    const connected = ['web', 'app', 'apple', 'google'].filter(id => hasRecords(report, id));
    if (isDemo) {
      text('report-status-title', '表示確認用の架空データを表示中');
      text('report-status-copy', 'グラフの配置や条件変更を試せます。本番の実績ではありません。');
    } else if (!connected.length) {
      text('report-status-title', '本番データを待っています');
      text('report-status-copy', 'まだ記録が届いていません。未取得を0件として表示せず、接続後に実際の値を表示します。');
    } else {
      text('report-status-title', `${connected.length}つのデータ元に記録があります`);
      text('report-status-copy', '取得済みの集計を表示しています。データ元ごとの最終受信を下部で確認してください。');
    }
    const qr = metric(report, 'qrEntries', 'web');
    const detail = metric(report, 'detailViews', 'web');
    const actions = metric(report, 'storeActions', 'web');
    const first = metric(report, 'firstOpens', 'app');
    text('total-qr', fmt(qr)); text('entry-qr', fmt(qr));
    text('total-store', fmt(actions)); text('entry-detail', fmt(detail)); text('entry-visits', fmt(metric(report, 'siteVisits', 'web')));
    text('total-first', fmt(first));
    text('total-qr-state', qr === null ? '未取得' : isDemo ? '架空のアクセス件数' : '取得済み · アクセス件数');
    text('total-store-state', actions === null ? '未取得' : isDemo ? '架空の行動回数' : '取得済み · 行動回数');
    text('total-first-state', first === null ? '未取得' : isDemo ? '架空の対象数' : '取得済み · 匿名識別子単位');
    renderEntryChart(series, hasRecords(report, 'web'));
    renderChannels(report);
    renderCohort(report);
    renderPlatforms(report);
    renderFeedback(report);
    renderStores(report);
    renderSources(report);
  }

  function renderEntryChart(series, connected) {
    const host = byId('entry-chart');
    const definitions = [
      { key: 'qrEntries', label: 'QRアクセス', color: '#667d5f' },
      { key: 'detailViews', label: '詳細表示', color: '#7896aa' },
      { key: 'storeActions', label: 'ストアへ進む行動', color: '#b49a6e' }
    ];
    const values = series.flatMap(row => definitions.map(item => number(row[item.key]))).filter(value => value !== null);
    if (!connected || !values.length) {
      empty(host, connected ? 'この期間の記録は未取得です' : 'サイト・QRの記録を待っています', '未取得の日は、0件の線として描きません。');
      return;
    }
    const width = Math.max(260, host.clientWidth), height = Math.max(180, host.clientHeight), left = 40, right = 16, top = 14, bottom = 32;
    const usableWidth = width - left - right, usableHeight = height - top - bottom;
    const max = Math.max(...values, 1);
    const magnitude = 10 ** Math.floor(Math.log10(max));
    const ceiling = Math.max(1, Math.ceil(max / magnitude) * magnitude);
    const x = index => series.length === 1 ? left + usableWidth / 2 : left + index * usableWidth / (series.length - 1);
    const y = value => top + usableHeight * (1 - value / ceiling);
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': 'entry-chart-title entry-chart-description', preserveAspectRatio: 'none' });
    svg.append(svgNode('title', { id: 'entry-chart-title' }, 'サイト・QRの記録の日別推移'));
    svg.append(svgNode('desc', { id: 'entry-chart-description' }, `${series.length}日分。緑はQRアクセス、青は詳細表示、茶はストアへ進む行動。未取得は線の切れ目として表示します。${state.mode === 'demo' ? '表示確認用の架空データです。' : ''}`));
    for (let i = 0; i <= 4; i++) {
      const value = ceiling * i / 4;
      const at = y(value);
      svg.append(svgNode('line', { x1: left, x2: width - right, y1: at, y2: at, stroke: '#e8ebe1', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
      svg.append(svgNode('text', { x: left - 10, y: at + 4, 'text-anchor': 'end', fill: '#858a80', 'font-size': 10 }, Number.isInteger(value) ? fmt(value) : value.toFixed(1)));
    }
    const count = Math.min(series.length, window.innerWidth < 580 ? 4 : 7);
    const indexes = [...new Set(Array.from({ length: count }, (_, i) => count === 1 ? 0 : Math.round(i * (series.length - 1) / (count - 1))))];
    indexes.forEach(index => svg.append(svgNode('text', { x: x(index), y: height - 8, 'text-anchor': 'middle', fill: '#858a80', 'font-size': 10 }, calendarDate(series[index].date))));
    definitions.forEach(definition => {
      let path = '', connectedPrevious = false;
      series.forEach((row, index) => {
        const value = number(row[definition.key]);
        if (value === null) { connectedPrevious = false; return; }
        path += `${connectedPrevious ? 'L' : 'M'}${x(index).toFixed(2)},${y(value).toFixed(2)} `;
        connectedPrevious = true;
      });
      if (path) svg.append(svgNode('path', { d: path, fill: 'none', stroke: definition.color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
      series.forEach((row, index) => {
        const value = number(row[definition.key]);
        if (value === null) return;
        const marker = svgNode('circle', { cx: x(index), cy: y(value), r: series.length <= 14 ? 3 : 2, fill: definition.color });
        marker.append(svgNode('title', {}, `${row.date} ${definition.label}：${fmt(value)}${definition.key === 'storeActions' ? '回' : '件'}`));
        svg.append(marker);
      });
    });
    host.replaceChildren(svg);
  }

  function renderCohort(report) {
    const connected = hasRecords(report, 'app');
    const cohort = report.cohort || {};
    const windowDays = number(cohort.windowDays) || 7;
    const matured = connected ? number(cohort.matured) : null;
    const completed = connected ? number(cohort.completed) : null;
    const pending = connected ? number(cohort.pending) : null;
    const candidate = number(cohort.rate);
    const rate = connected && matured > 0 && candidate !== null && candidate <= 1 ? candidate : null;
    text('total-rate', pct(rate));
    text('cohort-completed', fmt(completed)); text('cohort-matured', fmt(matured)); text('cohort-pending', fmt(pending));
    const rateValue = byId('cohort-rate');
    rateValue.replaceChildren(document.createTextNode(pct(rate)), node('small', '', '%'));
    byId('cohort-ring').style.background = `conic-gradient(#667d5f ${rate === null ? 0 : rate * 360}deg, #e9ede2 0deg)`;
    byId('cohort-ring').setAttribute('aria-label', rate === null ? '価値達成率は未算出' : `${state.mode === 'demo' ? '架空データ。' : ''}価値達成率${pct(rate)}パーセント。観測済み${fmt(matured)}件のうち${fmt(completed)}件が達成。`);
    text('cohort-description', `初回起動から${windowDays}日間を観測した同じ対象群で確認します。`);
    text('total-rate-help', matured > 0 ? `達成 ${fmt(completed)}件 / 観測済み ${fmt(matured)}件` : `${windowDays}日間の観測が終わった初回起動が対象です。`);
    text('total-rate-state', !connected ? '未取得' : !matured ? '分母なし · まだ算出できません' : state.mode === 'demo' ? '表示確認用の架空の比率' : '同じ対象群で算出');
    text('cohort-note', !connected ? 'アプリ側の接続後に表示します。観測中の対象は達成率の分母に含めません。' : !matured ? `まだ${windowDays}日間の観測が完了した対象がないため、率を0%として表示しません。` : `分母：${windowDays}日間の観測が完了した初回起動 ${fmt(matured)}件。分子：その期間内に価値を達成した ${fmt(completed)}件。観測中 ${fmt(pending)}件は分母から除外。`);
    text('event-first', fmt(metric(report, 'firstOpens', 'app')));
    text('event-start', fmt(metric(report, 'coreStarts', 'app')));
    text('event-complete', fmt(metric(report, 'coreCompletions', 'app')));
    text('event-repeat', fmt(metric(report, 'repeatCompletions', 'app')));
    const selectedApp = (report.apps || []).find(app => app.id === report.filter?.app);
    text('event-repeat-label', selectedApp?.id === 'tripmap' || selectedApp?.id === 'display-check' ? '別の旅行で再達成' : '別の計画で再達成');
    document.querySelectorAll('.tiny-tag').forEach(element => { element.textContent = `${windowDays}日観測`; });
  }

  function renderChannels(report) {
    const host = byId('channel-chart');
    const entries = Array.isArray(report.entries) ? report.entries : [];
    if (!hasRecords(report, 'web') || !entries.some(item => number(item?.storeActions) !== null)) {
      empty(host, '入口別の記録を待っています', '流入元が不明な記録も、接続後に表示します。'); return;
    }
    const definitions = [
      { channel: 'card', name: '名刺QR', color: 'green' },
      { channel: 'site', name: 'サイト', color: '' },
      { channel: 'organic', name: 'その他の流入', color: 'ochre' },
      { channel: 'unknown', name: '流入元が不明', color: 'neutral' }
    ];
    const max = Math.max(1, ...entries.map(item => number(item?.storeActions) ?? 0));
    const fragment = document.createDocumentFragment();
    definitions.forEach(definition => {
      const value = number(entries.find(item => item?.channel === definition.channel)?.storeActions);
      const row = node('div', 'channel-row');
      row.append(node('span', 'channel-label', definition.name));
      const track = node('div', 'bar-track'), fill = node('div', `bar-fill ${definition.color}`);
      fill.style.width = `${value === null ? 0 : value / max * 100}%`;
      track.append(fill); track.setAttribute('aria-hidden', 'true');
      const count = node('span', 'channel-value'); count.append(document.createTextNode(fmt(value)), node('small', '', value === null ? '未取得' : '回'));
      row.append(track, count); row.setAttribute('aria-label', `${definition.name}：${value === null ? '未取得' : `${fmt(value)}回`}`);
      fragment.append(row);
    });
    host.replaceChildren(fragment);
  }

  function barRow(value, max, color, label) {
    const row = node('div', 'horizontal-bar-row');
    const track = node('div', 'bar-track');
    const bar = node('div', `bar-fill ${color || ''}`);
    bar.style.width = `${value === null ? 0 : Math.min(100, max > 0 ? value / max * 100 : 0)}%`;
    track.append(bar);
    track.setAttribute('aria-hidden', 'true');
    const valueElement = node('span', 'bar-value', fmt(value));
    valueElement.setAttribute('aria-label', `${label}：${fmt(value)}件`);
    row.append(track, valueElement);
    return row;
  }

  function renderPlatforms(report) {
    const host = byId('platform-chart');
    const platforms = (Array.isArray(report.platforms) ? report.platforms : []).filter(item => item && typeof item.platform === 'string');
    if (!hasRecords(report, 'app') || !platforms.some(item => number(item.firstOpens) !== null || number(item.coreCompletions) !== null)) {
      empty(host, 'アプリの記録を待っています', 'OS別の件数は未取得です。'); return;
    }
    const max = Math.max(1, ...platforms.flatMap(item => [number(item.firstOpens) ?? 0, number(item.coreCompletions) ?? 0]));
    const fragment = document.createDocumentFragment();
    platforms.forEach(item => {
      const group = node('div', 'platform-group');
      const title = node('div', 'platform-name');
      title.append(node('span', '', platformNames[item.platform] || '判別できないOS'), node('small', '', '匿名識別子の件数'));
      group.append(title, barRow(number(item.firstOpens), max, '', '初回起動'), barRow(number(item.coreCompletions), max, 'green', '中心操作の完了'));
      fragment.append(group);
    });
    host.replaceChildren(fragment);
  }

  function renderFeedback(report) {
    const feedback = report.feedback || {};
    const connected = hasRecords(report, 'app');
    const responses = connected ? number(feedback.responses) : null;
    const prompts = connected ? number(feedback.prompts) : null;
    for (const [id, value, unit] of [['feedback-responses', responses, '件'], ['feedback-prompts', prompts, '回']]) {
      byId(id).replaceChildren(document.createTextNode(fmt(value)), node('small', '', unit));
    }
    const host = byId('feedback-chart');
    const counts = Array.isArray(feedback.counts) && feedback.counts.length === 5 ? feedback.counts.map(number) : [];
    if (!connected || !counts.length || responses === null) { empty(host, '評価の記録を待っています', '未取得を「低評価」として扱いません。'); return; }
    if (responses === 0) { empty(host, 'この期間の回答は0件です', '回答がない状態は、低い満足度を意味しません。'); return; }
    const max = Math.max(1, ...counts.map(value => value ?? 0));
    const fragment = document.createDocumentFragment();
    for (let score = 5; score >= 1; score--) {
      const row = node('div', 'feedback-row');
      const label = node('span'); label.append(node('i', '', '★'), document.createTextNode(String(score)));
      const track = node('div', 'bar-track'); const fill = node('div', 'bar-fill');
      fill.style.width = `${counts[score - 1] === null ? 0 : counts[score - 1] / max * 100}%`;
      track.append(fill); track.setAttribute('aria-hidden', 'true');
      const value = node('span', 'bar-value', fmt(counts[score - 1]));
      row.append(label, track, value); row.setAttribute('aria-label', `評価${score}：${fmt(counts[score - 1])}件`);
      fragment.append(row);
    }
    host.replaceChildren(fragment);
  }

  function renderStores(report) {
    const host = byId('store-metrics');
    const metrics = (Array.isArray(report.storeMetrics) ? report.storeMetrics : []).filter(item => item && number(item.value) !== null);
    if (!metrics.length) { empty(host, 'ストアの統計は未取得です', '元の指標名と期間を確認して取り込んでください。'); return; }
    const table = node('table', 'store-table');
    const caption = node('caption', 'sr-only', '選択期間内のストア統計。ストアごとの元の指標と単位。');
    const head = node('thead'), headRow = node('tr');
    ['元の指標 / データ元', '集計値', '最終対象日'].forEach(value => { const cell = node('th', '', value); cell.scope = 'col'; headRow.append(cell); });
    head.append(headRow); table.append(caption, head);
    const body = node('tbody');
    metrics.forEach(item => {
      const row = node('tr'), metricCell = node('td'), valueCell = node('td'), dateCell = node('td', '', typeof item.lastDate === 'string' ? item.lastDate : '—');
      metricCell.append(document.createTextNode(String(item.metric ?? '指標名なし')), node('span', '', sourceNames[item.source] || 'ストア'));
      valueCell.append(document.createTextNode(fmt(item.value)), node('small', '', unitNames[item.unit] || String(item.unit ?? '件')));
      row.append(metricCell, valueCell, dateCell); body.append(row);
    });
    table.append(body); host.replaceChildren(table);
  }

  function renderSources(report) {
    const explanations = {
      web: 'QRの共通URL・サイトのイベント受信',
      app: 'アプリからの初回起動・中心操作・任意評価',
      apple: 'App Store Connectの統計を手動取り込み',
      google: 'Play Consoleの統計を手動取り込み'
    };
    const grid = byId('source-grid'), fragment = document.createDocumentFragment();
    let total = 0;
    ['web', 'app', 'apple', 'google'].forEach(id => {
      const source = getSource(report, id);
      const connected = source.status === 'connected';
      if (connected) total++;
      const card = node('article', 'source-card');
      const top = node('div', 'source-card-top');
      top.append(node('h3', '', sourceNames[id]), node('span', `source-status${connected ? ' is-connected' : ''}`, state.mode === 'demo' ? '架空の記録' : connected ? '記録あり' : '未取得'));
      const line = node('p', '', connected ? '最終受信' : '最終受信：未取得');
      card.append(top, line);
      if (source.lastReceivedAt) {
        const time = node('time', '', `${timestamp(source.lastReceivedAt)}（日本時間）`);
        if (Number.isFinite(new Date(source.lastReceivedAt).getTime())) time.dateTime = source.lastReceivedAt;
        card.append(time);
      }
      card.append(node('p', 'source-help', explanations[id])); fragment.append(card);
    });
    grid.replaceChildren(fragment);
    text('source-summary', state.mode === 'demo' ? '表示確認用' : `${total} / 4 データ元に記録あり`);
    const notes = (Array.isArray(report.notes) ? report.notes : []).filter(item => typeof item === 'string').slice(0, 20);
    byId('report-notes').hidden = !notes.length;
    if (notes.length) { const list = node('ul'); notes.forEach(note => list.append(node('li', '', note))); byId('report-notes').replaceChildren(list); }
    const errors = report.diagnostics?.errors;
    byId('diagnostics').hidden = true;
    if (Array.isArray(errors) && errors.length) {
      const fragments = errors.slice(0, 10).map(error => node('p', '', typeof error === 'string' ? error : `記録エラー：${String(error?.errorCode || error?.type || error?.code || '種別不明')}${number(error?.count) !== null ? ` ${fmt(error.count)}件` : ''}`));
      byId('diagnostics').replaceChildren(node('strong', '', '確認が必要な記録'), ...fragments); byId('diagnostics').hidden = false;
    } else if (number(errors) > 0) {
      const details = (Array.isArray(report.diagnostics?.errorCodes) ? report.diagnostics.errorCodes : []).slice(0, 10).map(error => node('p', '', `${String(error.errorCode ?? '種別不明')}：${fmt(error.count)}件`));
      byId('diagnostics').replaceChildren(node('p', '', `選択期間のエラー記録：${fmt(errors)}件。アプリや計測の状態を確認してください。`), ...details); byId('diagnostics').hidden = false;
    }
  }

  function parseCsv(input, source) {
    if (typeof input !== 'string' || !input.trim()) throw new Error('CSVを貼り付けるか、ファイルを選んでください。');
    if (new TextEncoder().encode(input).length > 1024 * 1024) throw new Error('CSVは1MB以内にしてください。');
    const rows = [], row = []; let value = '', quoted = false, closedQuote = false;
    const data = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i <= data.length; i++) {
      const char = i === data.length ? '\n' : data[i];
      if (char === '"') {
        if (quoted && data[i + 1] === '"') { value += '"'; i++; }
        else if (quoted) { quoted = false; closedQuote = true; }
        else if (!value && !closedQuote) quoted = true;
        else throw new Error('CSVの引用符が正しくありません。');
      } else if ((char === ',' || char === '\n') && !quoted) {
        row.push(value.trim()); value = ''; closedQuote = false;
        if (char === '\n') { if (row.some(cell => cell !== '')) rows.push([...row]); row.length = 0; }
      } else { if (closedQuote && char.trim()) throw new Error('CSVの引用符の後に不要な文字があります。'); value += char; }
      if (rows.length > 1001) throw new Error('一度に取り込めるのは1,000行までです。');
    }
    if (quoted) throw new Error('CSVの引用符が閉じられていません。');
    if (rows[0]?.map(item => item.toLowerCase()).join(',') !== 'date,platform,value') throw new Error('先頭行は date,platform,value の3列にしてください。ストアの公式CSVをそのまま読む機能ではありません。');
    if (rows.length < 2) throw new Error('ヘッダーの下に1行以上のデータを追加してください。');
    const expectedPlatform = source === 'apple' ? 'ios' : 'android';
    const keys = new Set();
    return rows.slice(1).map((columns, index) => {
      const line = index + 2;
      if (columns.length !== 3) throw new Error(`${line}行目：3列にそろえてください。`);
      const [date, platform, raw] = columns;
      const parsedDate = new Date(`${date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || date < '2000-01-01' || date > new Date().toISOString().slice(0, 10)) throw new Error(`${line}行目：日付は2000年以降、今日までの実在する YYYY-MM-DD で入力してください。`);
      if (platform !== expectedPlatform) throw new Error(`${line}行目：${source === 'apple' ? 'Apple' : 'Google'}のOSは ${expectedPlatform} にしてください。`);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`${line}行目：valueは0以上の整数にしてください。`);
      const key = `${date}/${platform}`;
      if (keys.has(key)) throw new Error(`${line}行目：同じ日付・OSの行が重複しています。先に一つにまとめてください。`);
      keys.add(key);
      return { date, platform, value: Number(raw) };
    });
  }

  function importResult(message, error = false) {
    const result = byId('import-result');
    result.textContent = message; result.hidden = false;
    result.className = `notice${error ? ' notice-error' : ''}`;
  }

  function resetConfirmation() {
    state.pendingImport = null;
    byId('import-confirmation').hidden = true;
    byId('import-confirm').disabled = state.mode === 'demo';
  }

  function previewCsv() {
    resetConfirmation(); byId('import-result').hidden = true;
    if (state.mode === 'demo') { text('csv-preview', '表示確認中は取り込めません。本番の記録に戻ってください。'); return; }
    if (!byId('import-csv').value.trim()) { text('csv-preview', 'データを入力すると対象期間と件数を表示します。'); return; }
    try {
      const rows = parseCsv(byId('import-csv').value, byId('import-source').value);
      const dates = rows.map(row => row.date).sort();
      text('csv-preview', `${fmt(rows.length)}行 · ${dates[0]} ～ ${dates[dates.length - 1]} · 合計 ${fmt(rows.reduce((sum, row) => sum + row.value, 0))}`);
    } catch (error) { text('csv-preview', error.message); }
  }

  function demoReport() {
    const filters = selection();
    const now = new Date();
    const series = Array.from({ length: filters.days }, (_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - filters.days + index + 1));
      const qrEntries = Math.round(15 + index * .7 + Math.sin(index * .8) * 8 + (index % 7 === 4 ? 13 : 0));
      const detailViews = Math.round(31 + index * 1.15 + Math.cos(index * .55) * 14);
      const storeActions = Math.round(qrEntries * .65 + detailViews * .22);
      return { date: date.toISOString().slice(0, 10), siteVisits: Math.round(detailViews * 1.7), qrEntries, detailViews, storeActions, firstOpens: Math.round(storeActions * .6), coreCompletions: Math.round(storeActions * .36) };
    });
    const sum = key => series.reduce((total, item) => total + item[key], 0);
    const firstOpens = sum('firstOpens');
    const matured = Math.max(0, firstOpens - series.slice(-7).reduce((total, item) => total + item.firstOpens, 0));
    const completed = Math.round(matured * .62);
    const app = { id: 'display-check', name: 'TripMap（表示確認用）' };
    return {
      generatedAt: now.toISOString(), filter: { ...filters, app: 'display-check', release: 'production' }, apps: [app],
      sources: ['web', 'app', 'apple', 'google'].map(id => ({ id, status: 'connected', lastReceivedAt: now.toISOString() })),
      totals: { siteVisits: sum('siteVisits'), qrEntries: sum('qrEntries'), detailViews: sum('detailViews'), storeActions: sum('storeActions'), firstOpens, coreStarts: Math.round(firstOpens * .8), coreCompletions: sum('coreCompletions'), repeatCompletions: Math.round(firstOpens * .12), activationRate: matured ? completed / matured : null, activationDenominator: matured, activationNumerator: completed },
      entries: ['card', 'site', 'organic', 'unknown'].map((channel, index) => ({ channel, qrEntries: channel === 'card' ? sum('qrEntries') : 0, detailViews: channel === 'site' ? sum('detailViews') : 0, storeActions: index === 3 ? sum('storeActions') - Math.round(sum('storeActions') * .58) - Math.round(sum('storeActions') * .34) - Math.round(sum('storeActions') * .06) : Math.round(sum('storeActions') * [.58, .34, .06][index]) })),
      series, platforms: (filters.platform === 'all' ? ['ios', 'android', 'unknown'] : [filters.platform]).map((platform, index) => ({ platform, firstOpens: Math.round(firstOpens * (index === 0 ? .62 : index === 1 ? .34 : .04)), coreCompletions: Math.round(firstOpens * (index === 0 ? .38 : index === 1 ? .22 : .02)) })),
      feedback: { counts: [1, 2, 6, 19, 28], responses: 56, prompts: 184 },
      storeMetrics: [{ source: 'apple', metric: '表示確認用のダウンロード', unit: 'downloads', value: Math.round(firstOpens * .68), lastDate: series[series.length - 1].date }, { source: 'google', metric: '表示確認用のインストール', unit: 'installs', value: Math.round(firstOpens * .38), lastDate: series[series.length - 1].date }],
      notes: ['この画面の数値は、配置を確認するために作った架空の記録です。アプリの実績・目標値・推奨転換率ではありません。'], diagnostics: { errors: 0 }, cohort: { windowDays: 7, matured, completed, pending: firstOpens - matured, rate: matured ? completed / matured : null }
    };
  }

  async function toggleDemo(forceReal = false) {
    if (state.importing) return;
    const entering = !forceReal && state.mode === 'real';
    state.controller?.abort(); ++state.request;
    document.body.classList.remove('is-loading'); byId('refresh').disabled = false;
    byId('page-error').hidden = true; resetConfirmation();
    if (entering) { state.realFilters = selection(); state.mode = 'demo'; }
    else state.mode = 'real';
    const demo = state.mode === 'demo';
    byId('demo-banner').hidden = !demo;
    text('demo-toggle', demo ? '本番の記録に戻る ↗' : '表示を試す ↗');
    document.querySelector('.environment-label').lastChild.textContent = demo ? '表示確認用' : '本番の記録のみ';
    byId('import-form').querySelectorAll('input,select,textarea,button').forEach(element => { element.disabled = demo; });
    if (demo) {
      fillApps([{ id: 'display-check', name: 'TripMap（表示確認用）' }]);
      byId('filter-app').value = 'display-check';
      text('csv-preview', '表示確認中は取り込めません。本番の記録に戻ってください。');
      renderReport(demoReport());
    } else {
      fillApps(state.realApps);
      if (state.realFilters) {
        byId('filter-app').value = state.realFilters.app;
        byId('filter-days').value = String(state.realFilters.days);
        byId('filter-platform').value = state.realFilters.platform;
      }
      previewCsv(); await loadReport();
    }
  }

  byId('filters').addEventListener('submit', event => { event.preventDefault(); loadReport(); });
  byId('refresh').addEventListener('click', loadReport);
  byId('demo-toggle').addEventListener('click', () => toggleDemo());
  byId('demo-return').addEventListener('click', () => toggleDemo(true));
  byId('logout').addEventListener('click', async () => {
    byId('logout').disabled = true;
    try {
      const response = await window.VIBAdminAPI.request('/api/admin/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (response.ok || response.status === 401) { window.VIBAdminAPI.clear(); window.location.assign(window.VIBAdminAPI.loginPath); }
      else throw new Error('ログアウトできませんでした。もう一度お試しください。');
    } catch (error) { byId('page-error').hidden = false; byId('page-error').textContent = error.message; byId('logout').disabled = false; }
  });
  byId('import-csv').addEventListener('input', previewCsv);
  ['import-source', 'import-app', 'import-metric', 'import-unit'].forEach(id => byId(id).addEventListener('change', previewCsv));
  byId('import-file').addEventListener('change', async () => {
    if (state.mode !== 'real') return;
    const file = byId('import-file').files[0]; if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('ファイルは1MB以内にしてください。');
      const contents = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (state.mode !== 'real') return;
      byId('import-csv').value = contents; text('import-file-name', file.name); previewCsv();
    } catch (error) { importResult(error instanceof TypeError ? 'UTF-8のCSVを選択してください。' : error.message, true); }
  });
  byId('import-form').addEventListener('submit', event => {
    event.preventDefault(); if (state.mode !== 'real' || state.importing) return;
    try {
      const source = byId('import-source').value, appId = byId('import-app').value, metricName = byId('import-metric').value.trim(), unit = byId('import-unit').value;
      if (!appId) throw new Error('アプリを選択してください。');
      if (!metricName || Array.from(metricName).length > 100 || /[\p{Cc}\p{Cf}]/u.test(metricName)) throw new Error('ストアの元の指標名を100文字以内、制御文字を含めずに入力してください。');
      const rows = parseCsv(byId('import-csv').value, source);
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      if (!Number.isSafeInteger(total)) throw new Error('合計値が大きすぎます。対象期間を分けて取り込んでください。');
      state.pendingImport = { source, appId, metric: metricName, unit, rows };
      const dates = rows.map(row => row.date).sort();
      text('import-confirm-copy', `${sourceNames[source]} / ${byId('import-app').selectedOptions[0].text}\n${metricName}：${unitNames[unit]} 合計 ${fmt(total)}\n${dates[0]} ～ ${dates[dates.length - 1]} / ${fmt(rows.length)}行\n同じ指標・日付・OSの値は、この内容で置き換わります。`);
      byId('import-confirmation').hidden = false; byId('import-result').hidden = true; byId('import-confirm').focus();
    } catch (error) { resetConfirmation(); importResult(error.message, true); }
  });
  byId('import-cancel').addEventListener('click', () => { resetConfirmation(); byId('import-submit').focus(); });
  byId('import-confirm').addEventListener('click', async () => {
    if (state.mode !== 'real' || !state.pendingImport || state.importing) return;
    state.importing = true; byId('import-confirm').disabled = true; byId('import-submit').disabled = true;
    byId('demo-toggle').disabled = true; byId('demo-return').disabled = true;
    try {
      const payload = state.pendingImport;
      await requestJson('/api/admin/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      resetConfirmation(); importResult(`${fmt(payload.rows.length)}行を保存しました。集計を更新しています。`); await loadReport();
    } catch (error) { importResult(error.message, true); }
    finally {
      state.importing = false; byId('import-confirm').disabled = false; byId('import-submit').disabled = !state.realApps.some(app => app.id !== 'brand');
      byId('demo-toggle').disabled = false; byId('demo-return').disabled = false;
    }
  });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const report = state.mode === 'demo' ? demoReport() : state.report;
      if (report) renderEntryChart(Array.isArray(report.series) ? report.series : [], hasRecords(report, 'web'));
    }, 160);
  });
  loadReport();
})();
