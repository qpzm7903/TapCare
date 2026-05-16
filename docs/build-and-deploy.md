# 命令行构建与部署指南

本文档讲清楚：用命令行（不依赖 DevEco Studio GUI）完成本项目的**构建 → 双证书签名 → 推送到手机**全流程。

> 如果只想看一行命令：`./scripts/build-hap.sh debug --push`

---

## 1. 整体流程

```
源码  ──▶  hvigorw 构建  ──▶  HAP（含签名）  ──▶  adb push  ──▶  手机 /sdcard/haps/
                │                                                          │
                ├─ debug product → debug 证书签名                        ▼
                └─ default product → release 证书签名             「应用调测助手」App
                                                                          │
                                                                          ▼ 蓝牙
                                                                       手表安装
```

**关键认知**：

- Lite Wearable HAP **不能直接装到手表**（手表无 USB 口），必须通过手机的「应用调测助手」中转
- `/sdcard/haps/` 是手机端目录，不是手表端
- debug 和 release 用**不同证书**签名，由 `build-profile.json5` 里的 `product` 决定

---

## 2. 一次性环境准备

### 2.1 必须

| 项目 | 默认位置 | 说明 |
|---|---|---|
| DevEco Studio | `/Applications/DevEco-Studio.app` | 提供 hvigorw、Node.js、SDK、签名工具 |
| OpenHarmony SDK | `/Applications/DevEco-Studio.app/Contents/sdk` | 由 DevEco Studio 自带，无需单独装 |
| 签名证书 | `~/hongmeng/` | release 与 debug 两套（见下方"证书材料"） |

### 2.2 推送到手机用（二选一）

| 工具 | 适用 | 安装 |
|---|---|---|
| **adb**（推荐） | EMUI / HarmonyOS 2/3/4 | `brew install --cask android-platform-tools` 或 Android SDK |
| **hdc** | HarmonyOS 5 / NEXT 纯血鸿蒙 | DevEco Studio 自带 |

**实测踩坑**：HarmonyOS 4（如 Mate 40 Pro）上 hdc 经常报 `[Empty]`（客户端/服务端版本对不上），**adb 反而稳定**。脚本会自动选可用的工具。

### 2.3 证书材料（路径硬编码在 build-profile.json5 里）

| 用途 | 文件 |
|---|---|
| Release 证书 | `~/hongmeng/healthcounter_release.{p12,cer}` + `_profileRelease.p7b` |
| Debug 证书 | `~/hongmeng/keystore.p12` + `test.cer` + `test2Debug.p7b` |

> 密码是 DevEco Studio 加密后的字符串（`0000001A...` 开头），**绑定本机 keystore**，复用 OK 但**不能跨机迁移**。

---

## 3. 双签名是怎么工作的

### 3.1 三层关系（最容易混淆）

| 维度 | 控制什么 | 切换方式 |
|---|---|---|
| `buildMode` (debug/release) | 是否压缩、混淆、缓存等构建选项 | `-p buildMode=...` |
| `product` (default/debug) | 该 product 用哪套 signingConfig | `-p product=...` |
| `signingConfig` | 实际证书+profile+密钥 | 由 product 引用，命令行不能直接切 |

⚠️ **`-p buildMode=` 不切证书**。光改 buildMode 是 placebo，签名证书完全不会变。**必须靠 `-p product=`**。

### 3.2 build-profile.json5 关键结构

```json5
{
  "app": {
    "signingConfigs": [
      { "name": "default", "material": { /* release 证书 */ } },
      { "name": "debug",   "material": { /* debug 证书 */ } }
    ],
    "products": [
      { "name": "default", "signingConfig": "default" },  // release product
      { "name": "debug",   "signingConfig": "debug"   }   // debug product
    ],
    "buildModeSet": [{ "name": "debug" }, { "name": "release" }]
  },
  "modules": [{
    "name": "entry",
    "targets": [{
      "name": "default",                          // 必须叫 default，不能叫 "debug"
      "applyToProducts": ["default", "debug"]     // 单 target 应用到两个 product
    }]
  }]
}
```

**约束（实测踩坑）**：

- 保留名为 `default` 的 product 给 release 用 — DevEco IDE 默认就用这个，改名会破坏 IDE 内的 Run/Build 按钮
- module 的 `targets[].name` **不能叫 `"debug"`**（与 buildMode 同名，hvigor 报 `Unknown target 'debug'`），用 `default` + `applyToProducts: [...]` 列两个 product
- SDK 路径必须用 `Contents/sdk`（不带 `default` 子目录），让 hvigor 自己根据 product 选 openharmony 子目录。`~/Library/OpenHarmony/command-line-tools/sdk/default` 那个 SDK 通常缺组件，会报 `SDK component missing`

