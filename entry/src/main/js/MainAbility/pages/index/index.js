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

// 敲打检测核心参数 (基于 50Hz/20ms 采样率优化)
var TAP = {
  THRESHOLD: 0.15,          // 敲击峰值绝对阈值 (g)
  COOLDOWN_FRAMES: 7        // 敲击冷却帧数 (7帧 * 20ms = 140ms 防抖)
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
    debugCooldown: 0,
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
    this._cooldownTimer = 0;  // 倒数帧数
    this._tapFired = false;
    this._tapPeak = 0;

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
    this._cooldownTimer = 0;
    this._tapFired = false;
    this._tapPeak = 0;

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

  // ==================== 50Hz 敲打检测 ====================
  // 注意：此函数每秒会被调用 50 次，内部【严禁】创建任何对象、数组、闭包，或执行高频 logging！

  _processSensorData(self, x, y, z) {
    // 1. 计算当前加速度模长
    var magnitude = Math.sqrt(x * x + y * y + z * z);

    // 2. 初始化/更新动态基线 (EMA 算法)
    if (!self._baselineInitialized) {
      self._baseline = magnitude;
      self._baselineInitialized = true;
      return;
    }

    // 提取动态加速度差值 (绝对值)
    var dynamicAccel = Math.abs(magnitude - self._baseline);

    // 平滑更新基线 (仅在静止或轻微运动时快速更新，避免被巨大的敲击峰值带偏)
    if (dynamicAccel < TAP.THRESHOLD) {
      // 0.05 权重逼近，大约 20 帧 (400ms) 适应姿势变化
      self._baseline = self._baseline * 0.95 + magnitude * 0.05;
    }

    // 3. 冷却期倒数 (代替 Date.now() 计算时间差)
    if (self._cooldownTimer > 0) {
      self._cooldownTimer--;
      // 冷却期间更新峰值用于记录
      if (dynamicAccel > self._tapPeak) {
        self._tapPeak = dynamicAccel;
      }
      return; // 冷却中，忽略新触发
    }

    // 4. 阈值触发 (上升沿)
    if (dynamicAccel >= TAP.THRESHOLD) {
      if (!self._tapFired) {
        // 触发一次有效敲击
        self._tapFired = true;
        self._tapPeak = dynamicAccel;
        self._cooldownTimer = TAP.COOLDOWN_FRAMES; // 进入冷却

        self._onTapDetected();
      } else {
        // 已处于上升期，更新峰值
        if (dynamicAccel > self._tapPeak) {
          self._tapPeak = dynamicAccel;
        }
      }
    } else {
      // 信号回落低于阈值，重置上升沿状态，准备迎接下一次敲击
      if (self._tapFired) {
        self._tapFired = false;
      }
    }

    // 每间隔 10 帧 (约 200ms) 更新一次 UI 显示，避免高频刷新阻塞渲染线程
    self._renderTick = (self._renderTick || 0) + 1;
    if (self._renderTick % 10 === 0) {
      self.debugBaseline = self._baseline.toFixed(3);
      self.debugDynAccel = dynamicAccel.toFixed(3);
      self.debugPeak = self._tapPeak.toFixed(3);
      self.debugCooldown = self._cooldownTimer;
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
      self.debugBaseline = 'sub_start'; // 标记进入订阅流程

      sensor.subscribeAccelerometer({
        interval: 'normal',
        success: function (data) {
          try {
            self._rawCbCount = (self._rawCbCount || 0) + 1;

            // 每 1 帧都强制更新基线，证明收到数据
            self.debugBaseline = 'CB: ' + self._rawCbCount;

            if (self.state === 'counting') {
              // 安全防护：万一 data 结构不对
              var x = data.x || 0;
              var y = data.y || 0;
              var z = data.z || 0;
              self._processSensorData(self, x, y, z);
            }
          } catch (err) {
            // 捕获到任何隐藏的 JS 异常，直接拍到屏幕上
            self.debugPeak = 'E:' + (err.message || err);
          }
        },
        fail: function (data, code) {
          self.debugPeak = 'FAIL: ' + code;
          self._sensorActive = false;
        }
      });
      this._sensorActive = true;
      self.debugDynAccel = 'subs_OK'; // 标记订阅API调用成功
    } catch (e) {
      self.debugPeak = 'EXC: ' + e;
      this._sensorActive = false;
    }
  }
  ,
  _stopSensor() {
    if (!this._sensorActive) {
      return;
    }
    try {
      sensor.unsubscribeAccelerometer();
    } catch (e) {
      console.error('sensor unsub error: ' + e);
    }
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
