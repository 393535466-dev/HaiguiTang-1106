# 第三方组件与服务

## 浏览器录音

使用 [xiangyuecn/Recorder](https://github.com/xiangyuecn/Recorder) 的 WAV 录音组件，遵循 MIT 许可证。仅复用麦克风采集、重采样和 WAV 编码；权限说明、取消手势、文件归属校验、转写及判题由本项目处理。

- 固定提交：`74180842defbcf1cf3c8bccabceb3cc0faed5b6f`。
- 原始文件：[recorder.wav.min.js](https://raw.githubusercontent.com/xiangyuecn/Recorder/74180842defbcf1cf3c8bccabceb3cc0faed5b6f/recorder.wav.min.js)。原样保存于 `scripts/preview/vendor/recorder.wav.min.js`，SHA256 为 `9864dabd6ba92fc67dcfadd46dc49e74ffe6b36e692d4f33c4d3d2deac16f9a2`。
- 保留许可证：[Recorder-LICENSE.txt](../scripts/preview/vendor/Recorder-LICENSE.txt)，SHA256 为 `1f973bafdf4edbb0b1e6c8005d4d0cc70160752904e9440f69f59427c885c5e2`。
- 组件从本机静态目录加载，不依赖运行时 CDN。没有引入上游的商业转写插件或网络上传功能；当前文件中未发现 `fetch`、`XMLHttpRequest`、`sendBeacon` 网络发送调用。
- 微信端继续使用原生录音器。浏览器版仍须测试实际设备、麦克风权限和后台切换。

## AI 语音服务

自然女声使用百炼 `qwen3-tts-flash` 的 `Serena`，属于收费云服务，不是开源人声模型或真人录音。声音只合成已审核的题面、固定主持词与结束后解锁的答案。复用相同文本的合成结果以减少等待和费用；当前缓存限于服务实例内存，重启或冷启动不能保证复用。

- [官方语音合成接口](https://help.aliyun.com/zh/model-studio/qwen-tts-api)
- [官方音色列表](https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list)
- [模型与价格](https://help.aliyun.com/zh/model-studio/qwen3-tts-flash)

当前选择复用录音组件并接现有百炼服务，省去另行部署开源语音模型的 GPU、推理服务和运维工作。没有引入第三方海龟汤游戏代码或题库。

## 首页毛笔字

首页使用 [Ma Shan Zheng](https://github.com/googlefonts/mashanzheng) 接近用户提供的毛笔字参考；未声称识别出了参考图的原字体。采用 Google Fonts 提供的首页字符子集，通过 fontTools 转为 WOFF2，运行时字体别名为 SoupBrush。字体从项目自身目录加载，玩家打开页面时无需连接 Google Fonts。

- 字体文件为 `miniprogram/assets/fonts/soup-brush-home-v1.woff2`。
- 保留 Copyright 2018 The Ma Shan Zheng Project Authors 与完整 [SIL OFL 1.1](../miniprogram/assets/fonts/OFL-MaShanZheng.txt)。
- 子集仅覆盖当前首页文字，后续改文案需要重新补齐字形。生成素材及字体来源见 [首页素材记录](home-motion-assets.txt)。
