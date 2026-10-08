# JustVerifier

## 基于 Agnes Harness 的组合优化反例驱动修复与可信验证智能体

**队伍：** JustVerifier  
**组别：** 本科生组  
**参赛编号：** U132  
**当前版本：** v0.3.1

## 1. 项目简介

JustVerifier 是一套基于 Agnes Harness（AGH）的组合优化验证与自动修复智能体。

系统以员工排班问题为首个应用场景，通过 Agnes 模型理解任务，由 AGH 组织工具调用，再结合 OR-Tools CP-SAT 求解器完成约束修复，并通过独立验证器审计候选解。

核心目标包括：

- 自动检测排班约束冲突并提供具体反例
- 在满足已建模约束的前提下寻找最小扰动修复
- 区分 OPTIMAL、FEASIBLE、INFEASIBLE 和 UNKNOWN
- 独立复验候选修复方案
- 保存可供人工核查的 AGH 工具执行记录

本项目不声称普遍突破 NP-hard 问题的计算复杂度界限。

## 2. 技术架构

Agnes 3.0 Flash
    ↓
Agnes Harness (AGH)
    ↓
verify_schedule
    ↓
cp_sat_repair (OR-Tools CP-SAT)
    ↓
verify_schedule
    ↓
audit_schedule
    ↓
可信验证报告与 AGH Trace

Streamlit 用于可视化展示，不承担核心 Agent 编排。

## 3. 核心工具

| 工具 | 功能 |
|---|---|
| verify_schedule | 检查原始排班并生成反例 |
| repair_schedule | 规则驱动局部修复 |
| cp_sat_repair | 约束优化与最小扰动修复 |
| audit_schedule | 独立检查修复候选解 |

## 4. 已实现约束

- 每人每天恰好一个班次
- 夜班后不得直接安排早班
- 最低班次人数覆盖
- 历史排班锁定
- 员工不可用日期
- 最大连续工作天数
- 夜班次数上限

验证结论仅针对明确建模并实际检查的规则。

## 5. 测试结果

### 功能测试

21 项自动化测试通过，失败数为 0。

涵盖正常、边界、失败和篡改检测场景。

### 性能测试

12 组排班基准测试，四种规模，每种规模三个种子。

最大规模为 40 名员工、28 天。

12 组均返回 OPTIMAL，候选解均通过现有独立审计。

实验结果只代表所测实例，不构成多项式时间复杂度证明。

## 6. AGH 真实执行证据

已验证四工具闭环：

verify_schedule → FAIL
cp_sat_repair → OPTIMAL
verify_schedule → PASS
audit_schedule → PASS

对应 AGH 原生事件序号：

177、194、211、228。

提交材料包含经过安全审查的会话记录及核验摘要。

## 7. 运行环境

- Ubuntu 22.04 虚拟机
- Python 3.10
- Node.js
- Agnes Harness
- Agnes 3.0 Flash
- OR-Tools CP-SAT
- Streamlit

准确依赖版本与 AGH Git Commit 见环境记录。

## 8. 本地运行

求解器：

cd ~/Desktop/JustVerifier/solver
source .venv/bin/activate
python cp_sat_repair.py demo.json

自动化测试：

cd ~/Desktop/agnes-harness/examples/packages/justverifier-plugin
node --test tests/*.test.mjs

可视化页面：

cd ~/Desktop/JustVerifier/solver
source .venv/bin/activate
python -m streamlit run dashboard.py

默认访问地址：

http://127.0.0.1:8501

以上为原开发环境运行命令。跨机器部署需要先安装 AGH、创建 Python 环境、安装依赖并配置插件，不能直接复用本机绝对路径。

## 9. 安全与局限

- 模型 Key 不包含在提交材料中
- 求解器声明的最优性未由独立审计器再次证明
- 现有性能测试仅针对特定生成实例
- Streamlit 当前为本地证据展示模式，不实时调用 AGH
- AGH 原始执行记录用于核查真实模型与工具调用

## 10. 开源与第三方声明

项目基于 Agnes Harness 开发。

AGH：
https://github.com/AgnesAI-Labs/agnes-harness

其他第三方依赖和使用方式见 THIRD_PARTY.md。
