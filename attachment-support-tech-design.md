# 附件支持技术设计

状态：草案  
配套文档：[attachment-support-prd.md](./attachment-support-prd.md)

## 1. 当前状态

### 发信侧

当前 `mails` 发信链路：

- `src/core/send.ts`
- `src/providers/send/resend.ts`
- `src/cli/commands/send.ts`

现状：

- 支持 `text` / `html`
- 支持 `replyTo`
- 不支持 `attachments`
- 不支持自定义 `headers`

### 收信侧

当前 Worker 在 `worker/src/index.ts` 中：

- 直接读取 `message.raw`
- 用正则粗提取 `text/plain` / `text/html`
- 提取验证码
- 写入 `emails` 表

现状问题：

- 不解析 multipart/mixed 附件结构
- 不保存原始 MIME
- 不保存附件元数据
- 不保存附件正文
- 无法下载附件

### 搜索侧

`main` 目前还没有附件搜索。  
搜索分支已经做了邮件正文搜索，但没有附件字段。

这意味着如果我们现在只补“附件可收发”，后续还要再返工一次 schema 和搜索索引。  
因此本设计会一次把“附件可搜索的数据面”设计进去。

## 2. 设计原则

### 2.1 发信尽量薄封装

发附件直接复用 Resend 的 `attachments` 参数，不自己拼发信 MIME。

### 2.2 收件自己解析

当前开源仓库的接收路径是 Cloudflare Email Worker，不是 Resend Receiving。  
因此附件接收不能依赖 Resend 的 receiving API，必须由 Worker 解析原始 MIME。

### 2.3 搜索按邮件聚合，不新增“附件搜索产品”

搜索入口仍是 `mails inbox --query ...`。  
附件名和附件正文应汇总为邮件级搜索字段。

### 2.4 二进制与元数据分离

数据库保存元数据、提取文本和搜索字段。  
原始二进制不直接塞进主查询表。

## 3. 技术决策

## 3.1 MIME 解析库

Worker 改为使用 `postal-mime` 解析原始邮件，而不是继续依赖正则。

原因：

- 适配 Cloudflare Email Workers
- 能稳定解析 multipart、headers、attachments
- 比手写 MIME 解析更可靠

参考：

- <https://postal-mime.postalsys.com/>
- <https://postal-mime.postalsys.com/docs/guides/cloudflare-workers>
- Cloudflare Email Workers 文档同样给出了 `postal-mime` 示例

## 3.2 原始内容存储策略

### 选择

附件原始内容不写入 `emails` 主表，也不直接塞进 D1 / SQLite 查询路径。  
采用“原始 MIME 单独存储 + 附件元数据入库”的方案。

### 推荐实现

- Worker / Cloudflare 部署：R2
- 本地开发与测试：filesystem

### 为什么不是直接把附件二进制塞进数据库

- D1 / SQLite / db9 更适合查询型数据，不适合长期存储大二进制
- 一旦把 PDF / 图片正文直接混进主表，查询、备份、迁移都会恶化
- 原始 MIME 存一次即可，后续下载附件时按 part 重新切出，避免为每个附件再做一份 blob 副本

### 自部署复杂度控制

虽然 Worker 侧会新增一个 R2 bucket，但这是唯一新增的基础设施。  
相比把大对象塞进数据库，R2 的运维复杂度更低，后续风险更小。

## 4. 数据模型

## 4.1 新增类型

### 发送附件

```ts
export interface SendAttachment {
  filename?: string
  content?: string
  path?: string
  contentType?: string
  contentId?: string
}
```

### 邮件附件

```ts
export interface Attachment {
  id: string
  email_id: string
  filename: string
  content_type: string
  size_bytes: number | null
  content_disposition: string | null
  content_id: string | null
  mime_part_index: number
  text_content: string
  text_extraction_status: 'pending' | 'done' | 'unsupported' | 'failed' | 'too_large'
  storage_key: string | null
  created_at: string
}
```

### Email 扩展

```ts
export interface Email {
  ...
  message_id?: string | null
  attachment_count?: number
  attachment_names?: string
  attachment_search_text?: string
  attachments?: Attachment[]
}
```

### SendOptions 扩展

```ts
export interface SendOptions {
  ...
  attachments?: SendAttachment[]
}
```

## 4.2 数据表

