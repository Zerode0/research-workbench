# 数据与 HTTP 接口（v1）

所有文本 UTF-8；id 使用 `[a-z0-9][a-z0-9_-]{0,79}`。JSON 对象的额外字段保留。所有记录含 `id,title,revision,created_at,updated_at`，concept 用 name 而不是 title。revision 由服务写入。

## Ideas
`{id,title,summary,status:"inbox|active|paused|done",urgency:0..100,importance:0..100,difficulty:0..100,assessment:"draft|reviewed",rationale:{urgency:"",importance:"",difficulty:""},assessed_at:"YYYY-MM-DD",deadline:"YYYY-MM-DD或空",sources:[{paper_id,page:null或整数,page_label:"",locator:"",verified_page:false}],tags:[],steps:[{id,title,days:1..3,status:"todo|doing|done",deliverable:"",acceptance:"",depends_on:[]}],notes:"",revision}`。

## Concepts
`{id,name,aliases:[],domain:["物理","超导"],definition:"",explanation:"",sources:[来源对象同上],related_ids:[],prerequisite_ids:[],tags:[],notes:"",revision}`。

### 分类树
概念分类树由 `domain` 从上级到下级派生，相同前缀合并，空路径归入「未分类」。修改分类仍使用单条概念 PATCH，例如 `{revision:旧版本,domain:["物理","超导"]}`，不改其他字段。CLI `manage.py tree` 或 `GET /api/concept-tree` 返回 `{name,kind:"root",path:[],count,concepts:[],children:[节点]}`；分类节点包含 `name,kind:"category|uncategorized",path,count,concepts:[{id,name,revision}],children`，count 为本节点与后代概念总数。树是只读派生结构。

## Papers（亦存教材）
`{id,title,kind:"paper|textbook",authors:[],year:null或整数,doi:"",url:"",pdf_url:"",abstract:"",venue:"",provenance:{provider:"",query:"",retrieved_at:"",endpoint:""},local_pdf:"服务维护",notes:"",revision}`。

## HTTP
- `GET /api/state` → `{ideas:[],concepts:[],papers:[],today:"YYYY-MM-DD",max_step_days:3}`，列表按 updated_at 降序。详情从单条接口取。
- `GET /api/{ideas|concepts|papers}/{id}` → 单条记录。
- `POST /api/{collection}` → 创建（201），body 单条记录，可省略 id。
- `PATCH /api/{collection}/{id}` → body `{revision:旧版本号,...要替换的顶层字段}`。对象顶层替换，数组整体替换，保留其他字段。成功返回最新记录。冲突返回 409，应重读并合并；错误返回 `{error:"..."}`。
- `DELETE /api/{collection}/{id}?revision=N` → `{deleted:true}`。已被来源或显式概念关系引用时拒绝，先编辑引用方。
- `GET /api/relations/{concept_id}` → `{concepts:[{id,name,type:"mentioned|related|prerequisite|referenced_by",reason:""}],papers:[{id,title,type:"source|candidate",reason:""}]}`。
- `GET /api/literature?q=关键词&provider=openalex|crossref&recent=0|1` → `{provider,query,retrieved_at,results:[paper对象（未入库，无revision）],warnings:[]}`。网络失败 502，前端显示错误且保留现有数据。OpenAlex 失败时仅尝试一次 Crossref 回退，warnings 披露。
- `POST /api/papers/{id}/pdf?revision=N` → body 原始 PDF bytes，Content-Type application/pdf；返回最新 paper。
- 本地 PDF 访问 `/pdf/{paper_id}.pdf#page=N`。仅 verified_page 且 page 为正整数时跳页，否则不加 page。local_pdf 是相对数据根目录路径；前端据其是否非空选择本地 URL。
- `GET /api/export` → `{schema_version:1,ideas:[],concepts:[],papers:[]}`。
- `POST /api/import` → body export 数据；仅新增 id，遇到重复、悬空引用或非法记录整体拒绝，避免覆盖；返回 `{imported:N}`。
- `POST /api/ideas/{id}/decompose` → body `{revision:N}`，仅 steps 为空才创建三个可编辑草稿步骤（文献梳理、最小验证、结论整理）；返回最新 idea。

前端不能直接写文件、不存密钥。用户文本通过 textContent 或安全转义输出。PDF URL/论文 URL 仅允许 http(s)。时间按 Asia/Shanghai，JSON 备份是持久层，localStorage 仅作界面偏好。

## 远程登录

通过 `--public-url https://站点` 或非回环 `--host` 启动时必须登录。`GET /api/access` 返回 `{login_required:布尔值}`；`POST /auth/login` body `{password:"访问密码"}` 返回登录 Cookie；`POST /auth/logout` 删除当前浏览器 Cookie。其他数据、检索、PDF 和源码页面均要求认证；支持 Cookie 或 Bearer 密码。Host 和写入 Origin 必须属于启动时配置的精确地址。默认本机 127.0.0.1 模式保留原行为。外网启动与停止详见 REMOTE.md。
