# AI 局部编辑入口

数据修改通常只需读本文件和 API.md，使用 manage.py，不需要读取前后端源码。

## 聊天概念收录

学术概念解释先在聊天中讨论，用户说“可加入”作为收录指令后，才新增或更新网站概念及本次配套文献、关系。整合当前讨论中已认可的解释和用户补充、修正，不只复制最后一条 AI 回答；范围限本次确认，不自动收录后续概念或额外前置概念。普通肯定、口令引用或否定不触发写入。用户明确要求编辑已有记录时直接执行该编辑。完整流程见 `.agents/skills/knowledge-consultation/专项技能/research-concept-atlas/SKILL.md`。

## 数据操作

从项目根目录运行，路径含空格时使用引号。put 为新增，patch 为指定记录的顶层字段替换。

没有远程配置时，manage.py 使用本机 `research-tools/data/`。部署到私人服务器后，将服务器的 HTTPS 根地址写入 `research-tools/.access/remote-url.txt`，并在本机 `.access/password.txt` 保存相同访问密码；配置后，manage.py 自动通过 Bearer 认证调用在线 API。运行这些命令时需先连接服务器所在的 Tailscale tailnet。连接失败会报错，不会静默改写本地数据。需要明确操作本机数据时添加 `--local`。

概念的 `definition` 和 `explanation` 支持 LaTeX：行内公式写成 `$...$` 或 `\\(...\\)`，独立公式写成 `$$...$$` 或 `\\[...\\]`。聊天 AI 写入概念时可直接在文本中使用这些定界符；网页会自动排版公式。

```powershell
python research-tools/manage.py list ideas --query "超导" --limit 10
python research-tools/manage.py get ideas idea-id
python research-tools/manage.py patch ideas idea-id --file work/idea-patch.json
python research-tools/manage.py put concepts --file work/concept-new.json
python research-tools/manage.py relations concept-id
python research-tools/manage.py tree
python research-tools/manage.py search "superconducting quench" --recent
python research-tools/manage.py attach paper-id --file "D:/path/paper.pdf" --revision 2
```

patch 文件例如 `{"revision":3,"notes":"本轮新增说明"}`。revision 使用刚读取的值；冲突重新 get 并合并，不重试旧覆盖操作。rationale、sources、steps 等对象或数组整体替换，先保留旧内容。研究记录以 data 下文件为准，不存浏览器 localStorage。字段详见 API.md。

现有记录优先按稳定 id 更新；list 按名称／别名查重。新文献 DOI 查重，概念名称和别名查重。概念自动关系使用 relations 接口，保存显式关系时引用已有 id。

每次检索保留 provider/query/retrieved_at/endpoint。先以候选保存 paper，再在核实相关性后添加 sources。page 表示 PDF 从第一页开始计数的物理页码；page_label 保存书本印刷页码；不能直接把印刷页码写成 page。

## 源码修改定位

| 修改目标 | 只需读取的入口 |
| --- | --- |
| 存储、字段验证、关联、拆解模板 | core.py；字段另查 API.md |
| 在线文献检索与元数据解析 | literature.py；对应 paper-lookup 数据库 reference |
| HTTP / PDF / 本地运行 | server.py |
| 外网入口、登录、远程运行 | REMOTE.md；按需读 remote.py / access.py / web/login.js |
| AI 命令 | manage.py |
| 页面导航、共享状态 | web/app.js |
| Idea 地图与任务编辑 | web/ideas.js |
| 概念分组、解释与关系 | web/concepts.js |
| 分类树展示、展开折叠、分类编辑表单 | web/concept-tree.js；样式查 styles.css 的 Classification tree |
| AI 分类树输出 | taxonomy.py；CLI 用 manage.py tree |
| 分类树与分类移动验收（临时目录） | check_tree.py |
| 文献、PDF 与检索 | web/papers.js |
| 表单、对话框、转义 | web/ui.js |
| 布局与外观 | web/styles.css、web/index.html |
| 后端验收（临时目录） | check_core.py |
| 远程认证与读写验收（临时目录） | check_access.py |
| 浏览器验收（隔离本地服务，8876） | check_web.py；需 bb-browser |

修改接口时同步 API.md 和受影响页面，避免读取整个项目。网页 UI 不需要知道 Skill 或开发文件位置。

## 分类树定点修改

`domain` 数组是唯一分类来源，从上级到下级排列。树结构自动派生，不存在另一份需同步的分类配置；相同前缀自动共用父节点，空数组进入「未分类」。

先用 `python research-tools/manage.py tree` 查看现有分类；按节点返回的概念 id/revision 对单条记录执行 patch。例如 `{"revision":2,"domain":["物理","凝聚态物理","超导"]}`，会把该概念移动至对应分支，并保留解释、出处、备注和关系。

改整个分类分支时，只获取该节点的后代概念，逐条替换 domain 中的相应前缀并附各自 revision。不要直接写树缓存，也不要修改 web 源码完成数据分类。冲突需重读该条记录并合并；不覆盖其他编辑。

用户在树的概念节点或详情点击「修改分类」，可以选择已有路径或输入新路径（`/` 分级、每行一级），保存后立即重绘。概念总编辑表单也提供同一分类路径。

## 本地使用

`python research-tools/server.py --open`。默认端口 8765，仅本机访问，无安装或打包要求；`--data PATH` 可隔离验证数据。数据目录位于 research-tools/data，PDF 位于其中的 pdf，旧记录保存在 .history。JSON 导出仅包含记录；完整备份复制整个 data 目录。

网站本身不调用语言模型：网页在线检索由公共文献 API 完成；科研评分、可靠定义和具体研究拆解由项目聊天 AI 按 Skill 完成。未配置远程地址时，数据只存本地；`manage.py` 可按上文设置改走私人服务器 API。系统不做后台自动抓取，也不计算法定节假日。