---

## 4. 构建命令

### 4.1 推荐：用项目脚本

```bash
./scripts/build-hap.sh debug --push      # debug 构建 + 自动推送
./scripts/build-hap.sh release --push    # release 构建 + 自动推送
./scripts/build-hap.sh debug             # 只构建，不推送
./scripts/build-hap.sh --help            # 看用法
```

脚本职责：环境检查 → 构建 → HAP 完整性校验 → 严格验签（hap-sign-tool 提取 profile + MD5）→ 自动选 adb/hdc → push 到 `/sdcard/haps/`。

### 4.2 底层命令（脚本里在做的事）

```bash
NODE=/Applications/DevEco-Studio.app/Contents/tools/node/bin/node
HVIGOR=/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw.js
export DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk

# Debug 构建（debug 证书）
"$NODE" "$HVIGOR" assembleHap --mode module \
    -p product=debug -p buildMode=debug --no-daemon

# Release 构建（release 证书）
"$NODE" "$HVIGOR" assembleHap --mode module \
    -p product=default -p buildMode=release --no-daemon
```

### 4.3 输出位置

```
entry/build/<product>/outputs/<target>/entry-<target>-signed.hap
```

| Variant | 实际路径 |
|---|---|
| Debug   | `entry/build/debug/outputs/default/entry-default-signed.hap` |
| Release | `entry/build/default/outputs/default/entry-default-signed.hap` |

注意第三段是**target 名（固定 default）**，不是 buildMode。

### 4.4 ⚠️ debug 与 release 的 HAP 内部结构不同

| 模式 | HAP 内含 | 用途 |
|---|---|---|
| **release** | `config.json` + `pack.info` + `assets/` | 应用市场审核、AGC 上架 |
| **debug** | 单个 `entry-default-signed.bin` | 应用调测助手安装、本地真机调试 |

这是 Lite Wearable 特性，**不是构建错误**。校验 debug HAP 时不能找 config.json。

---

## 5. 验签（确认 HAP 真的用了对的证书）

普通 `openssl x509 -in cer` 看不出区别（cer 是证书链 PEM，第一项往往是 Huawei 根 CA）。**正确方式：用 hap-sign-tool 提取 profile，对比原始 profile MD5**。

```bash
SIGN_TOOL=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar
JAVA=/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home/bin/java

# 准备临时输出（macOS mktemp 坑：用 mktemp -d 后自拼路径，不要用 -t hap.XXXXXX.cer）
TMP=$(mktemp -d)

# 从 HAP 提取 profile
$JAVA -jar $SIGN_TOOL verify-app \
    -inFile entry/build/debug/outputs/default/entry-default-signed.hap \
    -outCertChain $TMP/chain.cer \
    -outProfile $TMP/extracted.p7b

# MD5 对比
md5 $TMP/extracted.p7b ~/hongmeng/test2Debug.p7b
# 一致 → debug HAP 确实用了 debug 证书
```

build-hap.sh 已经内嵌这一步，每次构建后自动打印 `🔐 验签通过, profile MD5: ...`。

---

## 6. 推送到手机

### 6.1 USB 模式辨析（最容易踩坑）

华为手机的 USB 连接**两种模式互斥**：

| 模式 | 选择位置 | 能干什么 | 不能干什么 |
|---|---|---|---|
| **USB 调试** | 设置 → 系统 → 开发人员选项 → USB 调试 | adb/hdc 通信、push、shell | 像 U 盘一样浏览文件 |
| **传输文件 (MTP)** | 接 USB 后通知栏选"传输文件" | 在 macOS Finder 里手动拖文件 | adb/hdc 看不到设备 |

**必须二选一**。要自动化必须选 USB 调试。

### 6.2 adb 推送（HarmonyOS 4 推荐）

```bash
ADB="$HOME/Library/Android/platform-tools/adb"
HAP=entry/build/debug/outputs/default/entry-default-signed.hap

$ADB devices                              # 应看到 设备序列号 + "device"
$ADB shell mkdir -p /sdcard/haps          # 首次需要
$ADB push $HAP /sdcard/haps/              # 核心命令
```

### 6.3 hdc 推送（HarmonyOS 5/NEXT 必须）

