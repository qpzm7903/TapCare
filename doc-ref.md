https://note.xiexuefeng.cc/post/vibe-coding-harmonyos-wearable-app/

针对华为 Watch GT4 和 GT6 这类轻量级穿戴设备（Lite Wearable），应用开发使用的是 **ArkUI (JS) 轻量级框架 (JS Lite Framework)**。由于设备的内存和算力受到严格限制，这套框架主要基于类 Web 范式（HTML/CSS/JS 的变体：HML/CSS/JS），不支持复杂的 ArkTS 声明式 UI，且在组件和样式支持上也有较大精简。

考虑到你提到的那篇博客探讨了结合 AI 进行“Vibe Coding”（即利用 AI 辅助全流程编程），我将你提供的所有官方文档链接进行系统化梳理，为你整理出一份**「鸿蒙轻量级穿戴设备应用开发完整参考手册/上下文结构」**。这份整理不仅方便你查阅，也非常适合作为提示词（Prompt Context）喂给 AI，让 AI 帮你生成符合规范的代码。

---

# 鸿蒙轻量级穿戴设备 (GT4/GT6) 开发参考手册

## 第一部分：框架概览与项目结构

轻量级穿戴设备采用 JS 语言和类 Web 开发范式，核心是分离 UI 布局、样式和逻辑。

* **框架核心 (`arkui-js-lite-framework`)**: 采用 `HML` (HarmonyOS Markup Language) 描述页面结构，`CSS` 描述样式，`JS` 处理逻辑和数据绑定。
* **文件结构 (`js-lite-framework-file`)**:
* 一个页面通常由三个同名文件组成：`index.hml`、`index.css`、`index.js`。
* 全局配置文件 `app.js` 用于管理应用级生命周期和全局数据。


* **应用与页面生命周期 (`js-lite-framework-lifecycle`)**:
* **应用生命周期 (app.js)**: `onCreate`, `onDestroy`。
* **页面生命周期 (index.js)**:
* `onInit`: 初始化页面数据。
* `onReady`: 页面准备就绪。
* `onShow`: 页面显示（包括每次从后台切回）。
* `onHide`: 页面隐藏。
* `onDestroy`: 页面销毁。





## 第二部分：语法规范

轻量级框架对标准 Web 语法进行了裁剪，仅保留适合手表的特性。

* **HML 语法 (`js-lite-framework-syntax-hml`)**:
* 支持数据绑定：`{{ data }}`。
* 支持条件渲染：`if`, `elif`, `else`。
* 支持列表渲染：`for="{{ list }}"` (注意配合 `tid` 属性优化性能)。


* **CSS 语法 (`js-lite-framework-syntax-css`)**:
* 支持基础选择器（类、ID、标签），**不支持复杂的组合选择器和伪类**。
* 布局模型：默认基于 **Flex 布局**，这是手表端排版最核心的布局方式。
* 支持 `@import` 引入外部样式。


* **JS 语法 (`js-lite-framework-syntax-js`)**:
* 使用 ES6+ 语法。
* `data` 对象中的数据会自动劫持，数据改变时会自动触发 UI 更新。
* 支持 `js-tag` (`js-lite-framework-js-tag`) 和模块化引用 (`js-lite-framework-js-file`)。



## 第三部分：通用特性 (所有组件共有)

在进行 UI 开发时，这些是几乎所有组件都能使用的通用配置：

* **通用事件 (`js-lite-common-events`)**:
* 触控事件：`touchstart`, `touchmove`, `touchend`, `touchcancel`。
* 点击/长按：`click`, `longpress`。
* 滑动事件：`swipe` (非常适合处理手表上的左滑退出或上下滑动)。


* **通用属性 (`js-lite-common-attributes`)**:
* `id`, `class`, `style` 基础三件套。
* `if` / `show` (控制显隐，`if` 会移除 DOM 节点，`show` 只改变 visibility)。


* **通用样式 (`js-lite-common-styles`)**:
* 盒模型属性：`width`, `height`, `margin`, `padding`, `border`。
* Flex 容器属性：`flex-direction`, `justify-content`, `align-items` 等。
* 背景与定位：`background-color`, `position` (仅支持 fixed/absolute 相关子集)。



## 第四部分：核心组件库指南

根据 GT4/GT6 的表盘形态（通常为圆形），UI 组件被精简以适应小屏。

### 1. 容器组件 (Containers)

