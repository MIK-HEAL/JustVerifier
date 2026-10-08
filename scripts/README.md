# Windows 本地构建与启动

在普通 PowerShell 中运行。项目根目录是同时包含 `scripts/` 和 `agnes-harness/` 的 `JustVerifier` 目录。

从项目根目录启动现有构建（不构建）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

从 `agnes-harness` 目录执行同一操作：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ..\scripts\start-local.ps1
```

修改源码后重建并启动：

先在旧 `serve` 终端按 `Ctrl+C`，释放 Windows 原生模块占用。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ..\scripts\start-local.ps1 -Rebuild
```

默认端口为 `4180`，以启动后打印的完整 URL 为准。终端保持打开。

`start-local.ps1` 支持 `-Port`、`-Profile`、`-AghHome` 和 `-OutputDir`。默认 home 与宿主保持一致：`AGH_HOME` → `AGNES_HOME` → `HOME/.agh` → `USERPROFILE/.agh`。

如果仍然出现 `daemon child exited before readiness (1)`，直接显示原始 daemon 错误：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ..\scripts\start-local.ps1 -Diagnose
```

诊断模式启动前台 daemon，不启动 Web 页面；退出后再使用正常启动命令。

已有脚本：

- `fix-agh-acl.ps1`：仅移除 `CodexSandboxUsers` 的显式 Allow 权限，核对目录 owner 与 Allow 主体；其他异常权限会报错，凭据和配置保留。
- `rebuild-local.ps1`：停止当前作用域的 daemon，保留并隔离遗留构建锁，然后重建并检查 CLI 版本。`-SkipBuild` 仅处理进程与锁，不会修复插件声明或启动记录。

ACL 修复应在普通终端执行；沙箱设置刷新可能再次添加读取权限。启动脚本在每次启动前修复已知权限，不放宽宿主凭据校验。

如果源码类型检查提示已声明的 workspace 子路径不存在，先核对本地依赖链接。已有完整依赖缓存时，可从 `agnes-harness` 目录按原锁文件离线刷新链接：

```powershell
pnpm install --offline --frozen-lockfile --ignore-scripts
```

本次 `resource-control-web/node_modules/@agnes/package-manager` 链接缺失即用此命令恢复，未修改依赖版本。
