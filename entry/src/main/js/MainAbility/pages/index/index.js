import sensor from '@system.sensor';
import file from '@system.file';

// 尝试导入振动器（部分固件可能不支持）
var vibrator = null;
try {
  vibrator = require('@system.vibrator');
} catch (e) {
  console.warn('vibrator not available');
}

var PARTS = [
  { id: 'gallbladder_left', name: '左胆经' },
  { id: 'gallbladder_right', name: '右胆经' },
  { id: 'pericardium', name: '心包经' },
  { id: 'sanjiao', name: '三焦经' }
];

// 敲打检测核心参数 (适配 5Hz/200ms 低频采样率优化)
var TAP = {
  THRESHOLD: 0.08,          // 放宽阈值 (g)：5Hz抓不到波峰，只能抓残余动能或抬手瞬间
  MIN_DEBOUNCE_MS: 380      // 动作冷却期 (ms)：约等于 2 帧 (400ms) 防抖
};

var SETTINGS_URI = 'internal://app/settings.json';

export default {
  data: {
    state: 'idle',
    isIdle: true,
    isCounting: false,
    isPaused: false,
    isCompleted: false,
    count: 0,
    partName: '左胆经',
    durationText: '00:00',

    // Debug variables
    debugBaseline: '0.00',
    debugDynAccel: '0.00',
    debugPeak: '0.00',
    debugGyro: '0.00',
    debugGyroPeak: '0.00',
    debugFired: false
  },

  onInit() {
    this._partIndex = 0;
    this._sensorActive = false;

    // EMA (指数移动平均) 动态基线
    this._baseline = 1.0;
    this._baselineInitialized = false;

    // 状态机制
    this._sessionStartTime = 0;
    this._totalPauseDuration = 0;
    this._pauseStartTime = 0;

    // 零分配峰值检测状态
    this._lastTapTime = 0;  // 绝对时间倒数
    this._tapFired = false;
    this._tapPeak = 0;

    // 传感器融合状态
    this._latestAccel = 0;
    this._latestAccelTime = 0;
    this._latestGyro = 0;
    this._latestGyroTime = 0;
    this._gyroPeak = 0;

    this._durationTimer = null;
    this._loadSettings();
  },

  onReady() { },
  onShow() { },
  onDestroy() {
    this._stopSensor();
    this._stopDurationTimer();
  },

  _setState(s) {
    this.state = s;
    this.isIdle = (s === 'idle');
    this.isCounting = (s === 'counting');
    this.isPaused = (s === 'paused');
    this.isCompleted = (s === 'completed');
  },

  // ==================== UI 事件 ====================

  switchPart() {
    if (this.state !== 'idle') return;
    this._partIndex = (this._partIndex + 1) % PARTS.length;
    this.partName = PARTS[this._partIndex].name;
    this._saveSettings();
  },

  startSession() {
    this.count = 0;
    this.durationText = '00:00';

    this._sessionStartTime = Date.now();
    this._totalPauseDuration = 0;
    this._pauseStartTime = 0;

    // 重置检测状态
    this._baselineInitialized = false;
    this._lastTapTime = 0;
    this._tapFired = false;
    this._tapPeak = 0;
    this._gyroPeak = 0;

    this._setState('counting');
    this._startSensor();
    this._startDurationTimer();
  },

  pauseSession() {
    this._pauseStartTime = Date.now();
    this._setState('paused');
    this._stopSensor();
    this._stopDurationTimer();
  },

  resumeSession() {
    if (this._pauseStartTime > 0) {
      this._totalPauseDuration += Date.now() - this._pauseStartTime;
      this._pauseStartTime = 0;
    }
    // 恢复时重新校准基线，防止用户变换姿势
    this._baselineInitialized = false;

    this._setState('counting');
    this._startSensor();
    this._startDurationTimer();
  },

  endSession() {
    this._stopSensor();
    this._stopDurationTimer();
    this._completeSession();
  },

  resetSession() {
    this.count = 0;
    this.durationText = '00:00';
    this._setState('idle');
  },

  // ==================== 会话完成 ====================

  _completeSession() {
    var elapsed = Date.now() - this._sessionStartTime - this._totalPauseDuration;
    this.durationText = this._formatDuration(elapsed);
    this._setState('completed');
    this._saveSession(elapsed);
  },

  // ==================== 5Hz 传感器融合检测 (Accel + Gyro) ====================
  // 此时 interval 为 normal (200ms)

  _processAccel(self, x, y, z) {
    var now = Date.now();
    var magnitude = Math.sqrt(x * x + y * y + z * z);

    if (!self._baselineInitialized) {
      self._baseline = magnitude;
      self._baselineInitialized = true;
      self._lastTapTime = now;
      return;
    }

    var dynamicAccel = Math.abs(magnitude - self._baseline);

    if (dynamicAccel < 0.05) {
      self._baseline = self._baseline * 0.85 + magnitude * 0.15;
    }

    self._latestAccel = dynamicAccel;
    self._latestAccelTime = now;

    if (dynamicAccel > self._tapPeak) {
      self._tapPeak = dynamicAccel;
    }

    self._checkFusion(self, now);
  },

  _processGyro(self, x, y, z) {
    var now = Date.now();
    // 陀螺仪的角速度模长 (rad/s)
    var gyroMag = Math.sqrt(x * x + y * y + z * z);

    self._latestGyro = gyroMag;
    self._latestGyroTime = now;

    if (gyroMag > self._gyroPeak) {
      self._gyroPeak = gyroMag;
    }

    self._checkFusion(self, now);
  },

  _checkFusion(self, now) {
    // 联合判定窗口: 保证两个传感器的数据都是在最近 300ms (1.5帧) 内到达的
    var accelAge = now - (self._latestAccelTime || 0);
    var gyroAge = now - (self._latestGyroTime || 0);
    var isDataFresh = accelAge < 300 && gyroAge < 300;

    var sinceLastTap = now - self._lastTapTime;

    // 联合条件：加速度有线性挥动 (>0.06G) 且 存在手腕旋转爆发 (>0.8 rad/s)
    if (isDataFresh && self._latestAccel > 0.06 && self._latestGyro > 0.8) {
      if (!self._tapFired && sinceLastTap >= TAP.MIN_DEBOUNCE_MS) {
        // 触发一次有效敲击
        console.info('[TAP_HIT] A:' + self._latestAccel.toFixed(3) + ' G:' + self._latestGyro.toFixed(3) + ' (gap:' + sinceLastTap + 'ms)');
        self._tapFired = true;
        self._lastTapTime = now;
        self._onTapDetected();
      } else {
        console.info('[TAP_BLOCK] debounce ' + sinceLastTap + 'ms < ' + TAP.MIN_DEBOUNCE_MS);
      }
    } else if (isDataFresh && (self._latestAccel > 0.06 || self._latestGyro > 0.8)) {
      // 如果只有一个传感器达到了阈值，打印出来看看是哪个差了一口气
      console.info('[TAP_MISS] A:' + self._latestAccel.toFixed(3) + ' G:' + self._latestGyro.toFixed(3));
    } else {
      // 回落：必须两个都降下来
      if (self._tapFired && self._latestAccel < 0.04 && self._latestGyro < 0.4) {
        self._tapFired = false;
      }
    }

    // UI 显示
    self._renderTick = (self._renderTick || 0) + 1;
    if (self._renderTick % 2 === 0) {
      self.debugBaseline = self._baseline.toFixed(3);
      self.debugDynAccel = (self._latestAccel || 0).toFixed(3);
      self.debugPeak = self._tapPeak.toFixed(3);
      self.debugGyro = (self._latestGyro || 0).toFixed(3);
      self.debugGyroPeak = self._gyroPeak.toFixed(3);
      self.debugFired = self._tapFired;
    }
  },

  _onTapDetected() {
    this.count += 1;
    // 每 100 次给予反馈，提醒进度
    if (this.count % 100 === 0) {
      this._vibrate();
    }
  },

  // ==================== 传感器 ====================

  _startSensor() {
    if (this._sensorActive) {
      return;
    }
    var self = this;
    try {
      try { sensor.unsubscribeAccelerometer(); } catch (e) { }
      try { sensor.unsubscribeGyroscope(); } catch (e) { }
      self.debugBaseline = 'sub_start'; // 标记进入订阅流程

      sensor.subscribeAccelerometer({
        interval: 'normal',
        success: function (data) {
          try {
            self._rawCbCount = (self._rawCbCount || 0) + 1;
            // 收到加速度即更新心跳
            self.debugBaseline = 'CBA:' + self._rawCbCount;

            if (self.state === 'counting') {
              self._processAccel(self, data.x || 0, data.y || 0, data.z || 0);
            }
          } catch (err) {
            self.debugPeak = 'EA:' + (err.message || err);
          }
        },
        fail: function (data, code) {
          self.debugPeak = 'FAIL A: ' + code;
          self._sensorActive = false;
        }
      });

      sensor.subscribeGyroscope({
        interval: 'normal',
        success: function (data) {
          try {
            if (self.state === 'counting') {
              self._processGyro(self, data.x || 0, data.y || 0, data.z || 0);
            }
          } catch (err) {
            self.debugGyroPeak = 'EG:' + (err.message || err);
          }
        },
        fail: function (data, code) {
          self.debugGyroPeak = 'FAIL G: ' + code;
          self._sensorActive = false;
        }
      });

      this._sensorActive = true;
      self.debugDynAccel = 'subs_OK'; // 标记订阅API调用成功
    } catch (e) {
      self.debugPeak = 'EXC: ' + e;
      this._sensorActive = false;
    }
  },

  _stopSensor() {
    if (!this._sensorActive) {
      return;
    }
    try {
      sensor.unsubscribeAccelerometer();
    } catch (e) { }
    try {
      sensor.unsubscribeGyroscope();
    } catch (e) { }
    this._sensorActive = false;
  },

  // ==================== 振动 ====================

  _vibrate() {
    if (!vibrator) {
      return;
    }
    try {
      vibrator.vibrate({ mode: 'short' });
    } catch (e) {
      // 静默失败，不影响核心功能
    }
  },

  // ==================== 计时器 ====================

  _startDurationTimer() {
    this._stopDurationTimer();
    var self = this;
    this._durationTimer = setInterval(function () {
      var elapsed = Date.now() - self._sessionStartTime - self._totalPauseDuration;
      self.durationText = self._formatDuration(elapsed);
    }, 1000);
  },

  _stopDurationTimer() {
    if (this._durationTimer) {
      clearInterval(this._durationTimer);
      this._durationTimer = null;
    }
  },

  _formatDuration(ms) {
    var totalSec = Math.floor(ms / 1000);
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    return (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
  },

  // ==================== 持久化 ====================

  _loadSettings() {
    var self = this;
    try {
      file.readText({
        uri: SETTINGS_URI,
        success: function (data) {
          try {
            var s = JSON.parse(data.text);
            if (s.partIndex !== undefined && s.partIndex < PARTS.length) {
              self._partIndex = s.partIndex;
              self.partName = PARTS[s.partIndex].name;
            }
            if (s.baseline) {
              self._baseline = s.baseline;
            }
          } catch (e) {
            console.error('parse settings: ' + e);
          }
        },
        fail: function () { }
      });
    } catch (e) {
      console.error('readText error: ' + e);
    }
  },

  _saveSettings() {
    try {
      file.writeText({
        uri: SETTINGS_URI,
        text: JSON.stringify({
          partIndex: this._partIndex,
          baseline: this._baseline
        }),
        success: function () { },
        fail: function () { }
      });
    } catch (e) {
      console.error('writeText error: ' + e);
    }
  },

  _saveSession(elapsed) {
    try {
      file.writeText({
        uri: 'internal://app/last_session.json',
        text: JSON.stringify({
          timestamp: Date.now(),
          part: PARTS[this._partIndex].id,
          count: this.count,
          duration: elapsed
        }),
        success: function () { },
        fail: function () { }
      });
    } catch (e) {
      console.error('save session error: ' + e);
    }
  }
};
