# Task 001：科研 Agent 的 NP 证书验证闭环

状态：已完成（T1–T6）  
优先级：P0  
负责人：待定  
基线：`agnes-harness` + `open-science`

完成记录：

- [打勾] T1：协议、JSON Schema、状态语义和确定性规则。
- [打勾] T2：从结构化 Agnes ledger/artifact 快照生成可重复 execution manifest。
- [打勾] T3：确定性验证器、JSON CLI 和退出码。
- [打勾] T4：合法、篡改、缺失、partial、unknown 和不可寻址证据 fixture 测试。
- [打勾] T5：CLI/JSON evidence graph 投影，保留 claim、check、evidence、activity 和 artifact 链路。
- [打勾] T6：`research-run` 与 `assumption-audit` 两个最小 Skill。

## 1. 任务结论

本项目按“单 Agent + Skills + 确定性验证 Harness”推进。第一阶段不做规划 Agent、执行 Agent、验证 Agent 的多 Agent 协商，也不把 LLM 的自我解释当成验证结果。

这里的 **NP** 指复杂性理论中 P=NP 语境下的 NP：对实例 `x` 和候选证书 `w`，验证器 `V(x, w)` 在多项式时间内检查证书是否满足规则。它不是 NumPy，也不是“让模型再判断一次”。

科研场景的对应关系：

| 复杂性理论 | 科研 Agent |
| --- | --- |
| 实例 `x` | 数据集/版本摘要、分析规格、假设声明、目标命题 |
| 证书 `w` | 代码摘要、执行回执、输入输出摘要、关键中间结果、引用和环境锁 |
| 验证器 `V` | 独立、确定性、可重放的 Harness 检查器 |
| 接受 | 证书与规则一致，且所有必要证据可追溯 |
| 拒绝/未知 | 数值不一致、证据缺失、假设未满足、链路不完整或无法验证 |

“通过”只表示给定证书满足已声明的检查，不宣称命题本身在现实世界中为真；无法验证必须显式显示为 `unknown`，不能降级成 `pass`。

## 2. 第一阶段目标

交付一个最小的科研验证闭环：

1. 单 Agent 读取研究任务和已启用 Skill，生成分析计划、可执行步骤和候选结论。
2. 每个步骤产生不可变 artifact、执行事件和证书字段。
3. Harness 对证书执行确定性检查：身份、输入、代码、输出、引用、假设、顺序和完整性。
4. UI/CLI 能展示“结论 -> 证书 -> 运行 -> 输入/输出”的链路，并指出第一个失败规则和缺失假设。
5. 同一份输入、证书和规则在无模型参与的情况下得到相同结果。

第一阶段只支持本地、单进程、单 Agent 运行；验证器不得调用 LLM，不得依赖自然语言相似度，不得通过搜索文件名猜测证据。

## 3. 值得直接借鉴的 open-science 能力

以下能力优先移植其数据模型和失败语义，不直接复制 Electron/UI 或业务代码。

| 能力 | 参考实现 | 在 JustVerifier 中的用法 | 优先级 |
| --- | --- | --- | --- |
| 不可变 artifact 版本、摘要和 opaque locator | `open-science/src/shared/artifact-provenance.ts` 中的 `ArtifactVersionDescriptor`、`ArtifactVersionIdentity` | 每个数据快照、脚本、报告和证书都用 `id + version + checksum` 标识；展示层不保存机器路径 | P0 |
| provenance 图 | 同文件的 `ArtifactProvenanceGraph*` 类型 | 以 activity/entity/edge 表达“使用了什么、生成了什么、依据是什么”，允许 `complete/conservative/incomplete` | P0 |
| 执行回执和逐文件比较 | `open-science/src/shared/artifact-reproducibility.ts` 的 receipt/comparison/log | 将 `matched/different/failed` 作为机器结果；保存比较原因、日志摘要和 receipt checksum | P0 |
| 证据覆盖率和原因码 | `open-science/src/shared/execution-file-evidence.ts` | 证据状态使用 `available/partial/unavailable`；原因码必须可见，禁止把 partial 当完整 | P0 |
| 环境锁与重放边界 | `artifact-reproducibility.ts` 的 environment lock 类型 | MVP 只记录环境指纹；完整环境恢复作为 P1，不阻塞第一条验证链 | P1 |
| 结构化计划 | `open-science/src/shared/session-plan/contract.ts` | 借鉴 phase/delegation/step 的可验证停止点；第一阶段 delegation 固定为单 Agent 轨道 | P0 |
| 审查 finding | `open-science/src/shared/reviewer.ts` 的 `ReviewCheck`、`FindingLocator` | 将假设问题、证据缺失和数值不一致建模为 `pass/warn/fail`，每条 finding 锚定证据块 | P0 |
| Skill 生命周期治理 | `open-science/src/shared/skill-*` 与 `agnes-harness/docs/guide/skills.zh-CN.md` | 只加载已发现、已审核、已启用的 Skill；Skill 是方法包，不是 Agent 身份 | P0 |

