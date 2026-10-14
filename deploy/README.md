# Linux VPS 部署模板

本模板面向 Debian/Ubuntu、systemd 和 Caddy。科研工作台使用 Python 标准库提供动态 API；GitHub 只存代码，不能替代持续运行的服务器。

## 上线前需要

- 一台持续运行的 Linux VPS，以及指向它的域名。
- 防火墙只开放 SSH、HTTP（80）和 HTTPS（443）；工作台端口 8765 仅绑定本机回环地址。
- Python 3.9 或更高版本、Git、Caddy。
- GitHub 私有仓库的只读部署密钥。私钥只放在服务器上，不要提交到仓库。

## 路径约定

- 代码：`/opt/research-workbench`
- 记录和 PDF：`/var/lib/research-workbench/data`
- 登录密码：`/etc/research-workbench/password.txt`
- 网站地址：`https://workbench.example.com`（示例域名需替换）

记录、PDF 和密码不放进 Git。部署时应将当前电脑的整个 `research-tools/data/` 目录安全复制到服务器的数据目录，并校对文件数和大小。首次启动前设置独立的长随机密码；保管好密码，勿放入命令历史或聊天记录。

## 配置

1. 安装 Python、Git、Caddy，并创建服务用户和数据目录：

   ```sh
   sudo adduser --system --group --no-create-home research-workbench
   sudo install -d -o root -g research-workbench -m 0750 /opt/research-workbench
   sudo install -d -o research-workbench -g research-workbench -m 0750 /var/lib/research-workbench/data
   sudo install -d -o root -g research-workbench -m 0750 /etc/research-workbench
   ```

2. 配置 GitHub 只读部署密钥，将仓库克隆到 `/opt/research-workbench`，并确保服务用户可读取代码。
3. 将当前电脑的整个 `research-tools/data/` 内容安全复制到 `/var/lib/research-workbench/data/`，并设置目录属主：

   ```sh
   sudo chown -R research-workbench:research-workbench /var/lib/research-workbench/data
   ```

4. 在服务器上生成并保存新的随机登录密码。文件权限设为 `0640`，属主 `root`、属组 `research-workbench`。
5. 复制 `research-workbench.service.example` 到 `/etc/systemd/system/research-workbench.service`，将 `workbench.example.com` 替换为实际域名。
6. 复制 `Caddyfile.example` 到 `/etc/caddy/Caddyfile`，替换为相同域名。DNS 的 A 记录需指向 VPS；确认 80/443 可从公网访问。
7. 启动并设为开机自启：

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now research-workbench
   sudo systemctl reload caddy
   ```

   Caddy 会为域名申请并续期 HTTPS 证书。

服务以 `research-workbench` 身份运行，仅监听 `127.0.0.1:8765`；Caddy 负责 HTTPS。公网不要直接开放 8765。

## 日常更新与备份

代码推送到 GitHub 后，在 VPS 更新私有仓库，再重启 `research-workbench` systemd 服务。更新代码不会覆盖独立的数据目录。

上线前应配置每日备份 `data/`，并将备份复制到 VPS 以外的位置。至少确认记录 JSON 和已上传 PDF 都包含在备份中，并实际检查备份可读。
