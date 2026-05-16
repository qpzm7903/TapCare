# AGENTS.md — AI Agent 操作手册

> **本文档面向所有 AI 编码助手**（Claude Code、Cursor、Cody 等）。
> **所有规则与约束以 [`_bmad-output/project-context.md`](./_bmad-output/project-context.md) 为单一权威**。本文档只提供操作步骤、目录结构和错误处理速查。

---

## 项目快速识别

**我敲 (TapCare)** — HarmonyOS Lite Wearable 健康练习应用（GT4/GT6 手表）。

- 开发模型：**FA**（非 Stage） · 语言：**JavaScript**（非 ArkTS） · UI：**ArkUI Lite**（HML+CSS+JS）
- 屏幕：**466px 圆形** · 包名：`com.huawei.healthcounter`

判断项目类型是否正确：

```
✅ 应该存在: entry/src/main/config.json
❌ 不应存在: AppScope/、*.ets、module.json5
```

若发现 ❌ 的项目结构，**不要修改**，立即告知用户项目是 Stage 模型，无法在手表上运行。

---

## 目录结构

```
项目根目录/
├── _bmad-output/
│   └── project-context.md        # 🔑 权威规则集（先读）
├── build-profile.json5           # 构建配置 + 双签名声明
├── scripts/
│   ├── build-hap.sh              # 命令行构建（推荐入口）
│   ├── debug-build.sh            # 底层 hvigorw 调用示例
│   └── patch.js                  # hvigor 组件加载补丁
├── entry/src/main/
│   ├── config.json               # FA 模型核心配置
│   ├── js/MainAbility/
│   │   ├── app.js                # 全局生命周期
│   │   └── pages/
│   │       └── index/
│   │           ├── index.hml     # 布局（Mustache 数据绑定）
│   │           ├── index.css     # 样式（px / 百分比，无 rem）
│   │           └── index.js      # 逻辑（export default 组件）
│   └── resources/base/
│       ├── media/                # 图标资源
│       └── string/               # 字符串资源
├── docs/
│   ├── build-and-deploy.md
│   └── tap-detection-algorithm.md
├── .sisyphus/
│   ├── plans/                    # 进行中的任务计划
│   │   └── archived/             # 已落地/搁置的历史计划
│   └── evidence/                 # 任务验证证据
│       └── archived/
├── CLAUDE.md                     # Claude Code 专属指引
├── AGENTS.md                     # 本文档
├── PRD.md                        # ⚠️ 已脱节
└── README.md                     # 算法详解、版本状态、开发计划
```

---

## 标准操作流程

### 新增页面

1. 在 `entry/src/main/js/MainAbility/pages/` 下新建目录 `xxx/`
2. 创建三件套：`xxx/index.hml`、`xxx/index.css`、`xxx/index.js`
3. 在 `config.json` 的 `module.js[0].pages` 数组中追加 `"pages/xxx/index"`
4. 跳转入口：`router.push({ uri: 'pages/xxx/index' })`
5. **必须**确保新页面 `onDestroy()` 中释放所有传感器订阅与定时器

### 构建与安装

```bash
./scripts/build-hap.sh debug --push      # 构建 + hdc 推到手机 /sdcard/haps/
# 然后手机端「应用调测助手」蓝牙转发到手表
```

详细流程：[docs/build-and-deploy.md](./docs/build-and-deploy.md)

### 验证 HAP 包（安装失败时）

```bash
cp entry-default-signed.hap check.zip && unzip check.zip -d hap_check
ls hap_check/
# release HAP: 必须有 config.json，不能有 module.json5 或 *.bin
# debug HAP:   只含 entry-default-signed.bin（这是 Lite Wearable 正常特性）
```

### 修改 config.json 中的 reqPermissions

⚠️ **完整格式才有效**（短格式会报错 `module.abilities.permissions 字段不合法`）：

```json
"reqPermissions": [
  {
    "name": "ohos.permission.ACCELEROMETER",
    "reason": "Access accelerometer sensor data for tap detection",
    "usedScene": {
      "ability": ["MainAbility"],
      "when": "inuse"
    }
  }
]
```

位置：`module` 内、`abilities` 之后。当前已声明 `ACCELEROMETER`、`VIBRATE`、`GYROSCOPE`。

---

## 常见安装错误速查

| 错误码/现象 | 原因 | 修复 |
|---|---|---|
| `40 配置文件格式错误` | `config.json` 缺 `apiVersion`，或 API Level 过高，或项目是 Stage 模型 | 检查 `config.json`；降低 `build-profile.json5` SDK 版本 |
| `47 apiVersion 不合法` | `compatibleSdkVersion` 过高 | 降为 `4.0.0(10)` |
| `10 内部错误` | HAP 未签名 | 配置手动签名后重构 |
| 覆盖安装失败 | 签名不一致 / 包名过长 / 图标过大 | 先卸载；`label` ≤ 22 字符；图标 80×80 或 114×114 |
| 页面空白 | `config.json` 的 `pages` 路径写错 | 检查路径与实际文件目录一致 |
| 传感器无回调 | `interval` 设为 `'game'`/`'ui'` | 必须用 `'normal'`，5Hz 是硬限制 |

---

## AI Agent 协作约束

- ✅ 改代码前先读 `_bmad-output/project-context.md`
- ✅ 只修改 `entry/src/main/` 下源码 + `scripts/` + `docs/`
- ❌ 不修改签名证书（`.cer`/`.p7b`/`material/`）和构建产物（`entry/build/`）
- ❌ 不擅自递增 `app.version.code`，除非用户明确要求发布
- ❌ 不主动 `git commit`，除非用户明确指示
- ⚠️ 算法参数调整必须在代码注释中写明：**调整原因 + 预期效果 + 验证方式**
- ⚠️ 添加新的"踩坑"规则时，更新 `_bmad-output/project-context.md`，**不要**在 CLAUDE.md / AGENTS.md 复制规则
