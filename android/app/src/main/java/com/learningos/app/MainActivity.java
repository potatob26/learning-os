package com.learningos.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        /*
         * 必须在 super.onCreate 之前注册插件 —— Capacitor 是在 super 里构建 Bridge 的，
         * 注册晚了插件不会被加载，JS 侧调用会报「not implemented」。
         */
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
