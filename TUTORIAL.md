# Node File Manager - 项目开发教学文档

欢迎来到 `Node File Manager` (节点式文件管理器) 项目！这份文档专门为代码新手编写，旨在帮助你理解这个项目是如何从零开始构建的、使用了哪些先进的技术，以及代码的核心运作原理。

---

## 🚀 1. 核心技术栈介绍

现代桌面应用开发不再局限于传统的 C++ 或 C#。这个项目采用了目前最流行且性能卓越的 **“前端 + 后端” 混合开发模式**。

### 核心框架：Tauri (V2)
Tauri 是一个用于构建更小、更快、更安全的桌面应用程序的跨平台工具包。
- **作用**：它是连接“前端网页”和“系统底层”的桥梁。它把你的网页打包成一个真实的 .exe/App，并提供访问电脑本地文件、打开程序的接口。
- **优势**：打包出的软件体积极小（通常不到 10MB），因为它是复用了系统自带的浏览器内核（Windows 下是 Edge WebView2），而不是像 Electron 那样内置一个完整的 Chrome 浏览器。

### 后端语言：Rust
Rust 是一门以**高性能**和**内存安全**著称的系统级编程语言。
- **在这个项目中的作用**：执行所有“脏活累活”。比如：极速读取文件夹列表、搜索数百个文件（防抖与并发）、复制/剪切/移动文件、调用 Windows API (`ShellExecuteW`) 来在资源管理器中定位文件等。
- **存放位置**：所有 Rust 代码都在 `src-tauri/` 目录下。最核心的逻辑在 `src-tauri/src/lib.rs` 中。

### 前端生态：React + TypeScript + Vite + Tailwind CSS
这是目前最主流的 Web 开发黄金组合。
- **React.js**：用于构建用户界面的组件化框架。
- **TypeScript**：带类型检查的 JavaScript。它能在写代码时帮你揪出拼写错误和类型错误。
- **Vite**：极速的前端构建工具，让你在按下保存的瞬间，页面就完成了热更新。
- **Tailwind CSS**：原子化 CSS 框架。你不需要写长篇幅的 `.css` 文件，而是直接在 HTML 标签中写 `className="flex text-blue-500"` 这样的预设类名来完成设计。

### 可视化核心：React Flow (`@xyflow/react`)
- **作用**：提供项目最核心的“无限画布”、“可拖拽节点”、“连线”和“小地图(MiniMap)”功能。
- **为什么选它**：要在网页里从头写一个能平移、缩放、带贝塞尔曲线连线的物理引擎非常困难，React Flow 帮我们完美解决了这个问题。

### 性能优化：React Virtual (`@tanstack/react-virtual`)
- **作用**：**虚拟滚动**技术。当你打开一个包含 10000 个文件的文件夹时，如果同时把 10000 个 DOM 节点塞进网页，电脑会直接卡死。`useVirtualizer` 只会渲染你肉眼当前能看到的十几个文件，随着你滚动鼠标，它再动态替换内容，丝滑无卡顿。

---

## 🧠 2. 代码项目结构

在 `node-fm` 目录下，你会看到这样两个世界：

```text
node-fm/
│
├── src-tauri/                 <-- 【Rust 后端世界】
│   ├── Cargo.toml             (Rust 的依赖包配置文件，类似 package.json)
│   ├── build.rs               (构建脚本)
│   ├── tauri.conf.json        (Tauri 打包、窗口大小等核心配置)
│   └── src/
│       └── lib.rs             (🔥 所有后端系统API都在这里)
│
├── src/                       <-- 【React 前端世界】
│   ├── components/
│   │   ├── FolderNode.tsx     (🔥 文件夹方块的 UI 组件，包含右键菜单)
│   │   └── FolderNode.css     (被选中的蓝色、被剪切的半透明等特效)
│   │
│   ├── App.tsx                (🔥 画布主程序：搜索框、剪贴板、渲染所有节点)
│   ├── main.tsx               (React 入口文件)
│   └── types.ts               (定义各种数据格式的长相，比如 SearchResult)
│
├── package.json               (Node.js 前端依赖配置)
└── vite.config.ts             (Vite 打包配置)
```

