# Task 003：插件化科学能力与右侧 Trace 工作台

状态：部分完成（P0-2、P0-3、P0-4、P0-5 和 P1-1 基础能力已完成；P0-1 的真实 verifier service 接线、P1 专业工具适配和 P2 仍待后续）  
优先级：P0/P1  
依据：最近提交 `77cb4e190`、`bde1937a9`、`00fa81b77` 及当前 `research-verifier` 实现

## 判断

最近提交总体守住了“宿主最小化 + 能力插件化”：科学 Skills 通过 bundled plugin 预装，验证器是独立 workspace package，`research/*` 是结构化 sidecar 事件，Web 通过 extension/slot 展示。后续任务应继续保持这条边界。

本次已补齐 bundled plugin 注册、manifest 命名空间投影、Open-Science checksum 审计和右侧 Trace 展开动作；剩余缺口集中在 verifier surface service 的真实调度、上游同步 CI 以及专业工具适配。

## 任务清单

## 完成记录

- [部分完成] P0-1：`@agnes/research-verifier` 已作为 bundled plugin 注册，带有受治理的插件行、版本、许可证、Skill/schema contribution 和只读能力发现工具；真正的 verifier surface service 仍待接线。
- [打勾] P0-2：科学扩展选择器改为读取 bundled manifest 的包身份/命名空间，并从资源控制面返回的实际 Skill/MCP descriptor 动态发现资源；设置页保留一键启用，未重新暴露内部插件名。
- [打勾] P0-3：右侧 Trace 已有展开/收起按钮、session 恢复、窄屏覆盖层、ARIA 和焦点样式，且状态不写 ledger。
- [打勾] P0-4：`research/*` sidecar、`ResearchRunManifest`、Evidence graph 和 Trace 现有投影已覆盖 activity 状态、artifact、assumption、rule、ledger seq 和 replay。
- [打勾] P0-5：run manifest 已统一记录 Skill revision/source/trust/actual、MCP server/tool revision、schema checksum、审批和 artifact 引用；未知/失败保持 fail-closed。
- [打勾] P1-1 基础审计：Open-Science bundle 已有版本、许可证、contribution 清单和逐文件 checksum 锁；`packages/package-manager/tools/open-science-audit.mjs` 可检查或重写锁定文件。
- [打勾] P1-2 基础复现包：`@agnes/research-verifier` 已提供离线运行包、manifest/ledger/certificate/ruleset/environment/artifact 文件和 checksum 校验。
- [打勾] P1-3：复用现有 approval、artifact、background/runtime 和 replay seam，科研语义仍留在插件包中。

未标记完成的内容需要真实的 verifier service 调度、上游网络同步/CI、无副作用专业 MCP 样板、MATLAB wrapper、Reviewer 和多 Agent；本次不把这些规划项伪装成已交付能力。

### P0-1：把 research-verifier 注册为受治理能力

- [打勾] 为 `@agnes/research-verifier` 增加标准 bundled/plugin 描述，声明受治理插件行、Skill/schema 资源和版本/许可证。
- [打勾] 通过 `BUNDLED_HELPERS` 官方插件入口安装，沿用现有 install/trust/enable/hash/revision/rollback 生命周期。
- [ ] 验证器由插件 hook 或受限 service 调用；当前仍以 workspace verifier/CLI 为确定性签发入口，下一步再接 surface service。
- [打勾] 不把验证器逻辑复制到 `core`/`host`，不让 Skill 直接写 ledger。

验收：禁用插件后宿主仍可运行普通会话；启用后 Agent 能通过标准能力发现并调用验证器；插件卸载不留下宿主科学状态。

### P0-2：让科学资源清单由插件 manifest 驱动

- [打勾] 移除宿主侧 `SCIENCE_EXTENSION.skills` 和 MCP ID 的静态重复清单。
- [打勾] UI 读取 bundled manifest 的包身份/命名空间和已安装 resource descriptor，继续显示资源自身的 revision、source、trust、desired、actual 和 winner。
- [打勾] 资源控制面为空、不可用或刷新失败时沿用现有 unavailable/error 诊断，不猜测缺失资源。

验收：新增一个 Skill 或 MCP server 只需更新插件 manifest；宿主源码无需同步修改；资源设置页测试覆盖安装、停用、删除和回滚。

### P0-3：右侧 Trace 的“展开右侧”按钮

- [打勾] 在现有 `ui:trace` 区域增加一个明确的“展开右侧”按钮，按钮属于 Trace client module，不改宿主主布局结构。
- [打勾] 三态行为：窄栏、展开、关闭。展开时使用现有 trace pane 的布局变量扩大右栏；关闭时恢复原始宽度；窄屏时退化为全屏覆盖层。
- [打勾] 状态保存到当前浏览器 profile/session，重新打开会话后恢复；不存在 Trace 区域时按钮不渲染。
- [打勾] 按钮有中文/英文 label、aria-expanded、键盘操作和焦点样式；布局改变不改会话滚动区。
- [打勾] 记录纯 UI 状态，不写入研究 ledger；科研 activity 仍从 ledger 恢复。

