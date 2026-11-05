# 固定判词语音来源

这 9 个 WAV 是本项目用离线 eSpeak NG 1.52.0 的 `cmn` 共振峰合成声音生成的中文判词。它们是说话语音，不是用提示音代替判词；声音有明显的机械合成感。文字与 `miniprogram/utils/presentation.js` 中的固定标签一致。

| 文件 | 朗读文字 |
|---|---|
| `yes.wav` | 是。 |
| `no.wav` | 否。 |
| `irrelevant.wav` | 无关。 |
| `unspecified.wav` | 题目未设定。 |
| `clarify.wav` | 请澄清。 |
| `solved.wav` | 猜中了。 |
| `incomplete.wav` | 还差一点。 |
| `incorrect.wav` | 方向不对。 |
| `uncertain.wav` | 暂无法判定。 |

生成参数为普通话 `cmn`、语速 `160`、音高 `48`、幅度 `100`。输出均为 22,050 Hz、16 bit、单声道 PCM WAV，9 条共 512,014 字节，单条约 0.65 至 1.83 秒。`manifest.json` 保存文本、来源校验值、文件 SHA256 及音频检查结果。

## 许可边界

- [eSpeak NG 1.52.0 源码](https://github.com/espeak-ng/espeak-ng/tree/1.52.0)使用 [GPL v3 或后续版本](https://github.com/espeak-ng/espeak-ng/blob/1.52.0/COPYING)，可以用于商业用途；其许可并非“仅个人、非商用”。
- GPL v3 第 2 节区分运行程序与程序输出，只有输出内容本身构成受许可作品时，输出才受 GPL 约束。[GNU 对程序输出的说明](https://www.gnu.org/licenses/gpl-faq.en.html#WhatCaseIsOutputGPL)也作了这一说明。这批文件是对本项目九句普通判词的合成朗读，没有复制引擎源代码、文字文档或界面素材。本项目据此将这些 WAV 作为生成的音频使用，没有把 eSpeak 引擎或字典作为小程序依赖分发。
- eSpeak 的固定构建还会取得 [sonic 固定提交](https://github.com/waywardgeek/sonic/tree/fbf75c3d6d846bad3bb3d456cbc5d07d9fd8c104)，该构建依赖使用 [Apache 2.0](https://github.com/waywardgeek/sonic/blob/fbf75c3d6d846bad3bb3d456cbc5d07d9fd8c104/LICENSE)。生成参数关闭了 sonic 变速、MBROLA、系统音频输出和 speechPlayer 后端。源码及编译物只留在本机临时缓存，不打进小程序。
- 生成不使用 macOS `say` 或 Apple 系统语音，不使用真人声音克隆、外部录音、需单独许可的 MBROLA 声音或任何收费接口。
- 以上是本项目对所用工具和生成方式的来源说明，不是将第三方软件重新授权，也不向外部授予本仓库代码或内容的额外许可。如以后把 TTS 引擎、字典或其他声音模型一起分发，应分别履行相应许可。

## 重新生成

在仓库根目录执行：

```sh
python3 scripts/generate-audio.py
```

需要 Python 3.9 或更高版本、pip、C/C++ 编译器、Make，以及首次访问官方 GitHub 和 PyPI 的网络。脚本会在系统临时目录缓存中下载固定且校验 SHA256 的 eSpeak/sonic 源码，并把 CMake 3.31.6 安装在该缓存中；不会安装到系统目录，也不需要管理员权限、模型 Key 或云服务。后续可复用缓存。只有更改文字或声音参数时才需要重新生成，小程序运行不依赖这些工具。

已有 CMake 3.x 时可传 `--cmake /绝对路径/cmake`，缓存位置可传 `--work-dir /临时目录`。Mac 上若存在 `MacOSX15.4.sdk`，脚本选用该 SDK，避免本机新版默认 SDK 与旧链接器不兼容；可用 `--sdk /绝对路径/SDK` 指定其他已安装版本。已在当前 Mac 的 AppleClang、MacOSX15.4 SDK 上实际编译生成。

只核验现有资源，不下载或编译：

```sh
python3 scripts/generate-audio.py --verify-only
```

已核验 PCM 格式、时长、非静音和未削波。这些结构检查不等于听感验收；需在微信真机确认中文发音、响度、静音开关及切后台停止播放，再决定是否替换成有明确授权的真人录音。