---

## 🔍 3. 核心机制解析（数据是怎么流动并展现的）

### 机制 A：我是如何看到电脑里的文件的？
1. 前端 `FolderNode.tsx` 刚加载时，调用 `fetchDir` 函数。
2. 通过 `invoke('read_directory', { path: "C:\\" })` 向 Rust 后端发送一条指令。
3. Rust 收到指令，执行 `fs::read_dir("C:\\")`，把这个文件夹里的所有子文件打包成一个 List。
4. Rust 把 List 丢回给前端。前端的 `useState` 接收到，触发 React 重新渲染，你就在屏幕上看到了文件列表。

### 机制 B：剪切、复制与粘贴状态管理（Context）
在这个应用里，你有多个分离的“文件夹方块”。你在方块 A 复制，怎么在方块 B 粘贴呢？
- 我们在最顶层的 `App.tsx` 创建了一个全局的 `ClipboardContext`（剪贴板管家）。
- 里面存储了：`clipboardPaths` (存了哪些文件的路径) 和 `clipboardMode` (是复制 'copy' 还是剪切 'cut')。
- 任何一个 `FolderNode` 都可以通过 `useContext(ClipboardContext)` 来告诉管家：“我复制了这个路径”，或者去管家那问：“刚才谁复制了什么文件？给我拿过来粘贴”。

### 机制 C：秒级模糊搜索是如何做到的？
由于要兼顾界面不卡死，搜索是需要技巧的：
1. **前端防抖 (Debounce)**：你在打字时，前端不会立刻发请求，而是等你停下手 300 毫秒（`setTimeout`）后才去搜，避免你打拼音时发几十个无效请求。
2. **后端取消 (AtomicBool)**：如果您在搜 C 盘（可能要 5 秒），突然改搜 D 盘。Rust 需要马上丢弃 C 盘的搜索。我们在 Rust 里用了一个 `SEARCH_CANCELLED: AtomicBool`。前端点击"✕"或继续打字时，会先发指令把这个变量设为 `true`，Rust 的疯狂遍历循环只要看到它是 `true` 就会立刻刹车。
3. **进度回传 (Emitter)**：Rust 每扫过 100 个文件，就会用 `Emitter::emit` 给前端发一条进度消息，告诉前端“我仍在干活，搜到 xxx 文件了”，前端就会把这个路径实时展示出来。

### 机制 D：文件夹为何能像树状图一样展示？
当你双击一个文件夹时：
1. `FolderNode` 不会自己变出新窗口，而是通过 `onExpand` 喊一声：喂，`App.tsx`！
2. `App.tsx` 是真正的操盘手。它会算一下这个旧方块的位置，然后在它的右下方 (`+X_OFFSET, +Y_OFFSET`) 凭空生成一个新的节点数据。
3. 接着在它们俩之间插入一条 `Edge`（贝塞尔曲线）。React Flow 侦测到数据改变，就会画出这两者和连接线。

---

## 🛠️ 4. 给新手的进阶建议

如果你想自己改动代码玩耍，可以试试：
1. **改颜色**：去 `FolderNode.tsx` 找到 `MENU_ACTIONS` 下面的 `<Copy className="text-blue-400">`，把 `text-blue-400` 改成 `text-green-500`，保存看看会发生什么。
2. **改多选背景**：去 `FolderNode.css` 找到 `.file-row-selected`，把它的 `background` 颜色调成你喜欢的透明色。
3. **写一个新的 Rust 函数**：在 `lib.rs` 照着 `cancel_search` 写一个 `hello_world`，用 `println!` 打印一句话，并把它加在底部的 `invoke_handler` 里。然后在前端随便按个按钮用 `invoke('hello_world')` 调用它，去终端里看看有没有打印出来。

这个架构非常健壮，兼具 Web 的高颜值生态和 Rust 的强悍系统底层能力。祝你在代码世界探索愉快！
