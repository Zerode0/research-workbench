# 外网访问与编辑

## 免费额度云端常驻（当前部署方案）

若希望电脑关机后仍可用手机访问，使用 `deploy/README.md` 中的 Always Free Linux VM + Tailscale Serve 方案。网页和记录在云 VM 上运行；Tailscale HTTPS 地址仅对已加入同一 tailnet 的设备开放，不需购买域名。云端迁移后，可用 `research-tools/.access/remote-url.txt` 让 `manage.py` 经 Bearer 认证操作云端数据。开通免费 VM 仍受服务商账号验证、地区容量和免费资源规则限制。

## 本机临时外网入口

通过 Cloudflare Quick Tunnel 提供临时 HTTPS 入口，无需域名或云端账号。数据仍保存在本机 `research-tools/data/`；远程网页与项目聊天 AI 读写同一份记录，版本冲突仍由后端拒绝。

## 准备与开启

`python research-tools/remote.py prepare` 下载 Cloudflare 官方客户端，并用官方 GitHub release 的 SHA-256 校验；生成随机访问密码。此命令不启用外网访问，也不安装系统服务。

当前准备状态（2026-10-13）：登录、远程读写、Cookie、Host/Origin 与版本冲突的本地检查已通过。官方客户端下载遇到网络读取超时，未开启外网入口；下次 prepare/start 会重新尝试官方下载安装。现有本机 8765 服务不受影响。

`python research-tools/remote.py start --open` 开启入口并打开登录页。此命令是外网发布步骤，需要项目规则要求的发布授权。外网地址显示在终端，也保存在 `.access/remote.json`。访问密码见 `.access/password.txt`；密码不放在 URL、日志或 JSON 导出中。登录有效期 12 小时。密码可手动更换为 20–200 字符，重启外网入口后旧会话失效。

入口进程运行时，其他设备用 HTTPS 地址登录后即可修改；主机须开机且联网。地址在重启后通常改变；Quick Tunnel 适合个人临时使用，不是长期固定域名部署。按 Ctrl+C 关闭入口。若希望长期固定网址，再配置具名 Tunnel 和域名。

## 实现位置

- access.py：密码校验、签名 Cookie、登录尝试限制。
- server.py：Host/Origin 限制、登录路由、接口和 PDF 权限。
- web/login.html、login.js：登录页。
- remote.py：官方客户端准备、HTTPS 隧道、本地认证服务生命周期。

内部认证服务使用 8766，监听 127.0.0.1；原本的本机 8765 服务可继续使用。远程网页没有直接访问磁盘目录的权限，只能访问指定记录接口和文献附件。外网 API 与本地 API 相同，除登录外均需会话或 `Authorization: Bearer <访问密码>`。

## 局域网或私人 VPN（按需）

`python research-tools/server.py --host 0.0.0.0 --port 8766` 启用本机网卡监听并要求密码登录；默认密码文件不变。也可只绑定某个私人 VPN 的网卡 IP。额外设备地址通过 `--allow-host IP:8766` 指定。此方式未配置 HTTPS，应使用可信局域网或加密私人 VPN，不能作为公开互联网入口。
