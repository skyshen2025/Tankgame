# 坦克动荡 Online v1.0

这是一个可以部署到公网、让不同网络中的朋友通过同一网址实时联机的浏览器坦克游戏。

## 已实现功能

- 2–4 人房间联机
- 创建房间 / 输入 6 位房间号加入
- 玩家昵称
- Node.js + Socket.IO 服务端权威同步
- W/S 移动，A/D 转向，空格射击
- 墙体与坦克碰撞
- 子弹撞墙和边界反弹
- 一炮击毁
- 回合制积分
- 先到 5 分赢得整场
- 房主重新开始
- 玩家掉线后自动更新房间状态
- 基础爆炸效果
- 支持本地运行与公网部署

---

## 一、本地运行

先安装 Node.js 18 或更高版本。

打开项目文件夹，在 CMD 中执行：

```bash
npm install
npm start
```

然后浏览器访问：

```text
http://localhost:3000
```

同一台电脑可以开两个浏览器窗口进行测试。

同一局域网内的另一台设备，可以访问：

```text
http://你的电脑局域网IPv4地址:3000
```

例如：

```text
http://192.168.1.105:3000
```

Windows 防火墙如弹出 Node.js 网络访问提示，请允许“专用网络”。

---

## 二、真正公网联机：部署到 Render

部署后，无论玩家是否在同一个 Wi‑Fi，只要能访问公网网址，就能联机。

### 1. 把项目上传到 GitHub

在 GitHub 创建一个新仓库，将本项目全部文件上传。

项目根目录必须直接包含：

- `package.json`
- `server.js`
- `public/`

### 2. 在 Render 创建 Web Service

进入 Render 后：

1. New → Web Service
2. 连接你的 GitHub 仓库
3. Runtime 选择 Node
4. Build Command 填：

```text
npm install
```

5. Start Command 填：

```text
npm start
```

6. 创建服务

Render 会自动设置 `PORT`，本项目已经使用：

```js
process.env.PORT || 3000
```

因此不需要自己修改端口。

部署完成后会获得类似：

```text
https://tank-turbulence-online-xxxx.onrender.com
```

把这个网址直接发给朋友即可。

---

## 三、Railway 部署

1. 登录 Railway
2. New Project
3. Deploy from GitHub Repo
4. 选择本项目仓库
5. Railway 会自动识别 `package.json`
6. 在 Settings / Networking 中生成 Public Domain

启动命令为：

```text
npm start
```

项目会自动监听 Railway 提供的 `PORT`。

---

## 四、游戏玩法

玩家 1：

1. 输入昵称
2. 点击“创建房间”
3. 把顶部 6 位房间号发给朋友

玩家 2–4：

1. 打开同一个公网网址
2. 输入昵称
3. 输入房间号
4. 点击“加入”

操作：

- W：前进
- S：后退
- A：向左转
- D：向右转
- Space：射击

规则：

- 子弹能够撞墙反弹
- 击中坦克即淘汰
- 每回合最后存活的玩家 +1 分
- 先达到 5 分的玩家赢得整场比赛

---

## 五、为什么这一版可以公网联机

前一版如果只运行在：

```text
http://localhost:3000
```

服务器只存在于你自己的电脑上。

这一版的核心联机结构是：

```text
你的浏览器 ─┐
朋友浏览器 ─┼── Internet ── Node.js + Socket.IO 游戏服务器
第三名玩家 ─┘
```

只要把服务器部署到 Render、Railway、VPS 等公网环境，玩家就不需要位于同一局域网。

注意：代码本身不能凭空提供一个永久公网网址。公网网址必须由 Render、Railway、云服务器等平台实际托管后生成。
