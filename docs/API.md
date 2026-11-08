# 单人语音版接口约定

所有小程序请求使用 `wx.cloud.callFunction({ name: 'game', data: { action, ...payload } })`。服务端从微信上下文取得用户身份，不接受客户端 openId。

统一响应：成功 `{ ok: true, data }`；失败 `{ ok: false, error: { code, message, retryable: false } }`。不会把服务错误映射成游戏判词。

## 操作

| action | payload | data |
|---|---|---|
| status | 无 | `{ configured, textReady, voiceReady, environment: 'cloud', ownerKey }`；ownerKey是用户散列，不返回密钥；ready只表示配置齐备，并非联调通过 |
| listPuzzles | 无 | `{ puzzles: [{ id, title, difficulty, teaser }] }`；无汤底 |
| startSolo | `{ puzzleId }` | `{ session }` |
| startTutorial | 无 | `{ session }`；文字 AI 已配置才创建，服务端选定私有练习题，1 小时到期；不接受客户端题库或答案 |
| startVoicePractice | 无 | `{ session }`；语音服务已配置才创建，1小时到期，仅用于练习转写，不进入正式题库或本机继续游戏入口 |
| getSession | `{ sessionId }` | `{ session }` |
| registerUpload | `{ sessionId }` | `{ uploadId, cloudPath }`，云端登记所属用户及24小时清理期限 |
| confirmUpload | `{ sessionId, uploadId, fileID }` | `{ confirmed: true }`；上传完成立即登记私有fileID |
| transcribeAudio | `{ sessionId, requestId, uploadId, fileID, replaceRequestId? }` | `{ requestId, status, transcript?, usage? }` |
| askQuestion | `{ sessionId, requestId, text, replaceRequestId? }` | `{ requestId, status, session?, answer? }` |
| guessAnswer | `{ sessionId, requestId, text, replaceRequestId? }` | 同上；`answer`为猜底枚举 |
| getRequest | `{ sessionId, requestId }` | `{ requestId, status, transcript?, session? }`，不暴露内部解释 |
| getSpeech | `{ sessionId, target: 'surface'\|'message'\|'solution', messageId? }` | `{ url, expiresAt, voice, characters }`；只朗读当前用户有权看到的固定内容，不接受任意 text；solution 仅 solved/revealed 可用 |
| getHint | `{ sessionId }` | `{ session }`，静态逐级提示，无模型费 |
| revealSoup | `{ sessionId }` | `{ session }`；前端需确认 |
| clearSession | `{ sessionId }` | `{ cleared: true }`；作废、撤销活动请求并删除正文 |
| feedback | `{ sessionId, messageId?, kind: 'wrong_answer'|'puzzle_issue' }` | `{ received: true }`；不收自由文本 |

上传步骤：registerUpload → wx.cloud.uploadFile({cloudPath,filePath}) → confirmUpload → transcribeAudio。只允许已登记的当前用户私有上传路径，不能传任意音频URL。取消时调用 `discardUpload { sessionId, uploadId, fileID? }`。录音设置19秒，服务端按实际MP3帧验证不超过20秒、1MB、单声道；私有文件下载也限制为1MB/8秒，临时下载地址不下发客户端。

语音练习复用相同上传、转写、幂等和查询接口，创建消耗开局配额，ASR 消耗语音配额；不代表免费调用。服务端固定 `mode: voice-practice`，拒绝在该会话提问判题、猜底、取提示或揭底。练习退出调用 `clearSession`，上传已开始时先完成登记或丢弃再清理；异常退出按 1 小时会话到期与定时任务清理。客户端无需保存练习会话或草稿，不替换原来的正式局。

文字练习固定 `mode: tutorial`，复用提问、猜底、提示、查询及清理接口，与正式局共享裁判和每日配额。退出清理独立会话，不替换正式局。

请求状态为 `processing | succeeded | failed | unknown | superseded`。unknown表示厂商可能已经计费，不可自动重新外呼。同requestId只读回原结果；用户显式确认重试后生成新ID并携带旧replaceRequestId，撤销旧请求游戏写回资格。

## 公开会话

```js
{
  id, puzzleId, puzzleVersion, title, difficulty, surface,
  state: 'playing' | 'solved' | 'revealed' | 'expired' | 'cleared',
  messages: [{ id, type: 'question'|'guess', text, answer, clarifyReason?, createdAt }],
  hints: [/* 已解锁文本 */], hintCount, maxHints: 3,
  questionCount, maxQuestions, guessFailures, maxGuessFailures: 5,
  attempts, maxAttempts: 50, expiresAt,
  solution: /* 只在solved或revealed时存在 */,
  activeRequestId: /* 用于恢复，不含内部原始内容 */
}
```

有效判词为 `yes | no | irrelevant`，各消耗一次有效提问。前端把 `unspecified | clarify` 显示为提示。新局暂定 `maxQuestions: 30`，达到上限时本轮判词和汤底随同一个响应返回，会话进入 `revealed`。旧会话的 `maxQuestions` 为 `null`，沿用手动揭底规则。

`clarifyReason` 只接受 `person | reference | time | multiple | open_ended | guess | instruction`，前端将其映射为审核过的引导文本。模型原始解释永不下发。服务端要求提问结果含有效 `intent`，开放问题等意图即使附带 yes/no 也强制转成澄清。

