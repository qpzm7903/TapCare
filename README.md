# 敲敲计 TapCare

运行在华为 Watch GT4/GT6 上的中医经络敲打健康练习应用。通过加速度传感器检测敲打动作，实现自动计数、力度识别和节奏评估。

## 功能

- 敲打自动计数（基于加速度传感器）
- 力度分级（轻 / 中 / 重）
- 节奏评估（很稳 / 良好 / 不稳）
- 振动反馈
- 多经络部位切换（左胆经、右胆经、心包经、三焦经）
- 练习记录持久化

## 技术栈

| 项目 | 值 |
|------|-----|
| 平台 | HarmonyOS Lite Wearable (HarmonyOS 5.0+) |
| 开发模型 | FA 模型（非 Stage 模型） |
| 语言 | JavaScript（非 ArkTS） |
| UI 框架 | ArkUI Lite（HML + CSS + JS 三件套） |
| 屏幕 | 466px 圆形表盘 |
| 包名 | com.huawei.healthcounter |

## 项目结构

```
entry/src/main/
├── config.json                        # FA 模型配置（页面路由、权限、设备类型）
└── js/MainAbility/
    ├── app.js                         # 应用生命周期
    └── pages/index/
        ├── index.hml                  # 页面布局
        ├── index.css                  # 页面样式
        └── index.js                   # 页面逻辑 + 敲打检测算法
```

## 构建与部署

本项目使用 **DevEco Studio** 构建，不支持命令行构建。

1. DevEco Studio 打开项目
2. `Build → Build Hap(s) → Build Debug Hap(s)`
3. 输出：`entry/build/default/outputs/default/entry-default-signed.hap`
4. 通过「应用调测助手」App 蓝牙传输 HAP 到手表
5. 调试日志通过应用调测助手查看

签名为手动配置（AGC 申请证书）。

## 使用方式

1. 打开应用，选择经络部位
2. 点击「开始敲打」
3. 等待 2 秒校准（保持手腕静止）
4. 开始敲打，自动计数
5. 达到目标次数自动完成，或手动结束

---

## 敲打检测算法

### 硬件约束

| 项目 | 值 |
|------|-----|
| 传感器 | `@system.sensor` subscribeAccelerometer |
| 可用采样模式 | 仅 `'normal'`（`'game'`、`'ui'` 静默失败） |
| 实际采样率 | ~5Hz（每帧 ~200ms） |
| 数据单位 | g（去重力后线性加速度） |
| 静止 magnitude | 约 0.25g，噪声 0.1~0.3g |

5Hz 意味着采样间隔 200ms，而一次轻敲脉冲仅 50~100ms。**轻敲有约 75% 的概率整个脉冲落在两个采样点之间**，这是物理极限。

### 算法三阶段

整个检测流程：**Baseline 校准 → 双通道信号提取 → 上升沿判定**。

#### 阶段一：Baseline 校准

开始计数后前 10 帧（约 2 秒）只采集不检测，测量手表静止时的加速度基准值。

```
采集 10 个 magnitude 样本
    ↓
排序，取最小的 6 个算均值 → baseline ≈ 0.20g
```

取最小 6 个而非全部均值，是为了排除校准期间用户已开始敲打的干扰样本。

#### 阶段二：双通道信号提取

每帧计算两路信号：

**通道 A — 绝对偏移：**
```
dynamicAccel = |magnitude - baseline|
```
捕获采样点恰好落在脉冲峰值上的情况。阈值 0.18g。

**通道 B — 帧间差值：**
```
delta = |当前帧 magnitude - 上一帧 magnitude|
```
捕获采样点落在脉冲边缘的情况 — 即使没采到峰值，敲打前后的帧也会有跳变。阈值 0.15g。

**触发条件：** 两路信号任一越过阈值即可触发（OR 逻辑）。

```
举例：
帧 N:   magnitude = 0.22g（静止）
帧 N+1: magnitude = 0.40g（脉冲边缘）

绝对偏移：|0.40 - 0.20| = 0.20g → 过阈值 ✓
帧间差值：|0.40 - 0.22| = 0.18g → 过阈值 ✓
→ BOTH 触发
```

