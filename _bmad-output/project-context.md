---
project_name: 'healthcounter'
user_name: 'Weiyicheng'
date: '2026-05-16'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'critical_rules']
status: 'complete'
rule_count: 42
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

| 技术 | 版本/值 | 约束说明 |
|------|---------|---------|
| 平台 | HarmonyOS Lite Wearable 5.0+ | GT4/GT6 手表 |
| 开发模型 | **FA 模型** | 非 Stage 模型，唯一配置文件为 `config.json` |
| 语言 | **JavaScript** | 裁剪版 JS 引擎，非 ArkTS |
| UI 框架 | **ArkUI Lite** | HML + CSS + JS 三件套 |
| 屏幕 | **466px 圆形表盘** | 布局基准宽高 |
| 包名 | `com.huawei.healthcounter` | 不可修改 |
| targetSdkVersion | `6.0.2(22)` | **不可更高**，否则安装失败 |
| compatibleSdkVersion | `4.0.0(10)` | **不可更高** |
| 传感器采样率 | ~5Hz (200ms/帧) | 仅 `normal` 模式可用，`game`/`ui` 静默失败 |
| 数据持久化 | `@system.file` | JSON 文件读写，success/fail 回调式 |
| 构建工具 | DevEco Studio + `hvigorw` CLI | 命令行构建已脚本化：`scripts/build-hap.sh debug\|release [--push]` |
| 双签名机制 | `product=debug`→test.cer / `product=default`→release.cer | **product 决定签名**，仅改 buildMode 不切证书 |

## Critical Implementation Rules

### Language-Specific Rules (JavaScript / 裁剪版引擎)

- **有限的 ES6 支持**: 支持 `let/const`、箭头函数、解构赋值和模板字符串。推荐使用箭头函数来解决异步回调中的 `this` 指向问题，替代繁琐的 `var self = this;`。
- **异步回调铁律**: 
  - ❌ 官方底层不支持原生的 `Promise` 和 `async/await`，必须使用 `success/fail` 回调。
  - ⚠️ 为了避免"回调地狱"，深层异步操作应提取为**命名函数**，避免过多的嵌套匿名函数。
- **严控 GC (垃圾回收) 压力**: 
  - 手表内存极小 (512KB-2MB RAM)。❌ 严禁在传感器回调等高频场景中使用 `map()`、`filter()`、`reduce()` 等函数式编程方法（会产生大量临时对象）。
  - ✅ 必须使用传统的 `for` 循环来处理数组。
- **强制防御性编程 (`try/catch`)**: 调用系统底层 API（如 `vibrator`、`sensor`、文件读写）时，必须使用 `try/catch` 严密包裹，防止未授权或硬件不支持导致应用崩溃。
- **单文件体积限制**: 单个页面的逻辑文件 (`.js`) 体积绝对不能超过 48KB。

### Framework-Specific Rules (ArkUI Lite / FA 模型)

- **页面三件套结构**: 每个页面必须由同一目录下的 `.hml` + `.css` + `.js` 三个文件组成，缺一不可。新增页面必须同步在 `config.json` 的 `module.js[0].pages` 数组中注册路径。
- **HML 模板约束**:
  - 使用 Mustache 语法 `{{ }}` 进行数据绑定。
  - 条件渲染使用 `if / elif / else` 属性，不支持 `v-if` 或 JSX。
  - 事件绑定直接写方法名：`onclick="handleClick"`（不加括号，不传参数）。
- **CSS 布局铁律（圆形表盘 466px）**:
  - ❌ 禁止使用 `rem/em/vw/vh`，仅支持 `px` 和百分比。
  - ❌ 禁止使用 `@keyframes` CSS 动画。
  - ❌ 禁止在深层嵌套 `div` 中使用 `flex-grow: 1`，引擎不支持流体高度传递，会导致容器坍塌为 0。
  - ✅ 必须使用**最扁平的 DOM 结构** + **绝对高度数值** + **实体 spacer div 占位块**来排版布局。
  - ⚠️ **圆屏文字安全区**：圆形 466px 表盘，上下 1/4 处可用宽度仅 ≈300px。文字组件 `width` 建议 ≤320px，配合 `text-align: center`。中文 24px 字号 320px 宽度约容纳 13 字。
  - ⚠️ **`list-item` 陷阱**（预览器实测）：
    - `list-item` 的 `padding-left/right` 对子元素 `width: 100%` **无效**，子元素仍占满全宽。要居中收窄，给子元素设固定 `width` + 父容器 `align-items: center`。
    - `list-item` 不设显式 `height` 会**坍塌为 0**，必须指定绝对高度。