猜底枚举为 `solved | incomplete | incorrect | uncertain`。只有 `incorrect` 消耗 5 次失败猜底机会。每局另有 50 次裁判尝试的费用护栏，已预占的超时和失败计入该护栏。语音转写按独立配额计量。

## 服务端依赖边界

`createService({ store, provider, audio, puzzles, clock, idFactory, limits })`。`store.transaction(async tx => ...)`中tx提供 `get(collection,id)`、`set(collection,id,value)`、`delete(collection,id)`；外呼不在事务里。

`provider.ready()`返回 `{textReady,voiceReady}`。`provider.judge({puzzle,history,text,kind})`返回 `{answer,clarifyReason?,usage:{inputTokens,outputTokens}}`，内部判定不得原样下发；`provider.transcribe({buffer,mimeType?})`返回 `{text,usage?}`。未配置时抛出 `CONFIG_REQUIRED`，不得默认伪造AI答案。

`audio.inspect({fileID,cloudPath})`返回 `{buffer,durationSeconds}`并在服务端验证实际MP3、大小、时长及路径；`audio.remove(fileID)`删除上传文件。清理函数需支持24小时孤立文件、7天会话正文和30天去标识计量清理，需可测试。

每日配额对裁判调用、ASR、音频登记/下载检查、开局分别计数。默认每用户每类 100、全局每类 500，配额只可在云端调低。已知失败保留预占，避免通过异常反复外呼。提问暂带最近 12 条问答，完整猜底独立判断。请求正文上限为 24KB UTF-8，超出时返回提示。实际 token 用量以厂商返回计量为准。

本地预览默认真实 AI，仅 `PREVIEW_MODE=fixture` 显式开启测试答案；仅绑定 127.0.0.1，限制 Host/Origin/JSON 类型，不公开密钥文件。开发服务不具备真实用户鉴权和微信内容审核，不可公开部署。

本地开发可显式提供测试provider，云函数生产入口不允许隐式mock。前端无密钥，无题库汤底，无客户端传来的身份判断。

## 语音扩展

浏览器适配以相同登记、确认、转写及查询接口工作，录音是 16kHz、16bit、单声道 WAV；原生微信仍是 MP3。`audio.extension` 只由服务端适配器设定，客户端不能随意指定格式。`POST /audio?path=...` 仅接受已登记、当前会话所有者的路径和受限 WAV 正文；不接收任意 URL、不保存磁盘录音。最大 20 秒、静音与格式校验发生在付费识别前。

getSpeech 每次访问检查会话归属及结果状态，并计入独立 speech 日配额；每用户每类 100、全局每类 500，本机全局 100。客户端缓存重播不再次请求；服务端对同模型/音色/固定文本共享生成中的请求和未过期音频地址，冷启动不保证命中。合成失败短暂缓存且不自动重试。生成 URL 只接受百炼指定音频域名，转换为 HTTPS；请按云端网络能力配置播放/下载域名。

## 好友房与排行榜（2026-11-08）

以下操作仍通过同一 `game` 云函数；服务端使用微信上下文身份，本机使用固定主身份或服务端签发的访客凭据。不采信正文 `userId`。

| action | 输入摘要 | 返回/约束 |
|---|---|---|
| `getProfile` / `saveProfile` | 后者 `nickname`，1～12 字 | 当前玩家昵称；保存前内容检查 |
| `getLeaderboard` | `mode: solo/friends` | `rows`（前20人）、`me`；分数由服务端计算 |
| `createRoom` | `puzzleId` | 房主及六位 `room.id`，等待状态 |
| `joinRoom` | `roomId` | 仅等候房接纳新成员，最多6人；旧成员可重新连接 |
| `getRoom` | `roomId` | 当前成员可读的房间、消息及轮次；刷新心跳，不调用模型 |
| `startRoom` | `roomId` | 仅房主，至少2人；事务预占每位成员首次资格 |
| `roomChat` | `roomId, requestId, text` | 内容检查后共享文字，不进入裁判上下文 |
| `roomQuestion` / `roomGuess` | `roomId, requestId, turnSerial, text` | 当前玩家才能发起；每房一个活动裁判请求 |
| `getRoomRequest` | `roomId, requestId` | 只查本人的原操作，不重新调用模型 |
| `skipRoomTurn` / `roomHint` | `roomId, turnSerial` | 当前玩家；跳过使旧结果失去写回资格 |
| `revealRoom` | `roomId` | 仅房主，结束整房，0分结算 |
| `leaveRoom` | `roomId` | 主动退出；需要时转移房主与轮次 |
| `getRoomSpeech` | `roomId, target, messageId?` | 与单人播报相同的固定文本白名单，未结束不可取答案音频 |

公开房间不含原始 `uid`、完整题库、标准评分点或未揭晓答案。`members[].id` 是匿名标识；`myTurn/isHost` 供界面显示，服务器另行验证权限。消息区分 `discussion/question/guess/system`。`revision` 防止客户端晚到快照回退，`turnSerial` 阻止旧轮次提交；判题结束时再核验，讨论产生的新消息不会使正常判题失效。

讨论上限200字，猜底500字；房间内显示最近200条共享消息，裁判独立保留12条正式问答。昵称/讨论检查失败不公开写入；讨论也有独立配额和至少1秒发送间隔。`roomRequests` 保存去重摘要和状态，不保存玩家输入正文。

好友转写复用每人独立的 `startVoicePractice` / 上传 / ASR 接口；无须把房间设成录音文件的所有者。`getRoomSpeech` 与单人合成共享服务实例缓存。