#### 阶段三：上升沿判定

用布尔标志 `_tapFired` 保证一次敲打只计一次：

```
信号
 │    ┌──┐
 │   / │  │\
 ───/──┼──┼──\──── 阈值线
 │ /   │  │   \
 │/    │  │    \
 └─────┴──┴────── 时间
       ↑        ↑
    触发计数   复位
```

1. 信号越阈值 + 未触发 → **计数 +1**，标记为已触发
2. 信号越阈值 + 已触发 → 不计数，跟踪峰值
3. 信号回落到阈值以下 → 复位，准备下一次

额外 150ms debounce 防极端抖动。

### 力度分级与节奏评估

**力度：**

| 等级 | 信号范围 |
|------|----------|
| 轻 | < 0.4g |
| 中 | 0.4g ~ 1.0g |
| 重 | > 1.0g |

**节奏：** 记录最近 10 次敲打间隔，计算变异系数 CV：

| CV | 评价 |
|----|------|
| < 0.15 | 很稳 |
| 0.15 ~ 0.30 | 良好 |
| > 0.30 | 不稳 |

### 完整数据流

```
手表加速度计 (5Hz, 每 200ms 回调一次)
    │
    ▼
(x, y, z) → magnitude = sqrt(x² + y² + z²)
    │
    ├── [前 10 帧] → Baseline 校准 → baseline ≈ 0.20g
    │
    ├── dynamicAccel = |mag - baseline|     → >= 0.18g?  (dynHit)
    │
    ├── delta = |mag - prevMag|             → >= 0.15g?  (deltaHit)
    │
    │                              dynHit OR deltaHit?
    │                              ┌────┴────┐
    │                              NO       YES
    │                              │         │
    │                         _tapFired?   _tapFired == false
    │                           true       且 since >= 150ms?
    │                            │              │
    │                         复位为          计数 +1
    │                          false         力度分级
    │                                        节奏评估
    │                                        振动反馈
    │                                        进度更新
    ▼
  prevMag = mag（保存供下帧使用）
```

### 参数总表

| 参数 | 值 | 作用 |
|------|-----|------|
| `TAP_THRESHOLD` | 0.18g | 绝对偏移触发阈值 |
| `DELTA_THRESHOLD` | 0.15g | 帧间差值触发阈值 |
| `MIN_DEBOUNCE_MS` | 150ms | 最小触发间隔 |
| `FORCE_LIGHT_MAX` | 0.4g | 轻/中敲分界 |
| `FORCE_MEDIUM_MAX` | 1.0g | 中/重敲分界 |
| `CAL.SAMPLE_COUNT` | 10 | 校准采集帧数 |
| `CAL.USE_LOWEST` | 6 | 校准取最小 N 个均值 |

### 算法演进

| 版本 | 方案 | 结果 |
|------|------|------|
| v1 | 状态机（上升-峰值-下降） | 5Hz 下无法追踪完整波形 |
| v2 | 简单阈值 + 时间 debounce | 阈值 0.5g 太高，轻敲漏检 |
| v3 | 降低阈值 + baseline 校准 | 改善但仍依赖单一绝对值 |
| v4 | 上升沿检测替代时间 debounce | 防止持续振动计多次 |
| v5 | **双通道：绝对偏移 + 帧间差值** | 当前方案，覆盖峰值和边缘两种情况 |

### 已验证的硬件结论（GT6 真机）

| 测试项 | 结果 |
|--------|------|
| accelerometer normal 模式 | 可用，~5Hz |
| accelerometer game 模式 | 不可用（0 回调） |
| accelerometer ui 模式 | 不可用（0 回调） |
| gyroscope normal 模式 | 可用，~5Hz，需 GYROSCOPE 权限 |

## 开发文档

- [敲打检测算法详细文档](.sisyphus/plans/tap-detection-algorithm.md)
- [陀螺仪融合方案（备用）](.sisyphus/plans/gyroscope-fusion-plan.md)

## License

Private project.
