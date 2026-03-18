# 附件支持 PRD

状态：草案  
分支：`codex/attachment-support-docs`  
范围：`mails` 开源仓库

## 背景

`mails` 现在能发纯文本/HTML 邮件，也能收信、提取验证码、查询 inbox，但附件仍然是缺失能力。

这带来三个直接问题：

1. Agent 无法发送常见业务附件，如 PDF、CSV、票据、报告。
2. 收件链路会丢失附件，导致发票、简历、合同、行程单等核心信息无法被 Agent 使用。
3. 即使我们已经开始做邮件搜索，附件内容仍然不会进入搜索范围，尤其是 PDF 内文完全不可见。

对 Agent 来说，附件不是可有可无的“富媒体增强”，而是邮件工作流中的核心载体。

## 产品原则

### 1. 附件是必要能力，不做成完整邮箱平台

我们要支持：

- 发附件
- 收附件
- 存附件
- 让 Agent 能读取、下载、搜索附件信息

我们不在这个需求里引入完整的线程/草稿/标签/多人协作平台模型。

### 2. 发信尽量委托给现有提供商

附件发送直接复用 Resend 的发送 API，不自己构建 MIME 发送基础设施。

### 3. 收件和搜索由我们掌控

附件的接收、落库、提取信息、搜索集成是 `mails` 自己的能力边界，因为这是 Agent 工作流的核心资产。

### 4. 自部署不能明显变复杂

方案必须控制额外部署复杂度。附件支持不能演变成“为了一个功能多引入半个邮件平台”。

## 目标

### 核心目标

1. 支持通过 SDK 和 CLI 发送附件邮件。
2. 支持 Worker 在接收邮件时识别附件并持久化。
3. 支持查询单封邮件时返回附件元数据。
4. 支持下载已存储的附件。
5. 支持把附件文件名和可提取文本纳入搜索范围。

### 搜索目标

附件搜索在 v1 不做“语义搜索”，只做结构化和关键词搜索：

- 文件名可搜索
- 支持类型的正文可提取并搜索
- 搜索结果仍然以“邮件”为单位返回，而不是单独返回附件

### v1 支持的搜索型附件

- `text/plain`
- `text/csv`
- `text/markdown`
- `application/json`
- `application/pdf`

### v1 非搜索目标

这些类型在 v1 可以接收和存储，但不承诺提取正文：

- 图片
- Office 文档（`.docx`, `.xlsx`, `.pptx`）
- 压缩包
- 音视频

## 非目标

以下内容明确不属于这个需求：

- 完整线程/会话模型
- 邮件客户端式附件预览 UI
- OCR
- 病毒扫描引擎
- 全文语义搜索 / embedding
- 附件去重产品化能力
- 批量附件管理后台

## 用户故事

### 发信

- 作为 Agent，我可以发送一封附带 `invoice.pdf` 的邮件。
- 作为 Agent，我可以一次发送多份附件，而不需要自己拼 MIME。

### 收信

- 作为 Agent，我收到一封带 PDF 的邮件后，系统会保留附件，不再只保留正文。
- 作为 Agent，我查询单封邮件时，可以知道有哪些附件、名称是什么、类型是什么、大小是多少。

### 搜索

- 作为 Agent，我搜索 `invoice` 时，邮件主题没写 invoice，但附件名是 `invoice-2026-03.pdf`，也应命中。
- 作为 Agent，我搜索 PDF 内文中的订单号时，包含该 PDF 的邮件应命中。

## 功能需求

### 1. 附件发送

系统必须支持：

- SDK `send()` 传入附件数组
- CLI `mails send` 通过重复参数附带多个文件
- 透传给 Resend 的 `attachments` 能力

系统应支持的字段：

- `filename`
- `content`
- `contentType`
- `path`
- `contentId`（为后续 inline image 留口）

### 2. 附件接收

Worker 在收到邮件时必须：

- 识别是否存在附件
- 解析附件元数据
- 保存附件和邮件的关联关系
- 为可搜索类型提取文本

### 3. 附件存储

系统必须持久化以下信息：

- 附件 ID
- 所属邮件 ID
- 文件名
- MIME 类型
- 大小
- disposition / content-id
- 原始内容的存储定位信息
- 可提取文本
- 提取状态

### 4. 邮件读取

查询单封邮件时，返回结构必须带上 `attachments[]`，至少包含：

- `id`
- `filename`
- `content_type`
- `size_bytes`
- `downloadable`
- `text_extraction_status`

### 5. 附件下载

需要新增单独的附件读取能力，用于：

- CLI 后续下载
- SDK 读取
- Worker HTTP API 暴露附件下载

### 6. 搜索集成

附件信息需要进入邮件级搜索，但返回结果仍然是邮件。

搜索最少要覆盖：

- 附件名
- 附件提取出的文本

### 7. 失败与降级

如果附件无法提取文本，不应导致整封邮件失败。

允许的降级策略：

- 元数据存储成功，正文提取失败
- 邮件正常可查，附件可下载，但搜索不到正文

## 约束

### 大小约束

v1 必须设置保守上限，避免把附件能力做成数据库/Worker 的稳定性问题。

建议默认：

- 单个附件搜索提取上限：`10MB`
- 单封邮件总提取上限：`25MB`

超过上限时：

- 仍保存附件元数据
- 原始文件仍尽量保存
- 标记为 `too_large_for_text_extraction`

### 类型约束

对可执行文件、未知二进制类型，只做存储和元数据保留，不做正文提取。

## 分阶段发布

### Phase 1：附件发送

- SDK 支持附件
- CLI 支持 `--attach`
- Resend provider 支持 `attachments`

### Phase 2：附件接收与存储

- Worker 解析附件
- 存储附件元数据
- 保存原始内容
- 单封邮件接口返回附件列表

### Phase 3：附件搜索

- 提取 PDF / 文本类附件正文
- 文件名进入搜索
- 提取文本进入搜索

## 成功标准

### 交付标准

1. `mails send` 能发送带附件邮件。
2. Worker 收到带附件邮件后，单封邮件详情里能看到附件列表。
3. PDF 附件内容可以在搜索中命中对应邮件。
4. 附件解析失败不会导致整封邮件丢失。

### 体验标准

- 对用户来说，附件是邮件对象的自然组成部分，而不是“另一个系统”
- 搜索附件不要求用户切换到单独的附件产品模型

## 与回复功能的关系

本需求不包含完整“回复功能”交付，但需要为它留好基础：

- 收件侧要保留 `message_id`
- 头部里的 `In-Reply-To` / `References` 不能丢

因为 Resend 已支持通过发送时附加邮件头来维持回复线程，所以我们不需要自己先发明线程系统，再做附件。

## 参考资料

- Resend Send Email: <https://resend.com/docs/api-reference/emails/send-email>
- Resend Attachments: <https://resend.com/docs/dashboard/emails/attachments>
- Resend Retrieve Received Email: <https://resend.com/docs/api-reference/emails/retrieve-received-email>
- Resend List Received Email Attachments: <https://resend.com/docs/api-reference/emails/list-received-email-attachments>
- Resend Reply to Receiving Emails: <https://resend.com/docs/dashboard/receiving/reply-to-emails>
