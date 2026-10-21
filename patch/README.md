# 可选补丁

默认**不打**这个补丁：心情只改语气，不影响回不回话。

想让心情真的压住「回几条、回不回」，再装。

## 打

```bash
node plugins/qq-agent-mood/patch/install.mjs
```

它会改应用的两个源码文件（`src/orchestrator.js`、`src/tools.js`），把写死的情绪调用换成插件提供的「能力门」。
改之前按锚点 + 哈希双重校验，对得上才动；备份成 `*.bak-before-qq-agent-mood`；原子写（先写临时文件再改名）。

**对不上就一个字节都不动**——换过版本、被人手改过，它只会告诉你哪一处没对上。打完要重启应用。

## 还原

```bash
node plugins/qq-agent-mood/patch/install.mjs --undo
```

直接拿备份盖回去（不是反推替换），并把打补丁后的版本留一份 `*.patched-<时间戳>`，万一想再打回去。

## 注意

- 应用升级后锚点可能变，需要重新确认（脚本会告诉你对不上，不会改坏）
- 卸载插件时**先 `--undo` 再删文件夹**，否则还原脚本跟着一起没了
- 没打补丁时，两个能力门（`mood.bubble-cap` / `mood.mute-rate`）没人调用，等于空转，不报错
