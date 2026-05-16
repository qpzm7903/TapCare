#!/bin/bash
# build-hap.sh — 命令行构建 HarmonyOS Lite Wearable HAP 包
# 用法:
#   ./scripts/build-hap.sh [debug|release] [--push]
#
# variant 与底层映射:
#   debug   -> product=debug,   buildMode=debug,   debug 证书 (test.cer)
#   release -> product=default, buildMode=release, release 证书 (healthcounter_release.cer)
#
# 关键：product 决定签名，buildMode 决定构建选项（压缩/混淆等）。
# 两者必须配对，光改 buildMode 不会切换签名证书。
#
# --push:
#   构建成功后，通过 hdc 将 HAP 推送到手机 /sdcard/haps/，
#   配合"应用调测助手" App 蓝牙转发到手表。
#   要求：手机开发者选项 → USB 调试 已开 + 信任此电脑（不是"传输文件"模式）。
#
# 前置条件:
#   - DevEco Studio 已安装（提供 Node.js、hvigorw、hdc）
#   - OpenHarmony SDK 已下载
#   - build-profile.json5 中已声明 default + debug 两套 signingConfig 与 product

set -euo pipefail

# ========== 参数解析 ==========
PUSH=0
ARGS=()
for a in "$@"; do
    case "$a" in
        --push)    PUSH=1 ;;
        -h|--help)
            echo "用法: $0 [debug|release] [--push]"
            echo "  debug   -> debug 证书签名（默认推荐用于真机调试）"
            echo "  release -> release 证书签名（用于 AGC 上架）"
            echo "  --push  -> 构建后通过 hdc 推送到手机 /sdcard/haps/"
            exit 0 ;;
        *)         ARGS+=("$a") ;;
    esac
done

VARIANT="${ARGS[0]:-release}"
case "$VARIANT" in
    debug)   PRODUCT="debug";   BUILD_MODE="debug"   ;;
    release) PRODUCT="default"; BUILD_MODE="release" ;;
    *)
        echo "❌ 未知 variant: $VARIANT"
        echo "   用法: $0 [debug|release] [--push]"
        exit 2 ;;
esac

# ========== 路径配置 ==========
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HVIGOR_HOME="/Applications/DevEco-Studio.app/Contents/tools/hvigor"
NODE_BIN="/Applications/DevEco-Studio.app/Contents/tools/node/bin/node"
DEVECO_SDK_HOME="${DEVECO_SDK_HOME:-/Applications/DevEco-Studio.app/Contents/sdk}"
HDC_BIN="${HDC_BIN:-/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc}"
# adb 候选路径：环境变量 > Android SDK 默认安装位置 > PATH
ADB_BIN="${ADB_BIN:-$HOME/Library/Android/platform-tools/adb}"

TARGET="default"
HAP_DIR="$PROJECT_ROOT/entry/build/$PRODUCT/outputs/$TARGET"
HAP_FILE_PATH="$HAP_DIR/entry-${TARGET}-signed.hap"

# ========== 前置检查 ==========
echo "🔍 检查构建环境..."

[ -f "$NODE_BIN" ]                         || { echo "❌ Node.js 未找到: $NODE_BIN"; exit 1; }
[ -f "$HVIGOR_HOME/bin/hvigorw.js" ]       || { echo "❌ hvigorw.js 未找到"; exit 1; }
[ -d "$DEVECO_SDK_HOME" ]                  || { echo "❌ OpenHarmony SDK 未找到: $DEVECO_SDK_HOME"; exit 1; }
[ -f "$PROJECT_ROOT/build-profile.json5" ] || { echo "❌ build-profile.json5 缺失"; exit 1; }

echo "✅ Node.js:  $($NODE_BIN --version)"
echo "✅ SDK:      $DEVECO_SDK_HOME"
echo "✅ Variant:  $VARIANT (product=$PRODUCT, buildMode=$BUILD_MODE)"
[ "$PUSH" = "1" ] && echo "✅ 构建后将 hdc push 到 /sdcard/haps/"
echo ""

