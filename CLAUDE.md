# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**我敲 (TapCare)** — 运行在华为 GT4/GT6 手表上的中医经络敲打健康练习应用。基于 5Hz 加速度传感器 + 峰值检测算法实现敲打动作计数、力度识别、节奏评估和练习记录。

- **平台**: HarmonyOS Lite Wearable (GT4/GT6, HarmonyOS 5.0+)
- **开发模型**: FA 模型（不是 Stage 模型）
- **语言**: JavaScript（不是 ArkTS）
- **UI 框架**: ArkUI Lite（HML + CSS + JS 三件套）
- **屏幕尺寸**: 466px 圆形表盘

> **⚠️ 陀螺仪融合方案已搁置**：尽管 `config.json` 中保留了 `GYROSCOPE` 权限，但当前算法只用加速度计单路。详见 `.sisyphus/plans/archived/gyroscope-fusion-plan.md`。

---

## 🔑 权威信息源（必读）

**所有项目规则与约束以 [`_bmad-output/project-context.md`](./_bmad-output/project-context.md) 为准**，包括：

- 技术栈版本约束（SDK、构建工具）
- JavaScript 运行时限制（异步、GC、文件体积等）
- ArkUI Lite / FA 模型约束（HML、CSS、生命周期、config.json）
- 传感器与硬件特性
- 持久化、命名、注释规范
- 安装错误速查表与审核要求

@_bmad-output/project-context.md

其他文档分工：

| 文档 | 用途 |
|------|------|
| `README.md` | 算法详解、版本状态、开发计划 |
| `AGENTS.md` | 项目结构、新增页面步骤、错误处理表（面向 AI agent 的操作手册） |
| `docs/build-and-deploy.md` | 构建部署详细命令、踩坑记录、故障排查 |
| `docs/tap-detection-algorithm.md` | 敲打检测算法参考 |
| `doc-ref.md` | HarmonyOS Lite Wearable 外部参考链接 |
| `PRD.md` | ⚠️ 已脱节，仅参考产品愿景和用户画像章节 |

---

## Claude Code 专属指引

### 构建与部署快捷方式

```bash
./scripts/build-hap.sh debug          # debug 证书签名，给「应用调测助手」用
./scripts/build-hap.sh release        # release 证书签名，给 AGC 上架审核用
./scripts/build-hap.sh debug --push   # 构建并通过 hdc 推送到手机 /sdcard/haps/
```

输出路径：
- Debug:   `entry/build/debug/outputs/default/entry-default-signed.hap`
- Release: `entry/build/default/outputs/default/entry-default-signed.hap`

完整命令、双签名机制、HAP 包结构差异、故障排查 → [docs/build-and-deploy.md](./docs/build-and-deploy.md)

### 工作流偏好

- **修代码前先读 `project-context.md`**，关键约束都在里面
- **算法参数调整**：必须在注释里写清楚调整原因和预期效果（不写 PR 就拒）
- **`config.json` 改动**：每次发布前 `app.version.code` 必须递增
- **不要主动 commit**，除非用户明确说"提交"
- **历史任务计划**：`.sisyphus/plans/archived/` 是历史快照，不要据此推断当前状态

### 验证循环（无自动化测试）

修改 → `./scripts/build-hap.sh debug --push` → 手表安装 → 真机操作 → 日志截图 OCR 提取。单次约 2-3 分钟。

---

## 详细语法支持参考

@doc-ref.md
