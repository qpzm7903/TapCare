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

// 简单峰值检测（适配 5Hz 低采样率 + 轻敲场景）
var TAP = {
  TAP_THRESHOLD: 0.35,      // 0.35g 检测轻敲（静止噪声 0.1~0.3，轻敲 0.5+）
  DEBOUNCE_MS: 300,         // 300ms 防抖，支持约 3 次/秒的敲打节奏
  FORCE_LIGHT_MAX: 0.8,     // 0.8g 以下为轻敲
  FORCE_MEDIUM_MAX: 2.0     // 2.0g 以下为中敲，以上为重敲
};

// Baseline 校准参数
var CAL = {
  SAMPLE_COUNT: 10,         // 采集 10 个样本（约 2 秒）
  USE_LOWEST: 6             // 取最小的 6 个计算均值（排除运动干扰）
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
    target: 100,
    partName: '左胆经',
    forceLevelText: '--',
    rhythmText: '--',
    progressPercent: 0,
    durationText: '00:00',
    forceLight: 0,
    forceMedium: 0,
    forceStrong: 0
  },

  onInit() {
    console.info('TapCare page onInit');

    this._partIndex = 0;
    this._sensorActive = false;
    this._hapticEnabled = true;
    this._baseline = 1.0;  // 初始值，启动后会自动校准

    this._sessionStartTime = 0;
    this._totalPauseDuration = 0;
    this._pauseStartTime = 0;
    this._lastTapTime = 0;
    this._tapIntervals = [];
    this._forceSum = 0;
    this._forceCounts = { light: 0, medium: 0, strong: 0 };

    // Baseline 校准
    this._baselineSamples = [];
    this._baselineCalibrated = false;

    this._durationTimer = null;
    this._debugLogCount = 0;

    this._loadSettings();
  },

  onReady() {
    console.info('TapCare page onReady, state=' + this.state);
  },

  onShow() {
    console.info('TapCare page onShow');
  },

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
    if (this.state !== 'idle') {
      return;
    }
    this._partIndex = (this._partIndex + 1) % PARTS.length;
    this.partName = PARTS[this._partIndex].name;
    this._saveSettings();
  },

  startSession() {
    console.info('startSession');
    this.count = 0;
    this.progressPercent = 0;
    this.forceLevelText = '--';
    this.rhythmText = '--';
    this.durationText = '00:00';

    this._sessionStartTime = Date.now();
    this._totalPauseDuration = 0;
    this._pauseStartTime = 0;
    this._lastTapTime = 0;
    this._tapIntervals = [];
    this._forceSum = 0;
    this._forceCounts = { light: 0, medium: 0, strong: 0 };
    this._resetBaseline();
    this._debugLogCount = 0;

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
    this.progressPercent = 0;
    this.forceLevelText = '--';
    this.rhythmText = '--';
    this.durationText = '00:00';
    this._setState('idle');
  },

  // ==================== 会话完成 ====================

  _completeSession() {
    var elapsed = Date.now() - this._sessionStartTime - this._totalPauseDuration;
    this.durationText = this._formatDuration(elapsed);
    this.forceLight = this._forceCounts.light;
    this.forceMedium = this._forceCounts.medium;
    this.forceStrong = this._forceCounts.strong;
    this._setState('completed');
    this._saveSession(elapsed);
  },

  // ==================== 敲打检测 ====================

  _processSensorData(x, y, z) {
    var now = Date.now();
    var magnitude = Math.sqrt(x * x + y * y + z * z);

    // Baseline 校准：采集样本，取最小的几个均值（排除运动干扰）
    if (!this._baselineCalibrated) {
      this._baselineSamples.push(magnitude);
      console.info('[CAL] ' + this._baselineSamples.length + '/' + CAL.SAMPLE_COUNT + ' mag=' + magnitude.toFixed(3));
      if (this._baselineSamples.length >= CAL.SAMPLE_COUNT) {
        // 手写冒泡排序（Lite Wearable 不支持 Array.sort）
        var arr = this._baselineSamples;
        var i;
        var j;
        var tmp;
        for (i = 0; i < arr.length - 1; i++) {
          for (j = 0; j < arr.length - 1 - i; j++) {
            if (arr[j] > arr[j + 1]) {
              tmp = arr[j];
              arr[j] = arr[j + 1];
              arr[j + 1] = tmp;
            }
          }
        }
        // 取最小的 CAL.USE_LOWEST 个样本的均值
        var sum = 0;
        for (i = 0; i < CAL.USE_LOWEST; i++) {
          sum += arr[i];
        }
        this._baseline = sum / CAL.USE_LOWEST;
        this._baselineCalibrated = true;
        console.info('[CAL] DONE baseline=' + this._baseline.toFixed(3) + ' (sorted: ' + arr[0].toFixed(2) + '~' + arr[arr.length - 1].toFixed(2) + ')');
      }
      return;
    }

    var dynamicAccel = Math.abs(magnitude - this._baseline);

    // 每 20 帧输出一次静态数据
    this._debugLogCount += 1;
    if (this._debugLogCount % 20 === 0) {
      console.info('[IDLE] dyn=' + dynamicAccel.toFixed(3) + ' base=' + this._baseline.toFixed(2));
    }

    // 简单峰值检测：dyn 超过阈值 + debounce 防抖
    if (dynamicAccel >= TAP.TAP_THRESHOLD) {
      var sinceLastTap = now - this._lastTapTime;
      console.info('[HIT] dyn=' + dynamicAccel.toFixed(3) + ' since=' + sinceLastTap);
      if (sinceLastTap >= TAP.DEBOUNCE_MS) {
        console.info('[TAP] +++ OK dyn=' + dynamicAccel.toFixed(3));
        this._onTapDetected(dynamicAccel, now);
      } else {
        console.info('[TAP] --- debounce skip');
      }
    }
  },

  _onTapDetected(peakAccel, timestamp) {
    console.info('Tap detected! peak=' + peakAccel.toFixed(2));
    this.count += 1;

    if (peakAccel < TAP.FORCE_LIGHT_MAX) {
      this.forceLevelText = '轻';
      this._forceCounts.light += 1;
    } else if (peakAccel < TAP.FORCE_MEDIUM_MAX) {
      this.forceLevelText = '中';
      this._forceCounts.medium += 1;
    } else {
      this.forceLevelText = '重';
      this._forceCounts.strong += 1;
    }

    var forceNorm = ((peakAccel - TAP.TAP_THRESHOLD) / 5.0) * 100;
    this._forceSum += Math.max(0, Math.min(100, Math.round(forceNorm)));

    if (this._lastTapTime > 0) {
      this._tapIntervals.push(timestamp - this._lastTapTime);
      if (this._tapIntervals.length > 10) {
        this._tapIntervals.shift();
      }
      this.rhythmText = this._evaluateRhythm();
    }
    this._lastTapTime = timestamp;

    this.progressPercent = Math.min(100, Math.round((this.count / this.target) * 100));

    this._vibrate();

    if (this.count >= this.target) {
      this._stopSensor();
      this._stopDurationTimer();
      this._completeSession();
    }
  },

  _evaluateRhythm() {
    var len = this._tapIntervals.length;
    if (len < 3) {
      return '检测中';
    }
    var sum = 0;
    var i;
    for (i = 0; i < len; i++) {
      sum += this._tapIntervals[i];
    }
    var avg = sum / len;
    var variance = 0;
    for (i = 0; i < len; i++) {
      var diff = this._tapIntervals[i] - avg;
      variance += diff * diff;
    }
    var cv = Math.sqrt(variance / len) / avg;
    if (cv < 0.15) {
      return '很稳';
    }
    if (cv < 0.3) {
      return '良好';
    }
    return '不稳';
  },

  _resetBaseline() {
    this._baselineSamples = [];
    this._baselineCalibrated = false;
  },

  // ==================== 传感器 ====================

  _startSensor() {
    if (this._sensorActive) {
      return;
    }
    var self = this;
    try {
      sensor.subscribeAccelerometer({
        interval: 'normal',
        success: function(data) {
          if (self.state === 'counting') {
            self._processSensorData(data.x, data.y, data.z);
          }
        },
        fail: function(data, code) {
          console.error('sensor fail: ' + code + ', data: ' + JSON.stringify(data));
          self._sensorActive = false;
        }
      });
      this._sensorActive = true;
      console.info('sensor started');
    } catch (e) {
      console.error('sensor error: ' + e);
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
    if (!this._hapticEnabled || !vibrator) {
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
    this._durationTimer = setInterval(function() {
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
        success: function(data) {
          try {
            var s = JSON.parse(data.text);
            if (s.target) {
              self.target = s.target;
            }
            if (s.partIndex !== undefined && s.partIndex < PARTS.length) {
              self._partIndex = s.partIndex;
              self.partName = PARTS[s.partIndex].name;
            }
            if (s.hapticEnabled !== undefined) {
              self._hapticEnabled = s.hapticEnabled;
            }
            if (s.baseline) {
              self._baseline = s.baseline;
            }
          } catch (e) {
            console.error('parse settings: ' + e);
          }
        },
        fail: function() {}
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
          target: this.target,
          partIndex: this._partIndex,
          hapticEnabled: this._hapticEnabled,
          baseline: this._baseline
        }),
        success: function() {},
        fail: function() {}
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
          target: this.target,
          duration: elapsed,
          completed: this.count >= this.target,
          force: {
            light: this._forceCounts.light,
            medium: this._forceCounts.medium,
            strong: this._forceCounts.strong
          }
        }),
        success: function() {},
        fail: function() {}
      });
    } catch (e) {
      console.error('save session error: ' + e);
    }
  }
};
