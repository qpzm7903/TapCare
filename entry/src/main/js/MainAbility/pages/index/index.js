import sensor from '@system.sensor';

var callbackCount = 0;
var lastTime = 0;
var intervals = [];

export default {
  data: {
    mode: 'game',          // 切换成 game / ui / normal 测试
    expectedInterval: 20,  // 根据 mode 动态更新
    actualInterval: 0,     // 实际平均间隔 ms
    callbackCount: 0,
    minInterval: 9999,
    maxInterval: 0,
  },

  onInit() {
    if (this.mode === 'game') this.expectedInterval = 20;
    else if (this.mode === 'ui') this.expectedInterval = 60;
    else this.expectedInterval = 200;
  },

  onShow() {
    callbackCount = 0;
    lastTime = 0;
    intervals = [];
    var self = this;

    // 预览器中模拟数据
    this._mockTimer = setInterval(function () {
      callbackCount++;
      self.callbackCount = callbackCount;
      self.actualInterval = self.expectedInterval;
      self.minInterval = self.expectedInterval;
      self.maxInterval = self.expectedInterval;
    }, this.expectedInterval);

    try {
      sensor.subscribeAccelerometer({
        interval: this.mode,   // 'game' | 'ui' | 'normal'
        success: function (ret) {

          // 若收到真实数据，则清除模拟器
          if (self._mockTimer) {
            clearInterval(self._mockTimer);
            self._mockTimer = null;
            callbackCount = 0;
            self.callbackCount = 0;
          }

          var now = Date.now();
          callbackCount++;
          self.callbackCount = callbackCount;

          if (lastTime !== 0) {
            var gap = now - lastTime;
            intervals.push(gap);

            // 保留最近20次计算平均值
            if (intervals.length > 20) intervals.shift();

            var sum = 0;
            var min = 9999;
            var max = 0;
            for (var i = 0; i < intervals.length; i++) {
              sum += intervals[i];
              if (intervals[i] < min) min = intervals[i];
              if (intervals[i] > max) max = intervals[i];
            }
            var avg = Math.round(sum / intervals.length);

            self.actualInterval = avg;
            self.minInterval = min;
            self.maxInterval = max;
          }
          lastTime = now;
        },
        fail: function (data, code) {
          console.error('订阅失败: ' + code + ' - ' + data);
        }
      });
    } catch (e) {
      console.error('Sensor API 不可用 (可能是预览器环境): ' + e);
    }
  },

  onDestroy() {
    if (this._mockTimer) {
      clearInterval(this._mockTimer);
      this._mockTimer = null;
    }
    try {
      sensor.unsubscribeAccelerometer();
    } catch (e) { }
  }
}
