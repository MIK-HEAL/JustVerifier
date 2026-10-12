`-Diagnose` 只启动前台 daemon，不启动前端页面，而且默认没有配置 Web 监听。

最简单的方式是：

1. 在当前诊断窗口按 `Ctrl+C`。
2. 回到项目根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Port 4177
```

3. 打开：

```text
http://127.0.0.1:4177/
```

如果你需要“前端页面 + 前台后端原始日志”同时运行：

终端 A：

```powershell
node .\agnes-harness\packages\cli\dist\local\daemon.mjs `
  --profile local-dev `
  --workspace D:\MyProject\hackson\JustVerifier\agnes-harness `
  --data-dir C:\Users\MIKHEAL\.agh\data `
  --local-web-addr 127.0.0.1:0 `
  --local-web-origin http://127.0.0.1:4177
```

终端 B：

```powershell
cd D:\MyProject\hackson\JustVerifier\agnes-harness
pnpm --filter @agnes/cli dev:web serve --port 4177
```

然后访问：

```text
http://127.0.0.1:4177/
```

这样后端错误会显示在终端 A，前端运行在终端 B。