```bash
HDC=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc
HAP=entry/build/debug/outputs/default/entry-default-signed.hap

$HDC list targets                         # 应看到 设备序列号
$HDC shell mkdir -p /sdcard/haps
$HDC file send $HAP /sdcard/haps/         # 注意是 file send 不是 push
```

### 6.4 推送之后

打开手机上的「**应用调测助手**」App，会自动列出 `/sdcard/haps/` 下的新 HAP。点击 → 蓝牙发送到手表 → 手表自动安装。

---

## 7. 故障排查清单

### 7.1 构建失败

| 症状 | 排查 |
|---|---|
| `SDK component missing` | `DEVECO_SDK_HOME` 用错了路径，应是 `/Applications/DevEco-Studio.app/Contents/sdk`（不带 default） |
| `Unknown target 'debug'` | module 的 target 名不能叫 `debug`，与 buildMode 同名冲突。用 `default` + `applyToProducts` 列两个 product |
| `Current product is 'debug'. No output ...` | product 在 build-profile 里没声明，或 module target 没 apply 过去 |
| 构建报警 `can not sign bin with codesign` | Lite Wearable 已知警告，不影响产物，可忽略 |

### 7.2 推送失败

| 症状 | 排查 |
|---|---|
| `adb devices` 空 / `hdc list targets` 显示 `[Empty]` | 见 6.1，确认 USB 模式选了"USB 调试"而不是"传输文件" |
| 设备显示 `unauthorized` | 手机弹窗的"允许 USB 调试"未点，或没勾"始终允许" |
| **物理层验证**：插上线后到底有没有识别 | `ioreg -p IOUSB -l -w 0 \| grep "USB Product Name"` 应能看到华为型号代号（如 `NOH-AN00` = Mate 40 Pro） |
| hdc 报 `[Empty]` 但 ioreg 看得到设备 | client/server 版本不匹配，**直接换 adb 不要在 hdc 上耗时间** |
| 多个 server 实例冲突 | `adb kill-server && adb start-server` 或 `hdc kill && hdc start` |

### 7.3 验签报错

| 症状 | 原因 |
|---|---|
| `Not support file: /dev/null` | hap-sign-tool 不接受 `/dev/null`，必须给真实可写文件 |
| `Not support file: ...XXXXXX.cer.RANDOM` | macOS 的 `mktemp -t hap.XXXXXX.cer` 会追加随机后缀，破坏扩展名。改用 `mktemp -d` 后自拼路径 |

---

## 8. 相关 Skills（给 Claude Code 用）

本项目工作流已经被沉淀进一个 Claude Code skill：

### `harmonyos-build` skill

- **位置**：`~/.claude/skills/harmonyos-build/SKILL.md`
- **触发场景**：用户提到 "构建 HAP"、"debug/release 构建"、"双签名"、"推送到手机"、"hdc / adb push"、"验签"、"hvigorw 报错" 等
- **能做的**：
  - 双 signingConfig 配置生成与诊断
  - 命令行构建（hvigorw + 正确的 product/buildMode 组合）
  - 严格验签（hap-sign-tool + profile MD5 对比）
  - adb/hdc 自动选择推送（HarmonyOS 4 → adb，5/NEXT → hdc）
  - 常见构建/推送错误排查

下次让 Claude Code 帮你处理构建相关任务时，**它会自动加载这个 skill**，不用手动指定。

### 相关命令

| 命令 | 用途 |
|---|---|
| `/skill-creator` | 创建新 skill 或改进现有 skill。本项目的 build/push 能力就是靠它和你协作出来的 |

### 二次开发提示

如果想给 `harmonyos-build` skill 加新能力（比如 HAR 包构建、特定模块构建优化），用 `/skill-creator` 走完整迭代流程：写测试 prompt → 跑 baseline + with-skill → 收集人工反馈 → 改进 → 重跑。

---

## 附录：核心文件速查

| 文件 | 作用 |
|---|---|
| `build-profile.json5` | 双 signingConfig + 双 product 配置 |
| `entry/build-profile.json5` | entry 模块构建选项（保持空模板即可） |
| `hvigorfile.ts` | 项目级 hvigor 任务（用 `legacyAppTasks`） |
| `entry/hvigorfile.ts` | entry 级 hvigor 任务（用 `legacyHapTasks`） |
| `local.properties` | SDK 路径（DevEco 自动维护，不要手改） |
| `scripts/build-hap.sh` | 一键构建+验签+推送 |
| `signing/` | debug 证书材料备份（与 `~/hongmeng/` 内容一致） |
