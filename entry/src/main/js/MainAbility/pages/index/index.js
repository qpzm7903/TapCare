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
  MIN_DEBOUNCE_MS: 350      // 动作冷却期 (ms)：约等于 2 帧 (400ms) 防抖，略放宽以容纳过快连击
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
    durationText: '00:00'
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

    // 瞬态突变检测(Surge/高通滤波)状态
    this._lastTapTime = 0;  // 绝对时间倒数
    this._aBase = 0;        // 加速度短期运动基线 (过滤挥臂慢动作)
    this._gBase = 0;        // 角速度短期运动基线 (过滤挥臂慢动作)
    this._tapPeak = 0; false;
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

    // 重置瞬态检测状态
    this._baselineInitialized = false;
    this._lastTapTime = 0;
    this._aBase = 0;
    this._gBase = 0;
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

    if (dynamicAccel < 0.1) {
      // 快速适应微小姿态变化 (过滤干扰)
      self._baseline = self._baseline * 0.85 + magnitude * 0.15;
    } else {
      // 缓慢适应长时间偏离，防止因换姿势导致基线彻底卡死
      self._baseline = self._baseline * 0.98 + magnitude * 0.02;
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
    // 联合判定窗口: 保证两个传感器的数据都是在最近 500ms (2.5帧) 内到达的
    var accelAge = now - (self._latestAccelTime || 0);
    var gyroAge = now - (self._latestGyroTime || 0);
    var isDataFresh = accelAge < 500 && gyroAge < 500;

    if (!isDataFresh) return;

    var a = self._latestAccel;
    var g = self._latestGyro;

    // 1. 初始化短期跟随基线 (如果尚未记录)
    if (self._aBase === 0 && self._gBase === 0) {
      self._aBase = a;
      self._gBase = g;
      return;
    }

    // 2. 提取当前“挥臂”的平滑运动基线 (Low-Pass Filter) -> 70% 沿用老趋势，30% 取最新值
    // 取值如果小于当前基线，则加速回落（避免错失下次判定）；如果大于当前基线，则缓慢上升（防止过滤掉波峰）
    self._aBase = (self._aBase * (a < self._aBase ? 0.5 : 0.8)) + (a * (a < self._aBase ? 0.5 : 0.2));
    self._gBase = (self._gBase * (g < self._gBase ? 0.5 : 0.8)) + (g * (g < self._gBase ? 0.5 : 0.2));

    // 3. 计算“相对于长期运动”的瞬态突波幅值 (High-Pass Filter 冲击量)
    var aSurge = a - self._aBase;
    var gSurge = g - self._gBase;

    var sinceLastTap = now - self._lastTapTime;

    // 4. 动态敲击判定 (依赖瞬变 Surge，不再依赖绝对阈值防止卡死)
    var isTap = (
      (aSurge > 0.08 && g > 1.5) ||  // 典型动作：产生了中等振动差，且手臂在快速甩动 (门槛下调至0.08防漏击)
      (aSurge > 0.15) ||             // 纯强力打击：不管手转没转，肉体发生了剧烈形变振颤
      (gSurge > 2.0 && a > 0.05)     // 极其猛烈的抖动手腕（虽然本身晃动，但突然加紧）
    );

    if (isTap) {
      if (sinceLastTap >= TAP.MIN_DEBOUNCE_MS) {
        // 触发一次有效敲击
        console.info('[TAP_HIT] A:' + a.toFixed(3) + ' (Surge:' + aSurge.toFixed(3) + ') G:' + g.toFixed(3) + ' (gap:' + sinceLastTap + 'ms)');
        self._lastTapTime = now;
        self._onTapDetected();

        // 击打后临时拉高基线，防止后续回波二次触发 (惩罚系数降至 0.3 以防吞没后续的正常轻击)
        self._aBase = self._aBase + (aSurge * 0.3);
        self._gBase = self._gBase + (gSurge * 0.3);
      } else {
        console.info('[TAP_BLOCK] TOO FAST! gap:' + sinceLastTap + 'ms < ' + TAP.MIN_DEBOUNCE_MS);
      }
    } else if (aSurge > 0.03 || gSurge > 0.8) {
      // 记录那些看似高扬，但未能构成“突刺”的平滑动作，以便排查
      console.info('[TAP_MISS] A:' + a.toFixed(3) + ' (Surge:' + aSurge.toFixed(3) + ') G:' + g.toFixed(3));
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

      sensor.subscribeAccelerometer({
        interval: 'normal',
        success: function (data) {
          try {
            self._rawCbCount = (self._rawCbCount || 0) + 1;

            if (self.state === 'counting') {
              self._processAccel(self, data.x || 0, data.y || 0, data.z || 0);
            }
          } catch (err) {
          }
        },
        fail: function (data, code) {
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
          }
        },
        fail: function (data, code) {
          self._sensorActive = false;
        }
      });

      this._sensorActive = true;
    } catch (e) {
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