暂不直接移植：文献 PDF 解析全套、Electron 工作台、远程计算调度、完整 Notebook kernel 恢复、领域专用蛋白质 Skills。它们可作为后续插件，不应掩盖验证协议尚未稳定的问题。

## 4. Agnes Harness 接入边界

Agnes 已有的运行时事实应作为唯一事件来源：

- `agnes-harness/packages/core/src/types.ts`：`Event`/`EventInput` 和持久账本边界。
- `agnes-harness/packages/protocol/src/constants.ts`：现有 `step/start`、`step/end`、`artifact/job`、`verifier/signal`、`repair/decision` 等事件类型。
- `agnes-harness/packages/core/src`：执行状态机和工具结果；验证器读取已提交事件，不重建一套平行会话历史。
- `agnes-harness/packages/host/src/trajectory-contract.ts`：只复用轨迹上传/读取能力；验证链路的事实仍保留在本地账本和 artifact store。
- `agnes-harness/docs/guide/skills.zh-CN.md`：沿用来源、trust、desired、actual 和 winner 语义；未审核的 Skill 不得进入证书。

建议在 Agnes 中新增一个科研验证扩展（暂定 `research-verifier`），而不是把 NP 逻辑散落到 Core loop：

```text
Core ledger/events
        |
        v
Research run adapter -> Certificate builder -> Deterministic verifier
        |                                      |
        +-> immutable artifacts              +-> Verification report
                                               +-> evidence graph projection
```

验证器只接收结构化输入：`instance`、`certificate`、`ruleset` 和可寻址证据；它不接收模型的“我认为正确”文本作为判据。

## 5. MVP 验证协议

### 5.1 证书最小结构

```json
{
  "schema_version": 1,
  "claim": { "id": "claim-1", "text": "...", "kind": "derived-result" },
  "instance": {
    "dataset_version_id": "...",
    "dataset_checksum": "sha256:...",
    "analysis_spec_checksum": "sha256:...",
    "assumption_ids": ["a-sample-independent", "a-missingness-mcar"]
  },
  "witness": {
    "source_code_version_id": "...",
    "execution_id": "...",
    "input_version_ids": ["..."],
    "output_version_ids": ["..."],
    "environment_fingerprint": "sha256:...",
    "result_fields": [{ "path": "table.p_value", "value": 0.031 }]
  },
  "evidence": [{ "kind": "ledger-event", "ref": "...", "checksum": "sha256:..." }]
}
```

### 5.2 确定性规则

P0 规则必须覆盖：

| 规则 | 失败示例 | 结果 |
| --- | --- | --- |
| `instance-integrity` | 数据集版本不存在或 checksum 不匹配 | `fail` |
| `witness-completeness` | 缺输入、输出、执行 ID 或代码版本 | `fail` |
| `ledger-binding` | execution ID 找不到对应 `step/start`、工具结果或 `step/end` | `fail` |
| `output-binding` | 报告数字和执行输出不一致 | `fail` |
| `replay-consistency` | 在固定输入/规则下重算得到不同结果 | `fail` |
| `assumption-status` | 必要假设没有 `satisfied` 证据，或已明确 `violated` | `warn`/`fail`，由规则声明决定 |
| `evidence-coverage` | 证据为 partial/unavailable | 至少 `warn`，不能 `pass` |
| `claim-scope` | 结论超出证据支持的样本、变量或时间范围 | `warn` 或 `fail` |

每条结果必须包含 `rule_id`、`status`、`message`、`evidence_refs`、`observed`、`expected` 和 `blocking`。规则集本身也必须有 checksum，报告引用规则集版本。

### 5.3 假设诊断

假设不能只存在于提示词。每个假设至少包含：

```text
id, statement, required_for, observable_checks, status,
evidence_refs, unknown_reason, severity
```

状态固定为 `satisfied | violated | unknown | not-applicable`。例如样本独立性、缺失机制、测量尺度、分布假设、样本量下限和多重比较校正，都需要对应检查或明确标记 `unknown`。`unknown` 是可交付的验证结果，但不能被渲染为“已验证”。

## 6. 第一个实施任务拆分

### T1. 定义协议和状态机

- 在 `research-verifier` 扩展目录建立 `instance/certificate/rules/report` schema。
- 固定 `pass | warn | fail | unknown` 的语义和 fail-closed 规则。
- 固定证据引用只允许 immutable artifact/version、ledger event 或已签名 receipt。
- 交付：JSON Schema/TypeScript 类型、版本字段、非法输入测试。

### T2. 建立最小证据采集适配器

- 从 Agnes ledger 读取一次 run 的步骤、工具调用、工具结果和 artifact 引用。
- 生成 execution manifest 和每个 artifact 的 checksum。
- 不修改原始 ledger；适配器只能生成派生 manifest。
- 交付：一份合成研究 run fixture，以及从 run 到 manifest 的可重复转换测试。

