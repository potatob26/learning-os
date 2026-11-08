package com.learningos.app.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 小组件的数据仓库（原生侧唯一的数据入口）。
 *
 * 为什么需要它：App 的数据在 WebView 的 localStorage / IndexedDB 里，
 * **原生代码读不到**。所以 Web 侧把小组件真正需要的那几个数字打成一份小 JSON，
 * 通过 {@link com.learningos.app.WidgetBridgePlugin} 推到这里（SharedPreferences），
 * 小组件渲染时只读本地，不需要唤醒 WebView、也不需要跑 JS。
 *
 * 存的是**结构化数据**而不是渲染好的字符串，这样小组件能做三件 Web 侧做不到的事：
 *   · 自己算「还有几天」（跨天后即使用户没打开 App 也是对的）
 *   · 自己轮换语句 / 切换重要日期（点击即换，不用开 App）
 *   · 自己按尺寸选布局
 *
 * 另外每个小组件实例有自己的状态（当前主题、当前索引），
 * 键名带上 appWidgetId，这样桌面上三个小组件可以各自不同主题、各自轮换。
 */
public final class WidgetStore {

    public static final String PREFS = "learning_os_widgets";

    /** Web 侧推来的那份 JSON */
    private static final String KEY_PAYLOAD = "payload";

    private WidgetStore() {}

    public static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /* ---------------- 载荷 ---------------- */

    public static void savePayload(Context ctx, String json) {
        prefs(ctx).edit().putString(KEY_PAYLOAD, json).apply();
    }

    public static JSONObject payload(Context ctx) {
        String raw = prefs(ctx).getString(KEY_PAYLOAD, null);
        if (raw == null) return new JSONObject();
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            // 存档坏了不能让小组件崩（系统进程里崩了会显示「加载中」）
            return new JSONObject();
        }
    }

    /* ---------------- 每个实例的状态 ---------------- */

    /** 主题 id，如 "pure-dark"；空表示跟随载荷里的默认主题 */
    public static String themeOf(Context ctx, int appWidgetId) {
        return prefs(ctx).getString("w" + appWidgetId + "_theme", "");
    }

    public static void setTheme(Context ctx, int appWidgetId, String theme) {
        prefs(ctx).edit().putString("w" + appWidgetId + "_theme", theme == null ? "" : theme).apply();
    }

    /** 当前显示的是第几条（语句 / 重要日期共用，各自的小组件互不影响） */
    public static int indexOf(Context ctx, int appWidgetId) {
        return prefs(ctx).getInt("w" + appWidgetId + "_index", 0);
    }

    public static void setIndex(Context ctx, int appWidgetId, int index) {
        prefs(ctx).edit().putInt("w" + appWidgetId + "_index", Math.max(0, index)).apply();
    }

    /* ---------------- 调色板 ---------------- */

    /**
     * 取某个主题的调色板。载荷里带的是全部 6 套主题的颜色，
     * 每个小组件按自己选的主题取一套 —— 这就是「每个小组件单独选主题」的实现。
     * 主题不存在时回落到载荷里的 defaultTheme。
     */
    public static JSONObject palette(Context ctx, int appWidgetId) {
        JSONObject p = payload(ctx);
        JSONObject palettes = p.optJSONObject("palettes");
        if (palettes == null) return new JSONObject();
        String want = themeOf(ctx, appWidgetId);
        if (want.isEmpty()) want = p.optString("defaultTheme", "");
        JSONObject pal = palettes.optJSONObject(want);
        if (pal != null) return pal;
        // 兜底：拿第一套，保证小组件永远有颜色可用，不会渲染成透明/黑块
        JSONArray names = palettes.names();
        if (names != null && names.length() > 0) {
            JSONObject first = palettes.optJSONObject(names.optString(0));
            if (first != null) return first;
        }
        return new JSONObject();
    }

    /** 主题顺序表（供点击轮换主题用），取自载荷里的 palettes 键顺序 */
    public static JSONArray themeOrder(Context ctx) {
        JSONObject palettes = payload(ctx).optJSONObject("palettes");
        if (palettes == null) return new JSONArray();
        JSONArray names = palettes.names();
        return names == null ? new JSONArray() : names;
    }

    /* ---------------- 通知刷新 ---------------- */

    /** 三类小组件全部重画一遍 */
    public static void notifyAll(Context ctx) {
        notifyProvider(ctx, PercentWidgetProvider.class);
        notifyProvider(ctx, QuoteWidgetProvider.class);
        notifyProvider(ctx, CountdownWidgetProvider.class);
    }

    public static void notifyProvider(Context ctx, Class<?> provider) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        ComponentName cn = new ComponentName(ctx, provider);
        int[] ids = mgr.getAppWidgetIds(cn);
        if (ids == null || ids.length == 0) return;   // 桌面上没放这个小组件，不用做事
        Intent intent = new Intent(ctx, provider);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        ctx.sendBroadcast(intent);
    }

    /** 某个实例所在的最小尺寸（dp）。API 31 以下用 minWidth/minHeight */
    public static int[] sizeOf(Context ctx, int appWidgetId) {
        // 整个方法都要兜住：假 id（debug 预览页用的负数）取不到信息，
        // 真机上个别 launcher 也会对已删除的实例抛异常。
        // 小组件跑在 launcher 进程里，这里抛出去那块就白了。
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            android.os.Bundle opts = mgr.getAppWidgetOptions(appWidgetId);
            int w = 0, h = 0;
            if (opts != null) {
                w = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                h = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
            }
            if (w <= 0 || h <= 0) {
                AppWidgetProviderInfo info = mgr.getAppWidgetInfo(appWidgetId);
                if (info != null) {
                    if (w <= 0) w = info.minWidth;
                    if (h <= 0) h = info.minHeight;
                }
            }
            return new int[] { w, h };
        } catch (Throwable t) {
            return new int[] { 0, 0 };   // 取不到就让 sizeTier 走中档
        }
    }
}
