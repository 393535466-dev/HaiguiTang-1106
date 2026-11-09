/* Explicit browser-only WeChat subset. Loads the actual mini-program controllers. */
(function () {
  'use strict';
  const files = window.__miniFiles;
  const screen = document.querySelector('#mini-screen');
  const appRoot = document.querySelector('#app');
  const overlays = document.querySelector('#preview-overlays');
  const unconfigured = new URLSearchParams(location.search).get('mode') === 'unconfigured';
  const remote = !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const isolatedTab = new URLSearchParams(location.search).get('guest') === '1';
  const guest = remote || isolatedTab;
  const identityStore = isolatedTab ? sessionStorage : localStorage;
  let guestIdentity;
  window.previewHeaders = async () => {
    if (!guest) return {};
    if (!guestIdentity) guestIdentity = (async () => {
      let token = identityStore.getItem('hgt-preview-player');
      if (!token) {
        const response = await fetch('/preview-player', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!response.ok) throw new Error('无法准备玩家身份，请从完整测试链接重新进入');
        token = (await response.json()).token; identityStore.setItem('hgt-preview-player', token);
      }
      return { 'X-Preview-Player': token };
    })().catch(error => { guestIdentity = null; throw error; });
    return guestIdentity;
  };
  const localStore = guest ? identityStore : localStorage;
  const modules = {}, definitions = {}, pages = [];
  let app, currentModule = '', scheduled = false, renderSequence = 0, toastTimer, composition = null, gesture = null;
  const domTemplates = {};
  const baseStyles = files['/app.wxss'].source;
  const style = document.createElement('style'); document.head.append(style);

  function pathResolve(name, parent) {
    const parts = (name[0] === '/' ? name : parent.slice(0, parent.lastIndexOf('/') + 1) + name).split('/');
    const result = [];
    for (const part of parts) { if (part === '..') result.pop(); else if (part && part !== '.') result.push(part); }
    let resolved = '/' + result.join('/');
    if (!resolved.endsWith('.js')) resolved += '.js';
    return resolved;
  }
  function requireMini(name, parent = '/app.js') {
    const id = pathResolve(name, parent);
    if (id === '/config.local.js') return { cloudEnv: unconfigured ? '' : 'LOCAL_PREVIEW_ONLY', functionName: 'game' };
    if (modules[id]) return modules[id].exports;
    if (!files[id] || files[id].kind !== 'js') throw new Error('Preview module not found: ' + id);
    const module = { exports: {} }; modules[id] = module;
    const previous = currentModule; currentModule = id;
    try { new Function('require', 'module', 'exports', files[id].source + '\n//# sourceURL=mini' + id)(name => requireMini(name, id), module, module.exports); }
    finally { currentModule = previous; }
    return module.exports;
  }
  window.App = definition => { app = definition; };
  window.Page = definition => { definitions[currentModule] = definition; };
  window.getApp = () => app;
  window.getCurrentPages = () => pages;
  const topPage = () => pages[pages.length - 1];
  const complete = (options, value) => { if (options && options.success) options.success(value || {}); if (options && options.complete) options.complete(value || {}); };

  function toast(options) {
    clearTimeout(toastTimer); const old = overlays.querySelector('.preview-toast'); if (old) old.remove();
    const node = document.createElement('div'); node.className = 'preview-toast'; node.textContent = options.title || ''; overlays.append(node);
    toastTimer = setTimeout(() => node.remove(), options.duration || 2500);
  }
  function modal(options) {
    const backdrop = document.createElement('div'); backdrop.className = 'preview-modal-backdrop';
    const dialog = document.createElement('section'); dialog.className = 'preview-modal';
    const heading = document.createElement('h2'); heading.textContent = options.title || '提示';
    const copy = document.createElement('p'); copy.textContent = options.content || '';
    const actions = document.createElement('div'); actions.className = 'preview-modal-actions';
    const close = confirm => { backdrop.remove(); complete(options, { confirm, cancel: !confirm }); };
    if (options.showCancel !== false) { const cancel = document.createElement('button'); cancel.className = 'cancel'; cancel.textContent = options.cancelText || '取消'; cancel.onclick = () => close(false); actions.append(cancel); }
    const agree = document.createElement('button'); agree.textContent = options.confirmText || '确定'; agree.onclick = () => close(true); actions.append(agree);
    dialog.append(heading, copy, actions); backdrop.append(dialog); overlays.append(backdrop);
  }
  function actionSheet(options) {
    const backdrop = document.createElement('div'); backdrop.className = 'preview-modal-backdrop';
    const dialog = document.createElement('section'); dialog.className = 'preview-modal preview-actions';
    (options.itemList || []).forEach((text, tapIndex) => { const button = document.createElement('button'); button.textContent = text; button.onclick = () => { backdrop.remove(); complete(options, { tapIndex }); }; dialog.append(button); });
    const cancel = document.createElement('button'); cancel.className = 'cancel'; cancel.textContent = '取消'; cancel.onclick = () => backdrop.remove(); dialog.append(cancel);
    backdrop.append(dialog); overlays.append(backdrop);
  }
  function navigate(options, type) {
    const target = new URL(options.url || '/pages/home/index', location.origin);
    const route = target.pathname.replace(/^\//, '');
    const file = '/' + route + '.js';
    if (!files[file]) { toast({ title: '预览不支持此页面' }); return; }
    const previous = topPage();
    if (previous) {
      if (type === 'redirect') { if (previous.onUnload) previous.onUnload(); pages.pop(); }
      else if (previous.onHide) previous.onHide();
    }
    requireMini(file);
    const definition = definitions[file];
    const page = Object.assign({}, definition, { route, data: structuredClone(definition.data || {}), _previewFile: file, _previewURL: '/' + route + target.search });
    page.setData = function (patch, callback) { Object.assign(this.data, patch); if (this === topPage()) scheduleRender(); if (callback) queueMicrotask(callback); };
    pages.push(page);
    location.hash = '/' + route + target.search;
    if (page.onLoad) page.onLoad(Object.fromEntries(target.searchParams));
    if (page.onShow) page.onShow();
    render(); complete(options);
  }
  window.wx = {
    cloud: {
      init() {},
      async callFunction(options) {
        const response = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...await window.previewHeaders() }, body: JSON.stringify(options.data) });
        if (response.status === 401) { identityStore.removeItem('hgt-preview-player'); guestIdentity = null; throw new Error('玩家身份已过期，请刷新页面重新进入。'); }
        if (!response.ok) throw new Error('试玩服务没有接通，请从完整测试链接重新进入');
        return { result: await response.json() };
      },
      async uploadFile() { throw new Error('浏览器预览不提供录音上传，请在微信真机验证。'); }
    },
    getStorageSync(key) { try { return JSON.parse(localStore.getItem(key)); } catch (_) { return null; } },
    getStorageInfoSync() { return { keys: Object.keys(localStore) }; },
    setStorageSync(key, value) { localStore.setItem(key, JSON.stringify(value)); },
    removeStorageSync(key) { localStore.removeItem(key); },
    setClipboardData(options) { navigator.clipboard.writeText(options.data).then(() => complete(options), () => modal({ title: '房间号', content: options.data, showCancel: false })); },
    navigateTo(options) { navigate(options, 'push'); },
    redirectTo(options) { navigate(options, 'redirect'); },
    navigateBack(options = {}) {
      if (pages.length <= 1) return navigate({ url: '/pages/home/index' }, 'redirect');
      const count = Math.min(options.delta || 1, pages.length - 1);
      for (let index = 0; index < count; index++) { const page = pages.pop(); if (page.onUnload) page.onUnload(); }
      const current = topPage(); location.hash = current._previewURL; if (current.onShow) current.onShow(); render(); complete(options);
    },
    showToast: toast, showModal: modal, showActionSheet: actionSheet,
    showLoading(options) { this.hideLoading(); const node = document.createElement('div'); node.className = 'preview-loading'; const label = document.createElement('div'); label.textContent = options.title || '加载中…'; node.append(label); overlays.append(node); },
    hideLoading() { const node = overlays.querySelector('.preview-loading'); if (node) node.remove(); },
    stopPullDownRefresh() {},
    getSetting(options) { complete(options, { authSetting: { 'scope.record': false } }); },
    authorize(options) { if (options.fail) options.fail({ errMsg: '本地预览不提供微信麦克风授权' }); },
    openSetting(options) { modal({ title: '请使用微信真机', content: '本地浏览器预览不提供微信权限或真实录音。', showCancel: false }); complete(options, { authSetting: { 'scope.record': false } }); },
    openPrivacyContract() { modal({ title: '微信隐私保护指引', content: '本地预览无法打开微信后台配置的隐私指引。请在真实 AppID 的微信环境验证。', showCancel: false }); }
  };
  if (window.installPreviewVoice) window.installPreviewVoice(window.wx);

  function evaluate(expression, scope) {
    try { return new Function('scope', 'with(scope){return (' + expression + ')}')(scope); }
    catch (error) { console.warn('Preview expression:', expression, error.message); return ''; }
  }
  function interpolate(value, scope) {
    const exact = value.match(/^\{\{([\s\S]*)\}\}$/);
    if (exact && !exact[1].includes('}}')) return evaluate(exact[1], scope);
    return value.replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) => { const result = evaluate(expression, scope); return result == null ? '' : String(result); });
  }
  function template(file) {
    if (!domTemplates[file]) domTemplates[file] = new DOMParser().parseFromString(files[file].source, 'text/html').body;
    return domTemplates[file];
  }
  function events(node, element, scope, page) {
    for (const attribute of node.attributes) {
      const match = attribute.name.match(/^(bind|catch):?(tap|input|touchstart|touchmove|touchend|touchcancel|agreeprivacyauthorization)$/);
      if (!match) continue;
      const logical = match[2];
      const nativeEvent = { tap: 'click', input: 'input', touchstart: 'pointerdown', touchmove: 'pointermove', touchend: 'pointerup', touchcancel: 'pointercancel', agreeprivacyauthorization: 'click' }[logical];
      const dispatch = event => {
        if (match[1] === 'catch') event.stopPropagation();
        if (logical === 'touchstart') {
          gesture = { handlers: element._previewTouchHandlers, pointerId: event.pointerId };
          if (screen.setPointerCapture) screen.setPointerCapture(event.pointerId);
        }
        const fn = page[attribute.value];
        if (typeof fn !== 'function') { console.warn('Preview missing handler', attribute.value); return; }
        const argument = { type: logical, currentTarget: { dataset: Object.assign({}, element.dataset) }, target: { dataset: Object.assign({}, element.dataset) }, detail: { value: event.target.value }, touches: logical === 'touchend' || logical === 'touchcancel' ? [] : [{ clientY: event.clientY || 0, clientX: event.clientX || 0 }] };
        Promise.resolve(fn.call(page, argument)).catch(error => { console.error(error); toast({ title: '预览操作异常：' + error.message }); });
      };
      element.addEventListener(nativeEvent, event => {
        if (event._previewForwarded) return;
        // Pinyin candidates belong to the native IME, not the player's draft.
        if (logical === 'input' && (event.isComposing || composition?.element === element)) return;
        dispatch(event);
      });
      if (logical.startsWith('touch')) {
        element._previewTouchHandlers = element._previewTouchHandlers || {};
        element._previewTouchHandlers[logical] = dispatch;
      }
      if (logical === 'input') {
        element.addEventListener('compositionstart', () => { composition = { element, page }; });
        element.addEventListener('compositionend', event => {
          if (composition?.element === element) composition = null;
          if (page !== topPage() || !element.isConnected) return;
          // Also handles browsers whose final input event still has isComposing.
          dispatch(event);
          scheduleRender();
        });
      }
    }
  }
  function renderChildren(parent, scope, page, prefix) {
    const fragment = document.createDocumentFragment();
    let branchActive = false, branchMatched = false;
    Array.from(parent.childNodes).forEach((node, index) => {
      const key = prefix + '-' + index;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.hasAttribute('wx:if')) { branchActive = true; branchMatched = Boolean(interpolate(node.getAttribute('wx:if'), scope)); if (!branchMatched) return; }
        else if (node.hasAttribute('wx:elif')) { if (!branchActive || branchMatched) return; branchMatched = Boolean(interpolate(node.getAttribute('wx:elif'), scope)); if (!branchMatched) return; }
        else if (node.hasAttribute('wx:else')) { if (!branchActive || branchMatched) return; branchMatched = true; }
        else { branchActive = false; branchMatched = false; }
      } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) { branchActive = false; branchMatched = false; }
      fragment.append(renderNode(node, scope, page, key));
    });
    return fragment;
  }
  function renderNode(node, scope, page, key, inLoop) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(interpolate(node.textContent, scope));
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    if (node.hasAttribute('wx:for') && !inLoop) {
      const fragment = document.createDocumentFragment();
      const values = interpolate(node.getAttribute('wx:for'), scope) || [];
      Array.from(values).forEach((item, index) => {
        const local = Object.assign({}, scope, { [node.getAttribute('wx:for-item') || 'item']: item, [node.getAttribute('wx:for-index') || 'index']: index });
        fragment.append(renderNode(node, local, page, key + '-i' + index, true));
      });
      return fragment;
    }
    if (node.tagName.toLowerCase() === 'block') return renderChildren(node, scope, page, key);
    const tag = { view: 'div', text: 'span', image: 'img', img: 'img', 'scroll-view': 'div', button: 'button', textarea: 'textarea' }[node.tagName.toLowerCase()] || 'div';
    const element = document.createElement(tag); element.dataset.nodeKey = key;
    if (tag === 'button') element.type = 'button';
    for (const attribute of node.attributes) {
      const name = attribute.name;
      if (name.startsWith('wx:') || /^(bind|catch)/.test(name)) continue;
      const value = interpolate(attribute.value, scope);
      if (tag === 'img' && name === 'src') { element.src = String(value || ''); element.alt = ''; element.draggable = false; continue; }
      if (tag === 'img' && name === 'mode') { element.style.objectFit = value === 'aspectFill' ? 'cover' : 'contain'; continue; }
      if (name === 'disabled') { element.disabled = Boolean(value); continue; }
      if (name === 'value') { element.value = value == null ? '' : String(value); continue; }
      if (['class', 'id', 'style', 'placeholder', 'maxlength'].includes(name) || name.startsWith('aria-') || name.startsWith('data-')) element.setAttribute(name, value == null ? '' : String(value));
    }
    if (node.tagName.toLowerCase() === 'scroll-view') element.dataset.scrollView = 'true';
    events(node, element, scope, page);
    element.append(renderChildren(node, scope, page, key));
    return element;
  }
  function css(source) {
    const width = screen.getBoundingClientRect().width;
    const height = screen.getBoundingClientRect().height;
    // Translate type selectors only; classes such as .message-text must stay intact.
    return source.replace(/([\d.]+)rpx/g, (_, n) => (+n * width / 750) + 'px').replace(/100vh/g, height + 'px').replace(/(^|})\s*page\s*\{/g, '$1#mini-screen{').replace(/(^|[}\s,{>+~])(view|text)(?=[\s,.#:{\[>+~]|$)/g, (_, prefix, tag) => prefix + (tag === 'view' ? 'div' : 'span'));
  }
  function scheduleRender() { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; render(); }); }
  function render() {
    const page = topPage(); if (!page) return;
    // Replacing a composing textarea commits every intermediate Pinyin string.
    // Defer ALL renders (including async replies and resize) until compositionend.
    if (composition?.page === page && composition.element.isConnected) return;
    composition = null;
    const active = document.activeElement;
    const activeKey = active && active.dataset && active.dataset.nodeKey;
    const selection = activeKey && active.tagName === 'TEXTAREA' ? [active.selectionStart, active.selectionEnd] : null;
    const scrolls = Array.from(appRoot.querySelectorAll('[data-scroll-view]')).map(element => [element.dataset.nodeKey, element.scrollTop]);
    const lastCount = page._renderedMessageCount;
    const conversation = page.data.session || page.data.room;
    const currentCount = conversation?.messages?.length;
    const contentKey = JSON.stringify([conversation?.messages?.slice(-1)[0]?.id, conversation?.state, conversation?.hintCount, conversation?.active?.requestId || conversation?.activeRequestId]);
    const stem = page._previewFile.replace(/\.js$/, '');
    style.textContent = css(baseStyles + '\n' + files[stem + '.wxss'].source);
    appRoot.replaceChildren(renderChildren(template(stem + '.wxml'), page.data, page, 'p'));
    for (const [key, top] of scrolls) { const element = appRoot.querySelector('[data-node-key="' + key + '"]'); if (element) element.scrollTop = top; }
    if (activeKey) { const input = appRoot.querySelector('[data-node-key="' + activeKey + '"]'); if (input && input.tagName === 'TEXTAREA') { input.focus({ preventScroll: true }); if (selection) input.setSelectionRange(selection[0], selection[1]); } }
    if (page.data.scrollTarget && (page._renderedScrollTarget !== page.data.scrollTarget || currentCount !== lastCount || contentKey !== page._renderedContentKey)) {
      const target = document.getElementById(page.data.scrollTarget);
      if (target) {
        const scroller = target.closest('[data-scroll-view]');
        const alignStart = page.data.scrollTarget === 'story-list' || page.data.scrollTarget.startsWith('practice-top');
        // A countdown repaint would cancel an unfinished native smooth scroll.
        // Finish inside the local scroller without moving the surrounding page.
        if (scroller && /^(room-)?message-end$/.test(page.data.scrollTarget)) scroller.scrollTop = scroller.scrollHeight;
        else if (scroller) scroller.scrollTop += target.getBoundingClientRect()[alignStart ? 'top' : 'bottom'] - scroller.getBoundingClientRect()[alignStart ? 'top' : 'bottom'];
        else target.scrollIntoView({ block: alignStart ? 'start' : 'end', behavior: 'auto' });
      }
    }
    page._renderedScrollTarget = page.data.scrollTarget; page._renderedMessageCount = currentCount; page._renderedContentKey = contentKey;
    renderSequence++;
  }
  window.addEventListener('resize', scheduleRender);
  window.addEventListener('hashchange', () => {
    const url = location.hash.slice(1) || '/pages/home/index';
    if (topPage()?._previewURL === url) return;
    const previous = pages.map(p => p._previewURL).lastIndexOf(url);
    if (previous >= 0) {
      while (pages.length > previous + 1) { const p = pages.pop(); if (p.onUnload) p.onUnload(); }
      if (topPage().onShow) topPage().onShow(); render();
    } else navigate({ url }, 'push');
  });
  for (const [nativeEvent, logical] of [['pointermove', 'touchmove'], ['pointerup', 'touchend'], ['pointercancel', 'touchcancel']]) {
    window.addEventListener(nativeEvent, event => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const current = gesture;
      if (logical !== 'touchmove') gesture = null;
      event._previewForwarded = true;
      current.handlers[logical]?.(event);
    }, true);
  }
  document.addEventListener('visibilitychange', () => { const page = topPage(); if (!page) return; if (document.hidden && page.onHide) page.onHide(); else if (!document.hidden && page.onShow) page.onShow(); });
  document.querySelectorAll('[data-page]').forEach(link => { link.onclick = event => { event.preventDefault(); navigate({ url: link.dataset.page }, 'redirect'); }; });
  document.querySelector('#sample-question').onclick = () => {
    const input = appRoot.querySelector('textarea');
    if (!input) return toast({ title: '先选择「没看的电影」并进入一局' });
    input.value = '小夏真的付钱买了电影票吗？'; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
  };
  requireMini('/app.js'); if (app.onLaunch) app.onLaunch();
  navigate({ url: location.hash.slice(1) || '/pages/home/index' }, 'push');
  fetch('/preview-status').then(r => r.json()).then(status => {
    document.querySelector('#preview-mode').textContent = unconfigured ? '未配置界面检查 · 无模型调用' : status.mode === 'fixture' ? '固定裁判测试模式 · 非真实 AI' : status.textReady ? 'AI 语音海龟汤 · ' + (remote ? '手机测试' : '本机体验') : '真实 AI 待接入 · 请配置服务端密钥';
    if (remote) {
      document.querySelector('#preview-detail').textContent = '好奇心俱乐部 · 手机测试';
      document.querySelector('.preview-notes p').textContent = '两台手机打开同一个完整邀请链接，分别填写昵称，通过六位房间号同桌。推荐在 Safari 或 Chrome 中打开并允许麦克风。临时测试期间，发起人的电脑需保持开机联网。';
    }
    if (status.mode === 'fixture') document.querySelector('#preview-description').textContent = '这是显式开启的开发测试模式，只匹配测试问句，不代表真实 AI 能力。默认启动方式使用真实模型。';
  }).catch(() => { document.querySelector('#preview-mode').textContent = '试玩服务未连接'; });
  // Read-only diagnostics for UI acceptance; this never contains the private puzzle bank.
  window.__preview = { get page() { return topPage(); }, get route() { return topPage().route; }, get renderCount() { return renderSequence; }, unconfigured };
})();