### T3. 实现确定性验证器

- 先实现上表 8 条规则中的前 6 条；`evidence-coverage` 和 `claim-scope` 至少能返回保守的 `warn`。
- 验证器不得依赖模型、网络或当前时间。
- 相同输入必须产生字节级稳定的排序和报告摘要。
- 交付：CLI/API `verify <certificate>`、机器可读 JSON 报告和退出码。

### T4. 实现 NP witness fixture 集

至少包含：

1. 合法证书，全部规则 `pass`。
2. 修改报告小数位，触发 `output-binding`。
3. 替换输入文件但保留文件名，触发 checksum/integrity。
4. 删除一步 ledger 事件，触发 `ledger-binding`。
5. 必要假设未提供检查，返回 `unknown`/`warn`，不能 `pass`。
6. partial evidence，验证结果保留原因码。
7. 证书引用不存在的 artifact，明确拒绝。

### T5. 链路展示投影

- 先输出 CLI/JSON，不先做复杂图形 UI。
- 展示 `claim -> check -> evidence -> activity -> input/output` 的有向边。
- 每条边显示 authority（authoritative/advisory）、evidence source 和 completeness。
- 点击或命令查询能够定位到原始 ledger seq、artifact version 和 receipt。

### T6. Skill 化研究工作流

- 提供 2 个最小 Skill：`research-run`（生成结构化 run）和 `assumption-audit`（生成假设清单与可观测检查）。
- Skill 只能提出步骤和证书字段，不能修改验证器结果。
- 每个 Skill 固定版本、来源、trust/enable 状态，并记录到 run manifest。

## 7. 后续多 Agent 编排设计

多 Agent 只作为“独立工作轨道”接入，不改变验证器的单一事实源：

1. **主 Agent**：解析问题、选择 Skill、创建 instance 和任务计划。
2. **执行 Agent**：生成代码并运行实验，只能写入自己的 attempt/artifact 命名空间。
3. **审查 Agent**：读取冻结的证据快照，提交结构化 findings；不能直接改写证书或把 `unknown` 改为 `pass`。
4. **验证 Harness**：确定性执行，拥有最终状态机和报告签发权。

编排必须满足：

- Agent 之间只传结构化 artifact、证书和事件引用，不用自然语言文件作为接口。
- 每个 delegate 有 `attempt_id`、输入快照、输出快照、预算、超时和终态；失败保留为分支，不覆盖成功记录。
- 共享写入通过 CAS/版本检查；禁止一个 Agent 原地修改另一个 Agent 的 artifact。
- 只有 Harness 可以签发验证报告；Agent 的“审查通过”只是输入 finding。
- 并行仅用于彼此独立的候选分析或审查，顺序依赖仍由 DAG/plan 明确表达。
- `subagent/cost`、`participant`、`verifier/signal` 等事件与 provenance graph 中的 activity 对齐，避免出现不可追溯的隐式通信。

多 Agent 的 P1 验收重点不是“Agent 数量”，而是：去掉任一 Agent 后，已有证书和验证结果仍可重放；新增 Agent 只能增加证据或 finding，不能降低验证标准。

## 8. 验收标准

- [打勾] 根目录存在一个版本化的验证协议和规则集。
- [打勾] 合法 fixture 在无模型、无网络条件下稳定返回 `pass`。
- [打勾] 七类篡改/缺失 fixture 至少能定位到具体 rule、evidence ref 和 ledger/artifact 位置。
- [打勾] 任何 checksum、输入、步骤或必要假设缺失都不会静默通过。
- [打勾] 报告数字、执行输出和 artifact checksum 可逐项追溯。
- [打勾] `partial`、`unavailable`、`unknown` 在机器报告和展示投影中保持可区分。
- [打勾] Skill 版本和来源进入证书或 execution manifest。
- [打勾] 同一证书重复验证结果稳定；规则集升级会产生明确 schema/ruleset 版本差异。
- [打勾] 任务文档中的所有 P0 测试可在 Agnes Harness 当前测试体系中运行。

## 9. 明确不做

- 不把 LLM 的自评、自然语言解释或多个 Agent 投票当作 NP 验证。
- 不在第一阶段搬运 open-science 的整套 Electron UI、远程环境恢复和文献检索产品面。
- 不用文件名、路径或“最近修改时间”作为证据身份。
- 不把“无法观测”改写成“没有发生”。
- 不先设计复杂的多 Agent 消息总线；先稳定 instance/certificate/evidence/report 四个合同。

## 10. 完成说明

T1–T6 已在 `agnes-harness/packages/research-verifier` 完成。验证器保持本地、单进程、无模型和无网络依赖；下一阶段如继续扩展，应先接入真实 ledger/artifact store 的读取适配，再考虑 UI 或多 Agent 编排。
