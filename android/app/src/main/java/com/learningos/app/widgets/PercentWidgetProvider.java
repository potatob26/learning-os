package com.learningos.app.widgets;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.widget.RemoteViews;

import com.learningos.app.R;

import org.json.JSONObject;

/**
 * 小组件一：今日目标完成百分比。
 *
 * 口径与首页那个进度环**完全一致**：今日自学分钟数 ÷ 每日学习目标。
 * 这两个数字由 Web 侧用同一套统计代码算好后推过来（不在这里重算），
 * 所以不会出现「小组件和首页对不上」。
 */
public class PercentWidgetProvider extends BaseWidgetProvider {

    @Override
    protected int itemCount(Context ctx) {
        return 0;   // 这个小组件没有可轮换的内容，点一下不换东西
    }

    @Override
    protected void render(Context ctx, AppWidgetManager mgr, int id) {
        mgr.updateAppWidget(id, build(ctx, id));
    }

    /** 真机路径：尺寸从系统查 */
    public static RemoteViews build(Context ctx, int id) {
        int[] size = WidgetStore.sizeOf(ctx, id);
        return build(ctx, id, size[0], size[1]);
    }

    /**
     * 只构造 RemoteViews，不查系统、不提交。
     *
     * 尺寸由调用方传入（而不是在这里查系统），有两个好处：
     *   · debug 预览页可以用假尺寸渲染，不必给系统一个不存在的 appWidgetId
     *     （之前就是这里崩的：AppWidgetManager 对未知 id 返回 null，下游炸了）
     *   · 构造过程变成纯函数，可测试
     */
    public static RemoteViews build(Context ctx, int id, int widthDp, int heightDp) {
        JSONObject payload = WidgetStore.payload(ctx);
        JSONObject pal = WidgetStore.palette(ctx, id);
        JSONObject p = payload.optJSONObject("percent");
        if (p == null) p = new JSONObject();

        int tier = WidgetRender.sizeTier(widthDp, heightDp);

        int cText = WidgetRender.color(pal, "text", 0xFF101828);
        int cSub = WidgetRender.color(pal, "secondary", 0xFF5A6270);
        int cBg = WidgetRender.color(pal, "bg", 0xFFF6F7F9);
        int cAccent = WidgetRender.color(pal, "accent", 0xFF3F7DF6);

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_percent);
        WidgetRender.tint(v, R.id.w_bg, cBg);
        WidgetRender.text(v, R.id.w_title, "今日自学", cSub);

        int percent = p.optInt("percent", 0);
        WidgetRender.text(v, R.id.w_main, percent + "%", cText);
        // 大档才显示「2h02m / 3h」这种明细；小档只有百分比，避免挤成一团
        WidgetRender.text(v, R.id.w_sub, p.optString("detail", ""), cSub);
        WidgetRender.show(v, R.id.w_sub, tier >= 1 && !p.optString("detail", "").isEmpty());

        // 进度条：RemoteViews 支持 ProgressBar，比再塞一行文字直观
        int goal = Math.max(1, p.optInt("goalMinutes", 0));
        v.setProgressBar(R.id.w_bar, goal, Math.min(goal, p.optInt("studiedMinutes", 0)), false);
        WidgetRender.show(v, R.id.w_bar, tier >= 1);

        // 小档把字号压小一点，不然「100%」在 2×1 里会换行
        WidgetRender.textSize(v, R.id.w_main, tier == 0 ? 20f : tier == 1 ? 26f : 32f);
        WidgetRender.textSize(v, R.id.w_title, tier == 0 ? 9f : 10f);

        // 只有换主题这一个可点的东西（这个小组件没有「下一条」）
        WidgetRender.setClick(v, R.id.w_theme, ctx, PercentWidgetProvider.class, id, WidgetRender.ACTION_THEME);
        WidgetRender.tint(v, R.id.w_theme_dot, cAccent);

        return v;
    }
}