建议 API：

```text
TracePanelOptions.expandToggle?: HTMLButtonElement
TraceHandle.setExpanded(expanded: boolean): void
TraceHandle.isExpanded(): boolean
```

验收：展开/关闭、刷新恢复、窄屏、键盘 Enter/Space、无 Trace fallback、长日志虚拟滚动和现有 trace 测试全部通过。

### P0-4：建立 Trace Evidence 投影

- [打勾] 从 `research/*` sidecar 事件和 `research-verifier` report 生成 UI projection，不在 Trace 组件内重新计算验证结果。
- [打勾] 每个 activity 显示 `recorded | verified | partial | unknown | failed`。
- [打勾] 展开详情显示 Skill/MCP/tool revision、审批、输入输出 artifact、checksum、assumption refs、rule IDs、ledger seq 和 replay 状态。
- [打勾] 只展示操作、结构化参数、结果和证据；不持久化模型隐藏思维。
- [打勾] 证据引用可定位 artifact version、receipt 或原始 ledger seq。

验收：刷新页面从 ledger 恢复；长运行支持分页/虚拟列表；partial/unavailable/unknown 不显示为 verified。

### P0-5：统一 MCP/Skill provenance

- [打勾] MCP 调用记录 server revision、tool schema checksum、审批决定、输入摘要、输出 artifact 和副作用声明。
- [打勾] Skill 记录 name、revision、source、trust、actual/winner，并绑定到 run manifest。
- [打勾] 对大输出只在 Trace 中展示摘要，完整内容通过 artifact locator 获取；截断原因可见。

验收：同一工具 schema 或 Skill revision 发生变化时，重放报告明确失败或进入 unknown；密钥不进入事件和 manifest。

### P1-1：Open-Science 同步和差异审计

- [打勾] 为 `bundled-plugins/open-science` 记录版本、来源、文件清单、每文件 checksum 和 Apache-2.0 许可。
- [打勾] 增加本地审计脚本，生成或比较差异锁；未授权文件和许可证变化会失败。
- [ ] CI 定期拉取上游并检查 AGH bundle；当前只提供可在 CI 调用的无网络审计命令。

验收：同步结果可复现；上游 Skill 变化会产生可审阅 diff；版本迁移保留用户删除/禁用选择。

### P1-2：复现包和工具适配器

- [打勾] 导出 manifest、ledger、certificate、ruleset、artifacts、environment 和 README。
- [ ] 先接一个无副作用 MCP 工具作为样板，再接 MATLAB wrapper；此项仍按 P1 规划。
- 重放只读取包内输入；外部工具不可用时明确 `unknown/unavailable`。

### P1-3：宿主基础设施按 seam 补齐

- Python runtime、code-mode、approval ticket store、artifact replay、background jobs 继续作为通用 seam 实现。
- 科学插件通过公开 seam 使用它们，不把 Python、Notebook、Slurm 或 MATLAB 业务模型放入 Core/Host。

### P2：Reviewer 和多 Agent

- Reviewer 作为独立插件上下文读取冻结证据快照，提交 finding。
- 多 Agent 每个拥有独立 attempt/artifact namespace；Trace 通过父子关系展示；只有 Harness/Verifier 能签发最终报告。

完成记录：

- [部分完成] 多 Agent 结构化合同已加入 `@agnes/research-verifier`：Agent/Task/Plan/Attempt/Finding 类型、确定性 DAG 就绪计算、attempt 命名空间检查、finding 聚合和 Harness-only 最终状态签发，并投影到现有 `ResearchActivity` 父子 Trace 与 run manifest。
- [打勾] 计划 checksum、Agent revision、预算/超时声明、attempt 状态、finding evidence refs 和最终 report checksum 均为可重放的结构化数据；没有新增平行日志。
- [ ] 仍待接入真实 delegate runtime、Reviewer 插件上下文和宿主的 participant/subagent 事件写入；在这些 seam 接通前不宣称已有真实多 Agent 调度。

## 明确边界

- `core`/`host` 只记录通用事件、执行、审批、artifact 和资源治理事实。
- 科研语义、连接器、Skills、Reviewer、MATLAB/MCP 适配器都属于插件。
- Trace 的展开状态是 UI 偏好，不是科学事实，不进入 ledger。
- 证据图是派生投影；不能绕过权限直接读写宿主 ledger。

## 建议顺序

先完成 P0-1、P0-2，再完成 P0-3 的按钮和布局测试；随后接 P0-4/P0-5，让右侧 Trace 展示真实证据；P1 处理同步和复现包，最后扩展 MATLAB、Reviewer 和多 Agent。
