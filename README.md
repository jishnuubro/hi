# PyLauncher (Electron) — Offline Minecraft Launcher

HTML + CSS + JavaScript দিয়ে বানানো UI, আর ভেতরে Electron (Node.js) থাকায় এটা
বাস্তবেই Minecraft ডাউনলোড ও লঞ্চ করতে পারে — একটা সাধারণ browser tab-এ চলা
JavaScript এটা পারত না (browser security sandbox প্রসেস চালাতে দেয় না)।

## চালানোর নিয়ম

1. [Node.js](https://nodejs.org) ইন্সটল করো (LTS version), যদি না থাকে।
2. এই ফোল্ডারে এসে টার্মিনালে লিখো:
   ```
   npm install
   npm start
   ```
3. প্রথমবার `npm install` একটু সময় নেবে (Electron ডাউনলোড হবে, প্রায় ১৫০-২০০ MB)।
4. এরপর অ্যাপ খুলবে — username দিয়ে account বানাও, version বেছে
   Download/Install চাপো, তারপর Play চাপলেই Minecraft চালু হবে।

## জরুরি শর্ত

- Java (JDK/JRE 17+) ইন্সটল করা থাকতে হবে এবং PATH-এ থাকতে হবে।
  অ্যাপ চালু হলে লগইন স্ক্রিনেই দেখাবে Java পাওয়া গেছে কিনা।
- নেটওয়ার্ক/ফায়ারওয়াল যেন `launchermeta.mojang.com` এবং
  `resources.download.minecraft.net`-এ যেতে দেয়।

## ফাইল গঠন

- `main.js` — Electron main process: ডাউনলোড, ফাইল সিস্টেম, Java launch (Node.js side)
- `preload.js` — renderer আর main process-এর মধ্যে নিরাপদ সেতু
- `index.html` / `styles.css` — UI
- `renderer.js` — UI logic, শুধু `window.api` দিয়ে main process-কে কল করে

## সীমাবদ্ধতা

- শুধু vanilla Minecraft (Forge/Fabric/mods সাপোর্ট নেই)
- Offline mode → শুধু single-player বা offline-mode চালু থাকা সার্ভারে খেলা যাবে
