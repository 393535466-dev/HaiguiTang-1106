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

## 源云明宋体正文（2026-11-09 后续调整）

用户指定的“源云明宋体”采用官方 [ButTaiwan/genwan-font](https://github.com/ButTaiwan/genwan-font) 的源雲明體丹 Regular（GenWanMin2 TC R 2.100），固定源提交 `25e718615173a3b51099ecc9a6bf4fa558c03fbc`。依据 SIL OFL 1.1 做 Unicode 子集与 WOFF2 编码，内部名称改为 HGT GenWan Web；保留字形轮廓、版权和 [OFL](fonts/genwan/OFL-GenWanMin.txt)、[NOTICE](fonts/genwan/NOTICE.txt)。运行时别名为 SoupMincho。

当前页面与剧本用字首包 399,932 bytes，其余 67 个按需分片，合计保留原始 35,349 个编码。原始字体有对应轮廓的简体字均正常使用；系统仍负责原字库不含的字符与 emoji。完整来源、生成脚本、字符范围和哈希在 `docs/fonts/genwan/`。字体包旁另附 OFL 和 NOTICE，随交付保留。正文更换此字体，品牌及按钮继续使用下述字体。

## 当前指定字体（2026-11-09）

使用品如手写体（林芳柽）与青柳隶书体（青柳衡山书法、SIMO 制字）。品如用于主要标题和按钮，青柳用于品牌及英文小标；正文和输入现采用上方源云字体。两份 TTF 均保留下载时的原始字节，没有改字形、裁字或转换字体格式；HTTP Brotli/gzip 只压缩传输，浏览器解压后与原文件相同。

品如作者的免费商用声明截图、来源链和二进制哈希保存在 [字体溯源记录](fonts/PROVENANCE.txt)。下载源为 FontHubs 镜像，作者原始发布页有反爬限制；免费商用声明不是完整开源许可证，未获得另行出售字体或任意改制的授权。青柳来自[作者发行页](https://opentype.jp/aoyagireisho.htm)，随项目保留 [原使用说明](fonts/aoyagi/usage-original.txt) 与 [字体解说](fonts/aoyagi/explanation.pdf)。

青柳中部分简体汉字虽有编码却无字形轮廓，CSS 通过 `unicode-range` 排除空字形，使这些字回退到品如，避免缺字；没有修改原字体。具体资源和生成记录见 [纸面主题素材记录](paper-theme-assets.txt)。

## 历史首页毛笔字（当前已替换）

首页使用 [Ma Shan Zheng](https://github.com/googlefonts/mashanzheng) 接近用户提供的毛笔字参考；未声称识别出了参考图的原字体。采用 Google Fonts 提供的首页字符子集，通过 fontTools 转为 WOFF2，运行时字体别名为 SoupBrush。字体从项目自身目录加载，玩家打开页面时无需连接 Google Fonts。

- 字体文件为 `miniprogram/assets/fonts/soup-brush-home-v1.woff2`。
- 保留 Copyright 2018 The Ma Shan Zheng Project Authors 与完整 [SIL OFL 1.1](../miniprogram/assets/fonts/OFL-MaShanZheng.txt)。
- 子集仅覆盖当前首页文字，后续改文案需要重新补齐字形。生成素材及字体来源见 [首页素材记录](home-motion-assets.txt)。
