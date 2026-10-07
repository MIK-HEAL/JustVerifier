# Task 002：可见、可复现的科研 Agent 工作过程

状态：已完成（P0 MVP：T2.1、T2.2、T2.4）
优先级：P0  
负责人：待定
基线：`agnes-harness` + `open-science`

完成记录：

- [打勾] T2.1：科研事件闭集、活动/证据/假设状态和 path-free `ResearchRunManifest`。
- [打勾] T2.2：离线运行包导出、文件 checksum 校验和按字段重放差异报告。
- [打勾] T2.4：复用现有 Trace，加入证据过滤、状态、ledger 序号、调用者、artifact、假设、验证规则和 replay 详情。
- [打勾] 安全边界：Trace 不把模型隐藏思维投影为证据；unknown/failed 保持 fail-closed。
前置任务：[001-np-research-verifier.md](001-np-research-verifier.md)

## 1. 目标

把一次科研 Agent 运行从“对话结果”提升为一份可检查、可解释、可复现的研究运行记录：

```text
用户问题
  -> 计划/Skill
  -> 模型决策
  -> 工具调用（内置或 MCP）
  -> 输入快照/代码/环境
  -> 执行输出/错误
  -> artifact 版本
  -> 假设检查
  -> NP 验证报告
```

用户可以在右侧看到实时轨迹；复核者可以展开每一步，查看结构化输入、工具版本、输出摘要和证据引用；另一个环境可以用导出的运行包重放，得到相同的确定性验证结论。

“可见”不等于泄露所有内部思维：展示操作、工具参数、结构化决策、证据和错误；模型的隐藏思维不作为证据，也不要求持久化。

## 2. 现有能力和复用点

不重新发明日志或右栏 UI，先复用 Agnes 已有能力：

| 已有能力 | 代码入口 | 本任务的增强 |
| --- | --- | --- |
| 账本事件与序号 | `agnes-harness/packages/core/src/types.ts`、`packages/protocol/src/constants.ts` | 增加科研事件的 schema 和跨事件关联字段，保留原始事件不可变 |
| 右侧 Trace 组件 | `agnes-harness/packages/web-units/src/trace.ts`、`packages/web/src/trace-panel.ts` | 在现有 trace 行上增加 evidence 状态、artifact、assumption、replay 入口；不另做第二个时间轴 |
| Trace 层级与虚拟列表 | `agnes-harness/packages/web-units/src/trace-hierarchy.ts`、`trace-virtual-window.ts` | 将研究 activity 映射为可折叠树，长运行仍支持分页和虚拟滚动 |
| MCP 控制面和逐服务器运行 | `agnes-harness/docs/guide/mcp.zh-CN.md`、`packages/worker-runtime/src/mcp-row-runtime.ts` | 将 server revision、tool schema、审批、调用结果和断线写入 run manifest |
| Skill 治理 | `agnes-harness/docs/guide/skills.zh-CN.md`、`packages/resource-control-runtime/src/skills.ts` | 记录 Skill name、revision、source、trust/desired/actual/winner，绑定到本轮快照 |
| 前端槽位 | `agnes-harness/docs/develop/frontend.zh-CN.md`、`ui:trace` | 优先在现有 Trace 区域扩展，不依赖宿主私有 DOM；必要时通过受治理 client module 注册 Evidence 面板 |
| open-science provenance/reproducibility | `open-science/src/shared/artifact-provenance.ts`、`artifact-reproducibility.ts`、`execution-file-evidence.ts` | 借鉴类型和 fail-closed 状态，落成 Agnes 侧轻量运行包，不搬运 Electron 产品面 |

## 3. 统一运行记录合同

每次运行生成一个 `ResearchRunManifest`，内容只引用不可变对象：

```text
run_id, schema_version, created_at
instance_checksum, certificate_checksum, ruleset_checksum
agent_model_id, agent_runtime_version
skill_refs[]: { name, revision, source, trust, actual }
mcp_refs[]: { server_id, revision, tool_name, schema_checksum, policy }
activities[]: { activity_id, parent_id, kind, status, started_at, ended_at }
artifacts[]: { artifact_id, version_id, role, checksum, size, content_type }
assumptions[]: { id, status, evidence_refs[], unknown_reason? }
events: { ledger_session, first_seq, last_seq, ledger_digest }
environment: { os, arch, runtime, packages_digest, tool_versions[] }
replay: { recipe_id, input_refs[], command_refs[], deterministic: true|false }
```

合同要求：

- 每个 activity 必须有开始、终态和父子关系；失败、取消、超时都保留。
- 工具调用绑定具体 `server revision + tool schema checksum`，不能只记录工具名。
- 参数和结果保存结构化摘要及完整 artifact 引用；超大输出只在 UI 截断，原文必须有可寻址存储或明确 `unavailable`。
- 密钥、token、患者标识和未经授权的原始数据不得进入 manifest；脱敏动作本身要留下规则版本和结果状态。
- manifest 完成后计算 checksum 并封存；后续修订生成新版本，不能原地覆盖。

## 4. P0 实施拆分

### T2.1 科研事件和运行 manifest

- 定义 `research/run-started`、`research/activity`、`research/assumption`、`research/evidence`、`research/run-finalized` 的结构化 payload。
- 事件只携带引用、状态和摘要；原始输出走 artifact store。
- 为每个 MCP/Skill/代码/artifact 建立 checksum 和 revision 绑定。
- 测试断线、工具失败、用户拒绝、取消和进程重启后的恢复。

### T2.2 复现包和确定性重放

