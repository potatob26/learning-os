package com.learningos.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.learningos.app.widgets.WidgetStore;

/**
 * 桌面小组件的数据桥（WebView → 原生）。
 *
 * 为什么必须有这一层：小组件是**原生**组件，由系统 launcher 渲染，
 * 而 App 的数据在 WebView 的 localStorage / IndexedDB 里 —— 原生读不到。
 * 所以 Web 侧把小组件真正需要的那几个数字算好、打成一份小 JSON 推过来。
 *
 * 只在安卓上存在：Web/PWA 构建里 {@code Capacitor.isNativePlatform()} 为 false，
 * JS 侧会直接跳过，不会报错。
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    /** 接收一份载荷并立刻刷新桌面上的小组件 */
    @PluginMethod
    public void sync(PluginCall call) {
        String payload = call.getString("payload");
        if (payload == null || payload.isEmpty()) {
            call.reject("payload 不能为空");
            return;
        }
        WidgetStore.savePayload(getContext(), payload);
        WidgetStore.notifyAll(getContext());
        JSObject ret = new JSObject();
        ret.put("saved", true);
        ret.put("bytes", payload.length());
        call.resolve(ret);
    }

    /** 小组件是否可用（安卓上恒为 true；给 JS 侧做能力探测用） */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        call.resolve(ret);
    }
}