- **JS 组件模式**: 使用 `export default { data: {}, onInit(), onShow(), onDestroy(), ... }` 单对象导出模式。`data` 中的属性自动具有响应式能力。
- **生命周期顺序**: `onInit()` → `onReady()` → `onShow()`；页面切换时前一页先触发 `onDestroy()`。
- **config.json 铁律**:
  - 顶层只允许 `app`、`deviceConfig`、`module` 三个 key。
  - `module.deviceType` 必须是 `["liteWearable"]`。
  - `reqPermissions` 必须包含完整格式（含 `reason` 和 `usedScene`），且放在 `module` 内、`js` 数组之前。
  - 必须包含 `app.apiVersion`，否则手表安装报错误码 40。
- **路由**: 使用 `router.push({ uri: 'pages/xxx/index' })` 跳转。右滑必须调用 `app.terminate()` 退出（华为应用商店审核要求）。

### Testing Rules (Lite Wearable 特殊约束)

- **无自动化测试框架**: Lite Wearable 平台不支持 Jest、Mocha 等 JS 测试框架，也没有可用的模拟器。所有验证只能通过**真机部署 + 人工观察 + 日志截图 OCR** 完成。
- **调试日志规范**:
  - 使用 `console.info/warn/error` 输出日志，通过「应用调测助手」App 在手机上查看。
  - 关键事件必须使用**标签前缀**（如 `[TAP_HIT]`、`[TAP_BLOCK]`、`[TAP_MISS]`），方便在 OCR 后的文本中快速定位和过滤。
  - 日志中记录关键参数的数值（如加速度值、时间间隔），精度使用 `.toFixed(3)` 保持一致。
- **验证循环**: 每次代码修改的验证流程为：`修改代码 → DevEco 构建 HAP → 传输到手机 → 蓝牙安装到手表 → 运行 → 截图日志 → OCR 提取`，单次循环约 2-3 分钟。
- **HAP 包完整性检查**: 安装失败时，将 `.hap` 重命名为 `.zip` 解压检查：必须包含 `config.json`，不能包含 `module.json5` 或 `*.bin` 文件。

### Code Quality & Style Rules

- **命名规范**:
  - 文件名：页面目录使用小写（`pages/index/`、`pages/history/`）；三件套统一命名 `index.hml/css/js`。
  - 方法名：公开方法使用 camelCase（`startSession`、`switchPart`）；私有/内部方法以 `_` 前缀（`_processAccel`、`_saveSettings`）。
  - 常量：全大写对象模式（`var TAP = { THRESHOLD: 0.08, MIN_DEBOUNCE_MS: 350 }`）。
  - 数据数组：全大写 var 声明（`var PARTS = [...]`）。
- **注释规范**:
  - 使用中文注释描述业务意图，英文命名变量和方法。
  - 使用分区注释标记代码区域：`// ========== 传感器 ==========`。
  - 算法关键步骤必须有行内注释解释“为什么”而非“做了什么”。
- **代码组织**:
  - `data` 声明在最前，生命周期方法紧跟其后，UI 事件处理方法居中，内部工具方法放最后。
  - 系统模块导入（`@system.xxx`）放文件顶部，常量紧随其后。
- **持久化约定**:
  - 文件 URI 使用 `internal://app/` 前缀。
  - 设置类数据存 `settings.json`，会话记录存 `last_session.json`（或 `sessions.json`）。
  - 读写操作始终提供 `success` 和 `fail` 回调，`fail` 中静默降级不崩溃。

### Development Workflow Rules

- **命令行构建（已脚本化）**:
  - `./scripts/build-hap.sh debug` — 用 debug 证书（test.cer）签名，给「应用调测助手」用
  - `./scripts/build-hap.sh release` — 用 release 证书（healthcounter_release.cer）签名，给 AGC 上架审核用
  - `./scripts/build-hap.sh debug --push` — 构建 + 通过 hdc 推送到手机 `/sdcard/haps/`（需手机 USB 调试 + 信任电脑）
  - 输出路径：
    - debug: `entry/build/debug/outputs/default/entry-default-signed.hap`
    - release: `entry/build/default/outputs/default/entry-default-signed.hap`
  - ⚠️ **Lite Wearable 特性**：debug HAP 内只含 `entry-default-signed.bin`（无 config.json），release HAP 才是常规结构（config.json + assets/）。这是正常的，不是构建错误。
- **HAP 部署到手表**:
  - 方案 A（有线/Wi-Fi）：`hdc install <path-to-hap>` 直接安装（设备开启 HDC 调试）。
  - 方案 B（蓝牙）：HAP 推到手机 `/sdcard/haps/`，通过「应用调测助手」蓝牙转发到手表。
  - ⚠️ 手机必须是 **USB 调试模式**（不是 MTP 文件传输模式），否则 hdc 找不到设备。
- **签名配置**:
  - 签名为手动配置（AGC 申请 `.cer` 和 `.p7b`），密码使用 DevEco 加密格式。
  - 覆盖安装前建议先卸载旧版本（签名不一致会失败）。
  - `config.json` 中 `label` 不超过 22 字符，图标 80×80 或 114×114。
