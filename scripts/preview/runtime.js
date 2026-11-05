/* Explicit browser-only WeChat subset. Loads the actual mini-program controllers. */
(function () {
  'use strict';
  const files = window.__miniFiles;
  const screen = document.querySelector('#mini-screen');
  const appRoot = document.querySelector('#app');
  const overlays = document.querySelector('#preview-overlays');
  const unconfigured = new URLSearchParams(location.search).get('mode') === 'unconfigured';
  const modules = {}, definitions = {}, pages = [];
  let app, currentModule = '', scheduled = false, renderSequence = 0, toastTimer;
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
    const page = Object.assign({}, definition, { route, data: structuredClone(definition.data || {}), _previewFile: file });
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
        const response = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.data) });
        if (!response.ok) throw new Error('本地预览服务没有接通');
        return { result: await response.json() };
      },
      async uploadFile() { throw new Error('浏览器预览不提供录音上传，请在微信真机验证。'); }
    },
    getStorageSync(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } },
    getStorageInfoSync() { return { keys: Object.keys(localStorage) }; },
    setStorageSync(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
    removeStorageSync(key) { localStorage.removeItem(key); },
    navigateTo(options) { navigate(options, 'push'); },
    redirectTo(options) { navigate(options, 'redirect'); },
    navigateBack(options = {}) {
      if (pages.length <= 1) return navigate({ url: '/pages/home/index' }, 'redirect');
      const count = Math.min(options.delta || 1, pages.length - 1);
      for (let index = 0; index < count; index++) { const page = pages.pop(); if (page.onUnload) page.onUnload(); }
      const current = topPage(); location.hash = '/' + current.route; if (current.onShow) current.onShow(); render(); complete(options);
    },
    showToast: toast, showModal: modal, showActionSheet: actionSheet,
    showLoading(options) { this.hideLoading(); const node = document.createElement('div'); node.className = 'preview-loading'; const label = document.createElement('div'); label.textContent = options.title || '加载中…'; node.append(label); overlays.append(node); },
    hideLoading() { const node = overlays.querySelector('.preview-loading'); if (node) node.remove(); },
    stopPullDownRefresh() {},
    getSetting(options) { complete(options, { authSetting: { 'scope.record': false } }); },
    authorize(options) { if (options.fail) options.fail({ errMsg: '本地预览不提供微信麦克风授权' }); },
    openSetting(options) { modal({ title: '请使用微信真机', content: '本地浏览器预览不提供微信权限或真实录音。', showCancel: false }); complete(options, { authSetting: { 'scope.record': false } }); },
    openPrivacyContract() { modal({ title: '微信隐私保护指引', content: '本地预览无法打开微信后台配置的隐私指引。请在真实 AppID 的微信环境验证。', showCancel: false }); },
    createInnerAudioContext() {
      const audio = new Audio();
      return { set src(value) { audio.src = value; }, play() { audio.play().catch(() => {}); }, stop() { audio.pause(); try { audio.currentTime = 0; } catch (_) {} }, destroy() { audio.pause(); audio.src = ''; } };
    }
  };

  function evaluate(expression, scope) {
    try { return new Function('scope', 'with(scope){return (' + expression + ')}')(scope); }
    catch (error) { console.warn('Preview expression:', expression, error.message); return ''; }
  }
  function interpolate(value, scope) {
    const exact = value.match(/^\{\{([\s\S]*)\}\}$/);
    if (exact) return evaluate(exact[1], scope);
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
      element.addEventListener(nativeEvent, event => {
        if (match[1] === 'catch') event.stopPropagation();
        if (logical.startsWith('touch') && logical === 'touchstart' && element.setPointerCapture) element.setPointerCapture(event.pointerId);
        const fn = page[attribute.value];
        if (typeof fn !== 'function') { console.warn('Preview missing handler', attribute.value); return; }
        const argument = { type: logical, currentTarget: { dataset: Object.assign({}, element.dataset) }, target: { dataset: Object.assign({}, element.dataset) }, detail: { value: event.target.value }, touches: logical === 'touchend' || logical === 'touchcancel' ? [] : [{ clientY: event.clientY || 0, clientX: event.clientX || 0 }] };
        Promise.resolve(fn.call(page, argument)).catch(error => { console.error(error); toast({ title: '预览操作异常：' + error.message }); });
      });
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
    const tag = { view: 'div', text: 'span', 'scroll-view': 'div', button: 'button', textarea: 'textarea' }[node.tagName.toLowerCase()] || 'div';
    const element = document.createElement(tag); element.dataset.nodeKey = key;
    if (tag === 'button') element.type = 'button';
    for (const attribute of node.attributes) {
      const name = attribute.name;
      if (name.startsWith('wx:') || /^(bind|catch)/.test(name)) continue;
      const value = interpolate(attribute.value, scope);
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
    return source.replace(/([\d.]+)rpx/g, (_, n) => (+n * width / 750) + 'px').replace(/100vh/g, height + 'px').replace(/(^|})\s*page\s*\{/g, '$1#mini-screen{').replace(/\b(view|text)(?=[\s,.#:{\[])/g, tag => tag === 'view' ? 'div' : 'span');
  }
  function scheduleRender() { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; render(); }); }
  function render() {
    const page = topPage(); if (!page) return;
    const active = document.activeElement;
    const activeKey = active && active.dataset && active.dataset.nodeKey;
    const selection = activeKey && active.tagName === 'TEXTAREA' ? [active.selectionStart, active.selectionEnd] : null;
    const scrolls = Array.from(appRoot.querySelectorAll('[data-scroll-view]')).map(element => [element.dataset.nodeKey, element.scrollTop]);
    const lastCount = page._renderedMessageCount;
    const currentCount = page.data.session && page.data.session.messages.length;
    const stem = page._previewFile.replace(/\.js$/, '');
    style.textContent = css(baseStyles + '\n' + files[stem + '.wxss'].source);
    appRoot.replaceChildren(renderChildren(template(stem + '.wxml'), page.data, page, 'p'));
    for (const [key, top] of scrolls) { const element = appRoot.querySelector('[data-node-key="' + key + '"]'); if (element) element.scrollTop = top; }
    if (activeKey) { const input = appRoot.querySelector('[data-node-key="' + activeKey + '"]'); if (input && input.tagName === 'TEXTAREA') { input.focus({ preventScroll: true }); if (selection) input.setSelectionRange(selection[0], selection[1]); } }
    if (page.data.scrollTarget && (page._renderedScrollTarget !== page.data.scrollTarget || currentCount !== lastCount)) {
      const target = document.getElementById(page.data.scrollTarget); if (target) target.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
    page._renderedScrollTarget = page.data.scrollTarget; page._renderedMessageCount = currentCount;
    renderSequence++;
  }
  window.addEventListener('resize', scheduleRender);
  document.addEventListener('visibilitychange', () => { const page = topPage(); if (!page) return; if (document.hidden && page.onHide) page.onHide(); else if (!document.hidden && page.onShow) page.onShow(); });
  document.querySelector('#sample-question').onclick = () => {
    const input = appRoot.querySelector('textarea');
    if (!input) return toast({ title: '先选择「没看的电影」并进入一局' });
    input.value = '小夏真的付钱买了电影票吗？'; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
  };
  requireMini('/app.js'); if (app.onLaunch) app.onLaunch();
  navigate({ url: location.hash.slice(1) || '/pages/home/index' }, 'push');
  // Read-only diagnostics for UI acceptance; this never contains the private puzzle bank.
  window.__preview = { get page() { return topPage(); }, get route() { return topPage().route; }, get renderCount() { return renderSequence; }, unconfigured };
})();