# ========== 构建 ==========
echo "🔨 开始构建 HAP..."
echo "────────────────────────────────────"

cd "$PROJECT_ROOT"
export DEVECO_SDK_HOME
export PATH="$HVIGOR_HOME/bin:$PATH"

"$NODE_BIN" "$HVIGOR_HOME/bin/hvigorw.js" assembleHap \
    --mode module \
    -p product="$PRODUCT" \
    -p buildMode="$BUILD_MODE" \
    --no-daemon

echo ""
echo "────────────────────────────────────"

# ========== 验证输出 ==========
if [ ! -f "$HAP_FILE_PATH" ]; then
    echo "❌ HAP 未生成。预期: $HAP_FILE_PATH"
    [ -d "$HAP_DIR" ] && ls -la "$HAP_DIR" || echo "   目录不存在"
    exit 1
fi
HAP_FILE="$HAP_FILE_PATH"
HAP_SIZE=$(du -h "$HAP_FILE" | cut -f1)
echo "✅ HAP 构建成功"
echo "   📦 $HAP_FILE"
echo "   📏 $HAP_SIZE"

# 完整性检查（debug/release 的 HAP 内部结构不同 — Lite Wearable 特性）
#   release: config.json + pack.info + assets/        （应用市场审核用）
#   debug:   entry-default-signed.bin                 （应用调测助手安装用）
if command -v unzip &>/dev/null; then
    TEMP_DIR=$(mktemp -d)
    unzip -q "$HAP_FILE" -d "$TEMP_DIR" 2>/dev/null || true

    if [ "$BUILD_MODE" = "release" ]; then
        [ -f "$TEMP_DIR/config.json" ] && echo "   ✅ config.json (FA 模型)" \
                                       || echo "   ❌ config.json 缺失"
        [ -f "$TEMP_DIR/module.json5" ] && echo "   ❌ 出现 module.json5（Stage 模型产物，本项目应为 FA）"
    else
        [ -f "$TEMP_DIR/entry-default-signed.bin" ] && echo "   ✅ entry-default-signed.bin (Lite debug BIN)" \
                                                    || echo "   ⚠️ debug 模式预期内含 BIN，未找到"
    fi
    rm -rf "$TEMP_DIR"
fi

# 严格验签（若 SDK 自带 hap-sign-tool 可用）
SIGN_TOOL="/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"
JAVA_BIN="/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home/bin/java"
if [ -f "$SIGN_TOOL" ] && [ -x "$JAVA_BIN" ]; then
    # hap-sign-tool 按扩展名判定可写文件类型，必须 .cer / .p7b 结尾。
    # macOS 的 mktemp -t 会把整个串当 prefix 并追加随机串，破坏扩展名 — 这里用 mktemp -d 后自拼路径。
    SIG_TMP=$(mktemp -d)
    CHAIN_OUT="$SIG_TMP/chain.cer"
    PROFILE_OUT="$SIG_TMP/profile.p7b"
    if "$JAVA_BIN" -jar "$SIGN_TOOL" verify-app \
        -inFile "$HAP_FILE" \
        -outCertChain "$CHAIN_OUT" \
        -outProfile  "$PROFILE_OUT" >/dev/null 2>&1; then
        PROFILE_MD5=$(md5 -q "$PROFILE_OUT" 2>/dev/null || md5sum "$PROFILE_OUT" | awk '{print $1}')
        echo "   🔐 验签通过, profile MD5: $PROFILE_MD5"
    else
        echo "   ⚠️ 验签失败（hap-sign-tool 报错）"
    fi
    rm -rf "$SIG_TMP"
fi

