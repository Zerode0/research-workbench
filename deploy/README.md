# 免费额度部署：Always Free Linux VM + Tailscale

这条路线让工作台在云端持续运行，个人电脑关机后仍可从手机访问。Linux VM 保存 Python 服务和数据；Tailscale Serve 提供仅限本人 tailnet 访问的 HTTPS 地址，不需要购买域名或开放网站端口。

## 费用与前提

- 选择云服务商的 Always Free Linux VM，并始终留在免费资源额度内。Oracle Cloud 的 Always Free VM 可用于运行现有程序，但账号验证、地区容量和免费额度受服务商规则影响；注册时可能要求支付卡验证。
- Tailscale 个人方案可用于本人设备组网。服务器和手机需加入同一个 tailnet，手机访问前需连接 Tailscale。
- 不要升级到付费云资源，也不要开放超出免费额度的配置。

## 部署位置

- 代码：`/opt/research-workbench`
- 记录和 PDF：`/var/lib/research-workbench/data`
- 登录密码：`/etc/research-workbench/password.txt`
- Tailscale HTTPS 地址：`https://workbench.tailnet.ts.net`（示例；替换为服务器实际的 `*.ts.net` 地址）

记录、PDF 和密码不放进 Git。部署时需把当前电脑的整个 `research-tools/data/` 目录安全复制到服务器的数据目录，并核对文件数和大小。密码可沿用当前 `.access/password.txt` 中的密码，但要通过 SSH 安全复制；不要提交到仓库或贴入聊天。

## 配置步骤

1. 在云服务商创建免费额度内的 Linux VM。安装 Python 3.9 或更高版本、Git 和 Tailscale；按需限制 SSH 管理入口。
2. 在 VM 和手机安装并登录 Tailscale 的同一 tailnet。在管理设置中启用 MagicDNS 和 HTTPS 证书，然后记下 VM 的完整 `*.ts.net` 名称。
3. 创建服务用户和目录：

   ```sh
   sudo adduser --system --group --no-create-home research-workbench
   sudo install -d -o root -g research-workbench -m 0750 /opt/research-workbench
   sudo install -d -o research-workbench -g research-workbench -m 0750 /var/lib/research-workbench/data
   sudo install -d -o root -g research-workbench -m 0750 /etc/research-workbench
   ```

4. 配置 GitHub 只读部署密钥，将私有仓库克隆到 `/opt/research-workbench`，并让服务用户可读取代码。
5. 安全复制 `research-tools/data/` 内的全部记录和 PDF 到 `/var/lib/research-workbench/data/`，并设置属主：

   ```sh
   sudo chown -R research-workbench:research-workbench /var/lib/research-workbench/data
   ```

6. 安全复制 `.access/password.txt` 到 `/etc/research-workbench/password.txt`，设置权限为 `0640`，属主 `root`、属组 `research-workbench`。
7. 将 `research-workbench.service.example` 复制到 `/etc/systemd/system/research-workbench.service`，把 `workbench.tailnet.ts.net` 替换为第 2 步记下的服务器名称。
8. 启动工作台和 Tailscale 私有 HTTPS 入口：

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now research-workbench tailscaled
   sudo tailscale serve --bg --https=443 http://127.0.0.1:8765
   sudo tailscale serve status
   ```

9. 手机连接 Tailscale，在浏览器打开服务器的 `https://<服务器名>.<tailnet名>.ts.net`，再输入工作台访问密码。

Tailscale Serve 仅向 tailnet 内的设备提供网站。不要改成 Funnel；Funnel 会把入口公开到互联网。

## 让科研 AI 使用云端数据

迁移并确认手机网页可登录后，在电脑项目根目录执行：

```powershell
Set-Content -Encoding utf8 -NoNewline -Path 'research-tools/.access/remote-url.txt' -Value 'https://<服务器名>.<tailnet名>.ts.net'
```

确认本机 Tailscale 已连接同一 tailnet，且 `research-tools/.access/password.txt` 与服务器密码一致。之后 `manage.py` 会把科研 AI 的读写操作发到云端 API；网络不可用时会报错，不会改写本机数据。只有明确需要处理本机副本时才加 `--local`。

## 更新和备份

更新代码时，在 VM 拉取私有仓库的新提交并重启 `research-workbench` systemd 服务。独立数据目录不会被代码更新覆盖。应定期将整个数据目录备份到云 VM 之外的位置，并检查 JSON 记录和 PDF 均可恢复。
