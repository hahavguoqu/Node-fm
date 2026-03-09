# 功能
在windows环境下，想要整理非常多的文件和文件夹需要打开很多的窗口和页面。这个工具转换了文件管理方式，使用画板的呈现方式，文件夹作为节点，在一个极小的空间内展示大量文件和文件夹，并清晰展示其中层次树状关系。

# 技术栈
Tauri + React + Typescript

# 支持系统
目前暂时仅支持windows，后续将完善

# 安装使用办法
在开始运行本项目之前，请确保您的电脑已经配置好相关的开发环境。由于 Tauri 在 Windows 下编译需要 Rust 与 C++ 依赖支持，请按照以下步骤进行准备：
### 1. 必备开发环境设置 (针对 Windows)
- [ ] **1. Node.js (推荐 LTS 版本)**
      用于运行前端项目并安装相关依赖项。
      * 下载地址：[Node.js 官方网站](https://nodejs.org/zh-cn/)
      * 测试是否安装成功：在终端中输入 `node -v`，若打印出版本号说明安装成功。
- [ ] **2. Rust 编译环境**
      Tauri 的核心是通过 Rust 运行和打包程序的。
      * 下载地址：[Rust 官网](https://rustup.rs/) 下载 `rustup-init.exe` 运行安装。
      * 测试是否安装成功：在终端中输入 `rustc --version` 与 `cargo --version`，出现版本号即为成功。
- [ ] **3. C++ 桌面开发工作负载（重要！）**
      在 Windows 环境中编译 Rust 必须配备此工具链。
      * 下载并运行 [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
      * 在运行安装程序时，请务必勾选包含 **“使用 C++ 的桌面开发” (Desktop development with C++)**，确认右侧详单包含了最新的 Windows 10/11 SDK，即可开始安装（体积较大，只需配置一次）。
- [ ] **4. WebView2 (系统通常已自带)**
      如果是 Win10/Win11 最新系统通常已预装。如果不确定或运行报错，可前往下载：[Microsoft Edge WebView2](https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/)。
---

### 2. 启动项目
当上述所有必要环境准备好后，跟随以下步骤在本地将项目跑起来：
**第一步：克隆/下载仓库并进入目录**
```bash
git clone https://github.com/hahavguoqu/Node-fm.git
cd Node-fm

**第二步：安装依赖**
```bash
npm install
```

**第三步：运行项目**
```bash
npm run tauri dev
```

温馨提醒： 第一次运行此命令时，由于 Rust 包管理工具 (Cargo) 需要去外网拉取各种后端依赖并编译核心逻辑，进程耗时可能会比较长（视网络甚至需要等几分钟），请耐心等待。这属于正常现象！一旦首发构建成功，之后再重启开发模式就将会是“秒开”的效果。