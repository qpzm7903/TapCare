# HarmonyOS Lite Wearable 开发指南

**我敲 (TapCare)** — 运行在华为 GT4/GT6 手表上的中医经络敲打健康练习应用。通过加速度 + 陀螺仪传感器实现敲打动作检测、计数、力度识别和练习记录。

- **平台**: HarmonyOS Lite Wearable (GT4/GT6, HarmonyOS 5.0+)
- **开发模型**: FA 模型（不是 Stage 模型）
- **语言**: JavaScript（不是 ArkTS）
- **UI 框架**: ArkUI Lite（类 Web 三件套：HML + CSS + JS）
- **屏幕尺寸**: 466px 圆形表盘
---

## 硬件能力与传感器策略

经过真机实测（华为 GT4），Lite Wearable 的传感器行为如下：
- `@system.sensor` 支持 `frequency: 'game'` 模式，并且**硬件能够真实达到 20ms（50Hz）的采样率**。
- 这意味着可以使用基于高频采样的波形分析、峰值检测等现代信号处理算法，而不需要依赖猜测或极低频（5Hz, 200ms）的数据点。

## 项目结构

```
项目根目录/
├── AGENTS.md
├── build-profile.json5          # 构建与签名配置（API 版本在此）
├── entry/
│   └── src/
│       └── main/
│           ├── config.json      # FA 模型核心配置（关键！）
│           ├── js/
│           │   └── MainAbility/
│           │       ├── app.js           # 全局生命周期
│           │       └── pages/
│           │           └── index/
│           │               ├── index.hml    # 布局
│           │               ├── index.css    # 样式
│           │               └── index.js     # 逻辑
│           └── resources/
│               └── base/
│                   ├── media/
│                   └── string/
└── AppScope/                    # ⚠️ 不存在！存在说明项目建错了
```

> **若目录中存在 `AppScope/` 或 `.ets` 文件，说明这是 Stage 模型项目，无法在手表上运行，不要修改，直接告知用户需要重建项目。**

---
### Lite Wearable config.json 限制（踩坑记录）

- `config.json` **顶层只允许** `app`、`deviceConfig`、`module` 三个 key，写其他字段会构建报错
- `module` 内添加 `reqPermissions` 必须使用完整格式（包含 `reason` 和 `usedScene`），否则会报 `module.abilities.permissions 字段不合法`
- 传感器权限声明格式（参考示例）：
  ```json
  "reqPermissions": [
    {
      "name": "ohos.permission.ACCELEROMETER",
      "reason": "Access accelerometer sensor data",
      "usedScene": {
        "ability": ["MainAbility"],
        "when": "inuse"
      }
    }
  ]
  ```
- `reqPermissions` 必须放在 `module` 内、`js` 数组之前
- Lite Wearable 上 `@system.sensor` 的加速度传感器需要声明权限才能正常使用

---
## 核心约束（必须遵守）

### FA 模型约束

- **唯一配置文件是 `config.json`**，不是 `module.json5`，不要创建或修改 `module.json5`
- `config.json` 必须包含 `app.apiVersion`，缺少此字段手表安装必报错误码 40
- `module.deviceType` 必须是 `["liteWearable"]`，不能是 `"wearable"` 或 `"phone"`
- `module.package` 必须存在且与 `app.bundleName` 一致


### build-profile.json5 API 版本

`targetSdkVersion` 和 `compatibleSdkVersion` 必须使用以下范围，**不能更高**：

```json5
"targetSdkVersion": "6.0.2(22)",
"compatibleSdkVersion": "4.0.0(10)"
```

GT4/GT6 手表固件对 Lite Wearable 支持的 API Level 上限为此范围，使用更高版本会导致安装失败。

### bundleName 规则

- 当前 `config.json` 中的 `com.huawei.healthcounter` 不用改

---

## JavaScript 运行时限制

Lite Wearable 运行的是**裁剪版 JS 引擎**，以下能力受限，编写代码时严格遵守：

| 能力 | 状态 | 替代方案 |
|---|---|---|
| `fetch` / `XMLHttpRequest` | ❌ 禁用 | 通过手机端 App 中转（`@system.bridge`） |
| WebSocket | ❌ 禁用 | 同上 |
| `console.log` 调试 | ✅ 可用 | 通过应用调测助手查看日志 |
| `setTimeout` / `setInterval` | ✅ 可用 | 正常使用 |
| 文件读写 | ✅ 受限可用 | 使用 `@system.file` |
| 传感器数据 | ✅ 可用 | 使用 `@system.sensor` |
| 页面路由 | ✅ 可用 | `router.push()` / `router.replace()` |
| Canvas | ✅ 部分可用 | 避免使用未 release 的 API |
| ES6 高级语法 | ❌ 禁用 | **必须使用严格的 ES5 语法**。不可使用 `const`、`let`、箭头函数 `()=>`、扩展运算符 `...`、解构赋值等。ES6 语法会导致 Hvigor 编译损坏，致使手表安装时报 `错误: 34`（内部错误），或在预览器中直接黑屏卡死！ |

**网络请求严苛限制 (Fetch API)**:
- GT5 及更早期的运动表与 iOS 手机配对时，**完全无法发起 fetch 请求**。
- 欧洲地区的运动表**均无法发起 fetch 请求**。
- **Payload 限制**：请求头大小不能超过 **2KB**，传输层单包数据不能超过 **7KB**，超过即静默失败。
- 手表本身没有独立联网能力（GT4/GT6 无独立 SIM），所有的 Fetch 实际上依赖手机中转。**不要编写依赖强网的代码**。