# ========== 推送到手机 ==========
# 自动选择推送工具：
#   - HarmonyOS 4 (Mate 40 Pro 等历史机型) 实测 adb 工作最稳，hdc client/server 版本常对不上
#   - HarmonyOS 5 / NEXT (纯血鸿蒙) 砍了 adb，必须用 hdc
# 优先 adb（已识别到设备就用），失败再 fallback hdc
if [ "$PUSH" = "1" ]; then
    echo ""
    echo "📲 推送到手机 /sdcard/haps/ ..."

    PUSH_TOOL=""
    PUSH_TOOL_NAME=""

    # 候选 1: adb
    if [ -x "$ADB_BIN" ]; then
        ADB_DEVS=$("$ADB_BIN" devices 2>/dev/null | tail -n +2 | grep -E "device$" || true)
        if [ -n "$ADB_DEVS" ]; then
            PUSH_TOOL="$ADB_BIN"
            PUSH_TOOL_NAME="adb"
            echo "   工具: adb ($ADB_BIN)"
            echo "   设备:"
            echo "$ADB_DEVS" | awk '{print "     " $1}'
        fi
    fi

    # 候选 2: hdc (fallback)
    if [ -z "$PUSH_TOOL" ] && [ -x "$HDC_BIN" ]; then
        HDC_DEVS=$("$HDC_BIN" list targets 2>&1 | grep -v "^\[Empty\]" | grep -v "^$" || true)
        if [ -n "$HDC_DEVS" ]; then
            PUSH_TOOL="$HDC_BIN"
            PUSH_TOOL_NAME="hdc"
            echo "   工具: hdc ($HDC_BIN)"
            echo "   设备:"
            echo "$HDC_DEVS" | sed 's/^/     /'
        fi
    fi

    if [ -z "$PUSH_TOOL" ]; then
        echo "❌ 没有连接的设备（adb 和 hdc 都未识别到）"
        echo "   adb 路径: ${ADB_BIN:-未设置}  ($([ -x "$ADB_BIN" ] && echo 可执行 || echo 不存在))"
        echo "   hdc 路径: $HDC_BIN  ($([ -x "$HDC_BIN" ] && echo 可执行 || echo 不存在))"
        echo ""
        echo "   排查清单："
        echo "   1. 手机已 USB 连接（数据线，不是充电线）"
        echo "   2. 手机：设置 → 系统 → 开发人员选项 → USB 调试 已开"
        echo '      （不是 USB 连接选项里的"传输文件 (MTP)"）'
        echo "   3. 首次连接需在手机弹窗点击「允许」信任此电脑"
        echo "   4. HarmonyOS 4 及以下推荐 adb；HarmonyOS 5/NEXT 必须 hdc"
        exit 1
    fi

    # 确保目标目录存在（应用调测助手监听这个目录）
    "$PUSH_TOOL" shell mkdir -p /sdcard/haps >/dev/null 2>&1 || true

    # adb 用 push, hdc 用 file send
    if [ "$PUSH_TOOL_NAME" = "adb" ]; then
        if "$PUSH_TOOL" push "$HAP_FILE" /sdcard/haps/ 2>&1 | tail -2; then
            echo "   ✅ 推送完成"
        else
            echo "   ❌ adb push 失败"
            exit 1
        fi
    else
        PUSH_LOG=$(mktemp)
        "$PUSH_TOOL" file send "$HAP_FILE" /sdcard/haps/ 2>&1 | tee "$PUSH_LOG" | tail -3
        if grep -qiE "FileTransfer finish|success" "$PUSH_LOG"; then
            echo "   ✅ 推送完成"
        else
            echo "   ⚠️ hdc 命令执行了，但未检测到成功标识，请人工核查"
        fi
        rm -f "$PUSH_LOG"
    fi

    echo ""
    echo "▶ 下一步：在手机上打开「应用调测助手」App，会自动列出新 HAP，选中蓝牙发送到手表。"
else
    echo ""
    echo "🚀 下一步: 自动推送 → ./scripts/build-hap.sh $VARIANT --push"
fi
