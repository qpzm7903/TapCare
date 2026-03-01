

https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-system-sensor
以下是根据华为 HarmonyOS 官方文档（`@system.sensor` 模块）整理的 API 参考手册，专为 LLM 理解和代码生成优化。

---

# HarmonyOS Sensor API 文档 (@system.sensor)

## 1. 模块概览

`@system.sensor` 模块提供订阅传感器数据的基本能力。

* **支持设备**：Wearable（穿戴设备）、Lite Wearable（轻量级穿戴设备）。
* **维护策略**：
* **Lite Wearable**：长期维护，正常使用。
* **其他设备**：从 API Version 8 开始建议使用新接口 `@ohos.sensor`。


* **权限说明**：部分接口需要系统权限或用户授权（见下文）。

## 2. 核心 API 索引

### 2.1 加速度计 (Accelerometer)

观察设备加速度数据的变化。

* **订阅**：`Sensor.subscribeAccelerometer(options: subscribeAccelerometerOptions): void`
* **取消订阅**：`Sensor.unsubscribeAccelerometer(): void`
* **数据结构 (`AccelerometerResponse`)**:
* `x`: number (x轴加速度)
* `y`: number (y轴加速度)
* `z`: number (z轴加速度)


* **参数配置 (`interval`)**: `'game'` (20ms), `'ui'` (60ms), `'normal'` (200ms)。
* **所需权限**：`ohos.permission.ACCELEROMETER`

### 2.2 罗盘 (Compass)

订阅罗盘数据变化（设备面对的方向度数）。

* **订阅**：`Sensor.subscribeCompass(options: SubscribeCompassOptions): void`
* **取消订阅**：`Sensor.unsubscribeCompass(): void`
* **数据结构 (`CompassResponse`)**:
* `direction`: number (度数)



### 2.3 计步器 (Step Counter)

订阅步数变化。

* **订阅**：`Sensor.subscribeStepCounter(options: SubscribeStepCounterOptions): void`
* **取消订阅**：`Sensor.unsubscribeStepCounter(): void`
* **数据结构 (`StepCounterResponse`)**:
* `steps`: number (当前步数)


* **所需权限**：`ohos.permission.ACTIVITY_MOTION`

### 2.4 心率 (Heart Rate)

订阅心率数据。

* **订阅**：`Sensor.subscribeHeartRate(options: SubscribeHeartRateOptions): void`
* **取消订阅**：`Sensor.unsubscribeHeartRate(): void`
* **数据结构 (`HeartRateResponse`)**:
* `heartRate`: number (心率值)


* **所需权限**：`ohos.permission.READ_HEALTH_DATA`

### 2.5 穿戴状态 (On-Body State)

检测设备是否佩戴在身上。

* **订阅回调**：`Sensor.subscribeOnBodyState(options: SubscribeOnBodyStateOptions): void`
* **单次获取**：`Sensor.getOnBodyState(options: GetOnBodyStateOptions): void`
* **数据结构 (`OnBodyStateResponse`)**:
* `value`: boolean (true 表示已佩戴)



### 2.6 其他传感器

* **环境光 (`subscribeLight`)**: 返回 `intensity` (lux)。
* **气压计 (`subscribeBarometer`)**: 返回 `pressure` (hPa)。
* **距离感应 (`subscribeProximity`)**: 返回 `distance`。
* **设备方向 (`subscribeDeviceOrientation`)**: API 6+ 支持，返回 `alpha`, `beta`, `gamma`。
* **陀螺仪 (`subscribeGyroscope`)**: API 6+ 支持，返回 `x, y, z` 角速度。

## 3. 代码示例 (TypeScript/JS)

```typescript
import { Sensor, AccelerometerResponse, subscribeAccelerometerOptions } from '@kit.SensorServiceKit';

// 1. 订阅加速度计
let options: subscribeAccelerometerOptions = {
  interval: 'normal',
  success: (ret: AccelerometerResponse) => {
    console.info(`X: ${ret.x}, Y: ${ret.y}, Z: ${ret.z}`);
  },
  fail: (data: string, code: number) => {
    console.error(`Subscription failed. Code: ${code}, Msg: ${data}`);
  },
};
Sensor.subscribeAccelerometer(options);

// 2. 取消订阅 (建议在 onDestroy 中调用)
Sensor.unsubscribeAccelerometer();

```

## 4. LLM 使用注意事项

1. **单例覆盖**：针对同一个应用，多次调用订阅接口会**覆盖**之前的调用，仅最后一次生效。
2. **生命周期管理**：必须在页面销毁（如 `onDestroy`）时取消订阅，否则会造成不必要的功耗和性能开销。
3. **硬件依赖**：此功能需要硬件支持，模拟器可能无法模拟所有传感器行为，建议真机调试。
4. **权限申请**：在使用加速度、计步器、心率等功能前，需确保在 `module.json5` 中声明了相应权限。