### emails 表新增字段

- `message_id`
- `has_attachments`
- `attachment_count`
- `attachment_names`
- `attachment_search_text`
- `raw_storage_key`

其中：

- `attachment_names`：所有文件名拼接后的搜索字段
- `attachment_search_text`：所有可提取附件正文拼接后的搜索字段
- `raw_storage_key`：原始 `.eml` blob 的定位信息

### 新增 attachments 表

```sql
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER,
  content_disposition TEXT,
  content_id TEXT,
  mime_part_index INTEGER NOT NULL,
  text_content TEXT DEFAULT '',
  text_extraction_status TEXT NOT NULL DEFAULT 'pending',
  storage_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_attachments_email_id ON attachments(email_id);
CREATE INDEX idx_attachments_filename ON attachments(filename);
```

说明：

- `storage_key` 默认与邮件级 `raw_storage_key` 一致即可，不必每个附件单独存 blob
- `mime_part_index` 用于从原始 MIME 重新定位附件

## 5. 存储抽象

新增 `AttachmentBlobStore`：

```ts
export interface AttachmentBlobStore {
  putRawEmail(key: string, raw: ArrayBuffer): Promise<void>
  getRawEmail(key: string): Promise<ArrayBuffer | null>
  deleteRawEmail(key: string): Promise<void>
}
```

v1 实现：

- `filesystem`：本地测试/开发
- `r2`：Worker 部署

## 6. 发送设计

## 6.1 SDK

`send()` 增加 `attachments?: SendAttachment[]`

`src/providers/send/resend.ts` 直接映射到 Resend：

- `attachments`
- `headers`

这也顺带为后续回复功能留口：

- `In-Reply-To`
- `References`

## 6.2 CLI

`mails send` 新增：

- `--attach <path>`，可重复

示例：

```bash
mails send \
  --to user@example.com \
  --subject "Invoice" \
  --body "See attached." \
  --attach ./invoice.pdf \
  --attach ./receipt.csv
```

v1 不做：

- 直接从 stdin 传附件二进制
- CLI 自定义 attachment filename

## 7. 接收设计

## 7.1 Worker 接收流程

新的 email() 处理流程：

1. 读取 `message.raw`
2. 将原始 MIME 存入 blob store
3. 用 `postal-mime` 解析：
   - headers
   - text
   - html
   - message-id
   - attachments
4. 对每个附件生成 `Attachment` 记录
5. 对支持类型做文本提取
6. 聚合 `attachment_names` 和 `attachment_search_text`
7. 写入 `emails` 与 `attachments`

## 7.2 文本提取策略

### v1 支持

- `text/plain`
- `text/csv`
- `text/markdown`
- `application/json`
- `application/pdf`

### v1 不支持

- 图片 OCR
- docx / xlsx / pptx
- zip / rar

### 提取结果处理

- 成功：`text_extraction_status = done`
- 类型不支持：`unsupported`
- 文件太大：`too_large`
- 解析报错：`failed`

失败时不影响整封邮件入库。

## 7.3 PDF 提取

PDF 是这个需求里最重要的搜索型附件。  
实现时建议单独引入 PDF 文本提取库，但要满足：

- Bun / Node 侧可测试
- Worker 侧可运行，或可在异步任务里运行

因为 Cloudflare Worker 运行时对某些 PDF 生态库不友好，建议实现时优先做技术验证，再确定具体库。  
本设计先锁定“PDF 必须进入搜索范围”这个产品结论，不把库名过早写死。

## 8. 查询与 API

## 8.1 单封邮件

`GET /api/email?id=<id>` 返回值新增：

```json
{
  "id": "...",
  "subject": "...",
  "attachments": [
    {
      "id": "...",
      "filename": "invoice.pdf",
      "content_type": "application/pdf",
      "size_bytes": 183421,
      "text_extraction_status": "done"
    }
  ]
}
```

## 8.2 附件下载

新增：

```text
GET /api/attachment?id=<attachment_id>
```

流程：

1. 查 `attachments`
2. 通过 `storage_key` 取原始 MIME
3. 用 `mime_part_index` 重新切出目标附件
4. 以附件原始类型流式返回

## 8.3 CLI

`mails inbox <id>` 至少增加附件摘要输出：

