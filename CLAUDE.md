# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**敲敲计 (TapCare)** — 运行在华为 GT4/GT6 手表上的中医经络敲打健康练习应用。通过加速度+陀螺仪传感器实现敲打动作检测、计数、力度识别和练习记录。

- **平台**: HarmonyOS Lite Wearable (GT4/GT6, HarmonyOS 5.0+)
- **开发模型**: FA 模型（不是 Stage 模型）
- **语言**: JavaScript（不是 ArkTS）
- **UI 框架**: ArkUI Lite（类 Web 三件套：HML + CSS + JS）
- **屏幕尺寸**: 466px 圆形表盘

## 构建与部署

本项目使用 **DevEco Studio** 构建，不支持命令行构建：

- 构建: `Build → Build Hap(s) → Build Debug Hap(s)`
- 输出: `entry/build/default/outputs/default/entry-default-signed.hap`
- 安装: 通过「应用调测助手」App 蓝牙传输 HAP 到手表
- 调试: `console.log` 输出通过应用调测助手查看

签名为手动配置（AGC 申请证书），不支持自动签名。

## 关键架构约束

### FA 模型（非 Stage 模型）

- 唯一配置文件是 `entry/src/main/config.json`，**绝对不能**创建或修改 `module.json5`
- 如果项目中出现 `AppScope/` 目录或 `.ets` 文件，说明项目结构错误
- `config.json` 中 `module.deviceType` 必须是 `["liteWearable"]`

### Lite Wearable config.json 限制（踩坑记录）

- `config.json` **顶层只允许** `app`、`deviceConfig`、`module` 三个 key，写其他字段会构建报错
- `module` 内**不支持** `reqPermissions` 字段，安装到手表时会报 `module.abilities.permissions 字段不合法`
- Lite Wearable 上 `@system.sensor` 的加速度传感器（`subscribeAccelerometer`）**无需权限声明**，直接调用即可
- **不要**在 config.json 中添加任何权限相关配置（`reqPermissions`、`defPermissions` 等），Lite Wearable 不支持

### JS 运行时限制

Lite Wearable 运行裁剪版 JS 引擎：

- **禁用**: `fetch`、`XMLHttpRequest`、WebSocket、`async/await`、`Proxy`、复杂解构
- **可用**: `setTimeout`/`setInterval`、`@system.sensor`（传感器）、`@system.file`（文件读写）、`console.log`、`router.push()`
- **不支持的 CSS**: `rem/em/vw/vh`、`@keyframes` 动画、部分 Flexbox 高级属性
- 手表无独立联网能力，不要编写任何网络请求代码

### SDK 版本约束

`build-profile.json5` 中的 SDK 版本：
- `targetSdkVersion` 不能高于 `"6.0.2(22)"`
- `compatibleSdkVersion` 不能高于 `"4.0.0(10)"`

### 命名约束

- 当前 `config.json` 中的 `com.huawei.healthcounter` 不用改

## 代码结构

```
entry/src/main/
├── config.json                    # FA 模型核心配置（页面路由、权限、设备类型）
└── js/MainAbility/
    ├── app.js                     # 全局生命周期 (onCreate/onDestroy)
    └── pages/
        └── index/
            ├── index.hml          # 页面布局模板（Mustache 语法绑定）
            ├── index.css          # 页面样式（px 或百分比单位）
            └── index.js           # 页面逻辑（data + 生命周期 + 方法）
```

## 页面开发模式

每个页面由同目录下的 `.hml` + `.css` + `.js` 三个文件组成：

```javascript
// index.js — 组件定义模式
export default {
  data: { /* 响应式数据 */ },
  onInit() { /* 页面初始化 */ },
  onShow() { /* 页面显示 */ },
  onDestroy() { /* 页面销毁 */ },
  // 自定义方法
}
```

新增页面步骤：
1. 在 `pages/` 下新建目录和三件套文件
2. 在 `config.json` 的 `module.js[0].pages` 数组中注册路径
3. 使用 `router.push({ uri: 'pages/xxx/index' })` 跳转

生命周期顺序：`onInit()` → `onReady()` → `onShow()`；页面切换时前一页先 `onDestroy()`。


# 详细语法支持参考

@doc-ref.md