- **AI Agent 协作规则**:
  - AI 只能修改 `entry/src/main/` 下的源码文件，不能修改签名和构建产物。
  - 算法参数调整必须在注释中说明调整原因和预期效果。
  - `config.json` 的 `app.version.code` 每次发布必须递增。

### Critical Don't-Miss Rules

**❌ 绝对禁止（Anti-Patterns）:**
- ❌ 不要创建 `module.json5`、`.ets` 文件或 `AppScope/` 目录（Stage 模型产物，Lite Wearable 不用）
- ❌ 不要在 `app.json5` 中改配置（Stage 模型文件）
- ❌ 不要编写 `fetch`、`axios`、`XMLHttpRequest` 等网络请求代码（手表无独立联网能力）
- ❌ 不要将 `targetSdkVersion` 设为高于 `6.0.2(22)`
- ❌ 不要尝试切换传感器 `interval` 为 `game` 或 `ui`（静默失败，0 回调）
- ❌ 不要使用 `Array.sort()` 等部分高级 Array 方法（部分固件不支持，运行时崩溃）

**⚠️ 隐蔽陷阱（Edge Cases）:**
- `@system.sensor` 的 `subscribeAccelerometer` 返回的是**去重力后的线性加速度（单位 g）**，静止时 magnitude ≈ 0.25g，不是 0
- 5Hz 采样率意味着一次轻敲脉冲（50~100ms）有 ~75% 概率完全落在两个采样点之间，**轻敲漏检是物理极限**
- `onHide()` 在用户按表冠时触发，如果不在此暂停传感器，系统挂起后恢复时状态可能异常
- `@system.file` 的 `readText/writeText` 是异步回调，读取 → 解析 → 追加 → 写回的操作链必须嵌套回调

**🔒 华为应用商店审核要求（已踩坑）:**
- 右滑手势必须调用 `app.terminate()` 退出应用（审核拒绝理由 3.2）
- 首次启动必须展示隐私协议弹窗，同意后才可使用应用
- **隐私弹窗默认值防御**（V1.0.4 教训）：`@system.file` 读取失败时，data 中 `showPrivacy` 默认值必须是 `true`（"安全的失败默认值"），否则文件读不到时弹窗不显示 → 审核黑屏拒绝
- **预览器 `@system.file` 缓存**：DevEco 预览器会跨会话保留 `internal://app/` 数据。排查弹窗逻辑时，临时注释文件读取来隔离问题
- **`reqPermissions` 格式铁律**（关键纠错）：Lite Wearable **支持** `reqPermissions`，但**必须使用完整格式**（`name` + `reason` + `usedScene`），简化的短格式会报错 `module.abilities.permissions 字段不合法`。位置：`module` 内、`abilities` 之后。当前已声明：`ACCELEROMETER` + `VIBRATE` + `GYROSCOPE`，均使用完整格式
- **图标规范**：80×80 或 114×114；圆形卡通风格 + 严格透明背景（V1.0.5 重绘后过审）

**🔧 常见安装错误速查表:**

| 错误码 | 原因 | 修复 |
|--------|------|------|
| 40 | `config.json` 缺 `apiVersion` 或 API Level 过高 | 检查 config.json 和 build-profile.json5 |
| 47 | `compatibleSdkVersion` 过高 | 降为 `4.0.0(10)` |
| 10 | HAP 未签名 | 配置手动签名 |
| 覆盖失败 | 签名不一致/包名超长/图标过大 | 先卸载；检查 label ≤22字符 |

---

## Usage Guidelines

**For AI Agents:**
- 在实现任何代码之前必须先读取本文件
- 严格遵守所有标记为 ❌ 的规则
- 当不确定时，选择更保守的实现方案
- 发现新模式时应建议更新本文件

**For Humans:**
- 保持本文件精簾，专注于 AI Agent 需要知道的不明显规则
- 技术栈变化时同步更新
- 定期审查并删除已变得显而易见的规则

**ℹ️ 待办事项:**
- [x] ~~创建 `build-hap` Skill（命令行构建自动化）~~ → 已实现为 `scripts/build-hap.sh`（commit d8661a0）
- [x] ~~创建 `push-hap` Skill（HAP 传输和安装自动化）~~ → 已合并到 `build-hap.sh --push`
- [ ] `sessions.json` 多记录历史（当前只有 `last_session.json` 覆盖写）—— 见 README 开发计划 V1.0.1
- [ ] 目标次数 UI 调节（当前硬编码 100 次）—— 见 README 开发计划 V1.0.1

Last Updated: 2026-05-16（文档审计：补充命令行构建、双签名、圆屏文字安全区、list-item 陷阱、隐私默认值防御、图标规范、Skill 实现状态）