```text
Attachments:
- invoice.pdf (application/pdf, 183421 bytes)
- receipt.csv (text/csv, 1204 bytes)
```

`mails attachment download <id>` 可作为后续小分支，不强制纳入本次首批交付。

## 9. 搜索设计

## 9.1 数据面

附件搜索不直接扫 blob，而是扫预聚合字段：

- `emails.attachment_names`
- `emails.attachment_search_text`

这样做的好处：

- SQLite 好实现
- db9 好实现
- 查询仍然以邮件为中心

## 9.2 SQLite

在 `searchEmails()` 中追加：

- `attachment_names LIKE ? COLLATE NOCASE`
- `attachment_search_text LIKE ? COLLATE NOCASE`

## 9.3 db9

在 `SEARCH_VECTOR` 中追加：

- `attachment_names`
- `attachment_search_text`

并保留对文件名的显式 `ILIKE` 回退。

## 9.4 与当前搜索分支的关系

因为搜索功能当前还在独立分支，本需求不应和搜索分支混写。  
正确做法是：

1. 本需求先把附件字段、schema、聚合数据面设计清楚
2. 搜索分支合并后，再把附件字段接进 `searchEmails()`

这样可避免再次改 schema。

## 10. 回复能力的技术结论

Resend 对回复线程的支持已经足够：

- 发送时可带 `headers`
- 关键头是 `In-Reply-To`
- 多轮线程需要 `References`

因此 `mails` 不需要先建一个完整线程系统。

为了未来回复功能简单化，这次附件需求里应该顺带保留：

- 入站 `message_id`
- 原始邮件头

未来做 reply 时，只要在发送时透传这些头即可。

## 11. 测试计划

## 11.1 单元测试

- Resend provider 附件 payload
- CLI `--attach` 参数解析
- Worker multipart/mixed 解析
- 附件元数据建模
- SQLite / db9 schema roundtrip
- 搜索字段聚合

## 11.2 E2E

### 发送

- mock Resend，验证 `attachments` 透传

### 接收

- Worker 输入 multipart/mixed 邮件
- 断言：
  - `emails` 正常落库
  - `attachments` 正常落库
  - 单封邮件详情包含附件

### 搜索

- PDF / txt 附件提取文本后
- `mails inbox --query <term>` 命中对应邮件

## 12. 建议实现分支

为了不把一个需求做成超大分支，建议按产品特性拆：

### Branch 1：`feat/attachments-core`

- `SendOptions.attachments`
- Resend 发附件
- Worker MIME 解析
- 附件元数据表
- 原始 MIME 存储
- 单封邮件详情返回附件

### Branch 2：`feat/attachment-text-extraction`

- 可搜索类型正文提取
- PDF 提取
- `attachment_names` / `attachment_search_text` 聚合

### Branch 3：`feat/attachment-search`

- 和 inbox 搜索分支对接
- SQLite / db9 搜索集成
- 搜索 E2E

### Branch 4：`feat/reply-headers`

- `headers` / `inReplyTo` / `references`
- 基于 Resend 的轻量 reply 能力

## 13. 风险

### 13.1 Worker PDF 提取兼容性

PDF 库在 Worker 环境下可能是实现难点。  
需要先做小型 spike。

### 13.2 大附件

如果不限制大小，附件能力会很快把成本和稳定性拖坏。  
必须有提取上限和清晰降级。

### 13.3 当前架构分裂

`mails` 核心存储提供者与 Worker D1 目前不是同一套抽象。  
附件功能会把这个裂缝放大，因此实现时应尽量统一模型，而不是继续双轨复制逻辑。

## 14. 参考资料

- Resend Send Email: <https://resend.com/docs/api-reference/emails/send-email>
- Resend Attachments: <https://resend.com/docs/dashboard/emails/attachments>
- Resend Retrieve Received Email: <https://resend.com/docs/api-reference/emails/retrieve-received-email>
- Resend List Received Email Attachments: <https://resend.com/docs/api-reference/emails/list-received-email-attachments>
- Resend Retrieve Received Email Attachment: <https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment>
- Resend Reply to Receiving Emails: <https://resend.com/docs/dashboard/receiving/reply-to-emails>
- PostalMime: <https://postal-mime.postalsys.com/>
- PostalMime Cloudflare Workers Guide: <https://postal-mime.postalsys.com/docs/guides/cloudflare-workers>
