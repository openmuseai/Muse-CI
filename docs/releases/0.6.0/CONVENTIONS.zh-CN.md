# 项目约定与配置说明

Muse-CI 0.6 将长期项目与流程记录分开。项目 ID 不随版本变化，版本负责交付，需求在声明的 Git 仓库研发，节点负责执行。旧 `ci_project_get` 的 `Project` 仍表示流程记录，以保留现有文档、运行、MR 和客户端合同；新增 `ManagedProject` 承载长期配置。

## 目录与配置优先级

服务使用 `CI_PROJECT_WORKSPACE` 指定受信工作区，缺省为服务启动目录。项目目录相对该工作区；仓库路径相对项目目录。项目 ID 与版本名使用小写字母、数字、点、下划线和短横线，不允许路径穿越。

配置顺序为：内置约定 → `.muse-project-<id>/project.json` 的显式字段 → 新建版本或需求时固化的流程定义。现有流程不会因模板变化自动重写。运行前读取当前项目配置、Skill 与规范并固定摘要；配置变化不能复用旧输入的批准或 MR 验证。

```json
{
  "schema": "openmuse.project/1",
  "id": "muse-ci",
  "title": "Muse-CI",
  "repositories": [{"id":"main","title":"Muse-CI","path":".","baseBranch":"master"}],
  "defaults": {"budget":50,"timeout":20,"retries":0,"skills":["ci-project-conventions"]},
  "skillsDirectory": "skills",
  "standardsDirectory": "standards"
}
```

项目初始化仅创建缺失配置，不覆盖已有文件。未知字段、重复仓库 ID、无效模板或越界路径会拒绝执行。`workflows/version.json` 与 `workflows/requirement.json` 可改阶段名称、增加阶段和节点，不能删除必需交付物或重排必需门禁。配置里的 Skill 引用项目 `skills/<id>/SKILL.md`；规范使用 `standards/` 下的 Markdown。子项目拥有独立配置与权限，不自动继承父项目成员。

## 根节点与材料

| 单元 | 执行或管理根 | 材料索引 |
| --- | --- | --- |
| 项目 | `<home>/.muse-project-<id>/` | `INDEX.json`，列出版本与配置来源 |
| 版本 | 项目根下 `versions/<version>/` | `version.json`、`INDEX.json`、需求引用 |
| 需求 | 项目声明的真实 Git 仓库 | `<repo>/.muse/requirements/<workflow-id>/requirement.json` 与 `INDEX.json` |
| 节点 | 所属流程的节点 | `nodes/<node-id>/attempts/<N>/INPUT.json`、`RESULT.json` 与 `artifacts/` |

SmartDoc 各修订在 `documents/<document-id>/rN.sydoc` 保存原生内容；索引保存标题、类型、所属 Step、发布修订和云端文档标识。执行输入包含配置、材料、源码、上游产物和项目规范快照。产物按内容摘要保存，结果保留生产者及输入摘要。重跑增加尝试，不覆盖历史。MR 回执随所属需求索引归档。

数据库是执行状态来源；持久 outbox 在状态变更后重试文件归档。文件系统失败不会把未归档状态伪装为成功；“根节点与归档”执行显式同步并显示结果。运行中的 `STATE.json` 可更新，完成后的 `INPUT.json`、`RESULT.json`、文档修订和产物不可覆盖。

## 操作与迁移

先选择项目，再选择该项目的版本。左侧按产品、UI、架构研发、测试交付、MR 分组；窄窗口与手机使用“交付物”抽屉。文档进入 Host 的完整 SmartDoc 编辑器，MR 定位所属需求。版本画布通过需求入口进入子画布。

历史流程需明确关联项目；需求需明确关联声明的仓库。迁移保留原 ID、文档与运行记录，不依据标题推断归属。切换时禁止旧上下文写操作；失败恢复原选择，迟到响应不能覆盖新上下文。

本轮不自动合并 MR、不上传渠道、不替代真实发布验收。通用执行器对仓库有适用范围检查；为其他仓库添加执行工具需要显式实现适配器，配置本身不能授予任意 Shell 能力。
