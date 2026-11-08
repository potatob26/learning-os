package com.learningos.app.widgets;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * 小组件渲染的公共部分。
 *
 * 这里有两个 RemoteViews 的硬限制，决定了整个实现方式：
 *
 * ① **圆角 + 任意颜色不能同时靠 setBackgroundColor 做到**。
 *    `setBackgroundColor` 会把背景整个换成一个 ColorDrawable，圆角就没了。
 *    所以布局里垫一层白色圆角 shape 的 ImageView，再用
 *    `setInt(id, "setColorFilter", color)` 给它上色 —— 圆角得以保留，
 *    颜色还能每个小组件不同（这是「每个小组件单独选主题」能成立的前提）。
 *
 * ② 小组件跑在**系统 launcher 进程**里。这里任何异常都不能往外抛，
 *    否则桌面上那块会显示成「加载中」或直接空白。所以颜色、字号全部有兜底值。
 */
public final class WidgetRender {

    /** 点击「换下一条」的广播动作 */
    public static final String ACTION_NEXT = "com.learningos.app.widget.NEXT";
    /** 点击「换主题」的广播动作 */
    public static final String ACTION_THEME = "com.learningos.app.widget.THEME";
    /** 两个广播都带这个 extra，用来定位具体是哪个实例 */
    public static final String EXTRA_ID = "appWidgetId";

    private WidgetRender() {}

    /* ---------------- 颜色 ---------------- */

    /** 从调色板取色；缺失或格式不对时用兜底色，绝不让小组件变成透明/黑块 */
    public static int color(JSONObject pal, String key, int fallback) {
        if (pal == null) return fallback;
        String v = pal.optString(key, "");
        if (v == null || v.isEmpty()) return fallback;
        try {
            return Color.parseColor(v);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    /**
     * 给白色圆角 shape 上色。
     * 用 ImageView + 着色（而不是 setBackgroundColor）—— 见类注释 ①。
     *
     * ⚠️ **只能对 ImageView 调这个方法**。RemoteViews 的反射有个不比不知道的坑：
     * 对没有该方法的 View 调用会在 apply 时抛 ActionException，
     * 而 provider 那边有 try/catch 兜底 → 结果是**整块小组件静默变成兜底样式**，
     * 不报错、不崩溃，极难发现（本项目真的踩过：主题按钮是个 FrameLayout，
     * 给它调 setImageTintList 就炸，是 debug 预览页把它抓出来的）。
     * 所以主题按钮上色要用里面那个圆点 ImageView 的 id（w_theme_dot），不能用容器 id。
     *
     * 两条路径都要有（setInt 只允许 @RemotableViewMethod 方法）：
     *   · API 31+：setImageTintList 明确带注解，用 setColorStateList 传值 —— 最稳
     *   · 更早版本：setColorFilter(int) 是社区长期做法，作为回落
     */
    public static void tint(RemoteViews views, int viewId, int color) {
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            views.setColorStateList(viewId, "setImageTintList", android.content.res.ColorStateList.valueOf(color));
        } else {
            views.setInt(viewId, "setColorFilter", color);
        }
    }

    public static void text(RemoteViews views, int viewId, String value, int color) {
        views.setTextViewText(viewId, value == null ? "" : value);
        views.setTextColor(viewId, color);
    }

    /** 字号：倒计时要按小组件尺寸缩放，必须走 setTextViewTextSize 而不是布局里写死 */
    public static void textSize(RemoteViews views, int viewId, float sp) {
        views.setTextViewTextSize(viewId, TypedValue.COMPLEX_UNIT_SP, sp);
    }

    /* ---------------- 点击 ---------------- */

    /**
     * 点击区域用**广播**而不是启动 Activity。
     *
     * 这样点一下就能换下一条 / 换主题，**完全不用打开 App**、
     * 也不用把 WebView 拉起来（后者会明显卡一下，而且费电）。
     * 广播由小组件自己的 provider 收，改完状态直接重画。
     *
     * requestCode 必须带上 appWidgetId：PendingIntent 的相等判定包含 requestCode，
     * 不给它的话桌面上多个实例会共用同一个 PendingIntent，
     * 于是点任何一个都作用在同一个实例上。
     */
    public static void setClick(RemoteViews views, int viewId, Context ctx, Class<?> provider, int appWidgetId, String action) {
        Intent intent = new Intent(ctx, provider);
        intent.setAction(action);
        intent.putExtra(EXTRA_ID, appWidgetId);
        PendingIntent pi = PendingIntent.getBroadcast(
                ctx,
                appWidgetId,          // 见上面说明：不能省
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(viewId, pi);
    }

    /**
     * 尺寸分档。
     * 「调整比例 = 小组件尺寸」就是这么落地的：同一份内容按可用格子选不同的字号与信息密度，
     * 不需要用户配置，也不需要多套布局文件。
     *
     * **只按高度分档，不看宽度**。第一版是 `height < 150 && width < 200` 才当中档，
     * 结果 4×1 这种「宽而矮」的会被判成大档（AND 不成立就掉到 else），
     * 于是那个只有一行高的格子里塞进了副标题和更大的字号 —— 实测截图发现的。
     * 对一行高的小组件来说，限制信息密度的是**高度**，宽度再宽也放不下第二行。
     */
    public static int sizeTier(int widthDp, int heightDp) {
        if (widthDp <= 0 && heightDp <= 0) return 1;   // 取不到尺寸就用中档，别渲染成空白
        if (heightDp < 80) return 0;                   // 小：只留主数字/主文案
        if (heightDp < 140) return 1;                  // 中：加一行副标题（2×1 的常见高度）
        return 2;                                      // 大：再加提示行、字号放大
    }

    /** 让某个子视图显示/隐藏（RemoteViews 只有 setViewVisibility） */
    public static void show(RemoteViews views, int viewId, boolean visible) {
        views.setViewVisibility(viewId, visible ? View.VISIBLE : View.GONE);
    }
}
