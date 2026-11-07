/* Browser recording adapter. Recorder WAV is vendored under its MIT license. */
(function () {
  'use strict';
  const files = new Map(), listeners = { Start: new Set(), Stop: new Set(), Error: new Set() };
  let active = null, generation = 0, timer, privacyGranted = false;
  const emit = (name, value) => { for (const fn of [...listeners[name]]) fn(value); };
  const emitTo = (current, name, value) => {
    let delivered = false;
    for (const fn of current.listeners[name]) if (listeners[name].has(fn)) { delivered = true; fn(value); }
    return delivered;
  };
  const supported = Boolean(window.Recorder && navigator.mediaDevices?.getUserMedia && window.isSecureContext);
  const recorder = {
    start(options = {}) {
      if (active) { emit('Error', { errMsg: '录音正在处理中。' }); return; }
      window.dispatchEvent(new Event('preview-recording-start'));
      const token = ++generation;
      const rec = Recorder({ type: 'wav', sampleRate: 16000, bitRate: 16,
        onProcess(buffers, power, duration) { if (duration >= 19000 && active?.rec === rec && active.state === 'recording') recorder.stop(); } });
      const current = { rec, token, state: 'opening', listeners: Object.fromEntries(Object.entries(listeners).map(([name, callbacks]) => [name, [...callbacks]])) };
      active = current;
      rec.open(() => {
        if (token !== generation || document.hidden) { rec.close(); return; }
        active.state = 'recording'; rec.start();
        timer = setTimeout(() => recorder.stop(), Math.min(options.duration || 19000, 19000));
        emitTo(current, 'Start', {});
      }, (message, denied) => {
        rec.close();
        if (token !== generation) return;
        active = null; emitTo(current, 'Error', { errMsg: denied ? '未获得浏览器麦克风权限。' : '无法开启麦克风，请检查设备。' });
      });
    },
    stop() {
      if (!active || active.state === 'stopping') return;
      clearTimeout(timer);
      const current = active;
      if (current.state === 'opening') {
        generation++; active = null; current.rec.close();
        emitTo(current, 'Stop', { duration: 0, tempFilePath: '' }); return;
      }
      current.state = 'stopping';
      current.rec.stop((blob, duration) => {
        current.rec.close(); active = null;
        const path = URL.createObjectURL(blob); files.set(path, blob);
        if (!emitTo(current, 'Stop', { duration, tempFilePath: path })) remove(path);
      }, () => { current.rec.close(); active = null; emitTo(current, 'Error', { errMsg: '没有录到有效声音，请重新录制。' }); });
    }
  };
  for (const name of Object.keys(listeners)) {
    recorder['on' + name] = fn => listeners[name].add(fn);
    recorder['off' + name] = fn => listeners[name].delete(fn);
  }
  function remove(path) { files.delete(path); if (path) URL.revokeObjectURL(path); }
  window.installPreviewVoice = wx => {
    wx.createInnerAudioContext = () => {
      const audio = new Audio(), handlers = { ended: new Set(), error: new Set() };
      const notify = name => { for (const fn of handlers[name]) fn({}); };
      const ended = () => notify('ended'), failed = () => notify('error');
      const stop = () => { audio.pause(); try { audio.currentTime = 0; } catch (_) {} };
      audio.addEventListener('ended', ended); audio.addEventListener('error', failed);
      window.addEventListener('preview-recording-start', stop);
      return { get src() { return audio.src; }, set src(value) { audio.src = value; },
        play() { audio.play().catch(failed); }, stop, pause() { audio.pause(); },
        onEnded(fn) { handlers.ended.add(fn); }, onError(fn) { handlers.error.add(fn); },
        destroy() { stop(); handlers.ended.clear(); handlers.error.clear(); audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed); window.removeEventListener('preview-recording-start', stop); audio.removeAttribute('src'); audio.load(); }
      };
    };
    if (supported) wx.getRecorderManager = () => recorder;
    wx.getFileSystemManager = () => ({ unlink(options) { remove(options.filePath); if (options.success) options.success(); } });
    wx.getSetting = options => {
      const done = state => options.success?.({ authSetting: { 'scope.record': state === 'granted' ? true : state === 'denied' ? false : undefined } });
      if (!navigator.permissions?.query) { done('prompt'); return; }
      navigator.permissions.query({ name: 'microphone' }).then(result => done(result.state), () => done('prompt'));
    };
    wx.authorize = options => {
      if (!supported) { options.fail?.({ errMsg: '当前浏览器不支持录音，请使用 Chrome 或 Safari。' }); return; }
      navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false }).then(stream => {
        stream.getTracks().forEach(track => track.stop()); options.success?.({});
      }, () => options.fail?.({ errMsg: '麦克风授权被拒绝，请在浏览器地址栏的权限设置中开启。' }));
    };
    wx.openSetting = options => wx.showModal({ title: '开启浏览器麦克风', content: '请在地址栏的网站权限中允许麦克风，然后再次按住说话。', showCancel: false, success: () => options.success?.({}) });
    wx.requirePrivacyAuthorize = options => {
      if (privacyGranted) { options.success?.({}); return; }
      wx.showModal({ title: '使用语音输入', content: '按住时录音，松手后发送至本机服务和百炼进行转写。文字由你核对后提交；也可以继续打字。', confirmText: '同意并继续', success: result => {
        if (result.confirm) { privacyGranted = true; options.success?.({}); }
        else options.fail?.({ errMsg: '已取消语音输入，可继续打字。' });
      } });
    };
    wx.cloud.uploadFile = async ({ cloudPath, filePath }) => {
      const blob = files.get(filePath);
      if (!blob) throw new Error('录音已清理，请重新录制。');
      const response = await fetch('/audio?path=' + encodeURIComponent(cloudPath), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '录音上传失败，请重新录制。');
      return data;
    };
  };
  window.addEventListener('pagehide', () => { generation++; clearTimeout(timer); if (active) active.rec.close(); active = null; for (const path of files.keys()) remove(path); });
})();
