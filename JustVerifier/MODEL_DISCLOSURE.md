# JustVerifier 模型使用说明

## 运行时大语言模型

模型标识：agnes-3.0-flash

提供方：Agnes AI

使用环节：
1. 理解用户任务
2. 选择与编排 AGH 工具
3. 分析验证与优化结果
4. 输出任务报告

调用方式：
通过 Agnes Harness 模型配置经 API 调用。

实际模型内部版本：
待依据 AGH 配置及赛事提供的模型说明核对。

API Key：
使用本地安全配置，不随作品提交。

## 非大语言模型组件

OR-Tools CP-SAT：
确定性约束建模与组合优化求解组件，
不作为大语言模型申报。

JustVerifier Independent Audit：
自编写的 JavaScript 规则审计模块。

## 开发辅助模型

如在编码、调试、文档或测试设计时使用
ChatGPT、Codex 或其他模型，
应根据实际情况补充模型名称、提供方、
使用环节以及是否参与运行时调用。

开发辅助与参赛作品运行时模型调用须明确区分。