- 导出 `run-manifest.json`、`ledger.jsonl`、`certificate.json`、`ruleset.json`、`artifacts/`、`environment.json` 和 `README`。
- 重放器只允许读取包内输入，不自动访问网络或当前工作区。
- 对随机数、时间、网络、并发顺序和外部工具做显式标记；不能保证确定性时输出 `non-deterministic` 及原因。
- 重放至少能验证 checksum、事件顺序、证书绑定和规则结果；完整 MATLAB/远程计算重跑作为 P1。

### T2.3 专业工具接入（MCP 优先）

专业工具通过 MCP 接入，Skill 只描述方法和前置条件，不伪造工具能力。每个工具适配器需要：

```text
tool_id, provider, version, server_revision, schema_checksum
input_schema, output_schema, side_effects, network_policy
approval_policy, timeout, resource_limits
provenance_hooks, artifact_outputs, replay_support
```

以 MATLAB 为例，第一版不把 MATLAB 代码解释器塞进 Agent：

1. 接入一个受审核的 MATLAB MCP server 或受控 wrapper。
2. 只暴露白名单工具，例如 `matlab.run_script`、`matlab.inspect_workspace`、`matlab.export_figure`。
3. 每次调用保存 `.m`/Live Script 版本、MATLAB release/toolbox 版本、输入变量摘要、stdout/stderr、退出状态和输出文件 checksum。
4. 明确 license、网络、文件系统和执行时长策略；工具调用前走 Agnes approval。
5. 不可重放时保留原始 receipt 和 `replay_support: unavailable`，不能显示成“已复现”。

同一模式可接 R、Stata、Julia、COMSOL 或实验仪器 MCP；不要为每个工具设计一套独立 trace 格式。

### T2.4 右侧 Trace/Evidence 面板

基于 `@agnes/web-units` 的现有 Trace：

- 保留现有时间轴、工具树、耗时和输入输出预览。
- 为每个 activity 增加状态灯：`recorded`、`verified`、`partial`、`unknown`、`failed`。
- 增加三个过滤器：全部、仅证据、仅问题；过滤不会改变原始事件。
- 展开一行时显示：调用者（Agent/Skill/MCP）、参数摘要、审批、输入 artifact、输出 artifact、假设影响、验证规则和 replay 状态。
- 结论行显示“由哪些证据支持”，点击证据定位原始 ledger seq、artifact version 和 receipt。
- 断线、分页、截断、脱敏和 unavailable 必须有明确标签；不把空白渲染成成功。
- 右栏只展示已提交或明确标为 streaming 的事件；streaming 内容结束后以最终 checksum 对账。

## 5. P1 扩展

- 证据图视图：`claim -> check -> evidence -> activity -> input/output`，使用 provenance graph 的 authority 和 completeness。
- 一键导出审计报告和可引用的运行包。
- 环境 lock 的创建和隔离恢复。
- MATLAB/R/Julia 等工具的 sandbox runner 和离线 replay adapter。
- 多 Agent delegate 的独立 attempt 轨迹：每个 delegate 使用自己的 namespace，主 Trace 显示父子关系和合并点。
- 运行包签名、远程共享和团队审阅；签名验证失败时整包进入 `untrusted`。

## 6. 安全和边界

- MCP 连接成功不代表工具结果正确；必须记录实际调用和输出。
- Skill 信任/启用不代表它的结论可信；Skill 只能产生步骤和证书字段。
- 专业工具是受信执行面或受控外部进程，不能因为有 approval 就声称是沙箱；文件、网络、license 和副作用要单独声明。
- 任何外部输入（MCP 返回、文件内容、模型输出）都按不可信数据处理；不得让工具返回内容修改验证规则或权限。
- 原始日志、个人数据和 secret 采用最小留存与脱敏；复现包应可配置“完整/脱敏/仅摘要”。

## 7. 验收标准

- [打勾] 一个包含 Skill、内置工具和 MCP 工具的合成科研 run 能在右侧实时看到完整 activity 树。
- [打勾] 每个工具调用都能定位到 server/tool revision、参数摘要、审批、结果 artifact 和 ledger seq。
- [打勾] 刷新页面或重新打开会话后，Trace 从 ledger 恢复，而不是依赖浏览器内存。
- [打勾] 导出的运行包在隔离目录内完成 manifest/checksum/证书验证，不访问外部网络。
- [打勾] 修改任一输入、代码、工具 schema、Skill revision 或输出后，重放明确失败并指出差异。
- [打勾] MATLAB 工具不可用、版本不匹配、license 错误或输出未捕获时，状态显示 `unknown/failed`，不会显示 `verified`。
- [打勾] 大输出、断线、取消、拒绝和脱敏都能在右侧显示原因，并保留可追溯引用。
- [打勾] 面板不展示模型隐藏思维，不把自然语言解释作为证据。

## 8. 推荐开发顺序

先做 T2.1 和 T2.4 的最小闭环，再做 T2.2；随后接入一个无副作用的专业工具 MCP 作为样板，最后接 MATLAB 这类有 license/执行副作用的工具。这样可以先证明“事件 -> 证据 -> 右栏 -> 复现”成立，再扩大工具面。

## 9. 完成说明

P0 MVP 已落在 `agnes-harness/packages/research-verifier`、`packages/protocol` 和
`packages/web-units`：科研事件写入现有 ledger 闭集，Trace 从 ledger sidecar 恢复证据活动，
运行包只使用调用方提供的包内字节并离线校验 checksum。MATLAB、R、Julia 等专业工具的真实
MCP adapter、环境隔离恢复、签名共享和多 Agent delegate 仍按 P1 规划推进；在 adapter 不可用
时只显示 `unknown`/`failed`，不会伪造 `verified`。