---

## 页面开发规范

### HML 模板

```html
<!-- index.hml -->
<div class="container">
  <text class="title">{{ title }}</text>
  <input type="button" value="点击" onclick="handleClick" />
</div>
```

### CSS 规范

- 表盘基准宽度：**466px**（圆形）或 **408px × 480px**（方形）
- 使用 px 或百分比，不支持 rem/em/vw/vh
- 不支持 CSS 动画（`@keyframes`）
- **CSS 布局陷阱 (极易坍塌)**: 
  - 避免在深层嵌套的 `div` 中使用 `flex-grow: 1`，老架构引擎不支持流体高度传递，会导致容器高度坍塌为 0 从而隐藏内部元素。
  - 对于圆形表盘（如 GT4/GT6 的 466px 屏幕），请使用**绝对高度 (`height: 466px`) + 明确尺寸的 spacer `div` 占位符**进行流式居中排版，而不是过度依赖复杂的层级嵌套和弹性伸缩。
- 不支持 Flexbox 的部分高级属性，使用 `display: flex` 时需测试实际效果

```css
.container {
  width: 466px;
  height: 466px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
```

### JS 逻辑

```javascript
// index.js
export default {
  data: {
    title: 'Hello Watch'
  },
  onInit() {
    // 页面初始化，数据已就绪
  },
  onShow() {
    // 页面显示时触发
  },
  handleClick() {
    this.title = '已点击';
  }
}
```

### 生命周期顺序

页面跳转时：前一页面 `onDestroy()` → 新页面 `onInit()` → `onReady()` → `onShow()`

---

## 新增页面步骤

1. 在 `entry/src/main/js/MainAbility/pages/` 下新建目录，如 `detail/`
2. 创建 `detail/index.hml`、`detail/index.css`、`detail/index.js`
3. 在 `config.json` 的 `module.js[0].pages` 数组中添加 `"pages/detail/index"`
4. 使用路由跳转：`router.push({ uri: 'pages/detail/index' })`

---

## 构建与安装流程

### 构建命令（DevEco Studio）

```
Build → Build Hap(s) → Build Debug Hap(s)
```

输出路径：`entry/build/default/outputs/default/entry-default-signed.hap`

### 安装到手表

1. 将 `.hap` 文件复制到手机 `/sdcard/haps/` 目录
2. 手表通过蓝牙连接手机
3. 打开「应用调测助手」→「应用管理」→ 选择 HAP → 安装

### 验证 HAP 包（安装失败时执行）

```bash
cp entry-default-signed.hap check.zip && unzip check.zip -d hap_check
ls hap_check/
# 必须存在: config.json
# 不能存在: module.json5 或 *.bin 文件
```

---

## 签名配置

Lite Wearable **不支持自动签名**，必须手动配置：

- 签名证书（`.cer`）和调试 Profile（`.p7b`）需在 AGC 手动申请
- Profile 申请时设备类型选「**穿戴设备（Wearable）**」
- 手表 UDID 从「应用调测助手」App 获取后添加到 Profile
- 签名密码使用 DevEco Studio 加密后的格式，不是明文

---

## 常见错误处理

| 现象 | 原因 | 修复 |
|---|---|---|
| 安装失败：40 配置文件格式错误 | `config.json` 缺 `apiVersion`，或 API Level 过高，或项目是 Stage 模型 | 检查 `config.json` 结构；降低 `build-profile.json5` 中的 SDK 版本 |
| 安装失败：47 配置 app.apiVersion 不合法 | `compatibleSdkVersion` 版本配置过高 | 将 `build-profile.json5` 中的 `compatibleSdkVersion` 降为 3 或与目标设备匹配的底线版本 |
| 安装失败：34 内部错误 / 预览器黑屏卡死 | HML/JS 存在语法错误或存在不支持的 **ES6+ 语法** | Lite Wearable JS 引擎极度裁剪，**必须全量使用 ES5** (用 `var` 和 `function` 替换 `const`/`let`/`=>`)；检查 HML 标签是否嵌套错误（如 `<text>` 不能包含其他标签） |
| 安装失败：10 内部错误 | HAP 未签名 | 配置手动签名后重新构建 |
| 覆盖安装失败 | 签名不一致、包名超长、图标过大 | 先卸载旧版本；检查 config.json 中的 label (不要超 22 字符)；检查图标尺寸 (80x80/114x114) |
| 页面空白 | `config.json` 的 `pages` 路径写错 | 检查路径是否与实际文件目录一致 |

---

## 禁止事项

- ❌ 不要创建或修改 `module.json5`（Stage 模型文件，Lite Wearable 不用）
- ❌ 不要将 `targetSdkVersion` 设为高于 `6.0.2(22)`
- ❌ 不要编写 `fetch`、`axios`、`XMLHttpRequest` 等网络请求代码
- ❌ 不要使用 `.ets` 文件或 ArkTS 语法（Lite Wearable 只支持 JS）
- ❌ 不要删除或重命名 `config.json`（唯一配置文件）
- ❌ 不要在 `app.json5` 中改配置（该文件属于 Stage 模型，本项目不使用）