用于搭建页面骨架。

* **`div`**: 最基础的 Flex 容器。可以横向或纵向排列子元素 (`js-lite-components-container-div`)。
* **`list` & `list-item**`: 核心滚动组件。在手表这种纵向滚动场景中最常用，性能由于原生优化，远好于直接在 `div` 中用 `overflow: scroll` (`js-lite-components-container-list/list-item`)。
* **`swiper`**: 轮播/滑动视图容器。常用于左右滑动切换不同功能卡片的场景 (`js-lite-components-container-swiper`)。
* **`stack`**: 堆叠容器。子组件按照先后顺序堆叠覆盖，适合做表盘中心定位或绝对定位的悬浮元素 (`js-lite-components-container-stack`)。

### 2. 基础组件 (Basic UI)

负责具体信息的展示和交互。

* **文本与输入**:
* `marquee`: 跑马灯组件。当文本超过屏幕宽度时使用 (`js-lite-components-basic-marquee`)。
* `input`: 基础输入框 (手表上通常配合按钮和预设选项，极少直接手写输入) (`js-lite-components-basic-input`)。


* **图像与媒体**:
* `image`: 图片展示 (`js-lite-components-basic-image`)。
* `image-animator`: 帧动画组件，非常适合通过连续播放静态图片来实现复杂动画，避免消耗过多 GPU (`js-lite-components-basic-image-animator`)。


* **数据可视化**:
* `progress`: 进度条，支持圆形 (手表常用) 和条形 (`js-lite-components-basic-progress`)。
* `chart`: 基础图表，提供折线图、柱状图等简易数据展示 (`js-lite-components-basic-chart`)。
* `qrcode`: 快速生成二维码的组件，常见于手表端展示绑定凭证或收款码 (`js-lite-components-basic-qrcode`)。


* **选择器**:
* `picker-view`: 滚动选择器，例如用于手表设置时间、选择列表项 (`js-lite-components-basic-picker-view`)。



### 3. 画布组件 (Canvas)

* **`canvas`**: 提供 2D 绘制上下文 (Context2D)。如果你需要实现极具个性化的表盘、复杂的动态图表或者小游戏，直接操作 Canvas 是必须的 (`js-lite-components-canvas-canvas`)。

## 第五部分：进阶特性

* **动画 (`js-lite-components-common-animation`)**:
* 支持标准的 CSS 动画 (`@keyframes`) 和过渡动画 (`transition`)。在轻量级设备上，尽量使用 `transform` (平移、缩放) 和 `opacity` 进行动画，以利用硬件加速。


* **媒体查询 (`js-lite-components-common-mediaquery`)**:
* 使用 `@media` 语法。如果你的应用需要同时适配方表（如 Watch Fit）和圆表（如 GT4/GT6），需要通过 `device-type` 或 `aspect-ratio` 编写差异化 CSS。



---

## 💡 给 AI (Vibe Coding) 使用建议：

如果你打算用这份清单作为提示词让大模型（如 ChatGPT, Claude）辅助你编写代码，你可以将上述内容结构加上以下**提示指令（Prompt Instructions）**：

> **"你现在是一个鸿蒙轻量级穿戴设备（HarmonyOS Lite Wearable）开发专家。目标设备是华为 Watch GT4/GT6（圆形屏幕，内存和性能受限）。**
> **请遵循以下 JS Lite 框架开发规范生成代码：**
> 1. **结构分离：** 输出必须包含完整的 `.hml`, `.css`, 和 `.js` 代码。
> 2. **布局首选：** 默认使用 Flex 布局。考虑到设备为圆屏，关键交互元素需避开屏幕四个死角，尽量居中或使用 `list` 组件保证可滑动。
> 3. **极简逻辑：** 不要在 `.js` 的 UI 渲染线程中包含复杂的计算。
> 4. **组件限制：** 只能使用轻量级框架支持的组件（div, list, swiper, image, progress, canvas 等），不能使用 ArkTS 的声明式语法，不要凭空捏造未在文档中声明的 CSS 属性。
> 5. **列表渲染优化：** 渲染多个元素必须使用 `<list>` 和 `<list-item>`，并在 `for` 循环中带上 `tid` 以提高渲染效率。"
>
>

这份整理覆盖了你提供的所有参考链接的知识面，将它们构建成了完整的开发知识树，可以直接作为你接下来的开发字典。