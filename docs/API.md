# 单人语音版接口约定

所有小程序请求使用 `wx.cloud.callFunction({ name: 'game', data: { action, ...payload } })`。服务端从微信上下文取得用户身份，不接受客户端 openId。

统一响应：成功 `{ ok: true, data }`；失败 `{ ok: false, error: { code, message, retryable: false } }`。不会把服务错误映射成游戏判词。

## 操作

| action | payload | data |
|---|---|---|
| status | 无 | `{ configured, textReady, voiceReady, environment: 'cloud', ownerKey }`；ownerKey是用户散列，不返回密钥；ready只表示配置齐备，并非联调通过 |
| listPuzzles | 无 | `{ puzzles: [{ id, title, difficulty, teaser }] }`；无汤底 |
| startSolo | `{ puzzleId }` | `{ session }` |
| getSession | `{ sessionId }` | `{ session }` |
| registerUpload | `{ sessionId }` | `{ uploadId, cloudPath }`，云端登记所属用户及24小时清理期限 |
| confirmUpload | `{ sessionId, uploadId, fileID }` | `{ confirmed: true }`；上传完成立即登记私有fileID |
| transcribeAudio | `{ sessionId, requestId, uploadId, fileID, replaceRequestId? }` | `{ requestId, status, transcript?, usage? }` |
| askQuestion | `{ sessionId, requestId, text, replaceRequestId? }` | `{ requestId, status, session?, answer? }` |
| guessAnswer | `{ sessionId, requestId, text, replaceRequestId? }` | 同上；`answer`为猜底枚举 |
| getRequest | `{ sessionId, requestId }` | `{ requestId, status, transcript?, session? }`，不暴露内部解释 |
| getHint | `{ sessionId }` | `{ session }`，静态逐级提示，无模型费 |
| revealSoup | `{ sessionId }` | `{ session }`；前端需确认 |
| clearSession | `{ sessionId }` | `{ cleared: true }`；作废、撤销活动请求并删除正文 |
| feedback | `{ sessionId, messageId?, kind: 'wrong_answer'|'puzzle_issue' }` | `{ received: true }`；不收自由文本 |

上传步骤：registerUpload → wx.cloud.uploadFile({cloudPath,filePath}) → confirmUpload → transcribeAudio。只允许已登记的当前用户私有上传路径，不能传任意音频URL。取消时调用 `discardUpload { sessionId, uploadId, fileID? }`。录音设置19秒，服务端按实际MP3帧验证不超过20秒、1MB、单声道；私有文件下载也限制为1MB/8秒，临时下载地址不下发客户端。

请求状态为 `processing | succeeded | failed | unknown | superseded`。unknown表示厂商可能已经计费，不可自动重新外呼。同requestId只读回原结果；用户显式确认重试后生成新ID并携带旧replaceRequestId，撤销旧请求游戏写回资格。

## 公开会话

```js
{
  id, puzzleId, puzzleVersion, title, difficulty, surface,
  state: 'playing' | 'solved' | 'revealed' | 'expired' | 'cleared',
  messages: [{ id, type: 'question'|'guess', text, answer, createdAt }],
  hints: [/* 已解锁文本 */], hintCount, maxHints: 3,
  questionCount, guessFailures, maxGuessFailures: 5,
  attempts, maxAttempts: 50, expiresAt,
  solution: /* 只在solved或revealed时存在 */,
  activeRequestId: /* 用于恢复，不含内部原始内容 */
}
```

提问枚举 `yes | no | irrelevant | unspecified | clarify`。
猜底枚举 `solved | incomplete | incorrect | uncertain`。只有 incorrect 消耗5次失败猜底机会；所有模型外呼都计入50次尝试。

## 服务端依赖边界

`createService({ store, provider, audio, puzzles, clock, idFactory, limits })`。`store.transaction(async tx => ...)`中tx提供 `get(collection,id)`、`set(collection,id,value)`、`delete(collection,id)`；外呼不在事务里。

`provider.ready()`返回 `{textReady,voiceReady}`。`provider.judge({puzzle,history,text,kind})`返回 `{answer,usage:{inputTokens,outputTokens}}`，内部判定不得原样下发；`provider.transcribe({buffer})`返回 `{text,usage?}`。未配置时抛出 `CONFIG_REQUIRED`，不得默认伪造AI答案。

`audio.inspect({fileID,cloudPath})`返回 `{buffer,durationSeconds}`并在服务端验证实际MP3、大小、时长及路径；`audio.remove(fileID)`删除上传文件。清理函数需支持24小时孤立文件、7天会话正文和30天去标识计量清理，需可测试。

每日配额对裁判调用、ASR、音频登记/下载检查、开局分别计数；默认每用户每类100、全局每类500，配额只可在云端调低。已知失败不退回预占，避免通过异常反复外呼。裁判请求正文上限为24KB UTF-8（并非精确token计数），超出明确提示，不静默截断；完整猜底独立判断，不携带历史，因此长对话仍可提交最终解释。实际token用量仅以厂商返回计量为准。

本地开发可显式提供测试provider，云函数生产入口不允许隐式mock。前端无密钥，无题库汤底，无客户端传来的身份判断。
